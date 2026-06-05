# 5_PROMPT — 작업 지시서 #5: [개선-4] 카테고리 아이템 제목 더블클릭 수정 진입

> **문서 유형:** AI/개발자 작업 지시서  
> **작업 번호:** 5  
> **모드:** R&D (기존 Tauri v2 앱 개선)  
> **상위 문서:** [`0_MASTER_PLAN.md`](0_MASTER_PLAN.md) §「개선-4」  
> **선행 완료:** [`4_RESULT.md`](4_RESULT.md) — 개선-3 PASS  
> **작성일:** 2026-06-04  
> **범위:** 마스터플랜 **단계 5** — 개선-4만. 개선 6~7·단계 8 **착수 금지**

---

## 1. 목표 (무엇을)

카테고리 패널 **아이템 표시 이름**을, 우클릭 메뉴 없이 **라벨 더블클릭**으로 바로 수정할 수 있게 한다.

**한 문장:**  
> `makeRow()`의 `.item-lbl`에 `dblclick`을 추가해 `_ctxCat`/`_ctxItem`을 설정하고 `showRenamePopup(x,y)`를 호출하며, 우클릭 「이름 수정」·`confirmRename` 저장 경로는 **그대로** 유지한다.

---

## 2. 이유 (왜)

| 근거 | 설명 |
|------|------|
| 개선-4 원인 | `src/index.html` `makeRow()`(약 L4960~5048) — 아이템 이름 변경은 **우클릭 → 컨텍스트 메뉴 → 「✏️ 이름 수정」**(`initCtxHandlers` L5752~5756)만 존재 |
| 4단계 RESULT §6 | 더블클릭 rename·UI.md·아이콘 **미해결·단계 5 대상** |
| 마스터플랜 DoD | 「아이템 라벨 더블클릭 → rename 팝업 진입」 |
| 회귀 리스크 | `row.onclick`(열기)·HTML5 드래그·Drive 드롭·우클릭 메뉴·`closeRenamePopup`/`confirmRename` — **기존 경로 유지** |

**현재 코드 앵커 (수정 전 확인):**

```text
L4960~5048:  makeRow() — row.onclick, contextmenu, drag/drop
L5716~5772:  showCtx, initCtxHandlers — btnRename → showRenamePopup(_renameX,_renameY)
L6149~6177:  showRenamePopup, closeRenamePopup, confirmRename
L4944:       cp-name dblclick (카테고리 헤더 rename — 참고 패턴)
```

---

## 3. 접근 (어떻게)

### Phase A — 컨텍스트 로드 (코드 수정 전)

1. [`AGENTS.md`](../AGENTS.md) — 최소·국소 변경
2. [`MDs/0_MASTER_PLAN.md`](0_MASTER_PLAN.md) §「개선-4」
3. [`src/index.html`](../src/index.html) — 아래만 읽기 (리포맷 금지)
   - L4960~5048: `makeRow()`
   - L5716~5772: 컨텍스트 메뉴·`_renameX`/`_renameY`
   - L6149~6177: rename 팝업·저장
   - L4940~4950: `cp-name` `dblclick` (헤더 rename — 동일 UX 참고)
4. [`4_RESULT.md`](4_RESULT.md) — 링크 폼·회귀 검증 기준

### Phase B — 설계 (구현 전 결정)

| 항목 | 지침 |
|------|------|
| **이벤트 대상** | `row.innerHTML` 후 `row.querySelector('.item-lbl')`에 `dblclick` 부착 (라벨만 — 아이콘·태그 제외) |
| **컨텍스트 설정** | `dblclick` 시 `_ctxCat = cat`, `_ctxItem = item` (우클릭 `showCtx`와 동일 상태) |
| **팝업 호출** | `showRenamePopup(e.clientX, e.clientY)` — 우클릭 메뉴의 `_renameX/_renameY`와 **동일 좌표 규칙** |
| **이벤트 전파** | `e.preventDefault()`, `e.stopPropagation()` — 더블클릭이 `row.onclick`(열기)으로 **이중 실행되지 않도록** |
| **click vs dblclick** | `row.onclick`이 더블클릭 시 **2회 openPath** 되지 않게: (1) 라벨 `dblclick`에서 전파 차단, (2) 필요 시 `row.onclick`에 **250ms 디바운스** 또는 `e.detail > 1` 무시 — **최소 diff**로 선택, RESULT §6에 기록 |
| **저장 로직** | `confirmRename`·`closeRenamePopup` **수정 금지**(재사용). 팝업 HTML·버튼 바인딩 변경 없음 |
| **우클릭 회귀** | `contextmenu` → `showCtx` → 「이름 수정」 경로 **그대로** |
| **드래그 회귀** | `draggable`·`dragstart`·행 간 drop — **미변경** |
| **Rust/설정/CSS** | `src-tauri/**`, `UI.md` 대규모 CSS **변경 없음** |

