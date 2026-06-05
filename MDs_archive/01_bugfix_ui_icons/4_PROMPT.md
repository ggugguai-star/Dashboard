# 4_PROMPT — 작업 지시서 #4: [개선-3] 링크 추가 토글 버튼 제거 (인라인 폼 항상 표시)

> **문서 유형:** AI/개발자 작업 지시서  
> **작업 번호:** 4  
> **모드:** R&D (기존 Tauri v2 앱 개선)  
> **상위 문서:** [`0_MASTER_PLAN.md`](0_MASTER_PLAN.md) §「개선-3」  
> **선행 완료:** [`3_RESULT.md`](3_RESULT.md) — BUG-2 PASS  
> **작성일:** 2026-06-04  
> **범위:** 마스터플랜 **단계 4** — 개선-3만. 개선 4~7·단계 8 **착수 금지**

---

## 1. 목표 (무엇을)

카테고리 패널 하단의 **「🔗 링크 추가」토글 버튼(`lb`)** 을 제거하고, **제목·URL 인라인 입력 폼(`link-input-row`)** 을 `acts` 영역에 **항상 표시**한다.

**한 문장:**  
> `lb.onclick` 토글 로직을 없애고, 패널 빌드 시 링크 입력 행을 고정 렌더링하며 `취소`는 폼 제거가 아닌 **입력 초기화**로 동작하게 한다.

---

## 2. 이유 (왜)

| 근거 | 설명 |
|------|------|
| 개선-3 원인 | `src/index.html` `buildCatPanels()`(약 L5098~5165) — `lb` 클릭 시 `.link-input-row`를 **생성/제거**하는 토글. 폼 안에 이미 `✓ 추가`·`취소`가 있어 **중복 UX** |
| 3단계 RESULT §6 | 개선 3~7 **미해결·단계 4 대상** |
| 마스터플랜 DoD | 「링크 추가 토글 버튼 없이 폼이 바로 보임」 |
| 회귀 리스크 | `submitLink()`·URL 정규화·`cat.items.push`·`buildCatPanels()`·링크 아이템 `openPath` — **로직 유지**, UI 진입 경로만 단순화 |

**현재 코드 앵커 (수정 전 확인):**

```text
L5097~5165: acts / lb 버튼 / onclick 토글 / link-input-row 동적 생성
L905~929:    .link-input-row, .link-add-btn CSS (구조 유지, 필요 시 여백만 미세 조정)
```

---

## 3. 접근 (어떻게)

### Phase A — 컨텍스트 로드 (코드 수정 전)

1. [`AGENTS.md`](../AGENTS.md) — 최소·국소 변경
2. [`MDs/0_MASTER_PLAN.md`](0_MASTER_PLAN.md) §「개선-3」
3. [`src/index.html`](../src/index.html) — 아래만 읽기 (리포맷 금지)
   - L5096~5166: `acts`, `lb`, 링크 폼 생성·`submitLink`
   - L905~929: `.link-input-row` 관련 CSS
   - (회귀) L4967~5005: 아이템 행·URL `openPath` 클릭
4. [`3_RESULT.md`](3_RESULT.md) — BUG-2·회귀 검증 기준

### Phase B — 설계 (구현 전 결정)

| 항목 | 지침 |
|------|------|
| **`lb` 제거** | `const lb = …`, `lb.onclick`, `acts.appendChild(lb)` **삭제** |
| **항상 표시** | `buildCatPanels()` 루프 내 `acts`에 `link-input-row`를 **매번** append (카테고리별 독립 폼) |
| **`submitLink`** | 기존 함수 본문 **그대로** 재사용. 성공 후 `row.remove()` → **`입력 필드만 clear` + `buildCatPanels()`** (폼은 유지) |
| **`취소` 버튼** | `row.remove()` 금지 → `titleInp.value = ''`, `urlInp.value = ''`, `titleInp.focus()` |
| **Escape 키** | `row.remove()` → **취소와 동일**(입력 초기화). 폼 자체는 남김 |
| **중복 방지** | `acts.querySelector('.link-input-row')` 토글 분기 **삭제** — 항상 1개만 생성 |
| **포커스** | 패널 빌드 후 `setTimeout(() => titleInp.focus(), 50)` — **선택**(항상 표시 시 포커스 스틸 방지: **첫 패널만** 또는 생략. RESULT §6에 결정 기록) |
| **CSS** | `.cp-drop-btns` 레이아웃이 깨지면 **해당 클래스만** 최소 수정. `UI.md` 대규모 변경 **금지** |
| **Rust/설정** | `src-tauri/**`, `tauri.conf.json` **변경 없음** |

### Phase C — 구현 체크리스트

1. 링크 폼 생성 코드를 **즉시 실행 함수 또는 인라인 블록**으로 `lb` 없이 `acts`에 연결
2. `submitLink` 성공 시: 필드 초기화, `buildCatPanels()`, `showToast` 유지
3. `cancelBtn` / `Escape` → 입력 초기화만
4. **회귀:** BUG-1 파일 드롭·BUG-2 workArea 스냅·HTML5 `_dragSrc` 이동 — 코드 경로 미변경 확인

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
| **L1** 카테고리 패널 열기 | **「🔗 링크 추가」버튼 없음**. 제목·URL 입력란·`✓ 추가`·`취소` **즉시 표시** |
| **L2** 제목·URL 입력 → `✓ 추가` | `tag: URL` 아이템 추가, 토스트 `✅ 링크 추가됨`, **폼은 그대로**·필드 비움 |
| **L3** URL만 입력(제목 생략) | hostname 자동 `lbl` (기존 `submitLink` 동작) |
| **L4** `취소` 또는 Esc | 행 **삭제되지 않음**, 입력만 초기화 |
| **L5** 추가된 링크 아이템 클릭 | `openPath` / 브라우저 열기 **기존과 동일** |
| **L6** BUG-1·BUG-2 회귀 | 파일·폴더 드롭 1회, 창 스냅(workArea) 1회 — 단계 2·3 동작 유지 |
| **L7** DevTools Console | 치명적(빨간) 에러 **0건** |

