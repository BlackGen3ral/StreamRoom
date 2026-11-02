# Local interface-discovery test only. No cross-network/media success is claimed.
# Does not install, join networks, change permissions, routes, firewall or settings.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{16}$')][string]$NetworkId,
    [string]$Dotnet='dotnet',
    [string]$ReportPath=(Join-Path $env:LOCALAPPDATA ('StreamRoom/NetworkDiagnostics/zerotier-ice-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '.json'))
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$bin=Join-Path $env:ProgramData 'ZeroTier/One/zerotier-one_x64.exe'
if(!(Test-Path -LiteralPath $bin)){throw 'ZeroTier oficial ainda nao instalado. Este diagnostico nao instala software.'}
$networkOutput=& $bin -q -j listnetworks 2>$null
if($LASTEXITCODE -ne 0){throw 'Sem acesso de leitura ao estado do ZeroTier. Nao copie authtoken.secret nem altere permissoes de seus arquivos.'}
$network=(($networkOutput -join "`n")|ConvertFrom-Json)|Where-Object {$_.id -eq $NetworkId -or $_.nwid -eq $NetworkId}
if(!$network -or $network.status -ne 'OK' -or $network.type -ne 'PRIVATE' -or !@($network.assignedAddresses).Count){throw 'A rede privada ainda nao esta autorizada com endereco atribuido. O proprietario deve conferir o painel Central.'}
$addresses=@($network.assignedAddresses|ForEach-Object{($_ -split '/')[0]})
$known=ConvertTo-Json -InputObject $addresses -Compress
$serviceOutput=& $bin -q -j info 2>$null
if($LASTEXITCODE -ne 0){throw 'Estado do servico indisponivel.'}
$service=($serviceOutput -join "`n")|ConvertFrom-Json
& $Dotnet build (Join-Path $root 'src/StreamRoom.App') -c Release --nologo
if($LASTEXITCODE -ne 0){throw 'Build failed.'}
# A private copy ensures probe injection never touches source or normal output.
$directory=Join-Path ([IO.Path]::GetTempPath()) ('streamroom-zt-discovery-'+[Guid]::NewGuid().ToString('N'))
$app=Join-Path $directory 'app';New-Item -ItemType Directory -Path $app -Force|Out-Null
$build=Join-Path $root 'src/StreamRoom.App/bin/Release/net10.0-windows10.0.22621.0'
Copy-Item -Path (Join-Path $build '*') -Destination $app -Recurse
$probePath=Join-Path $app 'Web/network-test.mjs'
$result=Join-Path $directory 'result.json'
$profile=Join-Path $directory 'preview.png'
$script=@'
const known=__KNOWN__;
let sequence=0;const requests=new Map();
function native(type,payload={}){return new Promise((resolve,reject)=>{const id=String(++sequence);requests.set(id,{resolve,reject});window.chrome.webview.postMessage({id,type,payload});});}
window.chrome.webview.addEventListener('message',({data})=>{if(data.type==='reply'){const r=requests.get(data.id);if(!r)return;requests.delete(data.id);data.ok?r.resolve(data.result):r.reject(Error('native-error'));}});
const candidates=[];let pc,error=null,ready,permissions={};
try {
 ready=await native('ready');
 for(const name of ['camera','microphone']){try{permissions[name]=(await navigator.permissions.query({name})).state;}catch{permissions[name]='unavailable';}}
 pc=new RTCPeerConnection({iceServers:[{urls:['stun:stun.cloudflare.com:3478','stun:stun.l.google.com:19302']}],iceTransportPolicy:'all',bundlePolicy:'max-bundle'});
 pc.createDataChannel('interface-discovery-only');
 const gathered=new Promise(resolve=>{pc.onicecandidate=({candidate:c})=>{if(!c){resolve();return;}candidates.push({type:c.type,zeroTier:known.includes(c.address),obfuscated:c.address?.endsWith('.local')??false,protocol:c.protocol});};setTimeout(resolve,12000);});
 await pc.setLocalDescription(await pc.createOffer());await gathered;
}catch(e){error=e.name;}
finally {
 const gathering=pc?.iceGatheringState??'unavailable';pc?.close();
 await native('testResult',{format:1,at:new Date().toISOString(),kind:'LOCAL_INTERFACE_DISCOVERY_ONLY',runtime:ready?.runtime,version:ready?.version,
  existingTailscaleFlagsEnabled:ready?.settings?.tailscaleEnabled===true,permissions,gathering,knownZeroTierAddressCount:known.length,
  zeroTierCandidates:candidates.filter(c=>c.zeroTier).length,candidates,error,crossNetworkMedia:'NOT_TESTED',audioVideo:'NOT_TESTED'});
}
'@
$process=$null
try {
    [IO.File]::WriteAllText($probePath,$script.Replace('__KNOWN__',$known))
    $dll=Join-Path $app 'StreamRoom.dll'
    $process=Start-Process -FilePath $Dotnet -ArgumentList @('"'+$dll+'"','--network-test','"'+$result+'"','--ui-preview','"'+$profile+'"') -PassThru -WindowStyle Hidden
    if(!$process.WaitForExit(20000)){throw 'Discovery timed out; no success claimed.'}
    if(!(Test-Path -LiteralPath $result)){throw 'No discovery report.'}
    $report=Get-Content -LiteralPath $result -Raw|ConvertFrom-Json
    $report|Add-Member -NotePropertyName zeroTier -NotePropertyValue @{version=$service.version;online=$service.online;tcpFallbackActive=$service.tcpFallbackActive;networkStatus=$network.status;networkType=$network.type;allowDefault=$network.allowDefault;allowGlobal=$network.allowGlobal;allowDNS=$network.allowDNS}
    New-Item -ItemType Directory -Path (Split-Path -Parent ([IO.Path]::GetFullPath($ReportPath))) -Force|Out-Null
    $report|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $ReportPath -Encoding UTF8
    Write-Output "Candidatos da interface ZeroTier: $($report.zeroTierCandidates). Rede: $($network.status)."
    Write-Output "Relatorio sem IPs, Network ID, identidade ou tokens: $ReportPath"
    Write-Output 'Teste local apenas. WebRTC com audio/video entre duas casas NAO TESTADO.'
} finally {
    if($process -and !$process.HasExited){$process.Kill()}
    # Remove only the private probe, which transiently included local addresses.
    if(Test-Path -LiteralPath $probePath){Remove-Item -LiteralPath $probePath}
}
