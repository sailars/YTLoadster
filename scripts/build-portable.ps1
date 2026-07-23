param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -Raw (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$version = $package.version
$toolsDir = Join-Path $projectRoot "tools\windows\x64"
$releaseDir = Join-Path $projectRoot "release"
$packageName = "YTLoadster-$version-portable"
$stagingDir = Join-Path $releaseDir $packageName
$archivePath = Join-Path $releaseDir "$packageName.zip"

foreach ($tool in @(
  "yt-dlp.exe",
  "deno.exe",
  "ffmpeg\ffmpeg.exe",
  "ffmpeg\ffprobe.exe",
  "ffmpeg\avcodec-62.dll",
  "ffmpeg\avdevice-62.dll",
  "ffmpeg\avfilter-11.dll",
  "ffmpeg\avformat-62.dll",
  "ffmpeg\avutil-60.dll",
  "ffmpeg\swresample-6.dll",
  "ffmpeg\swscale-9.dll",
  "ffmpeg\LICENSE.txt"
)) {
  if (-not (Test-Path -LiteralPath (Join-Path $toolsDir $tool) -PathType Leaf)) {
    throw "Не найден обязательный компонент: tools/windows/x64/$tool"
  }
}

if ((Test-Path -LiteralPath $stagingDir) -or (Test-Path -LiteralPath $archivePath)) {
  throw "Релиз $packageName уже существует. Удалите старую папку и ZIP после проверки либо увеличьте версию в package.json."
}

Push-Location $projectRoot
try {
  & npm.cmd run tauri -- build --no-bundle
  if ($LASTEXITCODE -ne 0) {
    throw "Сборка Tauri завершилась с кодом $LASTEXITCODE."
  }
}
finally {
  Pop-Location
}

$cargoTargetDir = $env:CARGO_TARGET_DIR
if ([string]::IsNullOrWhiteSpace($cargoTargetDir)) {
  $cargoTargetDir = Join-Path $projectRoot "src-tauri\target"
} elseif (-not [System.IO.Path]::IsPathRooted($cargoTargetDir)) {
  $cargoTargetDir = Join-Path $projectRoot $cargoTargetDir
}

$applicationExe = Join-Path $cargoTargetDir "release\YTLoadster.exe"
if (-not (Test-Path -LiteralPath $applicationExe -PathType Leaf)) {
  throw "Не найден результат сборки: $applicationExe"
}

$portableToolsDir = Join-Path $stagingDir "tools\windows\x64"
New-Item -ItemType Directory -Path $portableToolsDir -Force | Out-Null
Copy-Item -LiteralPath $applicationExe -Destination (Join-Path $stagingDir "YTLoadster.exe")
Copy-Item -LiteralPath (Join-Path $projectRoot "packaging\PORTABLE_README.txt") -Destination (Join-Path $stagingDir "README.txt")
Copy-Item -LiteralPath (Join-Path $projectRoot "THIRD_PARTY_NOTICES.md") -Destination (Join-Path $stagingDir "THIRD_PARTY_NOTICES.md")
Copy-Item -LiteralPath (Join-Path $toolsDir "yt-dlp.exe") -Destination $portableToolsDir
Copy-Item -LiteralPath (Join-Path $toolsDir "deno.exe") -Destination $portableToolsDir
Copy-Item -LiteralPath (Join-Path $toolsDir "ffmpeg") -Destination $portableToolsDir -Recurse
Copy-Item -LiteralPath (Join-Path $toolsDir "ffmpeg\LICENSE.txt") -Destination (Join-Path $stagingDir "LGPL-3.0.txt")

$ytdlpVersion = (& (Join-Path $toolsDir "yt-dlp.exe") --version | Select-Object -First 1).Trim()
$denoVersion = (& (Join-Path $toolsDir "deno.exe") --version 2>&1 | Select-Object -First 1).ToString().Trim()
$ffmpegVersion = (& (Join-Path $toolsDir "ffmpeg\ffmpeg.exe") -version 2>&1 | Select-Object -First 1).ToString().Trim()
$ffprobeVersion = (& (Join-Path $toolsDir "ffmpeg\ffprobe.exe") -version 2>&1 | Select-Object -First 1).ToString().Trim()
$componentManifest = @(
  "YTLoadster $version portable"
  ""
  "yt-dlp.exe"
  "Version: $ytdlpVersion"
  "SHA-256: $((Get-FileHash -Algorithm SHA256 (Join-Path $toolsDir 'yt-dlp.exe')).Hash)"
  "Source: https://github.com/yt-dlp/yt-dlp/releases/tag/$ytdlpVersion"
  ""
  "deno.exe"
  "Version: $denoVersion"
  "SHA-256: $((Get-FileHash -Algorithm SHA256 (Join-Path $toolsDir 'deno.exe')).Hash)"
  "Source: https://github.com/denoland/deno/releases"
  ""
  "ffmpeg.exe"
  "Version: $ffmpegVersion"
  "SHA-256: $((Get-FileHash -Algorithm SHA256 (Join-Path $toolsDir 'ffmpeg\ffmpeg.exe')).Hash)"
  "Source/build information: https://github.com/BtbN/FFmpeg-Builds"
  ""
  "ffprobe.exe"
  "Version: $ffprobeVersion"
  "SHA-256: $((Get-FileHash -Algorithm SHA256 (Join-Path $toolsDir 'ffmpeg\ffprobe.exe')).Hash)"
  "Source/build information: https://github.com/BtbN/FFmpeg-Builds"
)
$componentManifest += ""
$componentManifest += "FFmpeg runtime libraries"
Get-ChildItem -LiteralPath (Join-Path $toolsDir "ffmpeg") -Filter "*.dll" -File |
  Sort-Object Name |
  ForEach-Object {
    $componentManifest += "$($_.Name): $((Get-FileHash -Algorithm SHA256 $_.FullName).Hash)"
  }
$componentManifest | Set-Content -Encoding utf8 (Join-Path $stagingDir "COMPONENTS.txt")

Compress-Archive -Path $stagingDir -DestinationPath $archivePath -CompressionLevel Optimal
Get-FileHash -Algorithm SHA256 $archivePath | Format-List
Write-Host "Portable-релиз создан: $archivePath"
