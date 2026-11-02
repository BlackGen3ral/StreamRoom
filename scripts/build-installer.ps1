param([string]$Version = '0.4.0-beta.1')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    dotnet tool restore
    if ($LASTEXITCODE -ne 0) { throw 'Failed to restore Velopack CLI.' }
    dotnet publish src/StreamRoom.App/StreamRoom.App.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true "-p:Version=$Version" -o artifacts/publish
    if ($LASTEXITCODE -ne 0) { throw 'Publish failed.' }
    dotnet tool run vpk pack --packId StreamRoom --packVersion $Version --packDir artifacts/publish --mainExe StreamRoom.exe --packTitle StreamRoom --icon src/StreamRoom.App/Assets/StreamRoom.ico --framework webview2 --runtime win-x64 --outputDir artifacts/installer --channel win
    if ($LASTEXITCODE -ne 0) { throw 'Installer packaging failed.' }
    Get-ChildItem artifacts/installer -File | Select-Object Name, Length
} finally { Pop-Location }