### Phase F — RESULT 작성

1. `MDs/4_RESULT_draft.md` (§0~§6)
2. 완성 후 `MDs/4_RESULT.md`로 **rename**
3. PASS 전 **단계 5 PROMPT/구현 착수 금지**

---

## 4. Definition of Done (검증 가능 체크리스트)

- [ ] **G1** `python scripts/static_check.py` → exit **0**, `RESULT: PASS`
- [ ] **G2** `lb` 버튼·토글 onclick **코드에서 제거** (L1)
- [ ] **G3** 모든 카테고리 패널에 `link-input-row` **항상 표시** (L1)
- [ ] **G4** `✓ 추가` 후 링크 아이템 추가·폼 유지·필드 초기화 (L2·L3)
- [ ] **G5** `취소`/Esc → 입력 초기화만, 폼 제거 없음 (L4)
- [ ] **G6** 링크 아이템 열기 회귀 없음 (L5)
- [ ] **G7** BUG-1·BUG-2 회귀 없음 (L6)
- [ ] **G8** `git rev-parse HEAD` 및 `git log -1 --oneline`을 RESULT §4에 기록
- [ ] **G9** `MDs/4_RESULT.md` 존재, DoD G1~G9 항목별 §3 근거
- [ ] **G10** 마스터플랜 「단계 4 / 개선-3」완료 한 줄이 §0에 있음

**빌드/정적 게이트:**  
`python scripts/static_check.py` → **PASS (exit 0)**

**회귀 검증 (R&D 필수 한 줄):**  
개선-3 수정 후 **파일 드롭(BUG-1)·workArea 스냅(BUG-2)·카테고리 간 HTML5 아이템 드래그·우클릭 메뉴** 기존 동작 유지.

---

## 5. 영향 받는 파일 / 모듈 범위

| 구분 | 경로 | 본 단계 |
|------|------|---------|
| **주요 수정** | `src/index.html` | `buildCatPanels()` 내 `acts` / 링크 폼 블록 (~L5096~5166) |
| **조건부** | `src/index.html` CSS | `.cp-drop-btns`, `.link-input-row` 레이아웃만 (필요 시) |
| **수정 금지** | `snapToCurrentMonitor`, `monitorWorkArea`, Tauri `drag-drop` | BUG-2·BUG-1 |
| **수정 금지** | 더블클릭 rename, `UI.md` 대규모 CSS, `ITEM_ICON_SETS` / `CAT_ICONS` | 단계 5~7 |
| **수정 금지** | `src-tauri/**`, `tauri.conf.json`, capabilities | 범위 외 |
| **수정 금지** | `agent_orchestrator.py`, `scripts/static_check.py` | 유지 |
| **수정 금지** | Electron `main.js` / `preload.js` | 레거시 |
| **산출 문서** | `MDs/4_RESULT_draft.md` → `MDs/4_RESULT.md` | 필수 |

---

## 6. static_check FAIL 시에만 허용되는 최소 수정

1. stderr **맨 끝** `blocking_failures`만 대응  
2. 개선-3·회귀와 **무관한 리팩터링 금지**  
3. 수정 후 `python scripts/static_check.py` 재실행 → PASS  
4. RESULT §1·§2에 기록  

---

## 7. 작업 규칙 (위반 금지)

1. **단계 5~8 구현·PROMPT 작성 착수 금지**
2. **`src/index.html` 무분별 리포맷·대량 CSS 변경 금지**
3. **더블클릭 rename·UI.md 모션·아이콘 피커 확충 금지** — 단계 5~7
4. **capabilities 와일드카드 확대 금지**
5. **`git commit`은 사용자 요청 시에만**
6. **placeholder(`// TODO`) 금지**
7. **`Final.md` 작성 금지** — 마스터플랜 **단계 8** 완료 후에만

---

## 8. RESULT 문서 요구 (요약)

| 절 | 내용 |
|----|------|
| §0 | 개선-3 해결 여부 한 줄 |
| §1 | 변경 파일 경로만 |
| §2 | lb 제거·항상 표시·취소=초기화·submit 후 동작 2~5줄 |
| §3 | DoD G1~G10 항목별 충족 근거 |
| §4 | static_check·`tauri:dev` L1~L7(소스 복붙 금지) |
| §5 | static_check PASS/FAIL |
| §6 | 포커스 정책·다중 패널 레이아웃, 미해결 개선 4~7 |

---

## 9. 다음 작업 예고 (#5)

PASS 후 [`MDs/5_PROMPT.md`](5_PROMPT.md) (별도 작성):

- **단계 5** — [개선-4] 카테고리 아이템 제목 더블클릭 수정 진입 (`makeRow` · `showRenamePopup`)

**최종 단계 안내:** 마스터플랜 **단계 8**(회귀 검증 + git 체크포인트) PASS 후에만 [`MDs/Final.md`](Final.md) 작성.

---

## 10. 문서 이력

| 날짜 | 내용 |
|------|------|
| 2026-06-04 | 3단계 PASS 후 개선-3 지시서 초안 |
