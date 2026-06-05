# 서명 + latest.json 생성 + GitHub Release 업로드
# Usage:
#   .\scripts\sign-release.ps1 -Version 2.1.0
#   .\scripts\sign-release.ps1 -Version 2.1.0 -Password "키-비밀번호"
#   (또는 %USERPROFILE%\.tauri\sign-password.txt 한 줄에 비밀번호 저장)
param(
  [string]$Version = "2.1.0",
  [string]$Password = ""
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$key = Join-Path $env:USERPROFILE ".tauri\dashboard-update-key-new.pem"
if (-not (Test-Path $key)) {
  $key = Join-Path $env:USERPROFILE ".tauri\dashboard-update-key.pem"
}
if (-not (Test-Path $key)) { throw "Missing signing key: $key" }

$passFile = Join-Path $env:USERPROFILE ".tauri\sign-password.txt"
if (-not $PSBoundParameters.ContainsKey('Password') -and (Test-Path $passFile)) {
  $Password = (Get-Content $passFile -Raw).Trim()
}
if (-not $PSBoundParameters.ContainsKey('Password') -and $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  $Password = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
}
if (-not $PSBoundParameters.ContainsKey('Password')) {
  Write-Host "[sign] 키 비밀번호가 필요합니다 (생성 시 설정한 값)."
  $sec = Read-Host "비밀번호" -AsSecureString
  $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}

$nsis = Join-Path $root "src-tauri\target\release\bundle\nsis"
$exeName = "dashboard_${Version}_x64-setup.exe"
$exe = Join-Path $nsis $exeName
if (-not (Test-Path $exe)) {
  $found = Get-ChildItem $nsis -Filter "*${Version}*setup.exe" | Where-Object { $_.Name -notlike "dashboard_*" } | Select-Object -First 1
  if ($found) {
    Copy-Item $found.FullName $exe -Force
    Write-Host "[copy] $($found.Name) -> $exeName"
  } else {
    throw "Missing installer: $exe (run: npm run tauri:build)"
  }
}

Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue
if ($Password) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $Password }

Set-Location $root
$cli = Join-Path $root "node_modules\@tauri-apps\cli\tauri.js"
if (-not (Test-Path $cli)) { throw "Missing $cli — run npm install" }

Write-Host "[sign] Signing $exe ..."
$signScript = Join-Path $root "scripts\sign-file.mjs"
if (-not (Test-Path $signScript)) { throw "Missing $signScript" }
$passArg = if ($null -ne $Password) { $Password } else { "" }
& node $signScript $key $exe $passArg
if ($LASTEXITCODE -ne 0) { throw "sign-file.mjs failed (exit $LASTEXITCODE)" }

$sigFile = "$exe.sig"
if (-not (Test-Path $sigFile)) { throw "No .sig produced: $sigFile" }

$signature = (Get-Content $sigFile -Raw).Trim()
$notesText = $env:RELEASE_NOTES
if (-not $notesText) {
  $notesText = "v$Version — 항목 드래그 정렬, 알림 날짜/시간 분리, 아이콘 편집 확대, 클릭 실행·OS 드롭 개선"
}
$latest = @{
  version   = "v$Version"
  notes     = $notesText
  pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = @{
    "windows-x86_64" = @{
      signature = $signature
      url       = "https://github.com/ggugguai-star/Dashboard/releases/download/v$Version/$exeName"
    }
  }
}
$latestPath = Join-Path $root "latest.json"
$json = ($latest | ConvertTo-Json -Depth 5 -Compress) + "`n"
[System.IO.File]::WriteAllText($latestPath, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host "[ok] latest.json -> $latestPath"
Write-Host "[gh] Uploading .sig + latest.json to v$Version ..."
gh release upload "v$Version" $sigFile $latestPath --repo ggugguai-star/Dashboard --clobber
Write-Host "[done] https://github.com/ggugguai-star/Dashboard/releases/tag/v$Version"
