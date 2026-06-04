# 3_PROMPT — 작업 지시서 #3: P2 부가 기능 + P1 미검증 항목 E2E

> **문서 유형:** AI/개발자 작업 지시서  
> **작업 번호:** 3  
> **상위 문서:** [`0_MASTER_PLAN.md`](0_MASTER_PLAN.md)  
> **선행 결과:** [`MDs/2_RESULT.md`](2_RESULT.md) — **P1 완료** (관리자 강제 PASS 포함)  
> **작성일:** 2026-05-31

---

## 0. 역할 정의

Tauri v2 + Vanilla JS **업무 대시보드**에서 P0·P1은 [`2_RESULT.md`](2_RESULT.md) 기준 완료(또는 강제 통과)되었다.  
본 작업은 **P2 부가 기능**(Drive · Tasks · 설정 모달 · 카테고리/알림 등)과 **P1에서 자동 검증되지 않은 항목**(T10·T12·T14)을 **release exe** 기준으로 E2E 검증하고, 결함을 최소 diff로 수정한다.

**5대 원칙 유지:** Google API는 `src/google-api.js`만 · Rust API 금지 · Electron `main.js`/`preload.js` 수정 금지

---

## 1. 작업 목표 (한 문장)

> **release 빌드에서 Google Drive(Weekly Plan·패널)·Tasks 동기화·설정 모달·P1 미검증 창/캘린더 시나리오가 동작함을 E2E로 확인하고, P0·P1 회귀가 없는지 재검증한다.**

---

## 2. 선행 조건 (P1 완료 확인)

[`2_RESULT.md`](2_RESULT.md) §5 DoD 및 §1 요약을 확인한다. 최소한 아래가 성립해야 한다.

```powershell
cd C:\AI\AiCoding\Dashboard
npm run tauri:build
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
node scripts/diag-p1.mjs
# 기대: 15/15 passed, exit 0
```

**Google 계정:** Drive·Tasks 검증에는 OAuth 연동된 실제 계정 1개 필요. 미연동 시 T20~T28은 `SKIP(미연동)`으로 `3_RESULT.md`에 명시.

P0·P1 회귀 실패 시 **본 작업 중단** → `2_RESULT.md` §3·§4 파일 재확인.

---

## 3. P1·P2에서 이미 적용된 수정 (재수정 금지·이해 필수)

| 영역 | 파일 | 내용 |
|------|------|------|
| P0 클릭 | `src/index.html` | `#cevCtxOverlay` CSS, `Object.assign(window,…)` 순서 |
| CSP | `src-tauri/tauri.conf.json` | `ipc.localhost`, `dangerousDisableAssetCspModification` |
| 토큰 | `src/token-store.js`, `token_secure.rs` | keyring + `.gcal-tokens.sec`, 평문 JSON 금지 |
| OAuth UI | `src/index.html`, `google-api.js` | `async applySettings`, `getValidAccessToken` |
| CDP QA | `scripts/cdp-utils.mjs`, `diag-p1.mjs` | WEBVIEW2 우선, exe 자동 기동 |

---

## 4. 작업 범위

### 4-1. P2 필수 (Must)

| ID | 영역 | 검증 항목 | 핵심 파일 |
|----|------|-----------|-----------|
| P2-1 | **Calendar 보완 (T10)** | 날짜 클릭 → 하단 이벤트 목록 갱신 | `index.html`, `google-api.js` |
| P2-2 | **창/트레이 보완 (T12·T14)** | topbar 드래그·멀티모니터 스냅, 트레이/Ctrl+Alt+D toggle | `lib.rs`, `index.html` |
| P2-3 | **Drive Weekly Plan** | 이미지 목록·슬라이드·제목 편집·localStorage | `google-api.js`, `index.html` |
| P2-4 | **Drive 패널** | 폴더 탐색·브레드크럼·↻·우클릭(다운로드/이동/휴지통) | `google-api.js`, `index.html` |
| P2-5 | **Google Tasks** | 기본 목록 조회·동기화·할 일 CRUD·G 배지·연결 해제 시 초기화 | `google-api.js`, `index.html` |
| P2-6 | **설정 모달 4탭** | 일반·Google·화면·고급 탭 전환·저장(Apply) | `index.html` |
| P2-7 | **P0·P1 회귀** | `diag-p1.mjs` 15/15, `#btnNext`·CSP·ctx 메뉴 | `scripts/diag-p1.mjs` |

### 4-2. P2 (시간 허용 시)

