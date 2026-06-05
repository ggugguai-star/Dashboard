# 0_MASTER_PLAN.md — Dashboard 자유 크기조절 위젯 그리드 (iOS 컨트롤센터 스타일)

> 프로젝트: **모든 영역 위젯화 + 자유 리사이즈/재배치 + 다중 인스턴스 + 통합 JSON 영속화 + 신규 위젯군**
> 작성: 2026-06-05 · 기준 베이스라인: 이전 R&D(버그4+UI+아이콘) 완료 직후 커밋
> 원칙: 회귀 금지(기존 기능 무손상) / UI.md 디자인 준수 / 엔진-렌더-스토어 분리 / 골든셋 TDD
>
> ※ 본 문서는 초안 작성 → 시니어 리뷰(§9, 최신 GitHub/플랫폼 사실 검증 포함) → 최종본 순으로 완성됨.

---

## 0. 확정된 설계 결정 (Decisions)

| 항목 | 결정 |
|------|------|
| 대상 | Dashboard (`src/index.html` 중심) |
| 위젯화 범위 | **모든 영역** — 달력 / Weekly(드라이브) / 메모·할일 / 카테고리 전부 독립 위젯 |
| 그리드 컬럼 | **12 컬럼** |
| 셀 형태 | **정사각 셀** (행 높이 = 컬럼 폭) |
| 세로 오버플로 | **세로 스크롤 허용** — 위젯이 많으면 그리드가 아래로 늘어나고 스크롤(iOS 컨트롤센터 방식). 무스크롤 고정 폐기 |
| 날씨 공급자 | **Open-Meteo** (무료·**API 키 불필요**) — 키 관리/secrets 분기 제거 |
| 레이아웃 토글 | **feature flag `USE_WIDGET_GRID`** — 단계 4~14 동안 구/신 레이아웃 전환(롤백 안전망), 단계 15에서 제거 |
| Reflow | **밀어내기(push-down)** — react-grid-layout의 검증된 compact/collision 방식 미러링 |
| 그리드 엔진 | **직접 구현(Vanilla, 순수 ES 모듈)** + 엔진/렌더/스토어 분리 + 골든셋 TDD |
| 편집 진입 | **편집 모드** 진입 후에만 리사이즈/이동 핸들 노출 (오조작 방지) |
| 포인터 입력 | **Pointer Events + setPointerCapture** (mouse 이벤트 금지) |
| 내부 아이콘 | 패널 크기에 **반응형** (ResizeObserver) |
| 상태 저장 | **통합 JSON 파일** + **원자적 쓰기**(temp→rename) + 롤링 백업 + localStorage 1회 마이그레이션 |
| 백업 UI | ⚙ 설정 화면 + 편집 툴바 **양쪽**, 내보내기 시 **"API 키 포함" 체크박스(기본 ON)** |
| 다중 인스턴스 | **완전 자유** — 같은 타입도 여러 개 (달력 3개 등) |
| 위젯별 소스 | 위젯마다 데이터 소스 바인딩 (캘린더ID / TasksListID / DriveFolderID) |
| 신규 위젯 | 🕐 시계 · 📌 스티키메모 · ⏱ 뽀모도로 · 📆 D-Day · ☀️ 날씨 · 🤖 Gemini |

### 0-1. 데이터 소스 바인딩 (API 현황 — 조사 완료)
| 소스 | 현재 | 필요 작업 |
|------|------|-----------|
| 캘린더 | `primary` 하드코딩 | `getCalendarList()` 추가 + `calendarId` 파라미터화 |
| Tasks | `tasksGetDefaultList`+`tasksListTasks(listId)` 존재 ✅ | 위젯 바인딩만 연결 |
| Drive | `listDriveFolder(folderId)` 존재 ✅ | 위젯 바인딩만 연결 |
- OAuth 스코프(`auth/calendar`·`auth/drive`·`auth/tasks`) 충분 → **스코프 변경 불필요**.
- **공유 페치 캐시 필수**: 같은 소스를 보는 위젯이 여러 개여도 API 호출은 소스ID당 1회(TTL 캐시·in-flight dedupe)로 합쳐 Google 쿼터 보호.

