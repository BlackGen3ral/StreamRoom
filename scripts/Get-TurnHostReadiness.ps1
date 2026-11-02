[CmdletBinding()]
param(
    [string]$InterfaceAlias = 'Ethernet',
    [string]$RouterWan = '',
    [string]$UpstreamGateway = '',
    [ValidateRange(1024,65535)][int]$ListenPort = 3478,
    [ValidateRange(1024,65535)][int]$RelaySamplePort = 49160,
    [string]$ReportPath = (Join-Path $env:LOCALAPPDATA ('StreamRoom/NetworkDiagnostics/readiness-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '.json'))
)
$ErrorActionPreference = 'Stop'
function Get-AddressScope([string]$Value) {
    $ip = $null
    if (![Net.IPAddress]::TryParse($Value, [ref]$ip) -or $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return 'unknown' }
    $b=$ip.GetAddressBytes()
    if ($b[0] -eq 10 -or ($b[0] -eq 172 -and $b[1] -ge 16 -and $b[1] -le 31) -or ($b[0] -eq 192 -and $b[1] -eq 168)) { return 'private' }
    if ($b[0] -eq 100 -and $b[1] -ge 64 -and $b[1] -le 127) { return 'shared-cgn-range' }
    if ($b[0] -eq 0 -or $b[0] -eq 127 -or ($b[0] -eq 169 -and $b[1] -eq 254) -or $b[0] -ge 224) { return 'non-public' }
    return 'public-candidate'
}
$config = Get-NetIPConfiguration -InterfaceAlias $InterfaceAlias
$local = @($config.IPv4Address.IPAddress)[0]
if (!$local -or !$config.IPv4DefaultGateway) { throw 'Escolha uma interface IPv4 com gateway de internet.' }
$public = $null; $publicError = $null
try {
    $trace = Invoke-RestMethod 'https://www.cloudflare.com/cdn-cgi/trace' -TimeoutSec 8
    $value = (($trace -split "`n" | Where-Object { $_ -match '^ip=' } | Select-Object -First 1) -replace '^ip=','').Trim()
    if ((Get-AddressScope $value) -eq 'public-candidate') { $public=$value }
    else { $publicError='Nenhum IPv4 publico obtido pelo HTTPS.' }
} catch { $publicError='Consulta HTTPS indisponivel.' }
$bindings = @()
foreach ($port in @($ListenPort,$RelaySamplePort) | Select-Object -Unique) {
    $socket = [Net.Sockets.Socket]::new([Net.Sockets.AddressFamily]::InterNetwork,[Net.Sockets.SocketType]::Dgram,[Net.Sockets.ProtocolType]::Udp)
    $socket.ExclusiveAddressUse=$true
    try { $socket.Bind([Net.IPEndPoint]::new([Net.IPAddress]::Parse($local),$port)); $bindings += @{port=$port;localBindAvailable=$true} }
    catch [Net.Sockets.SocketException] { $bindings += @{port=$port;localBindAvailable=$false;error=$_.Exception.SocketErrorCode.ToString()} }
    finally { $socket.Dispose() }
}
$profiles=@(Get-NetFirewallProfile | ForEach-Object { @{name=$_.Name;enabled=$_.Enabled.ToString();defaultInbound=$_.DefaultInboundAction.ToString();defaultOutbound=$_.DefaultOutboundAction.ToString()} })
$networks=@(Get-NetConnectionProfile -InterfaceAlias $InterfaceAlias -ErrorAction SilentlyContinue | ForEach-Object { @{category=$_.NetworkCategory.ToString()} })
$firewallRules=@(Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True | ForEach-Object {
    $rule=$_
    $filters=@($rule | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue)
    foreach($filter in $filters) {
        # Exact relevant rules only. Any/range/app/policy rules still require review.
        if ($filter.Protocol -in @('UDP','17') -and (@($filter.LocalPort) -contains [string]$ListenPort -or @($filter.LocalPort) -contains [string]$RelaySamplePort)) {
            @{name=$rule.DisplayName;direction=$rule.Direction.ToString();action=$rule.Action.ToString();profile=$rule.Profile.ToString();ports=$filter.LocalPort}
        }
    }
})
$scope=Get-AddressScope $RouterWan
$nat = if ($scope -eq 'private') { 'upstream-private-address-reported' } elseif ($scope -eq 'shared-cgn-range') { 'shared-address-reported-needs-isp-confirmation' } elseif ($RouterWan -and $public -and $RouterWan -ne $public) { 'reported-wan-differs-from-observed-public' } else { 'unknown' }
$docker = @{installed=[bool](Get-Command docker -ErrorAction SilentlyContinue);engineAvailable=$false}
if ($docker.installed) {
    try {
        # Inspect only; never start Docker, create containers or pull images.
        $start=[Diagnostics.ProcessStartInfo]::new((Get-Command docker).Source,'version --format "{{json .}}"')
        $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
        $process=[Diagnostics.Process]::Start($start);$out=$process.StandardOutput.ReadToEndAsync();$err=$process.StandardError.ReadToEndAsync()
        try {
            if (!$process.WaitForExit(6000)) { $process.Kill(); throw 'Docker indisponivel.' }
            if ($process.ExitCode -eq 0) { $version=$out.GetAwaiter().GetResult() | ConvertFrom-Json; $docker.engineAvailable=$null -ne $version.Server; $docker.version=$version.Client.Version; $docker.serverOS=$version.Server.Os }
            $null=$err.GetAwaiter().GetResult()
        } finally { $process.Dispose() }
    } catch { $docker.engineAvailable=$false }
}
$report=[ordered]@{
    format=1;at=[DateTime]::UtcNow.ToString('o');interface=$InterfaceAlias;localIpv4=$local;gateway=$config.IPv4DefaultGateway.NextHop
    publicIpv4=$public;publicMethod='HTTPS Cloudflare trace; not an inbound connectivity test';publicError=$publicError
    reportedRouterWan=$RouterWan;reportedUpstreamGateway=$UpstreamGateway;wanSource='user-supplied, not read from router';wanScope=$scope;natEvidence=$nat
    globalIpv6=@(Get-NetIPAddress -InterfaceAlias $InterfaceAlias -AddressFamily IPv6 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -match '^[23]' -and $_.AddressState -eq 'Preferred' } | ForEach-Object {$_.IPAddress})
    udpPorts=$bindings;firewallProfiles=$profiles;activeNetworkProfiles=$networks;exactUdpRules=$firewallRules
    firewallConclusion='Rules above are incomplete evidence; no firewall change made. Do not disable the firewall to test.'
    docker=$docker;portForwarding='NOT_VERIFIED: requires authorized administrator of every upstream NAT'
    externalUdp='NOT_TESTED';turnAllocation='NOT_TESTED';crossNetworkMedia='NOT_TESTED'
    decision='NOT_READY: do not deploy coturn or integrate a fallback before confirming external ingress'
}
$parent=Split-Path -Parent ([IO.Path]::GetFullPath($ReportPath));New-Item -ItemType Directory -Path $parent -Force | Out-Null
$report | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
Write-Output "Relatorio privado salvo em: $ReportPath"
Write-Output "Portas UDP livres para bind local: $(@($bindings | Where-Object {$_.localBindAvailable}).Count)/$($bindings.Count). Isso nao prova acesso externo."
Write-Output "NAT: $nat. Encaminhamento no equipamento principal ainda nao verificado."
Write-Output 'Resultado: hospedagem TURN externa NAO COMPROVADA. Nenhum roteador, firewall ou servico foi alterado.'
