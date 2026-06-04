# 4_PROMPT — 작업 지시서 #4: P3 배포·품질 (화면 캡처 · 업데이터 · 릴리즈)

> **문서 유형:** AI/개발자 작업 지시서  
> **작업 번호:** 4  
> **상위 문서:** [`0_MASTER_PLAN.md`](0_MASTER_PLAN.md)  
> **선행 결과:** [`MDs/3_RESULT.md`](3_RESULT.md) — **P2 완료** (오케스트레이터 1차·2차 QA PASS)  
> **작성일:** 2026-06-01

---

## 0. 역할 정의

Tauri v2 + Vanilla JS **업무 대시보드**에서 P0·P1·P2는 [`3_RESULT.md`](3_RESULT.md) 기준 **자동 검증 완료**다.  
본 작업(**P3**)은 **배포·품질** 마무리 — **아이콘 화면 캡처**, **GitHub 자동 업데이트**, **`RELEASE_GUIDE.md` 체크리스트**, **P0~P2 회귀** — 를 **release exe** 기준으로 검증하고, 전체 마이그레이션 종료 시 **`MDs/Final.md`** 를 작성한다.

**5대 원칙 유지:** Google API는 `src/google-api.js`만 · Rust에 Google API 금지 · **`main.js` / `preload.js` (Electron) 수정 금지**

---

## 1. 작업 목표 (한 문장)

> **release 빌드에서 아이콘 화면 캡처(ms-screenclip → 클립보드 → 피커 반영)와 updater(`latest.json` 서명 릴리즈)가 동작함을 확인하고, P0~P2 회귀가 없으며 `RELEASE_GUIDE` 체크리스트를 충족한 뒤 `Final.md`로 마이그레이션을 종료한다.**

---

## 2. 선행 조건 (P2 완료 확인)

[`3_RESULT.md`](3_RESULT.md) §1·§5 DoD를 확인한다. 최소한 아래가 성립해야 한다.

```powershell
cd C:\AI\AiCoding\Dashboard
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
node scripts/diag-p2.mjs
# 기대: 13/13 passed (R1 내부 diag-p1 15/15 — diag-p2 SUMMARY는 13/13)
```

**Google 실계정:** `3_RESULT.md`의 `SKIP(미연동)` 항목은 본 작업에서 **필수 완료 조건이 아님**. 연동 계정이 있으면 §6 B-4 스모크 1회 권장.

P0~P2 회귀 실패 시 **본 작업 중단** → `3_RESULT.md` §3·[`scripts/diag-p2.mjs`](../scripts/diag-p2.mjs) 재확인.

---

## 3. P0~P2에서 이미 적용된 수정 (재수정 금지·이해 필수)

| 영역 | 파일 | 내용 |
|------|------|------|
| P0·P1·P2 CDP | `scripts/diag-p1.mjs`, `diag-p2.mjs`, `cdp-utils.mjs` | WEBVIEW2=9222, release exe 자동 기동 |
| 오버레이·피커 | `src/index.html` | `.icp-open`, `.drv-open`, P2-10, T35~T37 |
| 화면 캡처 (골격) | `src/index.html` | `icpStartCapture`, `_icpApplyClipboard`, `capture-image-ready` |
| 업데이터 (골격) | `src/index.html`, `tauri.conf.json` | `checkForUpdates`, `plugin:updater`, pubkey·endpoints |
| 토큰 | `token-store.js`, `token_secure.rs` | keyring · 평문 `gcal-tokens.json` 신규 생성 금지 |
| 릴리즈 문서 | [`RELEASE_GUIDE.md`](../RELEASE_GUIDE.md) | 서명 키 · `latest.json` · GitHub Release |

---

## 4. 작업 범위

### 4-1. P3 필수 (Must)

| ID | 영역 | 검증 항목 | 핵심 파일 |
|----|------|-----------|-----------|
| P3-0 | **P0~P2 회귀** | `diag-p2.mjs` **13/13** (오케스트레이터 1차와 동일) | `scripts/diag-p2.mjs` |
| P3-1 | **화면 캡처 (F9)** | 아이콘 피커 → 📸 캡처 → `ms-screenclip:` → 복귀 후 64×64 dataURL·피커 반영 | `index.html`, `plugin-shell`, `plugin-clipboard-manager` |
| P3-2 | **자동 업데이트 (F11)** | 서명 빌드 · GitHub `latest.json` · `check` → (선택) install | `tauri.conf.json`, `index.html`, `latest.json` |
| P3-3 | **릴리즈 체크리스트** | [`RELEASE_GUIDE.md`](../RELEASE_GUIDE.md) §빠른 체크리스트 전항 ✅ 또는 미충족 사유 명시 | repo 루트 |
| P3-4 | **종료 문서** | **`MDs/Final.md`** — 마스터플랜 대비 완료·미완·버전·검증 요약 | `MDs/Final.md` |

### 4-2. P3 권장 (Should)

