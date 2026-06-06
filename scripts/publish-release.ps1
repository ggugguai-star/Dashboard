# GitHub Release 업로드 (서명·latest.json 선행 권장)
# Usage: .\scripts\publish-release.ps1 -Version 2.0.3
param(
  [string]$Version = "2.0.3",
  [string]$Notes = "Tauri v2.0.3 — P3 마이그레이션 완료, 자동 업데이트 서명 지원"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$tag = "v$Version"
$exe = Join-Path $root "src-tauri\target\release\bundle\nsis\dashboard_${Version}_x64-setup.exe"
$sig = "$exe.sig"
$latest = Join-Path $root "latest.json"

if (-not (Test-Path $exe)) { throw "Missing: $exe (run tauri:build first)" }

$assets = @($exe)
if (Test-Path $sig) { $assets += $sig }
if (Test-Path $latest) { $assets += $latest }

Write-Host "[gh] Creating release $tag ..."
$assetArgs = ($assets | ForEach-Object { "`"$_`"" }) -join ' '
$cmd = "gh release create $tag --repo ggugguai-star/Dashboard --title `"$tag - $Notes`" --notes `"$Notes`" $assetArgs"
Invoke-Expression $cmd
Write-Host "[ok] https://github.com/ggugguai-star/Dashboard/releases/tag/$tag"
