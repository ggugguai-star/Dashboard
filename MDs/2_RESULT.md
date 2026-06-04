# 2_RESULT — 작업 #2 P1 핵심 연동 + 회귀 검증 결과

> **작업 지시서:** [`MDs/2_PROMPT.md`](2_PROMPT.md)  
> **선행 결과:** [`MDs/1_RESULT.md`](1_RESULT.md) — P0 완료  
> **검증일:** 2026-05-31 (QA CDP 재반려 수정 · release 재검증)  
> **빌드:** `src-tauri/target/release/work-dashboard.exe` · NSIS `업무 대시보드_2.0.2_x64-setup.exe`

---

## 작업 #2 결과 — P1 핵심 연동

### P0 회귀

- [x] release `#btnNext` 클릭 — hit=`btnNext`, Step 0→1→2
- [x] `cevCtxOverlay` computed `display:none`, 클릭 차단 없음
- [x] CSP violation **0건**
- [x] `typeof window.nextSetupStep === 'function'`

### P1 E2E (release exe + CDP)

| ID | 결과 | 비고 |
|----|------|------|
| T1~T4 | ✅ | 설정 위저드 → 대시보드 |
| T5~T8 | ✅ | OAuth (수동 확인 + invoke) |
| T6 | ✅ | keyring + `.gcal-tokens.sec` 폴백, 평문 JSON 미사용 |
| T9, T11, T13, T15 | ✅ | 자동 |
| T10, T12, T14 | ⏭️ | 수동·P2 |

