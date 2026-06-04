# 0_MASTER_PLAN — 업무 대시보드 Tauri v2 버그픽스 마스터 플랜

> **작성일:** 2026-05-31  
> **목적:** Electron v1.3.2 → Tauri v2 v2.0.x 마이그레이션 이후 남은 버그를 체계적으로 수정하기 위한 단일 기준 문서  
> **참조:** `SPEC.md` · `MIGRATION_PLAN.md` · `MIGRATION_RESULT.md` · `RELEASE_GUIDE.md`

---

## 1. 프로젝트 한 줄 요약

**업무 대시보드**는 Windows 데스크탑 작업 영역 전체를 덮는 프레임리스 위젯 앱이다. Google Calendar · Drive · Tasks와 동기화하고, 카테고리별 링크/Drive 탐색기 패널·메모·할 일·알림·화면 캡처·자동 업데이트를 제공한다.

| 항목 | Electron (레거시) | Tauri v2 (현재) |
|------|-------------------|-----------------|
| 버전 | v1.3.2 | v2.0.0 ~ v2.0.2 |
| 런타임 | Node.js + Chromium | WebView2 + Rust |
| 백엔드 | `main.js` (1,033줄) | `lib.rs` + `oauth.rs` |
| Google API | main.js `https` | `src/google-api.js` (fetch) |
| IPC | `preload.js` → `window.api.*` | ES 모듈 + `window.__TAURI__` |
| 프론트 | `src/index.html` (~7,000줄) | 동일 (JS만 교체) |
| 배포 | ~150 MB | ~8 MB (NSIS) |

---

## 2. 디렉터리 구조 (작업 시 필수 숙지)

```
Dashboard/
├── src/                          ← 프론트엔드
│   ├── index.html                ← UI 전체 (HTML/CSS/JS, ~7,003줄) ★ 핵심
│   ├── google-api.js             ← Google API fetch 레이어 (548줄)
│   ├── token-store.js            ← OAuth 토큰 파일 I/O (153줄)
│   └── fonts/                    ← 로컬 웹폰트
├── src-tauri/                      ← Rust 백엔드
│   ├── src/
│   │   ├── lib.rs                ← 플러그인·트레이·단축키·start_oauth
│   │   ├── oauth.rs              ← OAuth 콜백 서버 (port 59123)
│   │   └── main.rs
│   ├── capabilities/
│   │   └── main.json             ← v2 권한 설정 ★ 핵심
│   ├── tauri.conf.json           ← 창/CSP/NSIS/업데이터 설정
│   └── Cargo.toml
├── main.js / preload.js          ← Electron 레거시 (참고용, 실행 안 함)
├── package.json                  ← npm run tauri:dev / tauri:build
├── SPEC.md                       ← 기능 명세 (Electron 기준, 여전히 유효)
├── MIGRATION_PLAN.md             ← 8단계 마이그레이션 계획
├── MIGRATION_RESULT.md           ← 마이그레이션 완료 보고
└── RELEASE_GUIDE.md              ← Ed25519 서명·GitHub Release
```

---

## 3. Tauri v2 아키텍처 (마이그레이션 후)

```
┌─────────────────────────────────────────────────────────────┐
│  Rust (lib.rs + oauth.rs)                                    │
│  · OAuth 로컬 서버 (127.0.0.1:59123) → emit auth-code       │
│  · 시스템 트레이 / Ctrl+Alt+D / start_oauth 커맨드           │
│  · Tauri 플러그인 10종 초기화                                 │
└──────────────────────────┬──────────────────────────────────┘
                           │ window.__TAURI__.core.invoke / event.listen
┌──────────────────────────▼──────────────────────────────────┐
│  JS (index.html type="module")                               │
│  · import token-store.js, google-api.js                      │
│  · tInvoke('plugin:shell|open') 등 플러그인 직접 호출         │
│  · Object.assign(window, { nextSetupStep, doSync, ... })     │
│    → HTML onclick="..." 100개 핸들러가 window 함수에 의존    │
└─────────────────────────────────────────────────────────────┘
```

### 5대 마이그레이션 원칙 (변경 금지)

1. Google API는 **JS fetch만** (Rust 구현 금지)
2. fs·shell·dialog 등 **공식 플러그인** 사용
3. 화면 캡처: shell + clipboard-manager + Canvas
4. **OAuth 서버만 Rust** (tiny_http, port 59123)
5. **capabilities** PoLP 준수

