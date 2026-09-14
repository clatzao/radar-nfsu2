# Publica uma nova versão do app:
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 0.4 -Notes "O que mudou"
# Aumenta versionCode/versionName, gera o APK, faz commit + tag, envia ao GitHub e cria a Release com o APK.
# Os apps instalados encontram a Release sozinhos (Ajustes → Atualização automática).
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Notes = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$utf8 = New-Object System.Text.UTF8Encoding($false)

# 1) Versão no build.gradle
$gradleFile = Join-Path $root 'nfsu2-app\app\build.gradle'
$g = [IO.File]::ReadAllText($gradleFile)
$code = [int]([regex]::Match($g, 'versionCode = (\d+)').Groups[1].Value) + 1
$g = $g -replace 'versionCode = \d+', "versionCode = $code"
$g = $g -replace "versionName = '[^']*'", "versionName = '$Version'"
[IO.File]::WriteAllText($gradleFile, $g, $utf8)
Write-Host "Versão $Version (código $code)"

# 2) APK (usa o JDK que vem com o Android Studio)
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
Push-Location (Join-Path $root 'nfsu2-app')
try {
    # --no-daemon: sem o processo do Gradle em segundo plano segurando a saída do terminal
    & .\gradlew.bat assembleDebug --console=plain --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'Falha no build do APK' }
} finally { Pop-Location }
$apk = Join-Path $env:TEMP "RadarNFSU2-v$Version.apk"
Copy-Item (Join-Path $root 'nfsu2-app\app\build\outputs\apk\debug\app-debug.apk') $apk -Force
Copy-Item $apk (Join-Path $root 'RadarNFSU2.apk') -Force

# 3) Commit, tag e envio
Push-Location $root
try {
    git add -A
    # mensagem via arquivo UTF-8: o PowerShell 5 estraga acentos passados direto na linha de comando
    $msgFile = Join-Path $env:TEMP "radar-nfsu2-commit-$Version.txt"
    # "Versão" escrito com o código do "ã": o PowerShell 5 lê este .ps1 como ANSI e estragaria o acento
    $versao = "Vers$([char]0x00E3)o"
    [IO.File]::WriteAllText($msgFile, "$versao $Version`n`nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>`n", $utf8)
    git commit -F $msgFile
    git tag "v$Version"
    git push origin main --tags
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao enviar ao GitHub' }

    # 4) Release com o APK
    if (-not $Notes) { $Notes = "Versão $Version do Radar NFSU2." }
    $notesFile = Join-Path $env:TEMP "radar-nfsu2-notes-$Version.md"
    [IO.File]::WriteAllText($notesFile, $Notes, $utf8)
    gh release create "v$Version" $apk --title "Radar NFSU2 v$Version" --notes-file $notesFile
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar a Release' }
} finally { Pop-Location }
Write-Host "Publicado: v$Version"