### Phase C — 구현 체크리스트

1. `makeRow()` return 직전: `.item-lbl`에 `dblclick` 리스너 추가
2. 핸들러: `_ctxCat`/`_ctxItem` 설정 → `showRenamePopup(clientX, clientY)`
3. 더블클릭 시 `openPath` 이중 호출 방지 처리(§B)
4. `confirmRename` 저장 후 목록에 새 이름 반영 확인(기존 `buildCatPanels`)
5. **회귀:** BUG-1·BUG-2·개선-3 링크 폼·우클릭 메뉴 전 항목·HTML5 `_dragSrc`

### Phase D — 1차 정적 검증 (필수)

```powershell
cd C:\AI\AiCoding\Dashboard
python scripts/static_check.py
```

- exit **0** → PASS

### Phase E — 수동 기능 검증 (필수)

```powershell
npm run tauri:dev
```

| 시나리오 | 기대 |
|----------|------|
| **N1** 아이템 **라벨** 더블클릭 | `renamePopup` 표시, 입력값 = 현재 `item.lbl`, 포커스·전체 선택 |
| **N2** 팝업에서 이름 변경 → 저장(확인) | `confirmRename` → 토스트 `✏️ "old" → "new"`, 목록 라벨 갱신 |
| **N3** 팝업 Esc/취소(오버레이) | `closeRenamePopup`, `item.lbl` **변경 없음** |
| **N4** 라벨 **단일 클릭** | 기존과 동일 — `openPath` 1회(경로 있는 항목). 더블클릭 직후 **의도치 않은 2회 열기 없음** |
| **N5** 우클릭 → 「✏️ 이름 수정」 | 기존과 동일하게 팝업 진입·저장 |
| **N6** 우클릭 → 열기/복사/아이콘/삭제 | 회귀 없음 |
| **N7** 아이템 HTML5 드래그(패널 간 이동) | 회귀 없음 |
| **N8** 링크 폼 항상 표시·링크 추가 | 개선-3 회귀 없음 |
| **N9** 파일·폴더 드롭·workArea 스냅 | BUG-1·BUG-2 회귀 없음 |
| **N10** DevTools Console | 치명적(빨간) 에러 **0건** |

### Phase F — RESULT 작성

1. `MDs/5_RESULT_draft.md` (§0~§6)
2. 완성 후 `MDs/5_RESULT.md`로 **rename**
3. PASS 전 **단계 6 PROMPT/구현 착수 금지**

---

## 4. Definition of Done (검증 가능 체크리스트)

- [ ] **N1** `python scripts/static_check.py` → exit **0**, `RESULT: PASS`
- [ ] **N2** `.item-lbl` `dblclick` 핸들러 존재, `_ctxCat`/`_ctxItem` 설정 후 `showRenamePopup` 호출
- [ ] **N3** 더블클릭 → rename 팝업 진입·저장 시 라벨 갱신 (수동 N1·N2)
- [ ] **N4** 취소 시 라벨 미변경 (수동 N3)
- [ ] **N5** 단일 클릭 열기 회귀 없음·더블클릭 시 이중 `openPath` 없음 (수동 N4)
- [ ] **N6** 우클릭 「이름 수정」 경로 유지 (수동 N5·N6)
- [ ] **N7** HTML5 드래그·링크 폼·BUG-1·BUG-2 회귀 (수동 N7~N9)
- [ ] **N8** `confirmRename`/`closeRenamePopup` 본문 **미변경**(또는 클릭 디바운스만 `makeRow`/`onclick` 국소 변경)
- [ ] **N9** `git rev-parse HEAD` 및 `git log -1 --oneline`을 RESULT §4에 기록
- [ ] **N10** `MDs/5_RESULT.md` 존재, DoD 항목별 §3 근거
- [ ] **N11** 마스터플랜 「단계 5 / 개선-4」완료 한 줄이 §0에 있음