---

## 4. 기능 영역 맵 (SPEC 기준 — 회귀 테스트 체크리스트)

마이그레이션 완료 보고서상 8단계는 ✅이나, **실기 동작 검증은 미완**으로 간주한다.

| # | 영역 | 핵심 파일 | Tauri 변환 포인트 | 우선순위 |
|---|------|-----------|-------------------|----------|
| F0 | **앱 부팅·클릭·JS 실행** | `index.html` L2940~7027 | ES 모듈 + `Object.assign(window)` | **P0** |
| F1 | 초기 설정 위저드 (3단계) | `index.html` setup 섹션 | `nextSetupStep`, `launchDashboard` | P0 |
| F2 | 창 관리 (프레임리스·스냅·드래그) | `index.html`, `lib.rs` | `data-tauri-drag-region`, `snapToCurrentMonitor` | P1 |
| F3 | Google OAuth | `oauth.rs`, `google-api.js`, `token-store.js` | `start_oauth`, `auth-code` 이벤트 | P1 |
| F4 | Google Calendar | `google-api.js` | fetch + CSP `connect-src` | P1 |
| F5 | Google Drive (Weekly·패널·다운로드) | `google-api.js` | fetch + `plugin:dialog\|open` | P2 |
| F6 | Google Tasks | `google-api.js` | fetch + localStorage merge | P2 |
| F7 | 카테고리 패널 (local/drive) | `index.html` | DnD, `openPath` | P2 |
| F8 | 메모·할 일·알림 | `index.html` | `setInterval` 알람, `focusWindow` | P2 |
| F9 | 화면 캡처 (아이콘) | `index.html` icp* | shell + clipboard + Canvas | P3 |
| F10 | 시스템 트레이·단축키 | `lib.rs` | Rust 트레이, Ctrl+Alt+D | P2 |
| F11 | 자동 업데이트 | `index.html`, `tauri.conf.json` | `plugin:updater`, pubkey | P3 |
| F12 | 설정 모달·배율 | `index.html` | CSS 변수 `--scale` (변경 없음) | P2 |

---

## 5. P0 버그 — 앱 실행 시 아무것도 클릭되지 않음

### 5-1. 증상

- UI(설정 위저드 또는 대시보드)는 **렌더링**되나 버튼·링크·입력 등 **모든 클릭 무반응**
- JavaScript 실행 여부 **불확실** (DevTools 미확인 상태)
- 설치 파일: `업무 대시보드_2.0.2_x64-setup.exe`

### 5-2. 가장 유력한 원인 (우선 조사)

#### 가설 A — ES 모듈 초기화 실패 → `Object.assign(window, …)` 미실행 ★★★

`index.html`은 `<script type="module">` 하나에 **~4,000줄 JS**가 들어 있다.  
HTML `onclick="nextSetupStep()"` 등 **약 100개** 인라인 핸들러는 모듈 스코프 함수가 아니라 **`window` 전역**을 참조한다.

```6984:7026:src/index.html
Object.assign(window, {
  openPath, hideToTray, snapToCurrentMonitor,
  adjustScale, applySettings, setScalePreset,
  // ... 56개 함수 ...
  nextSetupStep, prevSetupStep,
  onUbBtnClick,
});
```

**모듈 중간 어디서든 동기 예외가 나면** 파일 끝의 `Object.assign`에 도달하지 못하고, 모든 `onclick`이 `ReferenceError`로 실패한다.

**의심 지점:**

| 위치 | 코드 | 위험 |
|------|------|------|
| L2946~2955 | `import ... from './token-store.js'` | 모듈 로드/CORS/경로 실패 |
| L2958~2959 | `window.__TAURI__.core.invoke` | `__TAURI__` 미주입 시 즉시 throw |
| L3247~3261 | `(async () => { window.__TAURI__.window.getCurrentWindow() ...})()` | top-level IIFE 동기 throw |
| L3264 | `checkMigration()` | 비동기 — throw해도 Object.assign은 실행됨 |

#### 가설 B — 투명/숨김 오버레이가 pointer-events 차단 ★★

닫힌 상태 오버레이 중 `pointer-events: none`이 **없는** fixed full-screen 요소:

