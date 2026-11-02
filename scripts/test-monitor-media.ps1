param(
    [string]$Dotnet = 'dotnet',
    [ValidateSet(480,720,1080)][int]$Height = 720,
    [int]$TimeoutSeconds = 90
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('streamroom-monitor-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
Push-Location $root
$publisher = $null; $viewer = $null
try {
    & $Dotnet build src/StreamRoom.App -c Release --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    $dll = Join-Path $root 'src/StreamRoom.App/bin/Release/net10.0-windows10.0.22621.0/StreamRoom.dll'
    $publisher = Start-Process -FilePath $Dotnet -ArgumentList @('"'+$dll+'"','--media-room-test','host','"'+$testRoot+'"',$Height) -WindowStyle Hidden -PassThru
    $viewer = Start-Process -FilePath $Dotnet -ArgumentList @('"'+$dll+'"','--media-room-test','viewer','"'+$testRoot+'"',$Height) -WindowStyle Hidden -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ((!$publisher.HasExited -or !$viewer.HasExited) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Seconds 1 }
    if (!$publisher.HasExited -or !$viewer.HasExited) { throw 'Monitor media test timed out.' }
    $results = @('host','viewer') | ForEach-Object { Get-Content -LiteralPath (Join-Path $testRoot "$_.json") -Raw | ConvertFrom-Json }
    $results | ForEach-Object { [PSCustomObject]@{ role=$_.role; success=$_.success; minFps=$_.minFps; transfer=$_.transfer.mode; transport=$_.transport; error=$_.error } } | Format-Table
    Write-Output "Detailed results: $testRoot"
    if (@($results | Where-Object { !$_.success }).Count) { throw 'Monitor media test failed; inspect result JSON.' }
} finally {
    foreach ($testProcess in @($publisher,$viewer)) { if ($null -ne $testProcess -and !$testProcess.HasExited) { $testProcess.Kill($true) } }
    Pop-Location
}
