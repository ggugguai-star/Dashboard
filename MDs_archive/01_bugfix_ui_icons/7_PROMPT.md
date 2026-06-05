# 7_PROMPT — 작업 지시서 #7: [개선-7] 아이콘 확충 및 카테고리 피커 개선

> **문서 유형:** AI/개발자 작업 지시서  
> **작업 번호:** 7  
> **모드:** R&D (기존 Tauri v2 앱 개선)  
> **상위 문서:** [`0_MASTER_PLAN.md`](0_MASTER_PLAN.md) §「개선-7」  
> **선행 완료:** [`6_RESULT.md`](6_RESULT.md) — 개선-6 PASS  
> **작성일:** 2026-06-04  
> **범위:** 마스터플랜 **단계 7** — 개선-7만. 단계 8·`Final.md` **착수 금지**

---

## 1. 목표 (무엇을)

**아이템 아이콘 피커** 데이터를 확충하고, **카테고리 편집 팝업**의 flat `CAT_ICONS`를 **탭 기반 `CAT_ICON_SETS`** 로 전환한다.

**한 문장:**  
> `ITEM_ICON_SETS`를 8개 카테고리·300개+ 이모지로 늘리고, `catEditPopup` 아이콘 그리드를 `showIconPicker`와 동일한 탭 UX로 바꾸며 `__gdrive__` 선택·저장을 유지한다.

---

## 2. 이유 (왜)

| 근거 | 설명 |
|------|------|
| 개선-7 현황 | `ITEM_ICON_SETS` 6×24=144 (`L5839~5864`), `CAT_ICONS` flat ~30개 (`L6302~6307`) |
| 6단계 RESULT §6 | 아이콘·CAT 피커 **미해결·단계 7 대상** |
| 마스터플랜 DoD | 「아이콘 피커 카테고리 8개+ / 아이콘 총 300개+ / CAT_ICONS 탭화」 |
| UX | 아이템 피커는 탭·그리드 완비(`_icpRenderTab`) — 카테고리 편집만 flat 그리드로 불일치 |
| 회귀 리스크 | `renderIcon`·`GDRIVE_ICON_MARKER`·`saveCatEditPopup`·`showIconPicker`·CDP `diag-p2` T36 |

**코드 앵커:**

```text
L5839~5934:  ITEM_ICON_SETS, showIconPicker, _icpRenderTab
L2590~2599:  #icpPopup HTML (icpTabs, icpGrid)
L2804~2831:  #catEditPopup HTML (cepIconGrid — flat)
L6282~6414:  GDRIVE_ICON_MARKER, CAT_ICONS, openCatEditPopup, saveCatEditPopup
L1580~1590:  .cep-icon-grid CSS
```

---

## 3. 접근 (어떻게)

### Phase A — 컨텍스트 로드 (코드 수정 전)

1. [`AGENTS.md`](../AGENTS.md) — 최소·국소 변경
2. [`MDs/0_MASTER_PLAN.md`](0_MASTER_PLAN.md) §「개선-7」
3. [`src/index.html`](../src/index.html) — 위 앵커만 읽기 (리포맷 금지)
4. [`6_RESULT.md`](6_RESULT.md) — CSS-only 완료·기능 회귀 기준

### Phase B — 설계 (구현 전 결정)

#### B-1. `ITEM_ICON_SETS` 확충 (필수)

| 항목 | 지침 |
|------|------|
| **기존 6탭** | 각 `icons` 배열 **24 → 48** (유니코드 이모지, 중복·공백 없이) |
| **신규 2탭** | `🏠 생활/장소` 48개 · `😀 감정/사람` 48개 |
| **합계** | 8탭 × 48 = **384개** (DoD 300+ 충족) |
| **스타일** | 기존과 동일 단일 이모지 문자열, SVG/이미지 URL 금지 |
| **탭 라벨** | 기존 `label` 패턴 유지 (`이모지 + 한글`) |

#### B-2. `CAT_ICON_SETS` 신설 (필수)

| 항목 | 지침 |
|------|------|
| **구조** | `ITEM_ICON_SETS`와 동일: `{ label, icons: string[] }[]` |
| **`CAT_ICONS` 처리** | flat 배열 **삭제** → `CAT_ICON_SETS`로 이관. `__gdrive__`(`GDRIVE_ICON_MARKER`)는 **전용 탭 1개**(예: `☁️ Drive/클라우드`) 또는 첫 탭에 1칸 포함 — `renderIcon` 동작 유지 |
| **탭 수** | 최소 **4~6탭** (카테고리 헤더용 큐레이션, 8탭 전체 복제 불필요). 각 탭 20~40개 권장 |
| **중복** | Drive 마커 + 자주 쓰는 학교/업무 이모지 포함 |