### 0-2. 신규 위젯 — 난이도/의존성
| 위젯 | 난이도 | 외부 의존 | 비고 |
|------|:---:|:---:|------|
| 🕐 시계 | 매우 낮음 | 없음 | `Date`+`Intl.DateTimeFormat`(세계시계 옵션) |
| 📌 스티키 메모 | 매우 낮음 | 없음 | textarea → JSON (Google 무관, 가벼운 메모) |
| ⏱ 뽀모도로 | 낮음 | 없음 | 카운트다운 + 알림 |
| 📆 D-Day | 매우 낮음 | 없음 | 목표일 D-N |
| ☀️ 날씨 | 낮음~중간 | **Open-Meteo(키 불필요)** + CSP | 위치/단위 설정 |
| 🤖 Gemini | 중간 | **본인 Gemini API 키** + CSP | OAuth로는 불가, AI Studio 무료키 필요 |

### 0-3. Gemini 위젯 — 구현 경로 & 무료 등급 사실 (2026-06 검증)

**경로 결정: AI Studio 무료 API 키 (유일하게 공식·합법·안정적).**
- ❌ **"로그인 계정의 Gemini(gemini.google.com/Workspace) 연동"은 불가** — 제3자 앱용 공식 API/스코프 없음. 비공식 우회는 ToS 위반+계정 위험(특히 교육청 관리계정) → 금지.
- ❌ Vertex AI(기업용)는 Cloud 결제+관리자 승인 필요 → 교사 개인 불가.
- ✅ **AI Studio 무료 키**: OAuth 로그인과 **독립된 별개 자격증명**.
  - ⚠️ **교육청 관리계정은 AI Studio가 차단된 경우 많음** → 키는 **개인 Gmail 계정**으로 발급 권장.
  - 대시보드 로그인(교육청 계정)=캘린더/드라이브/Tasks용, Gemini 키=별개. 서로 영향 없음.
- **설정에 "무료 키 발급 방법" 버튼** → 단계별 안내 모달(스크린샷식 설명 + `aistudio.google.com` 링크).

> ⚠️ 2025-12-07 Google이 무료 한도를 **50~80% 축소**. 아래는 현재값(수시 변동 — 발급 시 콘솔 재확인).

| 모델 | RPM | RPD(일일) | TPM | 컨텍스트 |
|------|:---:|:---:|:---:|:---:|
| Gemini 2.5 Flash-Lite | 15 | **1,000** | 250k | 100만 |
| Gemini 2.5 Flash | 10 | 250 | 250k | 100만 |
| Gemini 2.5 Pro | 5 | 100 | 250k | 100만 (**2026-04부터 유료화**) |

- **기본 모델 = Flash-Lite**(일 1,000건, 위젯 용도 충분). 사용자 모델 선택 가능.
- **TPM 250k 주의**: 컨텍스트 100만이지만 분당 25만 토큰 → "책 한 권 한 방에"는 스로틀. 현실 용도(요약/Q&A/번역/초안)는 문제없음. 초대형 입력은 청크/경고.
- 키 저장: **JSON 평문**(로컬 본인 파일). 내보내기 시 체크박스로 포함/제외.

### 0-4. Gemini 위젯 — 기능 스펙 (확정)
- **응답: 스트리밍**(`streamGenerateContent`, SSE) — 토큰 단위 실시간 출력.
- **대화 저장: 통합 JSON**(`geminiChats[]`). ※ 비대해지면 후속에 별도 파일 분리 가능(설계상 열어둠).
- **새 대화 / 대화 목록·기록**: API 무상태 → 클라이언트가 전체 맥락 누적 전송, 대화는 로컬 저장. 목록 클릭 로드, 제목 자동 생성.
- **파일 첨부 (코어 + DOCX/XLSX, HWP 제외)**:
  | 형식 | 방식 | 난이도 |
  |------|------|:---:|
  | 이미지/PDF/텍스트 | 인라인 base64 (Gemini 네이티브) | 낮음 |
  | 대용량(>20MB) | Files API 업로드→URI 참조 | 중간 |
  | DOCX | mammoth.js 텍스트 추출 | 중간 |
  | XLSX | SheetJS 셀 추출 | 중간 |
  | HWP/HWPX | **이번 범위 제외**(향후 별도 과제) | — |
  - Tauri `plugin-dialog`로 선택 → `plugin-fs` 읽기 → base64/추출 → 요청 part.
