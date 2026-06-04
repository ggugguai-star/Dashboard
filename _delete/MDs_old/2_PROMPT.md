# 2_PROMPT — 작업 지시서 #2: P1 핵심 연동 + 회귀 검증

> **문서 유형:** AI/개발자 작업 지시서  
> **작업 번호:** 2  
> **상위 문서:** [`0_MASTER_PLAN.md`](../0_MASTER_PLAN.md)  
> **선행 결과:** [`MDs/1_RESULT.md`](1_RESULT.md) — **P0 완료**  
> **작성일:** 2026-05-31

---

## 0. 역할 정의

Tauri v2 + Vanilla JS 업무 대시보드의 **P0 클릭 불가**는 [`1_RESULT.md`](1_RESULT.md) 기준 **release 검증 통과**했다.  
본 작업은 **P1 핵심 연동**(OAuth · Calendar · 창/트레이)을 E2E로 검증하고, P0 수정 회귀가 없는지 확인한다.

---

## 1. 작업 목표 (한 문장)

> **release 빌드에서 Google OAuth → Calendar 조회, 창/트레이/단축키, 설정 위저드→대시보드 전체 플로우가 동작함을 E2E로 확인하고, 발견된 결함을 최소 diff로 수정한다.**

---

## 2. 선행 조건 (P0 완료 확인)

[`1_RESULT.md`](1_RESULT.md) §5 DoD가 **모두 ✅**인지 먼저 확인:

```powershell
cd C:\AI\AiCoding\Dashboard
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9224"
Start-Process .\src-tauri\target\release\work-dashboard.exe
# Console: typeof window.nextSetupStep === 'function'
# 설정 위저드 「다음 →」 3회 클릭 → 대시보드 진입
```

P0 회귀 시 **본 작업 중단** → `1_RESULT.md` §4 파일 재확인.

---

## 3. P0에서 적용된 수정 (재수정 금지·이해 필수)

| 파일 | 내용 |
|------|------|
| `src/index.html` | `#cevCtxOverlay` CSS `display:none` + `.cev-open` class |
| `src-tauri/tauri.conf.json` | `ipc.localhost` connect-src, `dangerousDisableAssetCspModification: true` |

**5대 원칙 유지:** Google API는 `src/google-api.js`만 · Rust API 금지 · Electron 파일 수정 금지

---

## 4. 작업 범위

### 4-1. P1 필수 (Must)

| ID | 영역 | 검증 항목 | 핵심 파일 |
|----|------|-----------|-----------|
| P1-1 | **설정 위저드 E2E** | Step 0→1→2→대시보드, `setupDone` 저장 | `index.html` |
| P1-2 | **Google OAuth** | `start_oauth` → 브라우저 → `auth-code` → `gcal-tokens.json` | `oauth.rs`, `google-api.js`, `token-store.js` |
| P1-3 | **Calendar** | 월 달력 이벤트 dot, 동기화 ↻, 일정 추가 다이얼로그 | `google-api.js`, `index.html` |
| P1-4 | **창/트레이** | topbar 드래그, ✕→트레이 숨김, 트레이 toggle, Ctrl+Alt+D | `lib.rs`, `index.html` |
| P1-5 | **P0 회귀** | release exe `#btnNext` 클릭, CSP violation 0 | `tauri.conf.json` |

### 4-2. P2 (시간 허용 시)

| ID | 영역 |
|----|------|
| P2-1 | Drive Weekly Plan 이미지 |
| P2-2 | Google Tasks 동기화 |
| P2-3 | 닫힌 오버레이 `pointer-events:none` hardening |
| P2-4 | 설정 모달 4탭 |

### 4-3. 범위 밖

