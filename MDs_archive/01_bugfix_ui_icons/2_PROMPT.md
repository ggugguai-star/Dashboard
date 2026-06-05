# 2_PROMPT — 작업 지시서 #2: [BUG-1] 파일·폴더 드래그&드롭 경로 취득

> **문서 유형:** AI/개발자 작업 지시서  
> **작업 번호:** 2  
> **모드:** R&D (기존 Tauri v2 앱 개선)  
> **상위 문서:** [`0_MASTER_PLAN.md`](0_MASTER_PLAN.md) §「BUG-1」  
> **선행 완료:** [`1_RESULT.md`](1_RESULT.md) — static_check PASS  
> **작성일:** 2026-06-04  
> **범위:** 마스터플랜 **단계 2** — BUG-1만. BUG-2·개선 3~7 **착수 금지**

---

## 1. 목표 (무엇을)

Tauri v2 + WebView2 환경에서 **OS 파일·폴더를 카테고리 패널에 드롭**하면, **실제 파일 시스템 경로**가 포함된 아이템이 추가되도록 수정한다.

**한 문장:**  
> Electron 전용 `dataTransfer.files[].path` 의존을 제거하고, Tauri 네이티브 **`tauri://drag-drop`** 이벤트로 경로를 받아 기존 `handleFileDrop` 로직에 연결한다.

---

## 2. 이유 (왜)

| 근거 | 설명 |
|------|------|
| BUG-1 원인 | `src/index.html` `handleFileDrop()`(약 L4805)이 `getFilePath(f)` / `f.path` 사용 → Tauri WebView2에서는 경로 속성 **없음** |
| 1단계 RESULT §6 | BUG-1 **미해결·단계 2 대상**으로 명시 |
| 마스터플랜 DoD | 「파일·폴더를 카테고리 패널에 드롭 → 경로 포함 아이템 추가」 |
| 회귀 리스크 | 동일 파일의 HTML5 `_dragSrc`(카테고리 간 아이템 이동)는 **반드시 유지** |

**이벤트명 정정 (마스터플랜 `tauri://file-drop` → 실제 API):**  
본 프로젝트 `@tauri-apps/api` 기준 이벤트는 **`tauri://drag-drop`** (`TauriEvent.DRAG_DROP`). payload는 discriminated union:

```text
{ type: 'drop', paths: string[], position: { x, y } }  // Physical 좌표
```

---

## 3. 접근 (어떻게)

### Phase A — 컨텍스트 로드 (코드 수정 전)

1. [`AGENTS.md`](../AGENTS.md) — 단계·RESULT 프로토콜, 최소 변경
2. [`MDs/0_MASTER_PLAN.md`](0_MASTER_PLAN.md) §「BUG-1」
3. [`src/index.html`](../src/index.html) — 아래 앵커만 집중 읽기 (전체 리포맷 금지)
   - L3005~3007: `tInvoke` / `tListen` 래퍼
   - L3033~3038: `getFilePath` / `statPath` (Electron 호환 스텁)
   - L4801~4827: `_dragSrc`, `handleFileDrop`
   - L4958~5005: `body` / `cp-drop` 의 `drop`·`dragover` (파일 vs `_dragSrc` 분기)
4. [`node_modules/@tauri-apps/api/webview.d.ts`](../node_modules/@tauri-apps/api/webview.d.ts) — `DragDropEvent` 타입
5. [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) — `dragDropEnabled` 기본값 확인

### Phase B — 설계 (구현 전 결정)