| ID | 영역 |
|----|------|
| P2-8 | 카테고리 패널 DnD·아이콘 피커·local/drive 혼합 |
| P2-9 | 알림(Alarm) 미니 오버레이 + `focusWindow` |
| P2-10 | 닫힌 오버레이 `pointer-events:none` 전역 hardening (`scripts/diag-p0-inline-style.mjs` 연동) |

### 4-3. 범위 밖 (작업 #4 — P3)

- 화면 캡처 (`ms-screenclip:` + clipboard + Canvas)
- `plugin-updater` + GitHub `latest.json` 릴리즈 업로드
- `onclick` → `addEventListener` 전면 전환
- Electron `main.js` 수정
- **`MDs/Final.md`** 작성 (전체 마이그레이션 종료 시)

---

## 5. Phase A — 환경·빌드

```powershell
cd C:\AI\AiCoding\Dashboard
npm install
npm run tauri:build
# 산출물: src-tauri\target\release\bundle\nsis\업무 대시보드_2.0.2_x64-setup.exe
```

**주의:** `tauri dev`만으로 P2 완료 선언 금지. **release exe** 기준 검증.

---

## 6. Phase B — E2E 테스트 시나리오

### B-0. P1 회귀 (자동·필수)

| # | 명령/동작 | 기대 |
|---|-----------|------|
| R1 | `node scripts/diag-p1.mjs` (cdp-utils, WEBVIEW2=9222) | 15/15 PASS |
| R2 | 수동: 설정 위저드 `#btnNext` 1회 | Step 전환 (localStorage 초기화 후) |

### B-1. Calendar 보완 (T10)

| # | 동작 | 기대 |
|---|------|------|
| T10 | Google 연동 상태에서 캘린더 **날짜 셀** 클릭 | 하단 이벤트 목록·선택일 하이라이트 갱신 |
| T10b | ↻ 동기화 후 다른 날짜 클릭 | 목록이 해당일 이벤트로 변경 |

### B-2. 창/트레이 보완 (T12·T14)

| # | 동작 | 기대 |
|---|------|------|
| T12 | topbar 드래그로 보조 모니터 이동 | 창 이동, workArea 스냅(가능 시) |
| T14 | 트레이 아이콘 좌클릭 | 표시/숨김 toggle |
| T14b | `Ctrl+Alt+D` | 표시/숨김 toggle |
| T13 | ✕ 버튼 (회귀) | 트레이 숨김, 프로세스 유지 |

### B-3. Drive Weekly Plan (P2-3)

| # | 동작 | 기대 |
|---|------|------|
| T20 | Weekly Plan 영역 · Drive 폴더 연동 후 ↻ | 이미지 썸네일/dot 로드 |
| T21 | 이미지 클릭 | 라이트박스(←→·카운터·닫기) |
| T22 | 제목 인라인 편집 | `weeklyPlanTitle` + localStorage 저장 |

### B-4. Drive 카테고리 패널 (P2-4)

| # | 동작 | 기대 |
|---|------|------|
| T23 | Drive 타입 패널 · 폴더 진입 | `listDriveFolder` 목록, 브레드크럼 |
| T24 | 파일 클릭 | `plugin:shell` `open` URL |
| T25 | 파일 우클릭 → 다운로드 | `plugin:dialog` 폴더 선택 후 저장 |
| T26 | ↻ 새로고침 | 목록 갱신, toast/에러 없음 |

### B-5. Google Tasks (P2-5)

| # | 동작 | 기대 |
|---|------|------|
| T27 | Google 연동 후 Tasks 초기화 | `gtasksListId` localStorage, 동기화 UI |
| T28 | ↻ Tasks 동기화 | 로컬 할 일 머지, G 배지 |
| T29 | 할 일 추가·완료 체크·삭제 | `tasksCreateTask` / `tasksPatchTask` / `tasksDeleteTask` |
| T30 | Google 연결 해제 | `_gtasksListId`·Tasks UI 초기화 |

### B-6. 설정 모달 (P2-6)

| # | 동작 | 기대 |
|---|------|------|
| T31 | ⚙ 설정 열기 | 모달 표시 |
| T32 | 4탭 순회 (일반·Google·화면·고급) | 탭별 패널 전환 |
| T33 | Google 탭 연결/해제 + Apply | 칩 상태·토큰 저장(keyring) 일치 |
| T34 | 화면 탭 배율 변경 | `--scale` CSS 변수 반영 |

### B-7. 선택 (P2-8~10)

| # | 영역 | 기대 |
|---|------|------|
| T35 | 패널 헤더 드래그 | 패널 순서 변경 + `catData` 저장 |
| T36 | 아이콘 피커 | `icpOverlay` 열림·선택·닫힘, 클릭 회귀 없음 |
| T37 | 알람 트리거 | `alarmMiniOverlay` 표시, 포커스 복귀 |

