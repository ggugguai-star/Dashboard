# 0_MASTER_PLAN.md — Dashboard R&D (버그픽스 + 기능개선)

> 기준: Tauri v2.0.3 베이스라인 커밋 `c396771`
> 원칙: 최소·국소 변경 / 회귀 금지 / UI 시각 요소 보존

---

## 작업 목록

- [ ] **단계 1** — 베이스라인 static_check 통과 확인
- [ ] **단계 2** — [BUG] 파일·폴더 드래그&드롭 경로 취득 실패 수정
- [ ] **단계 3** — [BUG] 작업표시줄 가려짐 (snapToCurrentMonitor workArea 미적용)
- [ ] **단계 4** — [개선] 링크 추가 토글 버튼 제거 (인라인 폼 항상 표시)
- [ ] **단계 5** — [개선] 카테고리 아이템 제목 더블클릭 수정 진입
- [ ] **단계 6** — [개선] UI.md 기반 디자인 향상 (모션·글래스·색상)
- [ ] **단계 7** — [개선] 아이콘 확충 및 카테고리 피커 개선
- [ ] **단계 8** — 회귀 검증 + git 체크포인트

---

## 버그·개선 원인 분석

### BUG-1: 파일·폴더 드래그&드롭 작동 안 함
- **위치:** `src/index.html:4805` `handleFileDrop()`
- **원인:** `getFilePath(f)`, `f.path` — 두 API 모두 **Electron 전용**.
  Tauri v2 + WebView2 환경에서는 `e.dataTransfer.files[i]` 객체에 경로 속성이 없음 (보안 정책).
- **수정 방향:**
  1. `tauri://file-drop` 네이티브 이벤트로 교체
     (`window.__TAURI__.event.listen('tauri://file-drop', ...)`)
  2. 이벤트 payload: `{ paths: string[], position: {x, y} }`
  3. 드롭 위치(x,y) → `document.elementFromPoint` → 해당 cat 패널 특정
  4. `tauri.conf.json` → `"fileDropEnabled": true` 추가 필요 여부 확인
     (Tauri v2 기본값 확인: 기본 활성이면 생략)
  5. 기존 `body.addEventListener('drop', ...)` / `dz.addEventListener('drop', ...)` 는
     파일 경로 없이도 아이템 이동(_dragSrc) 용으로 유지, 파일 경로 처리만 교체

### BUG-2: 작업표시줄 가려짐
- **위치:** `src/index.html:3283` `snapToCurrentMonitor()`
- **원인:** `mon.size` = 작업표시줄 **포함** 전체 모니터 크기를 창 크기로 설정
  → 창 하단이 작업표시줄 뒤로 숨어버림
- **수정 방향:**
  - Tauri v2.11 `current_monitor` 반환값에 `workArea` 필드가 있으면 사용
  - 없으면 `screen.availWidth / availHeight / availLeft / availTop` × `scaleFactor` 폴백
  - 수정 위치: `pos`, `size` 계산부 4줄만 교체

### 개선-3: 링크 추가 토글 버튼 불필요
- **위치:** `src/index.html:5009` `lb` 버튼 (`🔗 링크 추가`)
- **원인:** 버튼 클릭 → 인라인 폼 토글. 그런데 폼 안에 이미 `✓ 추가` / `취소` 버튼이 있어 토글 버튼이 중복
- **수정 방향:**
  - `lb` 버튼 생성·추가 코드 제거
  - 인라인 `link-input-row` 폼을 `acts` div에 **항상 렌더링** (토글 없이)
  - `cancelBtn`은 "입력 초기화" 역할로 유지

### 개선-4: 카테고리 아이템 제목 더블클릭 수정
- **현재:** 우클릭 → 컨텍스트 메뉴 → "이름 수정" 경로만 존재
  (`src/index.html:4881`, `5675`)
- **수정 방향:**
  - `makeRow()` 내 아이템 라벨 요소에 `dblclick` 이벤트 추가
  - `dblclick` → `_ctxCat = cat; _ctxItem = item; showRenamePopup(x, y)`
  - 기존 우클릭 경로는 그대로 유지 (회귀 금지)
  - rename 저장 로직은 기존 `closeRenamePopup` 재사용