| ID | 영역 |
|----|------|
| P3-5 | `scripts/diag-p3.mjs` — `diag-p2` 체인 + 캡처/업데이터 CDP·invoke 스텁 |
| P3-6 | 설정 모달(고급)에서 「업데이트 확인」 수동 버튼 E2E 1회 |
| P3-7 | Google 연동 계정 있을 때 Drive·Tasks **수동 스모크** (`3_RESULT` SKIP 해소) |

### 4-3. 범위 밖 (본 작업에서 하지 않음)

- `onclick` → `addEventListener` **전면** 전환 (별도 기술부채 · `0_MASTER_PLAN` 장기)
- Electron `main.js` / `preload.js` 수정
- 신규 Google API를 Rust로 이전
- 대규모 `index.html` 리포맷

---

## 5. Phase A — 환경·서명·빌드

```powershell
cd C:\AI\AiCoding\Dashboard
npm install

# 서명 키 (RELEASE_GUIDE §1~2)
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\dashboard-update-key.pem" -Raw

npm run tauri:build
# 산출물: src-tauri\target\release\bundle\nsis\ (설치 exe + .sig)
```

**주의**

- `tauri dev`만으로 P3 완료 선언 **금지** — **release exe** 기준.
- `tauri.conf.json` `plugins.updater.pubkey` 가 비어 있으면 updater E2E **FAIL** (이미 pubkey 설정됨 — 회귀만 확인).
- 버전 올릴 때: `tauri.conf.json` `version` · NSIS 파일명 · `latest.json` `version`·`url`·`signature` **일치**.

---

## 6. Phase B — E2E 테스트 시나리오

### B-0. 회귀 (자동·필수)

| # | 명령 | 기대 |
|---|------|------|
| R0 | `node scripts/diag-p2.mjs` (WEBVIEW2=9222) | **13/13** PASS, exit 0 |
| R1 | (권장) `node scripts/diag-p3.mjs` 작성 후 동일 PASS 체인 | P3 전용 항목 포함 |

### B-1. 화면 캡처 (P3-1)

| # | 동작 | 기대 |
|---|------|------|
| T40 | 카테고리 아이콘 우클릭 → 아이콘 변경 → 🎭 커스텀 → **📸 캡처** | 창 hide → Windows 캡처 UI |
| T41 | 영역 드래그 후 앱 포커스 복귀 | 클립보드 이미지 → 64×64 preview · `saveState` 가능 dataURL |
| T42 | 캡처 취소(Esc) | 앱 복귀 · 크래시 없음 · 피커 재오픈 가능 |
| T43 | 📁 파일 선택 (폴백) | `icpFileInput` → 동일 preview 파이프라인 |

**실패 시 점검:** `openPath('ms-screenclip:')` · `plugin:clipboard-manager` 권한 · `_icpWaitFocusRestore` 타임아웃 · Console `[icpCapture]`.

### B-2. 자동 업데이트 (P3-2)

| # | 동작 | 기대 |
|---|------|------|
| T50 | 서명 빌드 후 `.exe.sig` 생성 | 빌드 로그에 signer 성공 |
| T51 | GitHub Release에 `latest.json` + 설치본 + `.sig` 업로드 | `endpoints` URL 200 |
| T52 | **구버전** release 앱 기동 3초 후 | `checkForUpdates` — `available` 또는 `not-available`(동일 버전) · pubkey/404는 **에러 토스트 없이** `not-available` 처리 |
| T53 | (선택) 테스트 채널에 **상위 버전** 올린 뒤 확인 | 다운로드 진행 · `installUpdate` · 재시작 |

**개발 PC만 있을 때:** T51~T53은 **SKIP(릴리즈 미업로드)** 로 `4_RESULT.md`에 명시 가능. **pubkey·서명 빌드·`latest.json` 템플릿 검증**은 로컬에서 필수.

참고: 루트 [`latest.json`](../latest.json) 는 v2.0.2 예시 — 실제 배포 시 **새 버전·signature·url** 로 갱신.

### B-3. RELEASE_GUIDE 체크리스트 (P3-3)

[`RELEASE_GUIDE.md`](../RELEASE_GUIDE.md) 「빠른 체크리스트」 각 항목을 `4_RESULT.md`에 ✅ / SKIP / N/A 로 기록.

### B-4. Google 수동 스모크 (P3-7·선택)

연동 계정 1개 있을 때만:

| # | 동작 | 기대 |
|---|------|------|
| T60 | Weekly Plan ↻ | Drive 이미지 로드 |
| T61 | Tasks 동기화·할 일 추가 | 목록 갱신 |
| T62 | Drive 패널 폴더 진입·파일 열기 | `listDriveFolder` · shell open |

미연동: **`SKIP(미연동)`** — `3_RESULT.md`와 동일 정책.

### B-5. Final.md (P3-4)

| # | 산출물 | 기대 |
|---|--------|------|
| F1 | **`MDs/Final.md`** | P0~P3 요약 · 버전 · 검증 명령 · Known issues · Electron 대비 상태 |
| F2 | 오케스트레이터 | `Final.md` 감지 시 **릴리즈 종료** (phase 999) |