**1차 정적 검증 (오케스트레이터):** `node scripts/diag-p1.mjs` → **15/15 PASS**  
(환경: `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, `CDP_PORT` 충돌 무시, exe 자동 기동)

---

## 1. 요약

| 항목 | 결과 |
|------|------|
| **QA 반려 (CDP unavailable / port 9224)** | ✅ 수정 — WEBVIEW2 우선·다중 포트 탐색·오케스트레이터 `CDP_PORT` 제거 |
| **P0·P1 자동 검증** | ✅ 15/15 (`CDP_PORT=9224` + WEBVIEW2=9222 동시 설정 시에도 9222 연결) |
| **P1 DoD** | ✅ (T10/T12/T14 선택 수동) |

**판정:** P1 DoD 충족 · 오케스트레이터 1차 검증 통과 가능 상태

---

## 2. QA 반려 대응 (CDP unavailable)

### 2-1. 반려 사유 (재발)

```
[diag-p1] Connecting CDP port 9224
[diag-p1] CDP unavailable. Start release exe with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9224
```

**근본 원인 (2차):**

1. `resolveCdpPort()` 가 **`CDP_PORT`를 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`보다 먼저** 읽음 → 호스트에 `CDP_PORT=9224`가 있으면 오케스트레이터의 9222와 불일치.
2. 앱은 9222로 뜨는데 스크립트는 9224만 조회 → CDP unavailable.
3. (구버전) `diag-p1.mjs` 즉시 실패 메시지 — 현재 트리에는 제거됨; 재반려 로그는 위 조합으로도 동일 증상 재현.

### 2-2. 수정 (2차)

| 파일 | 내용 |
|------|------|
| `scripts/cdp-utils.mjs` | `resolveCdpPort()`: **WEBVIEW2 인자 우선**, 그다음 `CDP_PORT`, 기본 9222. `cdpPortCandidates()` + `probeCdpPort()` / `waitForAnyCdp()` 로 9222·9224 다중 탐색. exe 기동 시 `CDP_PORT` 삭제·WEBVIEW2를 launch 포트로 고정 |
| `scripts/diag-p1.mjs` | `ensureCdpReady()` 단일 호출 (포트 인자 제거) |
| `scripts/diag-p0-inline-style.mjs` | 동일 |
| `agent_orchestrator.py` | `run_static_analysis()`: `custom_env.pop("CDP_PORT")`, `cwd=project_root` |

### 2-3. 재검증

```powershell
cd C:\AI\AiCoding\Dashboard
$env:CDP_PORT="9224"
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
node scripts/diag-p1.mjs
# → [diag-p1] Connecting CDP port 9222
# → 15/15 passed, exit 0
```

오케스트레이터와 동일 조건:

```powershell
python -c "import subprocess,os; r=subprocess.run('node scripts/diag-p1.mjs',shell=True,cwd=r'C:\AI\AiCoding\Dashboard',env={**os.environ,'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS':'--remote-debugging-port=9222','CDP_PORT':''} if False else {k:v for k,v in os.environ.items() if k!='CDP_PORT'} | {'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS':'--remote-debugging-port=9222'},capture_output=True,text=True); print(r.returncode)"
# → 0
```

---

## 3. 기존 P1 결함 수정 (누적)

| # | 내용 |
|---|------|
| 3-1 | `checkSetupDone` → `Object.assign` 이후 실행 |
| 3-2 | `openEvDialog` / `launchDashboard` 전역 노출 |
| 3-3 | capabilities 보강 |
| 3-4 | 오버레이 `pointer-events` |
| 3-5 | 토큰 keyring + `.gcal-tokens.sec` 폴백, `token_secure_save` Rust 내 검증 |
| 3-6 | `getAuthStatus` ← `getValidAccessToken`, `async applySettings` |
| 3-7 | `loadTokens`에서 매회 migrate 제거 (기동 시 `checkMigration`만) |

---

## 4. 변경 파일 (전체)

| 파일 | 요약 |
|------|------|
| `scripts/cdp-utils.mjs` | CDP 포트 우선순위·다중 포트·exe 자동 기동 |
| `scripts/diag-p1.mjs` | 오케스트레이터 호환 |
| `scripts/diag-p0-inline-style.mjs` | 포트 통일 |
| `agent_orchestrator.py` | `CDP_PORT` 제거·`cwd` 고정 |
| `src/index.html` | P0/P1 UI·OAuth·setup |
| `src/google-api.js` | OAuth 저장 검증 |
| `src/token-store.js` | keyring 저장 |
| `src-tauri/src/token_secure.rs` | Rust 토큰 I/O |
| `src-tauri/src/lib.rs` | 커맨드 등록 |
| `src-tauri/Cargo.toml` | keyring, dirs |
| `src-tauri/capabilities/main.json` | ACL |

---

## 5. P1 DoD (`2_PROMPT.md` §9)

- [x] T1~T4 설정 위저드 E2E
- [x] T5~T8 OAuth
- [x] T9~T11 Calendar (T10 선택)
- [x] T12~T15 (T12/T14 선택)
- [x] P0 회귀
- [x] `2_RESULT.md` 작성

---

## 6. 검증 명령

### 오케스트레이터 / CI (앱 미실행 상태)

```powershell
cd C:\AI\AiCoding\Dashboard
npm run tauri:build
# orchestrator: CDP_PORT 제거 + WEBVIEW2=9222 + cwd=프로젝트 루트
node scripts/diag-p1.mjs
```

### 수동 (포트 9224만 사용)

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9224"
Remove-Item Env:CDP_PORT -ErrorAction SilentlyContinue
Start-Process .\src-tauri\target\release\work-dashboard.exe
node scripts/diag-p1.mjs
```

---

## 7. 미해결 → 작업 #3

| 항목 | 우선순위 |
|------|----------|
| T10/T12/T14 수동 E2E | P2 |
| Drive Weekly Plan | P2 |
| Google Tasks 검증 | P2 |
| `onclick` → addEventListener | P3 |
| GitHub Release | P3 |

---

## 8. 문서 이력

| 날짜 | 내용 |
|------|------|
| 2026-05-31 | P1 초판·OAuth·토큰 보안 |
| 2026-05-31 | QA CDP 반려 1차 — `cdp-utils.mjs`, exe 자동 기동 |
| 2026-05-31 | **QA CDP 재반려 2차** — WEBVIEW2 우선, 다중 포트, orchestrator `CDP_PORT` pop, 15/15 PASS |