- **에러 처리**: 키 없음→안내+발급버튼, 429(쿼터)→친절 메시지, 네트워크 실패→폴백 토스트.

---

## 1. 아키텍처 (엔진/렌더/스토어 3계층 분리)

```
┌─ src/layout-engine.js  (순수 ES 모듈 · DOM/async/Date/random 금지) ─┐ ← 골든셋 TDD
│  GRID_COLS = 12                                                      │
│  collides(a,b) · getCollisions(layout,item)                          │  배열 in → 배열 out
│  moveElement(layout,item,x,y) · resizeElement(layout,item,w,h)       │  결정론적 → 객관 게이팅
│  compactVertical(layout) · resolveCollisionsCascade(layout,moved)    │  (react-grid-layout 미러)
│  pixelToCell(px,py,cell,gap) · clampToBounds(item)                   │
└──────────────────────────────────────────────────────────────────────┘
              ↑ 호출만 (단방향 의존)
┌─ src/widget-grid.js  (DOM·PointerEvents·렌더) ──────────────────────┐
│  renderGrid(layout) — transform 배치 · enter/exitEditMode()          │
│  drag/resize: pointerdown→setPointerCapture→rAF throttle→pointerup    │
│  드래그 중 고스트 미리보기(엔진 호출) · 커밋은 pointerup 1회          │
│  ResizeObserver(위젯별) → 내부 반응형 재렌더                          │
└──────────────────────────────────────────────────────────────────────┘
              ↑
┌─ src/store.js  (통합 JSON 영속화) ──────────────────────────────────┐
│  loadState()/saveState() — Tauri fs, 디바운스, 원자적 쓰기(temp→rename)│
│  롤링 백업 N개 · 스키마 version 체크 · migrateFromLocalStorage(1회·멱등)│
│  exportState({includeKeys}) / importState(file) — version 호환 처리   │
└──────────────────────────────────────────────────────────────────────┘
              ↑
┌─ src/google-cache.js  (공유 페치 캐시) ─────────────────────────────┐
│  소스ID 키 TTL 캐시 + in-flight dedupe → 동일 소스 위젯 N개도 호출 1회 │
└──────────────────────────────────────────────────────────────────────┘
```

**통합 JSON 스키마:**
```jsonc
{
  "schema": 3,                          // 버전. import 시 호환 판정
  "grid": { "cols": 12 },
  "widgets": [
    { "id":"cal-1","type":"calendar","x":0,"y":0,"w":4,"h":4,"minW":4,"minH":4,
      "title":"내 캘린더","source":{"calendarId":"primary"} },
    { "id":"cal-2","type":"calendar","x":4,"y":0,"w":4,"h":4,"minW":4,"minH":4,
      "title":"업무","source":{"calendarId":"...@group.calendar.google.com"} },
    { "id":"wk-1","type":"drive","x":8,"y":0,"w":3,"h":3,"minW":3,"minH":3,
      "title":"주간","source":{"folderId":"..."} },
    { "id":"memo-1","type":"todo","x":0,"y":4,"w":3,"h":4,"minW":3,"minH":3,
      "source":{"taskListId":"..."} },
    { "id":"note-1","type":"sticky","x":3,"y":4,"w":2,"h":2,"text":"..." },
    { "id":"clock-1","type":"clock","x":5,"y":4,"w":2,"h":2,"config":{"tz":"Asia/Seoul"} },
    { "id":"pomo-1","type":"pomodoro","x":7,"y":4,"w":2,"h":2 },
    { "id":"dday-1","type":"dday","x":9,"y":4,"w":2,"h":2,"config":{"date":"2026-12-31","label":"마감"} },
    { "id":"wx-1","type":"weather","x":0,"y":8,"w":3,"h":2,"config":{"loc":"Seoul","unit":"c"} },
    { "id":"ai-1","type":"gemini","x":3,"y":8,"w":4,"h":4,"config":{"model":"gemini-2.5-flash-lite"} },
    { "id":"cat-1","type":"category","x":7,"y":8,"w":2,"h":3,"color":"#ffb3b3","icon":"📚","items":[] }
  ],
  "memos": { },                          // 기존 localStorage 이전분
  "settings": { "scale":100,"setupDone":true },
  "secrets": { "geminiApiKey":"...","weatherApiKey":"..." }  // 내보내기 시 옵션 제외
}
```

