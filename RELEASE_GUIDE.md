# 업무 대시보드 — Tauri v2 릴리즈 가이드

> 작성 기준: Tauri v2.11.2 / NSIS currentUser 설치  
> 작성일: 2026-05-30

---

## 1단계: Ed25519 서명 키 생성 (최초 1회)

서명 키는 업데이트 파일의 무결성을 보증합니다.  
**개인 키(private key)는 절대 커밋하지 마세요.**

### 1-1. 키 생성

PowerShell 또는 cmd 에서 실행합니다:

```powershell
npm run tauri -- signer generate -w "%USERPROFILE%\.tauri\dashboard-update-key.pem"
```

실행하면 아래와 같이 출력됩니다:

```
Your keypair was generated successfully
Public key: dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXkgNzREMkE4N0QxN0ZERkZG
            RWRzaVFDSDdqYUhwdGVuczBNT...==
 ↑ 이 값을 복사해서 tauri.conf.json 에 붙여넣으세요

Private key saved to: C:\Users\..\.tauri\dashboard-update-key.pem
```

### 1-2. 공개 키 → `tauri.conf.json` 적용

`src-tauri/tauri.conf.json` 의 `plugins.updater.pubkey` 에 붙여넣습니다:

```json
"plugins": {
  "updater": {
    "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWdu...",
    "endpoints": [
      "https://github.com/ggugguai-star/Dashboard/releases/latest/download/latest.json"
    ]
  }
}
```

---

## 2단계: 빌드 전 환경 변수 설정

빌드 시 Tauri 가 개인 키로 `.exe` 와 `.sig` 파일에 서명합니다.

### PowerShell (권장)

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\dashboard-update-key.pem" -Raw

# 비밀번호를 지정했다면
# $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "your-password"
```

> **중요**: 이 변수는 현재 PowerShell 세션에만 유효합니다.  
> 터미널을 닫으면 사라지므로 빌드 전마다 다시 설정합니다.

### 영구 설정 (선택)

시스템 환경 변수로 등록하면 매번 설정할 필요가 없습니다:

```powershell
[System.Environment]::SetEnvironmentVariable(
  "TAURI_SIGNING_PRIVATE_KEY",
  (Get-Content "$env:USERPROFILE\.tauri\dashboard-update-key.pem" -Raw),
  "User"
)
```

---

## 3단계: 프로덕션 빌드

```powershell
npm run tauri:build
```

> 첫 빌드는 Rust 크레이트 컴파일로 **10~15분** 소요됩니다.  
> 이후 빌드는 캐시를 활용해 **3~5분** 내외입니다.

### 빌드 산출물 위치

```
src-tauri/target/release/bundle/nsis/
├── work-dashboard-setup-1.3.2.exe        ← 배포 설치 파일
└── work-dashboard-setup-1.3.2.exe.sig    ← 서명 파일 (업데이트 검증용)
```

---

## 4단계: GitHub Releases 배포

### 4-1. 버전 올리기

`src-tauri/tauri.conf.json` 의 `"version"` 필드 수정:

```json
"version": "1.3.3"
```

### 4-2. `latest.json` 파일 생성

GitHub Releases 루트에 `latest.json` 을 업로드해야 Tauri 업데이터가 읽을 수 있습니다.

```json
{
  "version": "v1.3.3",
  "notes": "변경 사항 요약",
  "pub_date": "2026-06-01T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<work-dashboard-setup-1.3.3.exe.sig 파일의 내용 전체 붙여넣기>",
      "url": "https://github.com/ggugguai-star/Dashboard/releases/download/v1.3.3/work-dashboard-setup-1.3.3.exe"
    }
  }
}
```

> `.sig` 파일의 전체 내용을 `"signature"` 값으로 사용합니다.

### 4-3. GitHub Release 에 업로드할 파일

| 파일 | 용도 |
|------|------|
| `work-dashboard-setup-1.3.3.exe` | 설치 파일 |
| `work-dashboard-setup-1.3.3.exe.sig` | 서명 (업데이터가 검증에 사용) |
| `latest.json` | 업데이터가 읽는 버전 메타데이터 |

---

## 5단계: GitHub Fine-Grained PAT 설정

기존 Electron 빌드용 `GH_TOKEN` 을 그대로 사용합니다:

```powershell
$env:GH_TOKEN = "github_pat_xxxxxxxxxxxx"
```

---

## 빠른 체크리스트

- [ ] `tauri.conf.json` — `pubkey` 에 공개 키 값 입력
- [ ] `tauri.conf.json` — `version` 이 최신인지 확인
- [ ] 환경 변수 `TAURI_SIGNING_PRIVATE_KEY` 설정
- [ ] `npm run tauri:build` 성공
- [ ] `.exe` + `.sig` + `latest.json` 3개 파일을 GitHub Release 에 업로드
- [ ] 업데이트 확인: 구 버전 앱에서 설정 → "업데이트 확인" 클릭

---

## 주의 사항

| ❌ 금지 | ✅ 대신 |
|--------|--------|
| `dashboard-update-key.pem` 을 git 에 커밋 | `.gitignore` 에 추가 |
| 공개 키를 `.pem` 파일과 혼동 | 공개 키는 `tauri.conf.json` 에, 개인 키는 `.pem` 에 |
| `pubkey` 빈 채로 프로덕션 빌드 | 업데이터가 서명 검증 실패로 동작 안 함 |
