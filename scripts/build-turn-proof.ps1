param([string]$Dotnet='dotnet',[string]$Version='0.4.24-turnproof.1')
$ErrorActionPreference='Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+-turnproof\.\d+$') { throw 'Experimental version required.' }
$root=Split-Path -Parent $PSScriptRoot
$output=Join-Path $root "artifacts/turn-proof/$Version"
& $Dotnet publish (Join-Path $root 'src/StreamRoom.App/StreamRoom.App.csproj') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:TurnExperiment=true "-p:Version=$Version" -o $output
if ($LASTEXITCODE -ne 0) { throw 'Experimental build failed.' }
$archive=Join-Path $root "artifacts/StreamRoom-TURN-PROOF-$Version.zip"
Compress-Archive -Path (Join-Path $output '*') -DestinationPath $archive -Force
Write-Output "Experimental portable package: $archive"
Write-Output 'Not installed. Not published to the stable update feed. TURN activation still requires authorization.'