| 항목 | 지침 |
|------|------|
| **네이티브 파일 드롭** | `tListen('tauri://drag-drop', handler)` 1회 등록 (`DOMContentLoaded` 또는 `initDashboard` 근처). `payload.type === 'drop'` 일 때만 처리 |
| **대상 카테고리** | `position` → **논리 좌표** 변환(`scaleFactor` 적용) → `document.elementFromPoint(x, y)` → `.cat-panel` 조상 → `CATS` 인덱스 매핑 (`dataset.catIdx` 등 **국소** 속성 추가 권장) |
| **경로 → 아이템** | `handleFileDrop`을 **경로 배열** 입력으로 리팩터(예: `addPathsToCat(paths, cat)`). 파일명은 `path`에서 `split(/[\\/]/).pop()` |
| **isDir 판별** | 기존 `statPath` 휴리스틱 유지 가능. 부정확하면 `plugin:fs|stat`(`fs:allow-stat` 이미 있음)로 **최소** 보강 |
| **웹 drop 핸들러** | `body`/`cp-drop`의 `e.dataTransfer.files` 분기는 **파일 경로 처리 제거** 또는 네이티브 처리 후 no-op. **`_dragSrc` 분기는 그대로** |
| **tauri.conf** | `dragDropEnabled` 기본 **true**. 명시 설정이 없으면 **생략**(마스터플랜 `fileDropEnabled`는 v2에서 `dragDropEnabled`) |
| **Windows 주의** | Tauri 문서: Windows에서 `dragDropEnabled: true`이면 HTML5 DnD와 충돌 가능. **회귀 테스트 필수** — 아이템 간 드래그 이동이 깨지면 RESULT §6에 기록, `dragDropEnabled` 조정은 **본 버그 범위 내 최소 실험**만 |

### Phase C — 구현 체크리스트

1. `buildCatPanels()`에서 각 `.cat-panel`에 `dataset.catIdx = String(CATS.indexOf(cat))` (또는 동등한 1:1 매핑)
2. `setupTauriFileDrop()` (이름 자유) — `tListen('tauri://drag-drop', …)` 등록
3. `drop` 시: `paths` 비어 있으면 return; 패널 미검출 시 **첫 패널 또는 토스트**로 사용자 피드백(침묵 실패 금지)
4. `handleFileDrop` / `addPathsToCat` — 경로별 `cat.items.push({ ic, lbl, tag, path })` 후 `buildCatPanels()` + `showToast`
5. 웹 `drop`에서 `files.length > 0` 이고 경로 없을 때 — `handleFileDrop(e, cat)` 호출 **제거·대체**(중복 추가 방지)

### Phase D — 1차 정적 검증 (필수)

```powershell
cd C:\AI\AiCoding\Dashboard
python scripts/static_check.py
```

- exit **0** → PASS
- exit **1** → `blocking_failures`만 최소 수정

### Phase E — 수동 기능 검증 (필수)

```powershell
npm run tauri:dev
```

| 시나리오 | 기대 |
|----------|------|
| **F1** 탐색기에서 `.txt` / `.pdf` 1개를 카테고리 **body** 또는 **드롭존**에 드롭 | 토스트 `N개 항목 추가`, 아이템 `path` 비어 있지 않음, 클릭 시 `openPath` 성공(또는 OS에서 열림) |
| **F2** 탐색기에서 **폴더** 1개 드롭 | `tag: 폴더`, `ic: 📁`, `path`에 폴더 경로 |
| **F3** 카테고리 A 아이템 → 카테고리 B로 HTML5 드래그 이동 | **이동 정상** (`_dragSrc` 회귀) |
| **F4** Drive 행 드롭(`_driveDragFile`) | 기존 동작 유지(본 단계 비범위이나 회귀 확인) |
| **F5** DevTools Console | 치명적(빨간) 에러 **0건** |

### Phase F — RESULT 작성

1. `MDs/2_RESULT_draft.md` (§0~§6)
2. 완성 후 `MDs/2_RESULT.md`로 **rename**
3. PASS 전 **단계 3 PROMPT/구현 착수 금지**

---

## 4. Definition of Done (검증 가능 체크리스트)