---

## 2. 작업 목록 (Phase)

- [ ] **단계 1** — JS 테스트 게이트 구축: `static_check.py`에 `node --test` 게이팅 추가 + 골든셋 하니스 뼈대
- [ ] **단계 2** — `layout-engine.js` 순수 엔진 구현 + 골든셋 100% PASS
- [ ] **단계 3** — `store.js` 통합 JSON(원자적 쓰기·백업) + localStorage 마이그레이션 (무손실)
- [ ] **단계 4** — `widget-grid.js` 정적 렌더: 기존 4종을 그리드 좌표로 표시 (편집 OFF, 기능 유지)
- [ ] **단계 5** — 편집 모드 + 드래그 이동 (PointerEvents, moveElement+cascade)
- [ ] **단계 6** — 리사이즈 핸들 + 스냅 + 착지 미리보기
- [ ] **단계 7** — 위젯 내부 반응형 (ResizeObserver)
- [ ] **단계 8** — google-api 다중 캘린더(`getCalendarList`+`calendarId`) + `google-cache.js` 공유 캐시
- [ ] **단계 9** — 위젯 추가/삭제(다중 인스턴스) + 데이터 소스 바인딩 UI
- [ ] **단계 10** — 신규 로컬 위젯 4종 (시계 · 스티키 · 뽀모도로 · D-Day)
- [ ] **단계 11** — 날씨 위젯 (API 키 설정 + CSP/capabilities + 캐시)
- [ ] **단계 12** — Gemini 위젯 (API 키 + CSP + 채팅 UI + 모델 선택)
- [ ] **단계 13** — 내보내기/가져오기 UI (키 포함 체크박스 · version 호환)
- [ ] **단계 14** — UI.md 미적 마감 (편집 모드 · 탄성 reflow · prefers-reduced-motion)
- [ ] **단계 15** — 전체 회귀 + 빌드 게이트 + 체크포인트

---

## 3. 단계별 상세 + DoD

### 단계 1 — JS 테스트 게이트 + 골든셋 하니스 ★선행 인프라
- `static_check.py`에 `check_node_test()` 추가: `*.test.mjs`/`*.test.js` 존재 시 `node --test` 실행, 실패면 차단(Node ≥18 내장 러너, 무의존). (검증: 이 PC node v24 존재)
- **[개선②] node 부재 = BLOCK**: JS 테스트 파일이 있는데 node가 PATH에 없으면 WARN이 아니라 **FAIL**(안전망 무음 무력화 방지).
- `src/layout-engine.test.mjs` 골든셋 뼈대 + 최소 케이스 작성.
- **DoD:** `python scripts/static_check.py`가 JS 테스트를 실제 실행·게이팅. node 부재 시 차단. 골든셋 25+ 케이스 정의(RED 허용).

### 단계 2 — 순수 레이아웃 엔진
- DOM/async/Date/random 일절 없음. 입력 레이아웃 → 출력 레이아웃. react-grid-layout의 `compact`+`moveElement`+cascade 충돌해소 미러.
- **DoD:** 골든셋 **100% PASS**. 겹침 없는 레이아웃은 그대로 반환(정상부 오탐 0).