#### B-3. 카테고리 편집 UI — 탭 피커 (필수)

| 항목 | 지침 |
|------|------|
| **HTML** | `#catEditPopup` 내 `cepIconGrid` **위에** `cepTabs` div 추가 (`.icp-tabs` 패턴 재사용) |
| **CSS** | `.cep-tabs`, `.cep-tab`, `.cep-tab-active` — `.icp-tabs` 스타일 **복제·축소**(최소) |
| **JS** | `_cepRenderTab(tabIdx)`, `_cepTabIdx`, `openCatEditPopup`에서 flat `forEach` 제거 → 탭 빌드(최초 1회) + `_cepRenderTab` |
| **선택 상태** | `cepSelectedIcon`·`.cep-sel`·`cepPreviewIcon` 갱신 — **기존 `saveCatEditPopup` 필드명 유지** |
| **시작 탭** | 현재 `cat.icon`이 포함된 탭으로 자동 선택 (`_icpRenderTab` startTab 로직 재사용) |

#### B-4. 아이콘 검색 필터 (선택·권장)

| 항목 | 지침 |
|------|------|
| **대상** | `#icpPopup`·`#catEditPopup` 그리드 상단 |
| **동작** | input `input` → 현재 탭 `icons`를 `includes`/`label` 한글 필터 (이모지 자체는 검색 어려움 — 탭 라벨·인접 키워드 optional) |
| **최소 구현** | 탭 내 그리드만 필터(빈 결과 시 「없음」 1줄) |
| **미구현 시** | RESULT §6에 **미구현 + 사유** 명시 (DoD 필수 아님) |

#### B-5. 공통·회귀

| 항목 | 지침 |
|------|------|
| **`showIconPicker`** | 탭 데이터만 확장 — `_icpRenderTab` 로직 **재사용**, 회귀 필수 |
| **`renderIcon`** | **수정 금지**(필요 시 버그만) |
| **`window` 노출** | `showIconPicker`, `openCatEditPopup` 등 CDP용 `Object.assign` 유지 |
| **6단계 CSS** | 개선-6 hover·blur **되돌리지 않음** |

### Phase C — 구현 체크리스트

1. `ITEM_ICON_SETS` 8탭·48×8 데이터 작성
2. `CAT_ICON_SETS` 정의 + `CAT_ICONS` 제거
3. `cepTabs` HTML + CSS + `_cepRenderTab` / `openCatEditPopup` 리팩터
4. (권장) icp/cep 검색 input + 필터 함수
5. `saveCatEditPopup`·Drive 타입·`__gdrive__` 저장 1회 수동 확인
6. **회귀:** `showIconPicker`·우클릭 아이콘 변경·카테고리 편집·BUG-1~2·개선 3~6

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
| **I1** 아이템 우클릭 → 아이콘 변경 | `icpOverlay` 8탭, 탭당 48개, 선택·확인 후 아이콘 반영 |
| **I2** 카테고리 ⚙/아이콘 → 편집 팝업 | `cepTabs` 표시, 탭 전환, 아이콘 선택·저장 |
| **I3** Drive 타입 카테고리 | `__gdrive__` 아이콘 선택·`renderIcon` SVG 정상 |
| **I4** `ITEM_ICON_SETS` 총 개수 | 코드·RESULT §2에 **384** (또는 300+) 기록 |
| **I5** `CAT_ICON_SETS` 탭 수 | **4+** 탭 |
| **I6** (선택) 아이콘 검색 input | 필터 동작 또는 §6 미구현 |
| **I7** 링크·rename·드롭·드래그·스냅 | 개선 3~6·BUG 1~2 회귀 없음 |
| **I8** DevTools Console | 치명적 에러 **0건** |

### Phase F — RESULT 작성

1. `MDs/7_RESULT_draft.md` (§0~§6)
2. 완성 후 `MDs/7_RESULT.md`로 **rename**
3. PASS 전 **단계 8·Final.md 착수 금지**

---

## 4. Definition of Done (검증 가능 체크리스트)