- [ ] **D1** `python scripts/static_check.py` → exit **0**, `RESULT: PASS`
- [ ] **D2** 탐색기 파일 1개 드롭 → 해당 카테고리에 아이템 추가, **`path`에 절대/전체 경로** 기록 (F1)
- [ ] **D3** 탐색기 폴더 1개 드롭 → 폴더 아이템 추가, `path` 유효 (F2)
- [ ] **D4** 드롭 위치가 속한 **cat-panel**에만 추가 (다른 패널로 오분류 없음)
- [ ] **D5** 카테고리 간 **아이템 드래그 이동** 정상 (F3 회귀)
- [ ] **D6** `git rev-parse HEAD` 및 `git log -1 --oneline`을 RESULT §4에 기록
- [ ] **D7** `MDs/2_RESULT.md` 존재, DoD D1~D7 항목별 §3 근거
- [ ] **D8** 마스터플랜 「단계 2 / BUG-1」완료 한 줄이 §0에 있음

**빌드/정적 게이트:**  
`python scripts/static_check.py` → **PASS (exit 0)**

**회귀 검증 (R&D 필수 한 줄):**  
BUG-1 수정 후에도 **카테고리 간 아이템 HTML5 드래그 이동·링크/우클릭 메뉴** 기존 동작 유지(F3·F4).

---

## 5. 영향 받는 파일 / 모듈 범위

| 구분 | 경로 | 본 단계 |
|------|------|---------|
| **주요 수정** | `src/index.html` | `handleFileDrop`·드롭 리스너·Tauri `drag-drop` 리스너·패널 `dataset` |
| **조건부** | `src-tauri/tauri.conf.json` | `dragDropEnabled` 명시 필요 시만 (기본 true면 생략) |
| **수정 금지** | `src-tauri/src/**` (Rust 로직 추가 없이 JS로 해결 우선) | BUG-1 범위 외 |
| **수정 금지** | BUG-2 `snapToCurrentMonitor`, 개선 3~7, `UI.md` 대규모 CSS | 다음 단계 |
| **수정 금지** | `agent_orchestrator.py`, `scripts/static_check.py` | 1단계 산출물 유지 |
| **수정 금지** | Electron `main.js` / `preload.js` | 레거시 참고만 |
| **산출 문서** | `MDs/2_RESULT_draft.md` → `MDs/2_RESULT.md` | 필수 |

---

## 6. static_check FAIL 시에만 허용되는 최소 수정

1. stderr **맨 끝** `blocking_failures`만 대응  
2. BUG-1·회귀와 **무관한 리팩터링 금지**  
3. 수정 후 `python scripts/static_check.py` 재실행 → PASS  
4. RESULT §1·§2에 파일·이유 기록  

---

## 7. 작업 규칙 (위반 금지)

1. **단계 3~7 구현·PROMPT 작성 착수 금지**
2. **`src/index.html` 무분별 리포맷·대량 CSS 변경 금지**
3. **capabilities 와일드카드 확대 금지**
4. **Google API Rust 이전 금지**
5. **`git commit`은 사용자 요청 시에만**
6. **placeholder(`// TODO`) 금지**
7. **링크 토글(lb 버튼) 제거·작업표시줄 workArea 수정 금지** — 각각 단계 4·3

---

## 8. RESULT 문서 요구 (요약)

| 절 | 내용 |
|----|------|
| §0 | BUG-1 해결 여부 한 줄 (경로 드롭 동작) |
| §1 | 변경 파일 경로만 |
| §2 | `tauri://drag-drop` 연동·좌표→cat 매핑·회귀 확인 2~5줄 |
| §3 | DoD D1~D8 항목별 충족 근거 |
| §4 | static_check·`tauri:dev` F1~F5 커맨드·결과(소스 복붙 금지) |
| §5 | static_check PASS/FAIL |
| §6 | `dragDropEnabled`/Windows HTML5 충돌 여부, `statPath` 한계, 미해결 BUG-2 |

---

## 9. 다음 작업 예고 (#3)

PASS 후 [`MDs/3_PROMPT.md`](3_PROMPT.md) (별도 작성):

- **단계 3** — [BUG-2] 작업표시줄 가려짐 (`snapToCurrentMonitor` → `workArea`)

---

## 10. 문서 이력

| 날짜 | 내용 |
|------|------|
| 2026-06-04 | 1단계 PASS 후 BUG-1 지시서 초안 (`tauri://drag-drop` API 정정 반영) |