**빌드/정적 게이트:**  
`python scripts/static_check.py` → **PASS (exit 0)**

**회귀 검증 (R&D 필수 한 줄):**  
개선-4 수정 후 **파일 드롭·workArea 스냅·링크 폼·카테고리 간 HTML5 드래그·우클릭 메뉴·단일 클릭 열기** 기존 동작 유지.

---

## 5. 영향 받는 파일 / 모듈 범위

| 구분 | 경로 | 본 단계 |
|------|------|---------|
| **주요 수정** | `src/index.html` | `makeRow()` (~L4960~5048), 필요 시 `row.onclick` 디바운스 |
| **읽기 전용·재사용** | `src/index.html` | `showRenamePopup`, `confirmRename`, `closeRenamePopup`, `initCtxHandlers` |
| **수정 금지** | `UI.md` CSS 대규모·`ITEM_ICON_SETS`/`CAT_ICONS` | 단계 6~7 |
| **수정 금지** | BUG-1 drag-drop, BUG-2 `snapToCurrentMonitor`, 링크 폼 블록 | 단계 2~4 |
| **수정 금지** | `src-tauri/**`, `tauri.conf.json`, capabilities | 범위 외 |
| **수정 금지** | `agent_orchestrator.py`, `scripts/static_check.py` | 유지 |
| **수정 금지** | Electron `main.js` / `preload.js` | 레거시 |
| **산출 문서** | `MDs/5_RESULT_draft.md` → `MDs/5_RESULT.md` | 필수 |

---

## 6. static_check FAIL 시에만 허용되는 최소 수정

1. stderr **맨 끝** `blocking_failures`만 대응  
2. 개선-4·회귀와 **무관한 리팩터링 금지**  
3. 수정 후 `python scripts/static_check.py` 재실행 → PASS  
4. RESULT §1·§2에 기록  

---

## 7. 작업 규칙 (위반 금지)

1. **단계 6~8 구현·PROMPT 작성 착수 금지**
2. **`src/index.html` 무분별 리포맷·대량 CSS 변경 금지**
3. **UI.md 모션·blur·아이콘 피커 확충 금지** — 단계 6~7
4. **capabilities 와일드카드 확대 금지**
5. **`git commit`은 사용자 요청 시에만**
6. **placeholder(`// TODO`) 금지**
7. **`Final.md` 작성 금지** — 마스터플랜 **단계 8** 완료 후에만

---

## 8. RESULT 문서 요구 (요약)

| 절 | 내용 |
|----|------|
| §0 | 개선-4 해결 여부 한 줄 |
| §1 | 변경 파일 경로만 |
| §2 | dblclick 대상·컨텍스트 설정·click/dblclick 충돌 처리 2~5줄 |
| §3 | DoD N1~N11 항목별 충족 근거 |
| §4 | static_check·`tauri:dev` N1~N10(소스 복붙 금지) |
| §5 | static_check PASS/FAIL |
| §6 | click 디바운스 선택·drive 패널 행(ondblclick L5653)과 혼동 없음, 미해결 개선 6~7 |

---

## 9. 다음 작업 예고 (#6)

PASS 후 [`MDs/6_PROMPT.md`](6_PROMPT.md) (별도 작성):

- **단계 6** — [개선-6] UI.md 기반 디자인 향상 (모션·글래스·색상·blur 정리)

**최종 단계 안내:** 마스터플랜 **단계 8**(회귀 검증 + git 체크포인트) PASS 후에만 [`MDs/Final.md`](Final.md) 작성.

---

## 10. 문서 이력

| 날짜 | 내용 |
|------|------|
| 2026-06-04 | 4단계 PASS 후 개선-4 지시서 초안 |