- [ ] **I1** `python scripts/static_check.py` → exit **0**, `RESULT: PASS`
- [ ] **I2** `ITEM_ICON_SETS` **8개** 카테고리, 카테고리당 **48개** (총 **384**, 300+)
- [ ] **I3** `CAT_ICON_SETS` 존재, `CAT_ICONS` flat **제거**
- [ ] **I4** `catEditPopup` 탭 UI + `_cepRenderTab`(또는 동등) 동작
- [ ] **I5** `__gdrive__` 선택·저장·표시 회귀 없음
- [ ] **I6** `showIconPicker`·아이템 아이콘 변경 회귀 (수동 I1)
- [ ] **I7** 카테고리 저장·Drive 타입 회귀 (수동 I2·I3)
- [ ] **I8** BUG-1·2·개선 3~6 기능 회귀 (수동 I7)
- [ ] **I9** 아이콘 검색 — 구현 또는 §6 **미구현** 명시
- [ ] **I10** `git rev-parse HEAD`·`git log -1 --oneline` RESULT §4
- [ ] **I11** `MDs/7_RESULT.md` 존재, DoD 항목별 §3 근거
- [ ] **I12** 마스터플랜 「단계 7 / 개선-7」완료 한 줄 §0

**빌드/정적 게이트:**  
`python scripts/static_check.py` → **PASS (exit 0)**

**회귀 검증 (R&D 필수 한 줄):**  
아이콘 데이터·피커 UI 변경 후 **파일 드롭·스냅·링크·rename·드래그·우클릭·열기·Drive 카테고리** 기존 동작 유지.

---

## 5. 영향 받는 파일 / 모듈 범위

| 구분 | 경로 | 본 단계 |
|------|------|---------|
| **주요 수정** | `src/index.html` | `ITEM_ICON_SETS`, `CAT_ICON_SETS`, `_icpRenderTab`·`showIconPicker`, `openCatEditPopup`, `_cepRenderTab`(신규) |
| **조건부 HTML** | `src/index.html` `#catEditPopup`, `#icpPopup` | `cepTabs`·검색 input (최소 추가) |
| **조건부 CSS** | `src/index.html` | `.cep-tabs` 등 (icp 패턴 복제) |
| **수정 금지** | `renderIcon`, `saveCatEditPopup` 본문(아이콘 필드 외), `buildCatPanels` 드롭/링크 | 범위 외 |
| **수정 금지** | `src-tauri/**`, `scripts/static_check.py` | 유지 |
| **참조** | `scripts/diag-p2.mjs` T36 | `showIconPicker` 회귀 |
| **산출 문서** | `MDs/7_RESULT_draft.md` → `MDs/7_RESULT.md` | 필수 |

---

## 6. static_check FAIL 시에만 허용되는 최소 수정

1. stderr **맨 끝** `blocking_failures`만 대응  
2. 개선-7·회귀와 **무관한 리팩터링 금지**  
3. 수정 후 `python scripts/static_check.py` 재실행 → PASS  
4. RESULT §1·§2에 기록  

---

## 7. 작업 규칙 (위반 금지)

1. **단계 8·`Final.md` 착수 금지**
2. **`src/index.html` 무분별 리포맷 금지** — 데이터 배열·피커 함수만
3. **이모지 300+는 `ITEM_ICON_SETS`로 충족** — `CAT_ICON_SETS`는 큐레이션 소량 허용
4. **플레이스홀더 이모지·`// TODO` 금지** — 48개는 실제 유니코드로 채움
5. **`git commit`은 사용자 요청 시에만**
6. **6단계 CSS 되돌리기 금지**
7. **capabilities·Google API Rust 이전 금지**

---

## 8. RESULT 문서 요구 (요약)

| 절 | 내용 |
|----|------|
| §0 | 개선-7 해결 여부 한 줄 |
| §1 | 변경 파일 경로만 |
| §2 | 탭 수·이모지 총개수·CAT 전환·검색 여부·`__gdrive__` 처리 (코드 복붙 금지) |
| §3 | DoD I1~I12 항목별 충족 근거 |
| §4 | static_check·`tauri:dev` I1~I8 |
| §5 | static_check PASS/FAIL |
| §6 | 검색 미구현·중복 이모지·diag-p2, 다음 단계 8 예고 |

---

## 9. 다음 작업 예고 (#8)

PASS 후 [`MDs/8_PROMPT.md`](8_PROMPT.md) (별도 작성):

- **단계 8** — 회귀 검증 + git 체크포인트

**최종 문서:** 단계 8 PASS 후 [`MDs/Final.md`](Final.md) — 마스터플랜 전체 종료·오케스트레이터 phase 999.

---

## 10. 문서 이력

| 날짜 | 내용 |
|------|------|
| 2026-06-04 | 6단계 PASS 후 개선-7 지시서 초안 |
