# 서명 + latest.json 생성 (대화형 — 비밀번호 프롬프트 가능)
# Usage: .\scripts\sign-release.ps1 -Version 2.0.3
param(
  [string]$Version = "2.0.3"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$key = Join-Path $env:USERPROFILE ".tauri\dashboard-update-key.pem"
if (-not (Test-Path $key)) { throw "Missing signing key: $key" }

$nsis = Join-Path $root "src-tauri\target\release\bundle\nsis"
$exeName = "dashboard_${Version}_x64-setup.exe"
$exe = Join-Path $nsis $exeName
if (-not (Test-Path $exe)) {
  $found = Get-ChildItem $nsis -Filter "*${Version}*setup.exe" | Select-Object -First 1
  if ($found) { Copy-Item $found.FullName $exe -Force } else { throw "Build installer first: npm run tauri:build" }
}

Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = $key
# 키에 비밀번호가 있으면 프롬프트 또는: $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "your-password"

Set-Location $root
Write-Host "[sign] Signing $exe ..."
npx tauri signer sign --private-key-path $key $exe
$sigFile = "$exe.sig"
if (-not (Test-Path $sigFile)) { throw "No .sig produced: $sigFile" }

$signature = (Get-Content $sigFile -Raw).Trim()
$notesText = $env:RELEASE_NOTES
if (-not $notesText) {
  $notesText = "v$Version — 항목 드래그 정렬, 알림 날짜/시간 분리, 아이콘 편집 확대, 클릭 실행·OS 드롭 개선"
}
$latest = @{
  version = "v$Version"
  notes = $notesText
  pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = @{
    "windows-x86_64" = @{
      signature = $signature
      url = "https://github.com/ggugguai-star/Dashboard/releases/download/v$Version/$exeName"
    }
  }
}
$latestPath = Join-Path $root "latest.json"
$json = ($latest | ConvertTo-Json -Depth 5) + "`n"
[System.IO.File]::WriteAllText($latestPath, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host "[ok] latest.json -> $latestPath"
Write-Host "[gh] Uploading .sig + latest.json to v$Version ..."
gh release upload "v$Version" $sigFile $latestPath --repo ggugguai-star/Dashboard --clobber
Write-Host "[done] Updater artifacts on GitHub release v$Version"
