# 1_PROMPT — 작업 지시서 #1: P0 클릭 불가 버그 진단 및 수정

> **문서 유형:** AI/개발자 작업 지시서  
> **작업 번호:** 1  
> **상위 문서:** [`0_MASTER_PLAN.md`](../0_MASTER_PLAN.md)  
> **작성일:** 2026-05-31  
> **범위:** P0 — 앱 실행 시 UI는 보이나 **모든 클릭 무반응**  
> **코드 작성:** 본 문서는 지시만 포함한다. 구현은 진단 결과 확인 **후** 별도 단계에서 수행한다.

---

## 0. 역할 정의

당신은 **Tauri v2 + Vanilla JS** 데스크탑 앱 버그픽스 엔지니어다.

- Electron → Tauri v2 마이그레이션이 완료된 **업무 대시보드**의 **첫 번째 블로커(P0)** 를 해결한다.
- 추측으로 대규모 리팩터링하지 않는다. **증거(DevTools·로그·재현)** 기반으로 최소 diff 수정한다.
- Google API를 Rust로 옮기거나, Electron `main.js`/`preload.js`를 수정하지 않는다.

---

## 1. 작업 목표 (한 문장)

> **앱 실행 직후 설정 위저드·대시보드 전역에서 클릭/입력이 정상 동작하도록, 근본 원인을 확정하고 P0 수정을 완료한다.**

---

## 2. 배경 (마스터플랜 요약)

| 항목 | 내용 |
|------|------|
| 앱 | Windows 프레임리스 전체화면 위젯 (`src/index.html` ~7,003줄) |
| 스택 | Tauri v2.0.2 · WebView2 · Rust(`lib.rs`, `oauth.rs`) · JS(`google-api.js`, `token-store.js`) |
| 증상 | UI 렌더링 O · 클릭/입력 X · JS 실행 여부 미확인 |
| 설치 파일 | `업무 대시보드_2.0.2_x64-setup.exe` |
| 핵심 가설 | **A** ES 모듈 초기화 실패 → `Object.assign(window, …)` 미실행 · **B** 오버레이 pointer-events · **C** capabilities 누락 · **D** drag-region |

상세 가설·진단 절차: `0_MASTER_PLAN.md` §5~§7

---

## 3. 작업 전 필독 (순서 고정)

1. [`0_MASTER_PLAN.md`](../0_MASTER_PLAN.md) — §5 P0 버그, §6 진단 절차, §7 수정 전략, §11 DoD
2. [`MIGRATION_RESULT.md`](../MIGRATION_RESULT.md) — §4단계 `window.api.*` → ES 모듈 교체 내역
3. [`src/index.html`](../src/index.html) — L2940~7027 (`type="module"`, Tauri 브리지, `Object.assign`)
4. [`src-tauri/capabilities/main.json`](../src-tauri/capabilities/main.json)
5. [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) — `withGlobalTauri`, CSP

---

## 4. 환경 준비 (Phase 0 — 코드 수정 전 필수)

```powershell
cd C:\AI\AiCoding\Dashboard
npm install
npm run tauri:dev
```

| 조건 | 참고 |
|------|------|
| `node_modules` 없음 | `npm install` 필수 |
| `src-tauri/target` 없음 | 첫 Rust 빌드 **10~15분** |
| DevTools | `tauri dev` 실행 후 WebView Inspector / F12 |

**Phase 0 완료 기준:** 앱 창이 뜨고, 클릭 불가 증상을 **직접 재현**했다.

---

## 5. Phase 1 — 진단 (코드 수정 금지)

마스터플랜 §6 순서를 **그대로** 따른다. 각 Step 결과를 기록한다.

### Step 1-1. JavaScript 실행 여부

DevTools Console에서 실행하고 **결과를 그대로 기록**:

```javascript
typeof window.__TAURI__
typeof window.nextSetupStep
typeof window.doSync
typeof window.launchDashboard
document.getElementById('btnNext')
localStorage.getItem('setupDone')
```

**판정:**

| 결과 | 의미 |
|------|------|
| `nextSetupStep === 'undefined'` | **가설 A** 거의 확정 — `Object.assign` 미실행 또는 모듈 crash |
| `nextSetupStep === 'function'` 이지만 클릭 불가 | **가설 B/C/D** 우선 — 오버레이·권한·drag-region |
| Console 빨간 에러 존재 | 에러 메시지·스택·파일명을 **1차 근본 원인** 후보로 기록 |

확인할 Console 에러 패턴:

