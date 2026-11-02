# Preliminary authenticated UDP round trip only. NOT a TURN server, allocation,
# relay or audiovisual test. No firewall/router configuration is performed.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Listen','Probe')][string]$Mode,
    [Parameter(Mandatory)][string]$TicketPath,
    [string]$PublicIpv4='',
    [string]$BindIpv4='0.0.0.0',
    [ValidateRange(1024,65535)][int[]]$Ports=@(3478,49160),
    [ValidateRange(15,180)][int]$Seconds=90,
    [switch]$DifferentInternet,
    [string]$ReportPath=''
)
$ErrorActionPreference='Stop'
function Is-PublicV4([string]$Value) {
    $ip=$null
    if (![Net.IPAddress]::TryParse($Value,[ref]$ip) -or $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return $false }
    $b=$ip.GetAddressBytes()
    return !($b[0] -eq 0 -or $b[0] -eq 10 -or $b[0] -eq 127 -or $b[0] -ge 224 -or ($b[0] -eq 169 -and $b[1] -eq 254) -or ($b[0] -eq 172 -and $b[1] -ge 16 -and $b[1] -le 31) -or ($b[0] -eq 192 -and $b[1] -eq 168) -or ($b[0] -eq 100 -and $b[1] -ge 64 -and $b[1] -le 127))
}
function Observed-PublicV4 {
    $trace=Invoke-RestMethod 'https://www.cloudflare.com/cdn-cgi/trace' -TimeoutSec 8
    $value=(($trace -split "`n" | Where-Object {$_ -match '^ip='} | Select-Object -First 1) -replace '^ip=','').Trim()
    if (!(Is-PublicV4 $value)) { throw 'Nao foi possivel obter IPv4 publico para diferenciar teste externo de local.' };return $value
}
function Sign-Packet([byte[]]$Key,[string]$Value) {
    $hmac=[Security.Cryptography.HMACSHA256]::new($Key)
    try { return [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::ASCII.GetBytes($Value))) } finally {$hmac.Dispose()}
}
function Same-Mac([string]$A,[string]$B) {
    $aBytes=[Text.Encoding]::ASCII.GetBytes($A);$bBytes=[Text.Encoding]::ASCII.GetBytes($B)
    if ($aBytes.Length -ne $bBytes.Length) {return $false};$difference=0
    for($i=0;$i -lt $aBytes.Length;$i++){$difference=$difference -bor ($aBytes[$i] -bxor $bBytes[$i])};return $difference -eq 0
}
$TicketPath=[IO.Path]::GetFullPath($TicketPath)
if (!$ReportPath) { $ReportPath=Join-Path $env:LOCALAPPDATA ('StreamRoom/NetworkDiagnostics/udp-' + $Mode.ToLower() + '-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '.json') }
$sockets=@();$results=@();$count=0;$key=$null
try {
    if($Mode -eq 'Listen') {
        $Ports=@($Ports | Select-Object -Unique)
        if($Ports.Count -gt 2 -or $Ports.Count -lt 1){throw 'Use no maximo duas portas de pre-teste.'}
        if(Test-Path -LiteralPath $TicketPath){throw 'Escolha um caminho novo para o ticket temporario.'}
        $observed=Observed-PublicV4
        if($PublicIpv4 -and $PublicIpv4 -ne $observed){throw 'O IP informado difere do IPv4 publico observado; confirme a rede antes de testar.'}
        $PublicIpv4=$observed
        $key=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($key)}finally{$rng.Dispose()}
        $expires=[DateTime]::UtcNow.AddSeconds($Seconds)
        foreach($port in $Ports) {
            $socket=[Net.Sockets.Socket]::new([Net.Sockets.AddressFamily]::InterNetwork,[Net.Sockets.SocketType]::Dgram,[Net.Sockets.ProtocolType]::Udp)
            $sockets+=,$socket;$socket.ExclusiveAddressUse=$true;$socket.Bind([Net.IPEndPoint]::new([Net.IPAddress]::Parse($BindIpv4),$port))
        }
        $ticket=@{format=1;kind='StreamRoom-UDP-PRECHECK-NOT-TURN';target=$PublicIpv4;ports=$Ports;expiresAt=$expires.ToString('o');secret=[Convert]::ToBase64String($key)}
        New-Item -ItemType Directory -Path (Split-Path -Parent $TicketPath) -Force | Out-Null
        $ticket | ConvertTo-Json | Set-Content -LiteralPath $TicketPath -Encoding UTF8
        Write-Output "Pre-teste UDP ativo por $Seconds segundos. Envie o ticket em particular ao amigo; nao publique nem cole no chat."
        Write-Output 'Nao e coturn. Nenhum pacote de midia e retransmitido. Nenhuma regra de firewall foi criada.'
        while([DateTime]::UtcNow -lt $expires -and $count -lt 20) {
            foreach($socket in $sockets) {
                if(!$socket.Poll(100000,[Net.Sockets.SelectMode]::SelectRead)){continue}
                $buffer=New-Object byte[] 1024;$remote=[Net.EndPoint][Net.IPEndPoint]::new([Net.IPAddress]::Any,0)
                $length=$socket.ReceiveFrom($buffer,[ref]$remote)
                if($length -gt 512){continue};$parts=[Text.Encoding]::ASCII.GetString($buffer,0,$length).Split('|')
                if($parts.Length -ne 3 -or $parts[0] -ne 'SRUDP1' -or $parts[1] -notmatch '^[a-f0-9]{32}$' -or !(Same-Mac $parts[2] (Sign-Packet $key ($parts[0]+'|'+$parts[1])))){continue}
                $count++;$body='SRUDP1-OK|'+$parts[1];$reply=[Text.Encoding]::ASCII.GetBytes($body+'|'+(Sign-Packet $key $body));$null=$socket.SendTo($reply,$remote)
                $external=(Is-PublicV4 $remote.Address.ToString()) -and $remote.Address.ToString() -ne $PublicIpv4
                $results+=@{port=$socket.LocalEndPoint.Port;signedRequestReceived=$true;responseSent=$true;sourceDifferentPublicIpv4=$external;at=[DateTime]::UtcNow.ToString('o')}
            }
        }
        $classification=if(@($results | Where-Object {$_.sourceDifferentPublicIpv4}).Count){'SIGNED_REQUEST_FROM_OTHER_PUBLIC_IP_SEEN_COMPARE_CLIENT_REPORT'}else{'NO_EXTERNAL_EVIDENCE'}
    } else {
        if(!$DifferentInternet){throw 'Execute no PC de outra casa e confirme -DifferentInternet. Testes locais nao validam entrada externa.'}
        if((Get-Item -LiteralPath $TicketPath).Length -gt 4096){throw 'Ticket invalido.'}
        $ticket=Get-Content -LiteralPath $TicketPath -Raw | ConvertFrom-Json
        $expires=[DateTime]::Parse($ticket.expiresAt).ToUniversalTime()
        if($ticket.format -ne 1 -or $ticket.kind -ne 'StreamRoom-UDP-PRECHECK-NOT-TURN' -or $expires -le [DateTime]::UtcNow -or $expires -gt [DateTime]::UtcNow.AddSeconds(185) -or !(Is-PublicV4 $ticket.target)){throw 'Ticket invalido ou expirado.'}
        $key=[Convert]::FromBase64String($ticket.secret);if($key.Length -ne 32){throw 'Ticket invalido.'}
        $portsToTest=@($ticket.ports);if($portsToTest.Count -gt 2 -or $portsToTest.Count -lt 1){throw 'Portas invalidas.'}
        $clientPublic=Observed-PublicV4
        if($clientPublic -eq $ticket.target){throw 'Mesmo IPv4 publico: nao e evidencia de outra internet.'}
        foreach($port in $portsToTest) {
            if([int]$port -lt 1024 -or [int]$port -gt 65535){throw 'Porta invalida.'}
            $socket=[Net.Sockets.Socket]::new([Net.Sockets.AddressFamily]::InterNetwork,[Net.Sockets.SocketType]::Dgram,[Net.Sockets.ProtocolType]::Udp);$sockets+=,$socket;$socket.ReceiveTimeout=1500
            $destination=[Net.IPEndPoint]::new([Net.IPAddress]::Parse($ticket.target),[int]$port);$passed=$false
            for($attempt=0;$attempt -lt 3 -and !$passed -and [DateTime]::UtcNow -lt $expires;$attempt++) {
                $nonce=[Guid]::NewGuid().ToString('N');$body='SRUDP1|'+$nonce;$packet=[Text.Encoding]::ASCII.GetBytes($body+'|'+(Sign-Packet $key $body));$null=$socket.SendTo($packet,$destination)
                try {
                    $buffer=New-Object byte[] 1024;$source=[Net.EndPoint][Net.IPEndPoint]::new([Net.IPAddress]::Any,0);$length=$socket.ReceiveFrom($buffer,[ref]$source)
                    $response=[Text.Encoding]::ASCII.GetString($buffer,0,$length).Split('|')
                    $passed=$source.Equals($destination) -and $response.Length -eq 3 -and $response[0] -eq 'SRUDP1-OK' -and $response[1] -eq $nonce -and (Same-Mac $response[2] (Sign-Packet $key ($response[0]+'|'+$response[1])))
                }catch [Net.Sockets.SocketException] { }
            }
            $results+=@{port=[int]$port;signedUdpRoundTrip=$passed;differentPublicIpv4=$true}
        }
        $classification=if(@($results | Where-Object {!$_.signedUdpRoundTrip}).Count -eq 0){'PRELIMINARY_EXTERNAL_UDP_ONLY_NOT_TURN'}else{'EXTERNAL_UDP_NOT_CONFIRMED'}
    }
    $report=@{format=1;mode=$Mode;at=[DateTime]::UtcNow.ToString('o');classification=$classification;results=$results;turnAllocation='NOT_TESTED';relayMedia='NOT_TESTED';limits='UDP preliminary test only; no proof of coturn allocation, all relay ports, media, or continuous reachability.'}
    New-Item -ItemType Directory -Path (Split-Path -Parent ([IO.Path]::GetFullPath($ReportPath))) -Force | Out-Null
    $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
    Write-Output "Resultado: $classification. Relatorio: $ReportPath"
} finally { foreach($socket in $sockets){$socket.Dispose()};if($key){[Array]::Clear($key,0,$key.Length)} }