- `onclick` → addEventListener 전면 전환 (별도 작업 #3)
- GitHub Release / `latest.json` 업로드
- Electron `main.js` 수정

---

## 5. Phase A — 환경·빌드

```powershell
cd C:\AI\AiCoding\Dashboard
npm install
npm run tauri:build
# 산출물: src-tauri\target\release\bundle\nsis\업무 대시보드_2.0.2_x64-setup.exe
```

**주의:** `tauri dev`만으로 P1 완료 선언 금지. **release exe** 기준 검증.

---

## 6. Phase B — E2E 테스트 시나리오

### B-1. 설정 위저드 → 대시보드

| # | 동작 | 기대 |
|---|------|------|
| T1 | 최초 실행, Step 0 「다음 →」 | Step 1 (Google) |
| T2 | 「연동 없이 계속하기」 또는 Step 1 스킵 | Step 2 |
| T3 | Step 2 「✨ 시작하기」 | 대시보드 표시, `setupDone=1` |
| T4 | 재실행 | 위저드 스킵, 대시보드 직접 |

### B-2. Google OAuth

| # | 동작 | 기대 |
|---|------|------|
| T5 | 설정 → Google 연결 | 브라우저 OAuth, port 59123 |
| T6 | 권한 허용 후 | `%APPDATA%\업무 대시보드\gcal-tokens.json` 생성 |
| T7 | topbar Google 칩 | 초록 "연결됨" |
| T8 | 연결 해제 | 토큰 파일 삭제, 칩 회색 |

### B-3. Calendar

| # | 동작 | 기대 |
|---|------|------|
| T9 | ↻ 동기화 | 이벤트 dot 표시, toast |
| T10 | 날짜 클릭 | 하단 이벤트 목록 |
| T11 | 「+ 일정 추가」 | 다이얼로그 열림·저장 |

### B-4. 창/트레이

| # | 동작 | 기대 |
|---|------|------|
| T12 | topbar 드래그 | 모니터 간 이동 + workArea 스냅 |
| T13 | ✕ 버튼 | 트레이 숨김 (종료 아님) |
| T14 | 트레이 좌클릭 / Ctrl+Alt+D | 표시/숨김 toggle |
| T15 | 캘린더 이벤트 우클릭 | ctx 메뉴 표시·닫기 후 클릭 복구 (P0 회귀) |

---

## 7. Phase C — 알려진 리스크·디버깅 힌트

| 증상 | 확인 위치 |
|------|-----------|
| invoke 실패 | Console `ipc.localhost` CSP · `capabilities/main.json` |
| OAuth 타임아웃 | port 59123 점유 · `oauth.rs` stderr |
| Calendar 401 | `getValidAccessToken()` · refresh_token |
| 클릭 다시 불가 | `#cevCtxOverlay` display · CSP onclick 차단 |
| Google SVG 아이콘 깨짐 | img-src `https://www.gstatic.com` (§1_RESULT §3-3) |

**CDP 진단 (선택):**

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9224"
node scripts/diag-p0.mjs
node scripts/diag-p0-inline-style.mjs
```

---

## 8. 산출물

| # | 파일 | 내용 |
|---|------|------|
| D1 | **`MDs/2_RESULT.md`** | T1~T15 결과, 결함·수정, P1 DoD |
| D2 | 변경 diff | P1 수정 시 파일 목록 |

---

## 9. P1 완료 조건 (DoD)

- [ ] T1~T4 설정 위저드 E2E
- [ ] T5~T8 OAuth (실제 Google 계정 1회)
- [ ] T9~T11 Calendar (연동 계정)
- [ ] T12~T15 창/트레이/ctx 메뉴
- [ ] P0 회귀 없음 (§2 선행 조건)
- [ ] `MDs/2_RESULT.md` 작성

---

## 10. 보고 형식

```markdown
## 작업 #2 결과 — P1 핵심 연동

### P0 회귀
- [x/❌] release 클릭 · CSP

### P1 E2E
| ID | 결과 | 비고 |
| T5 OAuth | ✅/❌ | |

### 변경 파일
| 파일 | 요약 |

### 미해결 → #3
```

---

## 11. 작업 규칙

1. **release exe** 기준 검증 (dev-only 통과 금지)
2. `index.html` 리포맷 금지 · 최소 diff
3. Google API → Rust 이전 금지
4. git commit은 사용자 요청 시에만
5. P2는 P1 DoD 후 또는 `2_RESULT.md`에 "미착수" 명시

---

## 12. 문서 이력

| 날짜 | 내용 |
|------|------|
| 2026-05-31 | `1_RESULT.md` P0 완료 기반 초版 작성 |
