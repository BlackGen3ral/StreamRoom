# Local interface-discovery test only. No cross-network/media success is claimed.
# Does not install, join networks or change installed app permissions/settings.
# The explicit permission switch affects only a disposable diagnostic profile.
[CmdletBinding(DefaultParameterSetName='Baseline')]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{16}$')][string]$NetworkId,
    [string]$Dotnet='dotnet',
    # Explicit diagnostic consent only. Never used in the normal application.
    [Parameter(ParameterSetName='TemporaryCamera')][switch]$TemporaryCameraPermission,
    # Separate diagnostic only: no extension is added to installed app/browser.
    [Parameter(ParameterSetName='Extension')][switch]$ExtensionContext,
    [Parameter(ParameterSetName='Extension')][switch]$CaptureBridgeSmokeTest,
    [string]$ReportPath=(Join-Path $env:LOCALAPPDATA ('StreamRoom/NetworkDiagnostics/zerotier-ice-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '.json'))
)
$ErrorActionPreference='Stop'
if($CaptureBridgeSmokeTest -and !$ExtensionContext){throw 'The local capture compatibility test requires -ExtensionContext.'}
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
$projectRoot=$root
if($TemporaryCameraPermission -or $ExtensionContext) {
    $projectRoot=Join-Path ([IO.Path]::GetTempPath()) ('streamroom-zt-permission-probe-'+[Guid]::NewGuid().ToString('N'))
    $files=@(git -C $root ls-files src/StreamRoom.App src/StreamRoom.Core Directory.Build.props)
    if($LASTEXITCODE -ne 0 -or !$files.Count){throw 'Temporary source copy requires a Git checkout.'}
    foreach($file in $files){$target=Join-Path $projectRoot $file;New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force|Out-Null;Copy-Item -LiteralPath (Join-Path $root $file) -Destination $target}
    $shell=Join-Path $projectRoot 'src/StreamRoom.App/ShellWindow.xaml.cs'
    $source=[IO.File]::ReadAllText($shell)
    $source=$source.Replace('installed = _updates.IsInstalled,','diagnosticTailscaleFlags = _tailscaleWebRtcReady, installed = _updates.IsInstalled,')
    $anchor='var core = Browser.CoreWebView2;'
    if(!$source.Contains($anchor)){throw 'Native probe anchor missing.'}
    if($ExtensionContext){
        # Do not rely on the owner's existing Tailscale opt-in during this proof.
        $source=$source.Replace('var browserOptions =','_tailscaleWebRtcReady = false;' + [Environment]::NewLine + '            var browserOptions =')
        $source=$source.Replace('private const string Origin = "https://streamroom.local";','private static string Origin = "https://streamroom.local";')
        $environmentAnchor='var environment = await CoreWebView2Environment.CreateAsync('
        if(!$source.Contains($environmentAnchor)){throw 'Native environment anchor missing.'}
        $source=$source.Replace($environmentAnchor,'browserOptions.AreBrowserExtensionsEnabled = true;' + [Environment]::NewLine + '            ' + $environmentAnchor)
        $source=$source.Replace($anchor,$anchor + [Environment]::NewLine + '            var probeExtension = await core.Profile.AddBrowserExtensionAsync(Path.Combine(AppContext.BaseDirectory, "Web")); Origin = "chrome-extension://" + probeExtension.Id;')
        $trustedAnchor='&& uri.Scheme == "https" && uri.Host == "streamroom.local" && uri.Port == 443;'
        if(!$source.Contains($trustedAnchor)){throw 'Native origin anchor missing.'}
        $source=$source.Replace($trustedAnchor,'&& ((uri.Scheme == "https" && uri.Host == "streamroom.local" && uri.Port == 443) || (App.NetworkTestOutput is not null && App.UiPreviewOutput is not null && uri.Scheme == "chrome-extension" && uri.Host == new Uri(Origin).Host));')
    } else {
        $source=$source.Replace($anchor,$anchor + [Environment]::NewLine + '            if (App.NetworkTestOutput is not null && App.UiPreviewOutput is not null) await core.Profile.SetPermissionStateAsync(CoreWebView2PermissionKind.Camera, Origin, CoreWebView2PermissionState.Allow);')
    $endAnchor='case "testResult" when App.NetworkTestOutput is not null:'
    if(!$source.Contains($endAnchor)){throw 'Native cleanup anchor missing.'}
    $revoke=@'
case "zeroTierProbeRevokePermission" when App.NetworkTestOutput is not null && App.UiPreviewOutput is not null:
                    await Browser.CoreWebView2.Profile.SetPermissionStateAsync(CoreWebView2PermissionKind.Camera, Origin, CoreWebView2PermissionState.Deny);
                    break;
                case "testResult" when App.NetworkTestOutput is not null:
                    if (App.UiPreviewOutput is not null) await Browser.CoreWebView2.Profile.SetPermissionStateAsync(CoreWebView2PermissionKind.Camera, Origin, CoreWebView2PermissionState.Deny);
'@
    $source=$source.Replace($endAnchor,$revoke)
    }
    [IO.File]::WriteAllText($shell,$source)
}
& $Dotnet build (Join-Path $projectRoot 'src/StreamRoom.App') -c Release --nologo
if($LASTEXITCODE -ne 0){throw 'Build failed.'}
# A private copy ensures probe injection never touches source or normal output.
$directory=Join-Path ([IO.Path]::GetTempPath()) ('streamroom-zt-discovery-'+[Guid]::NewGuid().ToString('N'))
$app=Join-Path $directory 'app';New-Item -ItemType Directory -Path $app -Force|Out-Null
$build=Join-Path $projectRoot 'src/StreamRoom.App/bin/Release/net10.0-windows10.0.22621.0'
Copy-Item -Path (Join-Path $build '*') -Destination $app -Recurse
$probePath=Join-Path $app 'Web/network-test.mjs'
$result=Join-Path $directory 'result.json'
$profile=Join-Path $directory 'preview.png'
$script=@'
const known=__KNOWN__;
let sequence=0;const requests=new Map();
function native(type,payload={}){return new Promise((resolve,reject)=>{const id=String(++sequence);requests.set(id,{resolve,reject});window.chrome.webview.postMessage({id,type,payload});});}
window.chrome.webview.addEventListener('message',({data})=>{if(data.type==='reply'){const r=requests.get(data.id);if(!r)return;requests.delete(data.id);data.ok?r.resolve(data.result):r.reject(Error('native-error'));}});
const candidates=[];let pc,error=null,ready,permissions={},permissionAfterTest=null;
try {
 ready=await native('ready');
 for(const name of ['camera','microphone']){try{permissions[name]=(await navigator.permissions.query({name})).state;}catch{permissions[name]='unavailable';}}
 pc=new RTCPeerConnection({iceServers:[{urls:['stun:stun.cloudflare.com:3478','stun:stun.l.google.com:19302']}],iceTransportPolicy:'all',bundlePolicy:'max-bundle'});
 pc.createDataChannel('interface-discovery-only');
 const gathered=new Promise(resolve=>{pc.onicecandidate=({candidate:c})=>{if(!c){resolve();return;}candidates.push({type:c.type,zeroTier:known.includes(c.address),obfuscated:c.address?.endsWith('.local')??false,protocol:c.protocol});};setTimeout(resolve,20000);});
 await pc.setLocalDescription(await pc.createOffer());await gathered;
}catch(e){error=e.name;}
finally {
 const gathering=pc?.iceGatheringState??'unavailable';pc?.close();
 if(__PERMISSION_TEST__){await native('zeroTierProbeRevokePermission');permissionAfterTest=(await navigator.permissions.query({name:'camera'})).state;}
 await native('testResult',{format:1,at:new Date().toISOString(),kind:'LOCAL_INTERFACE_DISCOVERY_ONLY',runtime:ready?.runtime,version:ready?.version,
  existingTailscaleFlagsEnabled:ready?.diagnosticTailscaleFlags??ready?.settings?.tailscaleEnabled===true,temporaryCameraPermissionTest:__PERMISSION_TEST__,extensionContextTest:__EXTENSION_TEST__,permissions,permissionAfterTest,gathering,knownZeroTierAddressCount:known.length,
  zeroTierCandidates:candidates.filter(c=>c.zeroTier).length,candidates,error,crossNetworkMedia:'NOT_TESTED',audioVideo:'NOT_TESTED'});
}
'@
$process=$null;$completed=$false
try {
    $permissionFlag=if($TemporaryCameraPermission){'true'}else{'false'}
    $extensionFlag=if($ExtensionContext){'true'}else{'false'}
    [IO.File]::WriteAllText($probePath,$script.Replace('__KNOWN__',$known).Replace('__PERMISSION_TEST__',$permissionFlag).Replace('__EXTENSION_TEST__',$extensionFlag))
    if($ExtensionContext){
        [IO.File]::WriteAllText((Join-Path $app 'Web/manifest.json'),'{"manifest_version":3,"name":"StreamRoom isolated interface diagnostic","version":"1.0.0","permissions":[]}')
    }
    if($CaptureBridgeSmokeTest){
        $capturePath=Join-Path $app 'Web/capture-test.mjs'
        $captureScript=[IO.File]::ReadAllText($capturePath).Replace('quality:1080,fps:60','quality:720,fps:30').Replace('maxFramerate=60','maxFramerate=30').Replace('20_000_000','2_500_000')
        $captureScript=$captureScript.Replace('const a=new RTCPeerConnection(), b=new RTCPeerConnection();','let a,b;')
        $captureScript=$captureScript.Replace("const bridge = new WgcStream(native, error => { document.getElementById('testStatus').textContent = error; });",'let bridge;')
        $captureScript=$captureScript.Replace("await native('ready');log('source');","await native('ready');a=new RTCPeerConnection();b=new RTCPeerConnection();bridge=new WgcStream(native,error=>log(error));log('source');")
        $captureScript=$captureScript.Replace('a.close();b.close();await bridge.stop();','a?.close();b?.close();await bridge?.stop();')
        $captureScript=$captureScript.Replace('navigator.mediaDevices.getDisplayMedia=',"log('context secure='+isSecureContext+' mediaDevices='+typeof navigator.mediaDevices+' VideoFrame='+typeof VideoFrame);if(navigator.mediaDevices)navigator.mediaDevices.getDisplayMedia=")
        $captureScript=$captureScript.Replace("await native('captureTestResult',result)","await native('captureTestResult',{...result,kind:'LOCAL_EXTENSION_CAPTURE_COMPATIBILITY_ONLY',extensionContextTest:true,existingTailscaleFlagsEnabled:false,crossNetworkMedia:'NOT_TESTED',audio:'NOT_TESTED',permissions:{camera:(await navigator.permissions.query({name:'camera'})).state,microphone:(await navigator.permissions.query({name:'microphone'})).state}})")
        [IO.File]::WriteAllText($capturePath,$captureScript)
    }
    $dll=Join-Path $app 'StreamRoom.dll'
    $arguments=@(('"'+$dll+'"'),'--network-test',('"'+$result+'"'),'--ui-preview',('"'+$profile+'"'))
    if($CaptureBridgeSmokeTest){$arguments+=@('--wgc-bridge-test',('"'+$result+'"'))}
    $process=Start-Process -FilePath $Dotnet -ArgumentList $arguments -PassThru -WindowStyle Hidden
    if(!$process.WaitForExit(30000)){
        if(Test-Path -LiteralPath ($result+'.log')){
            New-Item -ItemType Directory -Path (Split-Path -Parent ([IO.Path]::GetFullPath($ReportPath))) -Force|Out-Null
            Copy-Item -LiteralPath ($result+'.log') -Destination ($ReportPath+'.steps.log')
            Write-Output "Etapas do teste local: $ReportPath.steps.log"
        }
        throw 'Diagnostic timed out; no success claimed.'
    }
    if(!(Test-Path -LiteralPath $result)){throw 'No discovery report.'}
    $report=Get-Content -LiteralPath $result -Raw|ConvertFrom-Json
    $report|Add-Member -NotePropertyName zeroTier -NotePropertyValue @{version=$service.version;online=$service.online;tcpFallbackActive=$service.tcpFallbackActive;networkStatus=$network.status;networkType=$network.type;allowDefault=$network.allowDefault;allowGlobal=$network.allowGlobal;allowDNS=$network.allowDNS}
    New-Item -ItemType Directory -Path (Split-Path -Parent ([IO.Path]::GetFullPath($ReportPath))) -Force|Out-Null
    $report|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $ReportPath -Encoding UTF8
    if($CaptureBridgeSmokeTest){Write-Output "Compatibilidade local de captura na extensao: $($report.success). Video: $($report.width)x$($report.height)."}
    else {Write-Output "Candidatos da interface ZeroTier: $($report.zeroTierCandidates). Rede: $($network.status)."}
    Write-Output "Relatorio sem IPs, Network ID, identidade ou tokens: $ReportPath"
    Write-Output 'Teste local apenas. WebRTC com audio/video entre duas casas NAO TESTADO.'
    if($CaptureBridgeSmokeTest -and !$report.success){throw 'Local capture compatibility failed; inspect the report. No cross-network success claimed.'}
    $completed=$true
} finally {
    if($process -and !$process.HasExited){$process.Kill($true);$null=$process.WaitForExit(5000)}
    if(Test-Path -LiteralPath $probePath){Remove-Item -LiteralPath $probePath}
    # Remove disposable profiles, binaries and sources, including on timeout.
    # Resolve and constrain every recursive deletion to one named temp child.
    foreach($candidatePath in @($directory,$(if($TemporaryCameraPermission -or $ExtensionContext){$projectRoot}))){
        if(!$candidatePath -or !(Test-Path -LiteralPath $candidatePath)){continue}
        $resolved=[IO.Path]::GetFullPath((Resolve-Path -LiteralPath $candidatePath).Path)
        $parent=[IO.Path]::GetDirectoryName($resolved).TrimEnd([char[]]@('\','/'))
        $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([char[]]@('\','/'))
        $name=[IO.Path]::GetFileName($resolved)
        if($parent -ine $temp -or $name -notmatch '^streamroom-zt-(?:permission-probe|discovery)-[a-f0-9]{32}$'){throw 'Refusing cleanup outside the disposable probe directories.'}
        if((Get-Item -LiteralPath $resolved).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Refusing cleanup of a linked probe directory.'}
        if($completed){try{Remove-Item -LiteralPath $resolved -Recurse -Force}catch{Write-Warning 'The disposable test directory is still locked; its cleanup is pending.'}}
    }
}