### 단계 3 — 통합 JSON 영속화 + 마이그레이션
- **[개선③] 선행 필수 — localStorage 키 전수조사**: 코드 grep으로 `localStorage.setItem/getItem` 모두 수집해 **키 매핑표** 작성(카테고리 CATS·메모·할일·Weekly 제목·Tasks 목록선택·Drive nav·배율·setupDone 등 누락 0 확인). ⚠️ **OAuth 토큰은 keyring(`token_secure.rs`)에 있으므로 JSON으로 이동 금지.**
- Tauri fs: `mkdir(appDataDir())` 선행 → `writeTextFile(..., { baseDir: BaseDirectory.AppData })`. **원자적 쓰기**(temp 작성 후 rename), 롤링 백업 N개.
- 최초 1회 localStorage→JSON 이전, `_migrated` 플래그+백업 보존, **멱등**. 한 릴리스는 localStorage 읽기 폴백 유지.
- **[개선④] 마이그레이션 골든 테스트**: `store-migration.test.mjs` — localStorage 스냅샷(입력) → 기대 JSON(정답표) 케이스. 순수 변환 함수로 분리해 node --test 게이팅.
- **[개선⑤] 기본 레이아웃 시딩**: 마이그레이션 시 기존 항목에 x/y/w/h가 없으므로 **결정론적 auto-pack**으로 초기 배치(엔진 compact 재사용). 신규 사용자용 기본 레이아웃도 정의.
- capabilities `main.json`에 fs scope(앱 데이터 경로 glob) 추가.
- **DoD:** 키 매핑표상 전 항목 무손실 이전(누락 0), 재시작 후 동일 복원, 쓰기 중 강제종료에도 비손상(원자성), 마이그레이션 골든 테스트 PASS, 초기 배치 깨짐 없음.

### 단계 4 — 정적 그리드 렌더 (편집 OFF) ★회귀 표면 최대
- 기존 달력/Weekly/메모/카테고리 DOM을 위젯 컨테이너로 감싸 그리드 좌표(transform) 배치. **편집 불가·보기만.** 세로 오버플로 = 스크롤.
- **[개선⑦] feature flag `USE_WIDGET_GRID`**: 켜면 신 그리드, 끄면 기존 고정 레이아웃 → 단계 4~14 내내 롤백 가능(스트랭글러 패턴). 단계 15에서 구 레이아웃 제거.
- **DoD:** 회귀 0 — 드롭/링크열기/리네임/드라이브/캘린더/Tasks/캡처/멀티모니터/배율 전부 정상. flag OFF 시 기존과 100% 동일.

### 단계 5 — 편집 모드 + 드래그 이동
- 툴바 "편집" 버튼 진입(데스크탑이므로 버튼이 주, 길게누르기는 보조). PointerEvents+setPointerCapture, rAF 스로틀, 드래그 중 transform만, 커밋은 pointerup 1회 → `moveElement`+cascade.
- **[개선⑥] 편집 중 콘텐츠 폴링 일시정지**: 편집 모드 동안 Google 캘린더/Drive/Tasks 백그라운드 갱신·재렌더 중단(드래그와 충돌 방지), 편집 종료 시 재개.
- **DoD:** 다른 위젯 위로 끌면 밀어내기 정상. 종료 시 JSON 저장. 일반 모드 이동 불가(오조작 0). 편집 중 백그라운드 갱신으로 인한 깜빡임/충돌 0.

### 단계 6 — 리사이즈 + 스냅 + 미리보기
- 우하단 핸들 → `resizeElement`(minW/minH 클램프)+cascade. 착지 고스트 미리보기.
- **DoD:** min 이하로 안 줄어듦. 키우면 충돌 위젯 밀림. 스냅 정확.

### 단계 7 — 위젯 내부 반응형
- 위젯별 ResizeObserver. 카테고리 아이콘 `auto-fill` 열수/크기, 달력/메모 폰트·여백 단계. 11px 미만 금지(UI.md).
- **DoD:** 키우면 아이콘 크게/다열, 줄이면 컴팩트. 깨짐 없음.

### 단계 8 — 다중 캘린더 API + 공유 캐시
- `getCalendarList()` 추가, 캘린더 함수 `calendarId` 파라미터화(기본 `primary`). `google-cache.js`로 소스ID당 호출 1회(TTL+dedupe).
- **DoD:** 회귀 0(미지정 시 primary 동일). 같은 캘린더 위젯 N개여도 네트워크 호출 1회.