---

## 7. Phase C — 자동화·오케스트레이터

### C-1. 신규 스크립트 (권장 산출물)

| 파일 | 내용 |
|------|------|
| `scripts/diag-p2.mjs` | P2 자동 가능 항목(CDP): Weekly Plan DOM, 설정 탭, Tasks invoke stub, **선행** `ensureCdpReady()` |
| (선택) `agent_orchestrator.py` | `STATIC_CHECK_CMD`를 `node scripts/diag-p2.mjs`로 변경 **또는** `diag-p1.mjs && diag-p2.mjs` 체인 |

`diag-p2.mjs` 작성 전에도 **R1(`diag-p1.mjs`)은 필수**로 유지한다.

### C-2. CDP 실행 (수동·자동 공통)

```powershell
# 오케스트레이터와 동일
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
node scripts/diag-p1.mjs

# P2 전용 (작성 후)
node scripts/diag-p2.mjs
```

### C-3. 알려진 리스크·디버깅 힌트

| 증상 | 확인 위치 |
|------|-----------|
| Drive 403/404 | OAuth scope · `google-api.js` `listDriveFolder` q 파라미터 |
| Tasks `tasks_auth_required` | `getValidAccessToken` · `gtasksListId` null |
| 다운로드 실패 | `capabilities/main.json` — `dialog:allow-open`, `fs:allow-write` |
| `open` 실패 | `shell:allow-open` · URL scheme |
| 클릭 다시 불가 | 오버레이 `display`/`pointer-events` · `diag-p0-inline-style.mjs` |
| 설정 Apply 무반응 | `applySettings` `async` 여부 · Console 에러 |

---

## 8. 산출물

| # | 파일 | 내용 |
|---|------|------|
| D1 | **`MDs/3_RESULT.md`** | T10·T12·T14·T20~T37·R1 결과, 결함·수정, P2 DoD |
| D2 | (권장) `scripts/diag-p2.mjs` | P2 CDP 자동 검증 |
| D3 | 변경 diff | P2 수정 시 파일 목록 |

**작성 규칙:** 초안 `MDs/3_RESULT_draft.md` → 완료 후 `MDs/3_RESULT.md`로 rename (오케스트레이터 규칙).

---

## 9. P2 완료 조건 (DoD)

- [ ] R1: `diag-p1.mjs` 15/15 PASS (P0·P1 회귀)
- [ ] T10 Calendar 날짜 클릭 목록 (연동 계정 또는 SKIP 명시)
- [ ] T12·T14 창/트레이 수동 E2E
- [ ] T20~T22 Weekly Plan (연동 계정)
- [ ] T23~T26 Drive 패널 핵심 플로우 1회 이상
- [ ] T27~T30 Tasks 동기화·CRUD·해제 초기화
- [ ] T31~T34 설정 모달 4탭
- [ ] `MDs/3_RESULT.md` 작성
- [ ] P2-8~10 미착수 시 `3_RESULT.md`에 **미착수** 명시

---

## 10. 보고 형식

```markdown
## 작업 #3 결과 — P2 부가 기능

### P1 회귀
- [x/❌] diag-p1 15/15

### P2 E2E
| ID | 결과 | 비고 |
| T10 | ✅/❌/SKIP | |
| T20 Weekly Plan | ✅/❌/SKIP | |

### 변경 파일
| 파일 | 요약 |

### 미해결 → #4 (P3)
- 화면 캡처 · updater · GitHub Release · Final.md
```

---

## 11. 작업 규칙

1. **release exe** 기준 검증 (dev-only 통과 금지)
2. `index.html` 리포맷 금지 · 최소 diff
3. Google API → Rust 이전 금지
4. git commit은 사용자 요청 시에만
5. P2-8~10은 P2 DoD 필수 아님 — 시간 부족 시 §9에 명시
6. 토큰 경로: 평문 `gcal-tokens.json` **신규 생성 금지** — keyring/`.gcal-tokens.sec` 유지

---

## 12. 다음 작업 예고 (#4)

P2 완료 후 **작업 #4**에서 다룰 예정 (**최종 단계 전**):

- **P3** 화면 캡처 · `plugin-updater` · `RELEASE_GUIDE.md` 체크리스트
- GitHub Release + `latest.json`
- SPEC §7~§22 스모크 통합
- 완료 시 **`MDs/Final.md`** (오케스트레이터 phase 999)

---

## 13. 문서 이력
 
| 날짜 | 내용 |
|------|------|
| 2026-05-31 | `2_RESULT.md` P1 완료(강제 PASS 포함) 기반 — P2·미검증 T10/T12/T14 지시서 초版 |
