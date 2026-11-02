# Local preparation checks only. No router/firewall change or external UDP probe.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$probe=Join-Path $root 'scripts/Test-TurnUdpPath.ps1'
foreach($path in @($probe,(Join-Path $root 'scripts/Get-TurnHostReadiness.ps1'))) {
    $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors)
    if($errors){throw ($errors.Message -join '; ')}
}
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($probe,[ref]$tokens,[ref]$errors)
$ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$true) | ForEach-Object { . ([scriptblock]::Create($_.Extent.Text)) }
foreach($value in @('127.0.0.1','192.168.0.1','10.0.0.1','172.16.0.1','100.64.0.1','169.254.1.1','224.0.0.1','::1','not-an-ip')) {
    if(Is-PublicV4 $value){throw 'A non-public address was accepted.'}
}
if(!(Is-PublicV4 '1.1.1.1')){throw 'Public address rejected.'}
$key=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($key)}finally{$rng.Dispose()}
$request=Sign-Packet $key 'SRUDP1|nonce1';$reply=Sign-Packet $key 'SRUDP1-OK|nonce1';$other=Sign-Packet $key 'SRUDP1|nonce2'
if(!(Same-Mac $request $request) -or (Same-Mac $request $reply) -or (Same-Mac $request $other) -or (Same-Mac $request 'invalid')){throw 'Packet authentication failed.'}
try { & $probe -Mode Probe -TicketPath (Join-Path $env:TEMP 'unused-turn-ticket.json');throw 'Missing declaration was accepted.' }
catch { if($_.Exception.Message -notmatch 'DifferentInternet'){throw} }
$expired=Join-Path $env:TEMP ('turn-udp-ticket-test-' + [Guid]::NewGuid().ToString('N') + '.json')
try {
    @{format=1;kind='StreamRoom-UDP-PRECHECK-NOT-TURN';expiresAt=[DateTime]::UtcNow.AddMinutes(-1).ToString('o');target='1.1.1.1';ports=@(3478);secret=[Convert]::ToBase64String($key)} | ConvertTo-Json | Set-Content -LiteralPath $expired -Encoding UTF8
    try { & $probe -Mode Probe -TicketPath $expired -DifferentInternet;throw 'Expired ticket was accepted.' }
    catch { if($_.Exception.Message -notmatch 'expirado'){throw} }
} finally { Remove-Item -LiteralPath $expired -ErrorAction SilentlyContinue }
Write-Output 'PASS syntax, non-public address rejection, request/response signatures, nonce change rejection and external-test declaration.'
Write-Output 'PASS expired ticket rejected before network probes.'
Write-Output 'External UDP, TURN allocation and cross-network media: NOT TESTED.'