### 단계 9 — 위젯 추가/삭제 + 소스 바인딩
- 편집 모드 "+위젯" → 타입 선택 → 빈 격자 자동 배치(같은 타입 다수 허용). 설정 팝업에서 소스 선택(캘린더/Tasks목록/Drive폴더)+제목. 삭제(확인 다이얼로그).
- **DoD:** 달력 2개가 서로 다른 캘린더 동시 표시. 추가/삭제 후 컴팩트+JSON 반영. source 재시작 유지.

### 단계 10 — 신규 로컬 위젯 4종
- 🕐 시계(타임존 옵션) · 📌 스티키메모(JSON 저장) · ⏱ 뽀모도로(알림) · 📆 D-Day.
- **DoD:** 각 위젯 추가·동작·크기조절·JSON 영속 정상. 11px 규칙 준수.

### 단계 11 — 날씨 위젯 (Open-Meteo, 키 불필요)
- **[개선⑧] Open-Meteo** 사용 → **API 키·secrets 분기 없음**. CSP `connect-src`에 `api.open-meteo.com`(+지오코딩 `geocoding-api.open-meteo.com`) 추가. 캐시(분 단위 TTL). 위치 검색/단위(℃/℉) 설정.
- **DoD:** 위치 설정 후 현재 날씨·간단 예보 표시. 네트워크 실패 시 폴백 토스트. CSP 반영돼 호출 성공.

### 단계 12 — Gemini 위젯 (코어 + DOCX/XLSX)
- **인증/설정**: API 키 입력(JSON 저장) + "무료 키 발급 방법" 안내 모달 버튼(AI Studio 링크, 교육청 계정→개인계정 안내). CSP `connect-src`에 `generativelanguage.googleapis.com` 추가.
- **채팅**: 스트리밍(`streamGenerateContent`) 말풍선, 새 대화, 대화 목록/기록(통합 JSON `geminiChats[]`), 제목 자동 생성, 모델 선택(기본 Flash-Lite).
- **첨부**: 이미지·PDF·텍스트 인라인 base64 + 대용량 Files API + DOCX(mammoth.js)/XLSX(SheetJS) 추출. HWP 제외.
- **반응형**: 작을 때 간단 입력창, 키우면 목록+첨부+말풍선 풀 UI(단계 7 연동).
- **DoD:** 키 입력 후 스트리밍 응답 정상. 새대화/목록 로드/모델 전환 동작. 이미지·PDF·DOCX·XLSX 첨부가 응답에 반영. 키 없으면 발급 안내. 429 친절 처리. CSP 변경 반영돼 런타임 호출 성공.

### 단계 12b — (옵션·향후) HWP/HWPX 첨부
- 본 범위 제외. 추후 HWPX(zip+xml) 우선, HWP 바이너리는 외부 변환기 감지 폴백으로 별도 진행.

### 단계 13 — 내보내기/가져오기
- `exportState({includeKeys})` — dialog 저장 + "API 키 포함"(기본 ON) 체크박스. `importState` — version 호환·스키마 검증·미래버전 거부.
- 진입점: ⚙ 설정 + 편집 툴바 양쪽.
- **DoD:** 키 포함 내보내기→다른 PC 가져오기 시 키까지 완전 복원(재입력 0). 키 제외 내보내기는 안전 공유. 잘못된 파일 거부+토스트.

### 단계 14 — UI.md 미적 마감
- 편집 모드 시각 구분, 핸들 글래스, reflow `transform`+`--ease-liquid`. `prefers-reduced-motion` 존중.
- **DoD:** reflow 부드러움. 편집/일반 모드 명확 구분. UI.md 토큰 준수.

### 단계 15 — 회귀 + 빌드
- 전체 기능 점검 + `tauri build` 게이트 + exe 스모크.
- **DoD:** 회귀 0. 빌드 성공. 체크포인트 커밋.

---

## 4. 핵심 리스크 & 방어