- `Failed to load module script`
- `Cannot read properties of undefined (reading 'core')`
- `nextSetupStep is not defined` (버튼 클릭 시)
- `permission` / `not allowed` / `Forbidden`

### Step 1-2. ES 모듈 로드 (Network)

| 리소스 | 기대 |
|--------|------|
| `token-store.js` | HTTP 200 |
| `google-api.js` | HTTP 200 |
| `fonts/fonts.css` | HTTP 200 |

실패 시: CSP(`tauri.conf.json` `security.csp`) 또는 경로 문제로 기록.

### Step 1-3. 클릭 차단 DOM 검사

Console:

```javascript
[...document.querySelectorAll('*')].filter(el => {
  const s = getComputedStyle(el);
  const z = parseInt(s.zIndex) || 0;
  return s.position === 'fixed' && z > 100 &&
         s.pointerEvents !== 'none' &&
         el.offsetWidth > 100 && el.offsetHeight > 100;
}).map(el => ({
  id: el.id,
  cls: el.className.slice(0, 60),
  z: getComputedStyle(el).zIndex,
  pe: getComputedStyle(el).pointerEvents,
  vis: getComputedStyle(el).visibility,
  op: getComputedStyle(el).opacity,
  disp: getComputedStyle(el).display,
}));
```

특히 확인할 요소 (마스터플랜 §5-2 가설 B):

- `#settingsOverlay` / `.settings-overlay`
- `#evDialog` / `.ev-dialog-overlay`
- `#alarmOverlay` / `.alarm-overlay`
- `#cevCtxOverlay` / `.cev-ctx-overlay`

### Step 1-4. Tauri 권한·Rust 로그

- DevTools Console + 터미널 stderr에서 `permission`, `not allowed`, `Forbidden` 검색
- `invoke('start_oauth')`, `plugin:path|resolve_directory` 관련 거부 여부 확인

### Step 1-5. 가설 확정표 작성 (필수 산출물)

진단 종료 시 아래 표를 채운다:

| 가설 | 확정 (Y/N/?) | 근거 (로그·스크린샷·코드 라인) |
|------|--------------|--------------------------------|
| A — ES 모듈 / Object.assign | | |
| B — 오버레이 pointer-events | | |
| C — capabilities 누락 | | |
| D — drag-region | | |

**복합 원인 가능.** Primary(1순위) / Secondary(2순위)를 명시한다.

---

## 6. Phase 2 — 수정 (Phase 1 완료·가설 확정 후에만 시작)

> ⚠️ **Phase 1 산출물 없이 Phase 2에 들어가지 않는다.**

확정된 가설에 따라 `0_MASTER_PLAN.md` §7 전략을 적용한다. **아래는 허용된 수정 범위**이며, Primary 가설부터 처리한다.

### 가설 A 확정 시 — 허용 수정

| ID | 작업 | 대상 파일 |
|----|------|-----------|
| A-1 | `Object.assign(window, …)` 를 **모듈 초반**(import·함수 선언 직후)으로 이동, 또는 onclick용 전역 노출 구조 분리 | `src/index.html` |
| A-2 | top-level IIFE `(async () => { getCurrentWindow().listen('tauri://move') })()` 를 `DOMContentLoaded` 이후로 이동 | `src/index.html` L3247~3261 |
| A-3 | `window.__TAURI__` 가드 + 명시적 에러 로그 | `src/index.html` |
| A-4 | (선택) import/초기화 실패 시 화면 에러 배너 | `src/index.html` |

**금지:** `index.html` 전체 리포맷 · unrelated 기능 변경 · Rust에 Google API 추가

### 가설 B 확정 시 — 허용 수정

| ID | 작업 | 대상 파일 |
|----|------|-----------|
| B-1 | 닫힌 오버레이 CSS에 `pointer-events: none` 추가; 열릴 때만 `all` | `src/index.html` CSS |
| B-2 | `resetAllOverlaysOnStart`에 `#settingsOverlay`, `#alarmOverlay`, `#cevCtxOverlay` 추가 | `src/index.html` L6959~ |

### 가설 C 확정 시 — 허용 수정

| ID | 작업 | 대상 파일 |
|----|------|-----------|
| C-1 | 누락 permission 추가 (PoLP 유지) | `src-tauri/capabilities/main.json` |

검토 후보 (Tauri v2 공식 identifier로 **확인 후** 추가):

- `core:path:default`
- `allow-start-oauth` (또는 프로젝트 ACL에 맞는 커스텀 커맨드 permission)
- `core:window:allow-set-focus`
- `core:window:allow-minimize`
- `core:event:allow-listen`

**금지:** `**` 와일드카드로 전체 권한 개방

