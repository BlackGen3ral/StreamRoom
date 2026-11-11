param(
    [string]$VencordSource,
    [string]$StreamFixSource,
    [ValidatePattern('^\d+\.\d+\.\d+-discord\.\d+$')][string]$Version = '0.4.72-discord.1',
    [switch]$PackUpdates
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$parent = Split-Path -Parent $root
if (-not $VencordSource) { $VencordSource = Join-Path $parent 'Vencord-experimental' }
if (-not $StreamFixSource) { $StreamFixSource = Join-Path $parent 'StreamFix-experimental' }
$vencordRevision = 'd07030c0968e31e41caa0c35fda0ef8ae63a079e'
$streamFixRevision = '30c90e1518048b7c24ecede9019489b4233af72b'
if ((git -C $VencordSource rev-parse HEAD) -ne $vencordRevision -or
    (git -C $StreamFixSource rev-parse HEAD) -ne $streamFixRevision) {
    throw 'Use as revisões do Vencord e do StreamFix indicadas neste script.'
}
git -C $VencordSource diff --quiet HEAD
if ($LASTEXITCODE -ne 0) { throw 'O código original do Vencord tem alterações locais.' }

$originalPlugin = Join-Path $StreamFixSource 'streamFix'
$plugin = Join-Path $VencordSource 'src/userplugins/streamFix'
if (-not (Test-Path -LiteralPath $plugin)) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $plugin) -Force | Out-Null
    Copy-Item -LiteralPath $originalPlugin -Destination $plugin -Recurse
}
$originalFiles = @(Get-ChildItem -LiteralPath $originalPlugin -File -Recurse)
$pluginFiles = @(Get-ChildItem -LiteralPath $plugin -File -Recurse)
if ($originalFiles.Count -ne $pluginFiles.Count) { throw 'A pasta do plugin não corresponde ao StreamFix original.' }
foreach ($file in $originalFiles) {
    $relative = [IO.Path]::GetRelativePath($originalPlugin, $file.FullName)
    if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath (Join-Path $plugin $relative)).Hash) {
        throw 'O plugin StreamFix tem alterações locais.'
    }
}

Push-Location -LiteralPath $VencordSource
try {
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar as dependências do Vencord.' }
    pnpm build --disable-updater
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o Vencord experimental.' }
} finally { Pop-Location }

$output = Join-Path $root ('artifacts/discord-experiment-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
dotnet publish (Join-Path $root 'src/StreamRoom.App') -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true "-p:Version=$Version" -o $output --nologo
if ($LASTEXITCODE -ne 0) { throw 'Falha na publicação local do StreamRoom experimental.' }
$assets = New-Item -ItemType Directory -Path (Join-Path $output 'DiscordExperiment')
$bundles = @('patcher.js','preload.js','renderer.js','renderer.css','patcher.js.LEGAL.txt','renderer.js.LEGAL.txt',
    'patcher.js.map','preload.js.map','renderer.js.map','renderer.css.map')
foreach ($file in $bundles) { Copy-Item -LiteralPath (Join-Path $VencordSource "dist/$file") -Destination $assets.FullName }
Copy-Item -LiteralPath (Join-Path $VencordSource 'LICENSE') -Destination (Join-Path $assets 'LICENSE-Vencord.txt')
Copy-Item -LiteralPath (Join-Path $StreamFixSource 'LICENSE') -Destination (Join-Path $assets 'LICENSE-StreamFix.txt')

$source = Join-Path $output 'corresponding-source'
$vencordArchive = "$output-vencord-source.zip"
git -C $VencordSource archive --format=zip "--output=$vencordArchive" HEAD
if ($LASTEXITCODE -ne 0) { throw 'Falha ao arquivar o código correspondente do Vencord.' }
Expand-Archive -LiteralPath $vencordArchive -DestinationPath $source
Remove-Item -LiteralPath $vencordArchive
$sourcePlugin = Join-Path $source 'src/userplugins'
New-Item -ItemType Directory -Path $sourcePlugin -Force | Out-Null
Copy-Item -LiteralPath $originalPlugin -Destination $sourcePlugin -Recurse
Copy-Item -LiteralPath (Join-Path $StreamFixSource 'LICENSE') -Destination (Join-Path $sourcePlugin 'streamFix/LICENSE')
Copy-Item -LiteralPath (Join-Path $StreamFixSource 'README.md') -Destination (Join-Path $sourcePlugin 'streamFix/README.md')
Set-Content -LiteralPath (Join-Path $source 'BUILD-STREAMFIX.txt') -Encoding utf8 -Value @"
Vencord: $(git -C $VencordSource rev-parse HEAD)
StreamFix: $streamFixRevision, copiado sem alterações para src/userplugins/streamFix.
Compilar com Node.js e pnpm: pnpm install --frozen-lockfile; pnpm build --disable-updater
"@

Set-Content -LiteralPath (Join-Path $output 'LEIA-ME.txt') -Encoding utf8 -Value @'
StreamRoom para Windows — experimento Discord

Extraia toda a pasta do ZIP e abra StreamRoom.exe. Em Conexões, procure
Compartilhar no Discord. Seu amigo usa uma conta Proton própria para baixar
um perfil WireGuard Windows do US-FREE#76 ou outro servidor gratuito dos EUA.
Importe o .conf, saia do Discord pela bandeja e clique em Configurar Discord.
Aceite a instalação do WireSock se o Windows pedir. Depois abra o Discord
normalmente com o ProtonVPN fechado. Use o Discord estável para Windows.
O assistente também oferece ativar FakeNitro junto com o StreamFix.
Se o Discord atualizar e perder o Vencord, saia do Discord pela bandeja e
use Conexões → Reparar Vencord. O reparo usa as preferências e os perfis já salvos.

O assistente usa uma compilação experimental do Vencord com StreamFix e pausa
as atualizações automáticas do Vencord. O backup fica em
%LOCALAPPDATA%\StreamRoom\DiscordSetup\backups. O arquivo .conf é importado
localmente e contém uma chave privada. Guarde o original em seu próprio PC.

Teste em duas casas: compartilhe uma janela, confirme imagem e áudio no PC
do espectador e repita a transmissão sem reiniciar o Discord.
'@

$archive = "$output.zip"
tar.exe -a -cf $archive -C $output .
if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar o ZIP experimental.' }
Get-FileHash -LiteralPath $archive -Algorithm SHA256 | Format-List Hash,Path

if ($PackUpdates) {
    $updateOutput = "$output-updates"
    Push-Location $root
    try {
        dotnet tool restore
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar o Velopack.' }
        dotnet tool run vpk pack --packId StreamRoom --packVersion $Version --packDir $output --mainExe StreamRoom.exe `
            --packTitle StreamRoom --icon src/StreamRoom.App/Assets/StreamRoom.ico --framework webview2 `
            --runtime win-x64 --outputDir $updateOutput --channel win-discord
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar o pacote de atualização experimental.' }
    } finally { Pop-Location }
    Write-Output "Pacotes de atualização do canal win-discord em $updateOutput"
}