| ID / 클래스 | z-index | 닫힌 상태 CSS | resetAllOverlaysOnStart 처리 |
|-------------|---------|---------------|------------------------------|
| `.settings-overlay` | 800 | opacity:0, visibility:hidden | ❌ 미포함 |
| `.ev-dialog-overlay` (#evDialog) | 950 | opacity:0, visibility:hidden | ✅ evd-open 제거 |
| `.cev-ctx-overlay` | 960 | display:none (HTML) | ❌ |
| `.alarm-overlay` | 10000 | opacity:0, visibility:hidden | ❌ (display:none 아님) |
| `#cevCtxOverlay` | — | display:none | ❌ |

코드에 이미 아래 주석·대응이 있으나 **일부 오버레이 누락** 가능:

```6954:6957:src/index.html
   시작 시 모든 오버레이/팝업 강제 초기화
   이전 세션 잔여 상태나 권한 오류로 인해 오버레이가 열린 채
   남아 있으면 전체 화면 클릭이 막히므로 무조건 닫는다.
```

WebView2에서 `visibility:hidden`만으로 pointer-events가 차단되지 않는 edge case 가능 → **닫힌 오버레이에 `pointer-events: none` 추가**가 안전한 수정.

#### 가설 C — `capabilities/main.json` 권한 누락 ★★

현재 `main.json`에 **없을 가능성이 있는 권한:**

| 호출 | 필요 권한 (추정) | 현재 main.json |
|------|------------------|----------------|
| `invoke('start_oauth')` | 커스텀 커맨드 allow | ❌ 명시 없음 |
| `plugin:path\|resolve_directory` | `core:path:default` 또는 path allow | ❌ 없음 |
| `plugin:window\|current_monitor` | `core:window:allow-current-monitor` | ✅ |
| `getCurrentWindow().listen('tauri://move')` | window event listen | 확인 필요 |
| `getCurrentWindow().hide/setFocus` | allow-hide, allow-set-focus | hide ✅, set-focus ❌ |
| clipboard image (캡처) | `clipboard-manager:allow-read-image` | ✅ |
| `plugin:image\|rgba` (캡처 1차) | image plugin 권한 | ❌ 없음 (캡처 시만) |

권한 오류는 대개 **비동기 invoke 실패**이지만, path/fs 초기화 실패가 연쇄적으로 UI를 망가뜨릴 수 있다.

#### 가설 D — `data-tauri-drag-region` 클릭 영역 과다 ★

대시보드 topbar 전체에 `data-tauri-drag-region` 적용.  
설정 위저드에는 drag region 없음 → **위저드에서도 클릭 불가면 가설 A가 더 유력**.

---

## 6. P0 진단 절차 (반드시 이 순서)

### Step 0 — 환경 준비

```powershell
cd C:\AI\AiCoding\Dashboard
npm install                    # node_modules 없으면 필수
npm run tauri:dev              # 첫 Rust 빌드 10~15분
# 또는 이미 빌드됐으면:
npm run tauri:build:debug      # 디버그 빌드 + DevTools
```

> `node_modules`·`src-tauri/target` 모두 없으면 **첫 빌드 전에는 설치 exe만으로는 디버깅 불가**.

### Step 1 — JavaScript 실행 여부 확인 (30초)

Tauri dev 실행 후 **F12 DevTools** (또는 `webview` inspector):

```javascript
// 콘솔에 입력
typeof window.__TAURI__           // "object" 기대
typeof window.nextSetupStep       // "function" 기대 — "undefined"면 가설 A 확정
typeof window.doSync              // "function" 기대
document.getElementById('btnNext') // setup 버튼 존재 확인
```

**Console 탭 빨간 에러** 확인:
- `Failed to load module script` → import 경로/CSP
- `Cannot read properties of undefined (reading 'core')` → `__TAURI__` 타이밍
- `nextSetupStep is not defined` (onclick 클릭 시) → Object.assign 미실행

### Step 2 — 네트워크/모듈 로드

DevTools **Network** 탭:
- `token-store.js` — 200?
- `google-api.js` — 200?
- `fonts/fonts.css` — 200?

### Step 3 — 클릭 차단 요소 검사

```javascript
// 클릭 불가 시 — 최상위 fixed 요소 탐색
[...document.querySelectorAll('*')].filter(el => {
  const s = getComputedStyle(el);
  return s.position === 'fixed' && s.zIndex > 100 &&
         s.pointerEvents !== 'none' &&
         el.offsetWidth > 100 && el.offsetHeight > 100;
}).map(el => ({ id: el.id, cls: el.className, z: getComputedStyle(el).zIndex,
                pe: getComputedStyle(el).pointerEvents, vis: getComputedStyle(el).visibility }));
```

### Step 4 — Tauri 권한 로그

Rust 쪽 stderr / DevTools console에서 `permission` · `not allowed` · `Forbidden` 검색.

---

## 7. P0 수정 전략 (가설별)

### A. 모듈 초기화 / window 노출

| 작업 | 설명 |
|------|------|
| A-1 | `Object.assign(window, …)` 를 **모듈 최상단(import 직후)** 으로 이동하거나, 함수 선언부를 **별도 non-module `<script>`** 로 분리 |
| A-2 | top-level IIFE `(async () => { getCurrentWindow().listen(...) })()` 를 `DOMContentLoaded` 이후로 이동 |
| A-3 | `window.__TAURI__` 가드: `if (!window.__TAURI__) { console.error(...); }` |
| A-4 | import 실패 시 화면에 **빨간 에러 배너** 표시 (silent fail 방지) |

### B. 오버레이 pointer-events

| 작업 | 설명 |
|------|------|
| B-1 | 닫힌 상태 공통: `.settings-overlay`, `.ev-dialog-overlay`, `.alarm-overlay`, `.cev-ctx-overlay` 에 `pointer-events: none` |
| B-2 | `resetAllOverlaysOnStart`에 `#settingsOverlay`, `#alarmOverlay`, `#cevCtxOverlay` 추가 |
| B-3 | 열릴 때만 `pointer-events: all` (또는 class toggle) |

### C. capabilities 보완

`src-tauri/capabilities/main.json`에 추가 검토:

```json
"core:path:default",
"allow-start-oauth",
"core:window:allow-set-focus",
"core:window:allow-minimize",
"core:event:allow-listen"
```

> Tauri v2 정확한 permission identifier는 `npm run tauri dev` 시 ACL 생성 로그 또는 [Tauri Capabilities 문서](https://v2.tauri.app/security/capabilities/)로 확인.

### D. drag region

- topbar 자식 클릭 요소에 `data-tauri-drag-region="false"` 또는 CSS `-webkit-app-region: no-drag` 재확인
- Electron `-webkit-app-region: drag` 와 Tauri `data-tauri-drag-region` **중복 적용** 시 충돌 여부 확인

---

## 8. P1~P3 후속 작업 (P0 해결 후)

### P1 — 핵심 연동

- [ ] OAuth: `start_oauth` → 브라우저 → `auth-code` → `exchangeCodeForTokens` → `%APPDATA%\업무 대시보드\gcal-tokens.json`
- [ ] Calendar 이벤트 조회·추가·수정·삭제
- [ ] 창: 멀티모니터 `snapToCurrentMonitor`, topbar 드래그, ✕ → 트레이 숨김
- [ ] 트레이: 좌클릭 toggle, Ctrl+Alt+D

### P2 — 부가 기능

- [ ] Drive Weekly Plan 이미지·Drive 패널 탐색·다운로드
- [ ] Tasks 동기화 (할 일 G 배지)
- [ ] 카테고리 패널 DnD·편집·아이콘 피커
- [ ] 알림 오버레이 + `focusWindow`
- [ ] 설정 모달 4탭

### P3 — 배포·품질

- [ ] 화면 캡처 (`ms-screenclip:` + clipboard)
- [ ] 자동 업데이트 (pubkey ✅ 설정됨, `latest.json` GitHub 업로드)
- [ ] `RELEASE_GUIDE.md` 체크리스트 완료
- [ ] Electron `main.js` 대비 회귀 테스트 (Playwright 스크립트 `scripts/` 참고 — **Tauri용으로 재작성 필요**)

---

## 9. 데이터·설정 경로 (마이그레이션 호환)

| 저장소 | 경로/키 | 비고 |
|--------|---------|------|
| OAuth 토큰 | `%APPDATA%\업무 대시보드\gcal-tokens.json` | Electron과 **동일 경로** |
| 창 위치 | window-state 플러그인 | `window-bounds.json` 대체 |
| UI 설정 | localStorage (`catData`, `appScale`, `setupDone` 등) | WebView2 IndexedDB |
| setup 완료 | `localStorage.setupDone === '1'` | 없으면 **설정 위저드** 표시 |

---

## 10. 빌드·실행 명령 요약

```powershell
# 개발 (Hot reload + DevTools)
npm run tauri:dev

# 프로덕션 NSIS
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\dashboard-update-key.pem" -Raw
npm run tauri:build

# 산출물
# src-tauri\target\release\bundle\nsis\업무 대시보드_2.0.2_x64-setup.exe
```

---

## 11. 성공 기준 (Definition of Done)

### P0 완료 조건

- [ ] 앱 실행 후 **설정 위저드 "다음 →"** 버튼 클릭 동작
- [ ] `typeof window.nextSetupStep === 'function'`
- [ ] DevTools Console **치명적 에러 0건** (updater pubkey 경고는 허용)
- [ ] 닫힌 오버레이 상태에서 **전체 UI 클릭 가능**

### 전체 완료 조건

- [ ] SPEC.md §7~§22 기능 **수동 스모크 테스트** 통과
- [ ] Google OAuth → Calendar/Drive/Tasks E2E 1회 이상
- [ ] 멀티모니터 스냅·트레이·Ctrl+Alt+D
- [ ] NSIS 설치 exe 클린 VM/PC에서 P0 재현 없음
- [ ] GitHub Release + `latest.json` 업데이트 (선택)

---

## 12. AI/외부 플랫폼 작업 시 주의사항

1. **`npm install` 먼저** — repo에 `node_modules` 없음
2. **첫 `tauri build` 10~15분** — `src-tauri/target` 없음
3. **`index.html` 7,000줄** — 무분별한 리포맷 금지, 최소 diff
4. **`capabilities/main.json`** — 권한 추가 시 PoLP 유지
5. **Electron `main.js`/`preload.js` 수정하지 말 것** — Tauri가 프로덕션
6. **Google API는 `google-api.js`만** — Rust에 API 호출 추가 금지
7. **버전:** `tauri.conf.json` = 2.0.2, `package.json` name/version은 Electron 잔재(1.3.2) — 혼동 주의

---

## 13. 다른 AI에게 `0_MASTER_PLAN.md` 갱신을 요청할 때 쓸 프롬프트

아래를 복사해 사용한다.

---

```
당신은 Tauri v2 + Vanilla JS 데스크탑 앱 버그픽스 엔지니어입니다.

## 프로젝트
- 앱명: 업무 대시보드 (Windows 프레임리스 전체화면 위젯)
- Electron v1.3.2 → Tauri v2 v2.0.2 마이그레이션 완료 (빌드는 됨)
- P0 버그: 앱 실행 시 UI는 보이나 아무것도 클릭되지 않음 (JS 실행 불확실)

## 필수 읽기 (순서)
1. 0_MASTER_PLAN.md
2. SPEC.md (기능 명세)
3. MIGRATION_RESULT.md (변환 내역)
4. src/index.html L2940~7027 (Tauri 브리지 + Object.assign)
5. src-tauri/capabilities/main.json

## 작업 규칙
- Google API는 src/google-api.js (fetch)만 — Rust 금지
- HTML onclick 100개 → window 전역 함수 의존 → Object.assign 실패 시 전체 클릭 불가
- 최소 diff, index.html 리포맷 금지
- npm install 후 npm run tauri:dev 로 재현·DevTools 확인
- 수정 후 0_MASTER_PLAN.md §11 P0 체크리스트 기준으로 보고

## 이번 목표
[P0 / P1 / 구체적 기능 — 여기에 작성]

## 보고 형식
1. 근본 원인 (증거: 콘솔 로그·코드 위치)
2. 변경 파일·diff 요약
3. 재현·검증 방법
4. 0_MASTER_PLAN.md 에 반영할 체크리스트 업데이트
```

---

## 14. 문서 이력

| 날짜 | 내용 |
|------|------|
| 2026-05-31 | 초版 작성 — SPEC/MIGRATION/RELEASE 분석 + P0 클릭 불가 진단·수정 플랜 |
