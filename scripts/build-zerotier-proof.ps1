param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{16}$')][string]$NetworkId,
    [string]$Dotnet='dotnet'
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$output=Join-Path $root ('artifacts/zerotier-proof-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
& $Dotnet publish (Join-Path $root 'src/StreamRoom.App') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:StreamRoomZeroTierProof=true -p:Version=0.4.25-zt-proof.1 -o $output --nologo
if($LASTEXITCODE -ne 0){throw 'Experimental publish failed.'}
[IO.File]::WriteAllText((Join-Path $output 'zerotier-proof.json'),(@{networkId=$NetworkId}|ConvertTo-Json -Compress))
[IO.File]::WriteAllText((Join-Path $output 'LEIA-ME.txt'),@'
StreamRoom - prototipo ZeroTier

Extraia esta pasta e abra StreamRoom.exe. O perfil e separado da versao normal.
Este pacote ainda NAO instala o servico ZeroTier. A distribuicao do instalador
oficial continua pendente. Nao e o instalador unico solicitado.

Com o servico oficial ja instalado, use Conectar a rede privada e confirme o
Windows. O proprietario autoriza o dispositivo no painel ZeroTier.
Rede privada conectada e um pre-requisito, nao prova de transmissao.

Teste posterior: dois PCs de casas diferentes, um transmissor e um espectador,
720p30, audio do sistema habilitado. Confirme imagem em movimento, som e
ZeroTier nos detalhes da midia; copie o diagnostico dos dois PCs.
Rota direta/relay do overlay ainda nao e classificada por este prototipo.
Nao foi realizado teste entre casas. Nenhuma versao estavel e substituida.
'@)
$archive=$output+'.zip'
Compress-Archive -Path (Join-Path $output '*') -DestinationPath $archive
Write-Output "Prototipo local (nao e instalador integrado): $archive"
