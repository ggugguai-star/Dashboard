# 1_RESULT — 작업 #1 Phase 0~1 진단 + Phase 2 수정·검증 결과

> **작업 지시서:** [`MDs/1_PROMPT.md`](1_PROMPT.md)  
> **마스터플랜:** [`0_MASTER_PLAN.md`](../0_MASTER_PLAN.md)  
> **최초 진단:** 2026-05-31  
> **QA 재검증·갱신:** 2026-05-31 (Cursor Agent — 로컬 Ollama QA 타임아웃 대체)  
> **범위:** Phase 0~1 진단 + Phase 2 P0 수정·release 재검증

---

## 0. QA 반려 사유 처리

| 항목 | 내용 |
|------|------|
| **로컬 AI QA 오류** | `HTTPConnectionPool(host='localhost', port=11434): Read timed out` — Ollama(11434) 미응답으로 **QA 파이프라인 자체 실패** |
| **앱 결함 여부** | QA 타임아웃 ≠ 앱 버그. 본 문서는 Cursor Agent가 **CDP + release exe**로 독립 재검증 |
| **1차 진단 보완** | 1차 `1_RESULT`의 `#cevCtxOverlay` 원인은 **맞았으나 불완전** — release 전용 **CSP 2종 결함** 추가 발견·수정 |

---

## 1. 요약 (Executive Summary)

| 항목 | 결과 |
|------|------|
| **근본 원인 #1** | `#cevCtxOverlay` — HTML `style="display:none"`(세미콜론 없음)이 tauri.localhost WebView2에서 무시 → CSS `display:none` + class toggle로 **수정 완료** |
| **근본 원인 #2** | **CSP** — release 빌드에서 (a) Tauri asset CSP hash/nonce가 `onclick` inline handler 차단 (b) `connect-src`에 `ipc.localhost` 누락 → invoke 실패 → **수정 완료** |
| **가설 A (ES 모듈)** | **기각** — `nextSetupStep=function`, 모듈 200 |
| **P0 상태** | **release exe 검증 통과** (2026-05-31) |

---

## 2. Phase 0 — 환경 (변경 없음)

| Step | 상태 |
|------|------|
| `npm install` | ✅ |
| `npm run tauri:dev` | ✅ (첫 빌드 ~2m29s) |
| `npm run tauri:build` | ✅ (release ~2~4m, 3회 빌드) |
| CDP 진단 | ✅ `scripts/diag-p0*.mjs` |

---

## 3. Phase 1 — 진단 (1차 + 재검증)

### 3-1. dev vs release 비교

| 환경 | URL | `#btnNext` hit | 클릭 Step 전환 |
|------|-----|----------------|----------------|
| `tauri dev` | http://127.0.0.1:1430 | `BUTTON#btnNext` | ✅ |
| release (수정 전) | http://tauri.localhost | `DIV#cevCtxOverlay` | ❌ intercept |
| release (overlay만 수정) | http://tauri.localhost | `BUTTON#btnNext` | ❌ CSP가 onclick 차단 |
| **release (전체 수정 후)** | http://tauri.localhost | `BUTTON#btnNext` | **✅ Step 0→1→2** |

### 3-2. 근본 원인 #1 — `#cevCtxOverlay` (가설 B)

**증상:** fixed full-screen 투명 레이어, z-index 960, `pointer-events: auto`

**기술:** `style="display:none"` 단독 속성이 release WebView에서 CSSOM 미반영. `.cev-ctx-overlay { position:fixed; inset:0 }`만 적용.

| ID | attr | computed (수정 전) | computed (수정 후) |
|----|------|-------------------|-------------------|
| cevCtxOverlay | (inline 제거) | block | **none** |
| cevCtxMenu | (inline 제거) | block | **none** |

**적용 수정 (`src/index.html`):**

- CSS: `.cev-ctx-overlay`, `.cev-ctx-menu` 기본 `display:none; pointer-events:none`
- `.cev-open` class toggle (`openCevCtx` / `closeCevCtx`)
- `resetAllOverlaysOnStart`에 `cevCtxOverlay`, `cevCtxMenu` 추가