| 리스크 | 방어 |
|--------|------|
| reflow 버그 | 골든셋 TDD(단계1·2) + **JS 게이트 실제 실행**(단계1 인프라) |
| JSON 쓰기 중 크래시 → 손상 | 원자적 쓰기(temp→rename) + 롤링 백업 |
| 기존 데이터 손실 | 마이그레이션 멱등+백업+무손실 DoD, localStorage 1릴리스 폴백 |
| 기존 기능 회귀 | 단계4 "편집 OFF·기능 유지" 먼저 통과 후 점진 확장 |
| Google 쿼터 초과 | 공유 페치 캐시(소스ID당 1회) |
| Gemini/날씨 런타임 무음 실패 | CSP+capabilities 변경을 각 단계 DoD 체크리스트에 명시 |
| 배율·멀티모니터 깨짐 | 기존 `getViewport`/scale/`snapToCurrentMonitor` 재사용, px↔cell 반영 |
| 키 유출(백업 공유) | 내보내기 "키 포함" 체크박스(기본 ON, 공유 시 OFF) |
| node 부재 → 게이트 무음 무력화 | 단계1: JS 테스트 있는데 node 없으면 BLOCK |
| 마이그레이션 데이터 손실 | 키 전수조사 매핑표 + 마이그레이션 골든 테스트 |
| 단계4 레이아웃 전환 회귀 | feature flag `USE_WIDGET_GRID`로 즉시 롤백 |
| 편집 중 폴링 충돌 | 편집 모드 동안 콘텐츠 갱신 일시정지 |

---

## 5. 변경/신규 파일

| 파일 | 구분 | 내용 |
|------|------|------|
| `src/layout-engine.js` | 신규 | 순수 그리드 엔진 |
| `src/layout-engine.test.mjs` | 신규 | 골든셋 테스트(node --test) |
| `src/widget-grid.js` | 신규 | DOM 렌더·편집·PointerEvents |
| `src/store.js` | 신규 | 통합 JSON·원자적 쓰기·마이그레이션(순수함수)·시딩·내보내기/가져오기 |
| `src/store-migration.test.mjs` | 신규 | 마이그레이션 골든 테스트(node --test) |
| `src/google-cache.js` | 신규 | 공유 페치 캐시 |
| `src/google-api.js` | 수정 | `getCalendarList()` + 캘린더 `calendarId` 파라미터화 |
| `src/index.html` | 수정 | 컨테이너 위젯화·모듈 연결·편집 툴바·위젯 설정 팝업·신규 위젯 마크업 |
| `scripts/static_check.py` | 수정 | `node --test` 게이트 추가 |
| `src/gemini.js` | 신규 | Gemini API(스트리밍·첨부·대화관리) + 키 발급 안내 모달 |
| `src-tauri/tauri.conf.json` | 수정 | CSP `connect-src`에 Gemini·날씨 도메인 |
| `src-tauri/capabilities/main.json` | 수정 | fs scope(앱 데이터) + 신규 네트워크 권한 |
| `package.json` | 수정 | DOCX 추출 `mammoth`, XLSX 추출 `xlsx`(SheetJS) 의존성 |

---

## 6. 파이프라인 게이팅 계약 (이 프로젝트 특화)
- 1차(static_check): `cargo check`(Rust) + **`node --test`(JS 골든셋, 단계1에서 추가, node 부재 시 BLOCK)** + ruff/bandit(있으면).
- 2차(Ollama QA): `git diff HEAD` 기반.
- 단계 PASS → 자동 git 체크포인트.
- **객관 게이팅의 심장 = layout-engine 골든셋 + 마이그레이션 골든셋.** 둘 다 순수 함수라 결정론적 정답표로 reflow 정확도·데이터 무손실을 매 단계 수치 검증.

### 6-1. 단계별 난이도/위험 태그 (사람이 주시할 구간)
| 단계 | 크기 | 위험 |
|------|:---:|:---:|
| 2 엔진 | 중 | 중(골든셋이 방어) |
| 3 마이그레이션 | 중 | **높음(데이터 손실)** |
| 4 그리드 전환 | **큼** | **높음(회귀)** — flag로 완화 |
| 9 위젯추가+바인딩 | 큼 | 중 |
| 12 Gemini | **큼(미니프로젝트)** | 중 — 필요시 수동 개입 대비 |