### 가설 D 확정 시 — 허용 수정

| ID | 작업 | 대상 파일 |
|----|------|-----------|
| D-1 | topbar 클릭 요소에 drag 제외 (`data-tauri-drag-region="false"` 또는 `-webkit-app-region: no-drag`) | `src/index.html` |
| D-2 | `-webkit-app-region: drag` 와 `data-tauri-drag-region` 중복 충돌 제거 | `src/index.html` CSS/HTML |

---

## 7. Phase 3 — 검증

### 7-1. P0 스모크 테스트 (필수)

| # | 시나리오 | 기대 결과 |
|---|----------|-----------|
| T1 | 최초 실행 (`localStorage.setupDone` 없음) | 설정 위저드 **「다음 →」** 클릭 → Step 1 이동 |
| T2 | Step 0 → Step 1 → Step 2 → 대시보드 진입 | `launchDashboard()` 후 대시보드 표시 |
| T3 | `setupDone === '1'` 상태 재실행 | 위저드 스킵, 대시보드 직접 표시 + 클릭 가능 |
| T4 | 대시보드 topbar | ↻ 동기화 · ⚙ 설정 · ✕ 트레이 숨김 **각각 클릭 반응** |
| T5 | DevTools Console | **치명적 에러 0건** (updater pubkey/info 경고는 허용) |
| T6 | Console | `typeof window.nextSetupStep === 'function'` |

### 7-2. 회귀 방지 (최소)

- 설정 모달 열기/닫기 후 클릭 가능 유지
- 일정 다이얼로그·알림 오버레이 **닫힌 상태**에서 클릭 차단 없음

### 7-3. 빌드 확인 (가능하면)

```powershell
npm run tauri:build:debug
# 또는 npm run tauri:build
```

설치 exe에서 T1~T4 재현.

---

## 8. 산출물 (작업 완료 시 제출)

다음 파일/내용을 남긴다:

| # | 산출물 | 형식 |
|---|--------|------|
| D1 | **진단 보고** — Step 1-1~1-5 결과, 가설 확정표 | Markdown |
| D2 | **근본 원인 1~2문장** + 증거 (콘솔 로그, 라인 번호) | Markdown |
| D3 | **변경 파일 목록** + diff 요약 (Phase 2 수행 시) | Markdown |
| D4 | **검증 결과** — T1~T6 체크리스트 | Markdown |
| D5 | **`MDs/1_RESULT.md`** (없으면 생성) — 위 D1~D4 통합 | Markdown |

`0_MASTER_PLAN.md` §11 P0 체크리스트 상태도 D5에 반영한다.

---

## 9. 보고 형식 (템플릿)

```markdown
## 작업 #1 결과 — P0 클릭 불가

### 근본 원인
[1~2문장 + 증거]

### 가설 확정
- Primary: [A/B/C/D]
- Secondary: [해당 시]

### 변경 사항
| 파일 | 변경 요약 |
|------|-----------|

### 검증
- [x] T1 …
- [x] T2 …

### 미해결 / 다음 작업 (#2로 이관)
- …
```

---

## 10. 작업 규칙 (위반 금지)

1. **Phase 1(진단) 없이 코드 수정 시작 금지**
2. **`src/index.html` 무분별 리포맷 금지** — diff 최소화
3. **Electron `main.js` / `preload.js` 수정 금지**
4. **Google API를 Rust로 이전 금지** — `src/google-api.js`만
5. **capabilities PoLP 유지** — 와일드카드 전체 개방 금지
6. **P1 이상 기능(OAuth E2E, Drive, Tasks 등)은 본 작업 범위 밖** — P0만
7. **git commit은 사용자 요청 시에만**

---

## 11. 완료 조건 (Definition of Done)

`0_MASTER_PLAN.md` §11 P0와 동일:

- [ ] 설정 위저드 **「다음 →」** 클릭 동작
- [ ] `typeof window.nextSetupStep === 'function'`
- [ ] DevTools Console 치명적 에러 0건
- [ ] 닫힌 오버레이 상태에서 전체 UI 클릭 가능
- [ ] `MDs/1_RESULT.md` 작성 완료

---

## 12. 다음 작업 예고 (#2)

P0 완료 후 [`MDs/2_PROMPT.md`](2_PROMPT.md) (미작성)에서 다룰 예정:

- **P1** Google OAuth E2E · Calendar 조회 · 창/트레이/단축키

---

## 13. 문서 이력

| 날짜 | 내용 |
|------|------|
| 2026-05-31 | 작업 #1 지시서 초版 — `0_MASTER_PLAN.md` P0 기반 |
