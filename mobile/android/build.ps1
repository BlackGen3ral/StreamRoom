param(
    [Parameter(Mandatory)] [string] $Sdk,
    [Parameter(Mandatory)] [string] $Jdk,
    [Parameter(Mandatory)] [string] $Output,
    [Parameter(Mandatory)] [string] $Keystore
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$env:JAVA_HOME = $Jdk
$tools = Join-Path $Sdk 'build-tools/35.0.0'
$platform = Join-Path $Sdk 'platforms/android-35/android.jar'
$build = Join-Path ([IO.Path]::GetTempPath()) ('streamroom-apk-' + [guid]::NewGuid())
New-Item -ItemType Directory "$build/classes", "$build/dex" | Out-Null
& "$Jdk/bin/javac.exe" --release 8 -classpath $platform -d "$build/classes" "$PSScriptRoot/MainActivity.java"
& "$Jdk/bin/jar.exe" cf "$build/classes.jar" -C "$build/classes" .
& "$tools/d8.bat" --lib $platform --min-api 26 --output "$build/dex" "$build/classes.jar"
& "$tools/aapt2.exe" link -I $platform --manifest "$PSScriptRoot/AndroidManifest.xml" -o "$build/unsigned.apk"
& "$Jdk/bin/jar.exe" uf "$build/unsigned.apk" -C "$build/dex" classes.dex
& "$tools/zipalign.exe" -f 4 "$build/unsigned.apk" "$build/aligned.apk"
& "$tools/apksigner.bat" sign --ks $Keystore --ks-key-alias streamroom --ks-pass env:STREAMROOM_ANDROID_KEY_PASSWORD --out $Output "$build/aligned.apk"
& "$tools/apksigner.bat" verify --print-certs $Output