### 개선-6: UI.md 기반 디자인 향상
- **참조:** `UI.md` §1·§4·§5·§6
- **현황 진단:**
  - 배경 메시 그라디언트: 부분 적용됨
  - 카드/패널 blur: 과다 적용 (`backdrop-filter: blur(40px)` 등 남발)
  - 트랜지션: `.15s ease` 기계적 리니어 다수 → `--ease-liquid` 미적용
  - 아이템 hover: `transform` 없는 단순 색상 변화
  - 버튼: 단색 배경 多 → 리퀴드 메탈 그라디언트 미적용
- **수정 방향:**
  1. **CSS 변수 추가** (`:root`): `--ease-liquid: cubic-bezier(0.34, 1.56, 0.64, 1)`
  2. **카드·아이템 hover**: `transform: translateY(-2px) scale(1.012)` + `350ms var(--ease-liquid)` (cat-panel, item row, 버튼)
  3. **blur 정리**: 상위 뎁스(헤더, 모달)에만 유지. 중첩 blur 제거 → 퍼포먼스 개선
  4. **버튼 그라디언트**: 주요 액션 버튼(`link-add-btn`, 설정 저장 등) → `linear-gradient(to right, #8b5cf6, #7c3aed)` + `color: white`
  5. **패널 Spatial Glass**: cat-panel 보더 → `rgba(255,255,255,0.25)` 상단 하이라이트 rim
  6. **토스트·팝업 진입 애니메이션**: `translateY` + `opacity` 조합으로 부드러운 슬라이드인
  7. **폰트 보정**: 10px 이하 텍스트 → 11px 이상 상향 (가독성 규칙)
- **수정 범위:** CSS 섹션 (`:root` 변수 + 기존 클래스 transition/transform 값 교체). HTML 구조 변경 없음.

### 개선-7: 아이콘 확충 및 카테고리 피커 개선
- **현황:**
  - `ITEM_ICON_SETS` (아이템 아이콘): 6개 카테고리 × 24개 = 144개
  - `CAT_ICONS` (카테고리 헤더 아이콘): 단순 flat 배열 ~20개
- **수정 방향:**
  1. **`ITEM_ICON_SETS` 확충**: 기존 6개 카테고리 각 24→48개 (동일 유니코드 이모지 스타일 유지), 신규 2개 카테고리 추가
     - 추가: `🏠 생활/장소` (집, 쇼핑, 음식, 교통 등)
     - 추가: `😀 감정/사람` (표정, 제스처, 사람 실루엣 등)
  2. **`CAT_ICONS` → 카테고리별 피커로 전환**: 현재 flat → `CAT_ICON_SETS` 구조로 교체
     - 카테고리 에디터 팝업(`catEditPopup`)의 아이콘 그리드를 탭 기반으로 변경
     - ITEM_ICON_SETS와 동일 UX 패턴 재사용
  3. **아이콘 검색 입력**: 아이콘 피커 상단에 간단한 텍스트 필터 input 추가 (선택사항 — 구현 복잡도 낮으면 포함)
- **수정 위치:** `ITEM_ICON_SETS`, `CAT_ICONS` 데이터 + `catEditPopup` 아이콘 그리드 렌더 함수

---

## 변경 파일 (예상)

| 파일 | 변경 내용 |
|------|-----------|
| `src/index.html` | 단계 2~7 모두 (함수·CSS 레벨 국소 변경) |
| `src-tauri/tauri.conf.json` | `fileDropEnabled: true` 추가 가능성 (BUG-1 분석 후 결정) |

---

## DoD (완료 기준)

| 항목 | 기준 |
|------|------|
| BUG-1 | 파일·폴더를 카테고리 패널에 드롭 → 경로 포함 아이템 추가됨 |
| BUG-2 | 앱 실행 시 창이 작업표시줄 위로 딱 맞게 표시됨 |
| 개선-3 | 링크 추가 토글 버튼 없이 폼이 바로 보임 |
| 개선-4 | 아이템 라벨 더블클릭 → rename 팝업 진입 |
| 개선-6 | hover 시 탄성 애니메이션 / blur 정리 / 버튼 그라디언트 적용 |
| 개선-7 | 아이콘 피커 카테고리 8개+ / 아이콘 총 300개+ / CAT_ICONS 탭화 |
| 회귀 | 기존 아이템 드래그(카테고리 간 이동) 정상 / 링크 URL 열기 정상 / 우클릭 메뉴 정상 |