---

## 7. 구현·수정 가이드 (필요 시만 최소 diff)

### 7-1. 화면 캡처

- 이미 `icpStartCapture` ~ `_icpApplyClipboard` 구현됨 — **동작 안 하면 버그 수정만**.
- `capabilities` / shell allowlist에 `ms-screenclip:` 허용 여부 확인 (`src-tauri/capabilities/`).
- RGBA·Blob 경로 모두 64×64 center-crop 유지.

### 7-2. 업데이터

- `checkForUpdates` / `installUpdate` — `window` 노출 여부 CDP에서 확인 가능하면 `Object.assign(window, …)` 패턴 유지.
- `latest.json`의 `signature` = `.sig` 파일 **전체 내용**.
- 프로덕션 endpoint: `tauri.conf.json` `plugins.updater.endpoints[0]` 와 일치.

### 7-3. diag-p3.mjs (권장)

```text
diag-p3.mjs
  └─ spawn diag-p2.mjs (13/13)
  └─ CDP: typeof icpStartCapture === 'function'
  └─ CDP: typeof checkForUpdates === 'function'
  └─ (선택) mock clipboard / updater invoke — 실패 시 note만
```

오케스트레이터 `STATIC_CHECK_CMD` 변경은 **선택** — 변경 시 `agent_orchestrator.py` `STATIC_CHECK_CMD` 와 본 문서 §8을 함께 갱신.

---

## 8. 산출물

| # | 파일 | 내용 |
|---|------|------|
| D1 | **`MDs/4_RESULT.md`** | R0·T40~T53·RELEASE 체크리스트·회귀·결함·P3 DoD |
| D2 | (권장) `scripts/diag-p3.mjs` | P3 자동 검증 |
| D3 | (배포 시) GitHub Release assets | `.exe`, `.sig`, `latest.json` |
| D4 | **`MDs/Final.md`** | **마이그레이션 최종 명세** (본 작업 완료의 실질 종료 조건) |

**작성 규칙:** 초안 `MDs/4_RESULT_draft.md` → 완료 후 `MDs/4_RESULT.md` rename (오케스트레이터 V4.7).

**검증 건수 (혼동 방지)**

| 스크립트 | 1차 검증 기대 |
|----------|----------------|
| `diag-p2.mjs` | **13/13** (현재 오케스트레이터 기본) |
| `diag-p3.mjs` | **N/N** (작성 후 `4_RESULT`에 실제 stdout 인용) |

---

## 9. P3 완료 조건 (DoD)

- [ ] R0: `diag-p2.mjs` **13/13** PASS
- [ ] T40~T43 화면 캡처 수동 E2E (또는 `SKIP(Windows 캡처 불가)` + 사유)
- [ ] T50 서명 빌드 · `latest.json` 템플릿 정합
- [ ] T51~T53 또는 **SKIP(릴리즈 미업로드)** 명시
- [ ] `RELEASE_GUIDE.md` 체크리스트 결과 표
- [ ] P0~P2 기능 회귀 없음 (`4_RESULT`에 명시)
- [ ] **`MDs/4_RESULT.md`** 작성
- [ ] **`MDs/Final.md`** 작성 → 오케스트레이터 종료

---

## 10. 보고 형식 (`4_RESULT.md` 템플릿)

```markdown
## 작업 #4 결과 — P3 배포·품질

### 회귀
- [x] diag-p2 13/13

### P3 E2E
| ID | 결과 | 비고 |
| T40~T43 | ✅/❌/SKIP | |
| T50~T53 | ✅/❌/SKIP(릴리즈 미업로드) | |

### RELEASE_GUIDE 체크리스트
| 항목 | 결과 |

### 변경 파일
| 파일 | 요약 |

### Final.md
- [x] 작성 완료 · 오케스트레이터 phase 999 대기
```

---

## 11. 작업 규칙

1. **release exe** 기준 검증 (dev-only 통과 금지)
2. `index.html` 리포맷 금지 · 최소 diff
3. Google API → Rust 이전 금지
4. git commit은 사용자 요청 시에만
5. `SKIP(...)` 은 `3_RESULT`와 같이 **지시서 허용** — 반드시 사유·대체 검증 명시
6. **개인 키·PAT·토큰** 문서·커밋 금지

---

## 12. 오케스트레이터 연동

| 이벤트 | 동작 |
|--------|------|
| `4_PROMPT.md` 감지 | 코드 수정 지시 (`4_RESULT_draft` → `4_RESULT.md`) |
| `4_RESULT.md` 감지 | 1차: `node scripts/diag-p2.mjs` (기본) · 2차: Ollama QA |
| `4_OVERRIDE_QA.flag` | 1차 생략·QA만 (V4.7) |
| `Final.md` 감지 | **프로세스 종료** |

---

## 13. 문서 이력

| 날짜 | 내용 |
|------|------|
| 2026-06-01 | `3_RESULT.md` PASS 기반 — P3·Final 지시서 초版 |