---

## 9. 시니어 리뷰 반영 사항 (초안 → 최종 델타)
실리콘밸리/베테랑 시니어 관점 + 2026-06 플랫폼 사실 검증으로 초안에서 보강한 항목:

1. **[치명] JS 테스트가 게이트에서 안 돌던 문제** — `static_check.py`는 pytest/cargo/tsc만 실행. 골든셋(JS)이 게이팅 안 됨 → 단계 1에서 `node --test` 게이트를 **선행 인프라로 추가**. 이게 없으면 TDD 전략 전체가 허상.
2. **[사실정정] Gemini 무료 한도** — 2025-12-07 50~80% 축소. 정확값(Flash-Lite 1,000 RPD, TPM 250k, Pro 2026-04 유료화) 반영. 기본 모델 Flash-Lite로. "책 한 권 한 방에"는 TPM 스로틀 → 현실 기대치로 조정.
3. **[데이터 안전] 원자적 쓰기** — 단일 거대 JSON을 매번 덮어쓰다 크래시 시 손상. temp→rename + 롤링 백업.
4. **[쿼터] 공유 페치 캐시** — 같은 캘린더/폴더 보는 위젯 N개가 API를 N배 호출 → 소스ID당 1회 캐시·dedupe(`google-cache.js`).
5. **[입력] PointerEvents+setPointerCapture** — mouse 이벤트 핸드롤 그리드의 고질적 버그(드래그 중 포커스 이탈) 회피. rAF 스로틀, 커밋은 pointerup 1회.
6. **[런타임 무음실패] CSP+capabilities** — Gemini/날씨 도메인 누락 시 조용히 실패. 각 단계 DoD에 변경 체크리스트 명시.
7. **[엔진 순수성] Date/random/DOM 금지** — 엔진 내 비결정성 제거해야 골든셋이 결정론적.
8. **[호환성] 스키마 version + import 방어** — 미래버전 파일 거부/마이그레이션, 알 수 없는 필드에 무crash.
9. **[Tauri 사실] fs 디렉터리 미자동생성** — `mkdir(appDataDir())` 선행 필수, `baseDir: BaseDirectory.AppData`.
10. **[접근성/성능] prefers-reduced-motion** 존중 + 드래그 중 전체 재렌더 금지(transform/미리보기만).

> 참고 출처: ai.google.dev/gemini-api(rate-limits·pricing), v2.tauri.app/plugin/file-system, tauri-apps GitHub discussions #11279 / issues #1969.

### 9-2. 2차 시니어 검토 반영 (opus 높음 패스)
11. **[치명·기하] 정사각+12컬럼+무스크롤 모순** → **세로 스크롤 허용**으로 해소(고정 무스크롤 폐기). iOS 컨트롤센터와 동일.
12. **[치명·게이트] node 부재 무음 무력화** → 단계1에서 node 없으면 **BLOCK**(WARN 아님).
13. **[치명·데이터] localStorage 키 누락** → 단계3 선행 **키 전수조사 매핑표**(Weekly제목·Tasks선택·Drive nav·배율 등). OAuth 토큰은 keyring 유지(JSON 이동 금지).
14. **[높음·검증] 마이그레이션 무테스트** → 마이그레이션도 순수함수+**골든 테스트**로 게이팅.
15. **[높음·UX] 초기 배치 미정의** → 결정론적 **auto-pack 시딩**(마이그레이션·신규 사용자).
16. **[높음·충돌] 편집 중 폴링** → 편집 모드 동안 콘텐츠 갱신 일시정지.
17. **[중간·안전] 단계4 롤백 부재** → **feature flag `USE_WIDGET_GRID`**(스트랭글러).
18. **[중간·단순화] 날씨 키 관리** → **Open-Meteo(키 불필요)**로 secrets 분기 제거.

> 2차 검토 검증: node v24 확인 · Open-Meteo 무키 확인.