### 3-3. 근본 원인 #2 — CSP (재검증 중 신규 발견)

**증상:** overlay 수정 후에도 `#btnNext` 클릭 무반응. `window.nextSetupStep()` 직접 호출은 동작.

**Console (수정 전):**

```
Executing inline event handler violates ... script-src ... 'sha256-...'
Note that 'unsafe-inline' is ignored if either a hash or nonce value is present
```

```
Connecting to 'http://ipc.localhost/plugin%3Apath%7Cresolve_directory' violates connect-src
```

**원인:**

1. Tauri release가 asset CSP에 **sha256/nonce** 주입 → `unsafe-inline`/`unsafe-hashes`만으로는 **100개 `onclick=`** 허용 불가
2. 커스텀 CSP의 `connect-src`에 **`ipc:` / `http://ipc.localhost`** 누락 → 모든 `invoke()` 실패

**적용 수정 (`src-tauri/tauri.conf.json`):**

```json
"connect-src": "... ipc: http://ipc.localhost https://ipc.localhost ...",
"style-src": "... 'unsafe-hashes'",
"script-src": "... 'unsafe-hashes'",
"img-src": "... https://www.gstatic.com",
"dangerousDisableAssetCspModification": true
```

> `dangerousDisableAssetCspModification: true` — release 빌드의 자동 hash/nonce 주입 비활성화. `onclick` 100개 유지 전략과 호환.

### 3-4. 가설 확정표 (최종)

| 가설 | 확정 | 비고 |
|------|------|------|
| A — ES 모듈 / Object.assign | **N** | |
| B — 오버레이 클릭 차단 | **Y (#1)** | cevCtxOverlay — **수정됨** |
| **E — CSP (신규)** | **Y (#2)** | inline handler + ipc — **수정됨** |
| C — capabilities | **N** | |
| D — drag-region | **N** | |

---

## 4. Phase 2 — 적용 변경 파일

| 파일 | 변경 요약 |
|------|-----------|
| `src/index.html` | cev-ctx CSS `display:none`, class toggle, resetAllOverlaysOnStart 보강 |
| `src-tauri/tauri.conf.json` | connect-src ipc, style/script unsafe-hashes, gstatic img, disableAssetCspModification |

---

## 5. P0 DoD — release 검증 (2026-05-31)

CDP + Playwright, `target/release/work-dashboard.exe`, `localStorage` cleared:

| 조건 | 결과 |
|------|------|
| `#btnNext` hit-test → `btnNext` | ✅ |
| `#cevCtxOverlay` computed display | ✅ `none` |
| Playwright click Step 0→1 | ✅ `sp1.active` |
| Playwright click Step 1→2 | ✅ `sp2.active` |
| CSP violation (onclick/ipc) | ✅ **0건** |
| `typeof window.nextSetupStep` | ✅ `function` |

**검증 명령:**

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9224"
Start-Process .\src-tauri\target\release\work-dashboard.exe
node scripts/diag-p0-inline-style.mjs
```

---

## 6. 후속 (작업 #2 완료)

[`MDs/2_RESULT.md`](2_RESULT.md) — P1 자동 검증 14/14, `checkSetupDone` 순서 수정, capabilities·overlay 보강.

---

## 7. 잔여 리스크 (P2 이관)

| 항목 | 우선순위 | 비고 |
|------|----------|------|
| 닫힌 `.settings-overlay` / `.alarm-overlay` `pointer-events` hardening | P2 | dev에서 미차단, 예방적 |
| `onclick` 100개 → addEventListener 점진 전환 | P3 | CSP hardening 장기 |
| `dangerousDisableAssetCspModification` 보안 검토 | P2 | PoLP vs 호환 trade-off |
| Google OAuth / Calendar E2E | **P1** | → [`2_RESULT.md`](2_RESULT.md) (자동 완료, OAuth 수동만) |

---

## 7. 문서 이력

| 날짜 | 내용 |
|------|------|
| 2026-05-31 | Phase 0~1 진단 (코드 수정 없음) |
| 2026-05-31 | QA Ollama 타임아웃 → Cursor 재검증; CSP #2 발견; P0 수정·release 검증 통과 |
