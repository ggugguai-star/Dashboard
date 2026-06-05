# 8_PROMPT — 작업 지시서 #8: 회귀 검증 + git 체크포인트 + Final.md (R&D 종료)

> **문서 유형:** AI/개발자 작업 지시서  
> **작업 번호:** 8  
> **모드:** R&D (기존 Tauri v2 앱 개선) — **마스터플랜 최종 단계**  
> **상위 문서:** [`0_MASTER_PLAN.md`](0_MASTER_PLAN.md) §「단계 8」·DoD 전체  
> **선행 완료:** [`7_RESULT.md`](7_RESULT.md) — 개선-7 PASS  
> **작성일:** 2026-06-04  
> **범위:** **기능 추가 없음** — 회귀·문서·체크포인트만. 신규 버그 수정은 **실패 재현 시 최소 diff**

---

## 1. 목표 (무엇을)

단계 2~7에서 구현한 **BUG-1·BUG-2·개선 3~7** 이 통합 상태에서 **회귀 없음**을 검증하고, `static_check` PASS를 재확인한 뒤 **`MDs/Final.md`** 로 R&D를 종료한다.

**한 문장:**  
> 마스터플랜 DoD 전항을 수동·정적으로 재검증하고 `8_RESULT` + `Final.md`([VERSION]/[RELEASE_NOTES])를 작성해 오케스트레이터 **phase 999** 종료 조건을 충족한다.

---

## 2. 이유 (왜)

| 근거 | 설명 |
|------|------|
| 마스터플랜 단계 8 | 「회귀 검증 + git 체크포인트」 — **코드 추가 단계 아님** |
| 7단계 RESULT §6 | 단계 8·`Final.md` **미완** |
| AGENTS.md | 단계마다 녹색 게이트; 최종 단계는 **전체 DoD 통합 확인** |
| 오케스트레이터 | `8_RESULT.md` PASS → `_git_checkpoint(phase 8)` · **`Final.md` 감지 → phase 999·릴리즈 파이프라인** |
| 회귀 리스크 | 7단계 아이콘·6단계 CSS·5단계 dblclick 등 **누적** — 개별 PASS만으로 통합 보장 불충분 |

**기준 커밋(참고):** `c396771` (Tauri 2.0.3 베이스라인). 실제 검증 HEAD는 RESULT·Final에 **현재 `git rev-parse HEAD`** 기록.

---

## 3. 접근 (어떻게)

### Phase A — 컨텍스트 로드 (코드 수정 전)

1. [`AGENTS.md`](../AGENTS.md) — RESULT 프로토콜·최소 변경
2. [`MDs/0_MASTER_PLAN.md`](0_MASTER_PLAN.md) — DoD 표·회귀 항목
3. [`MDs/2_RESULT.md`](2_RESULT.md) ~ [`MDs/7_RESULT.md`](7_RESULT.md) — 단계별 검증·§6 한계
4. [`agent_orchestrator.py`](../agent_orchestrator.py) — `Final.md` `[VERSION]`/`[RELEASE_NOTES]` 파싱·phase 999
5. [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) — `version` (Final `[VERSION]`용)

### Phase B — 설계 (본 단계 원칙)

| 항목 | 지침 |
|------|------|
| **기본** | **새 기능·리팩터링 금지** — 검증·문서만 |
| **코드 수정** | 회귀 **재현된 결함**만 **최소 diff** 수정 → RESULT §2·§6에 사유 |
| **static_check** | **필수** PASS (오케스트레이터 1차 게이트) |
| **git commit** | **사용자 요청 없이 커밋하지 않음** — 오케스트레이터 `[auto-checkpoint] phase 8 passed` 별도 |
| **Final.md** | 본 단계 **필수 산출물** (아래 §Phase F) |

### Phase C — 1차 정적 검증 (필수)

```powershell
cd C:\AI\AiCoding\Dashboard
python scripts/static_check.py
```

- exit **0** → PASS

### Phase D — 통합 회귀 매트릭스 (수동·필수)

```powershell
npm run tauri:dev
```

아래 **전부** 확인. 실패 시 최소 수정 후 재검.

#### D-1. BUG (단계 2~3)

| ID | 시나리오 | 기대 |
|----|----------|------|
| **R-B1** | 탐색기 **파일·폴더** → cat-panel 드롭 | `path` 포함 아이템 추가, 토스트 |
| **R-B2** | 앱 최초 실행·모니터 이동 후 스냅 | 창 하단이 **작업표시줄 위** (workArea) |

#### D-2. 개선 (단계 4~7)

| ID | 시나리오 | 기대 |
|----|----------|------|
| **R-G3** | cat-panel 하단 | 링크 폼 **항상 표시**, `🔗 링크 추가` 토글 **없음** |
| **R-G4** | 아이템 라벨 **더블클릭** | rename 팝업; 단일 클릭 **열기 1회** |
| **R-G4b** | 우클릭 → 이름 수정 | 기존 경로 동작 |
| **R-G6** | panel·item hover | 탄성 `scale(1.012)`; 주요 버튼 **보라 그라디언트** |
| **R-G7** | 아이템 우클릭 → 아이콘 변경 | icp **8탭**·검색; cep **5탭**·`__gdrive__` |

#### D-3. 마스터플랜 공통 회귀

| ID | 시나리오 | 기대 |
|----|----------|------|
| **R-C1** | 카테고리 간 **HTML5 아이템 드래그** | 이동·순서 저장 |
| **R-C2** | URL 링크 아이템 **클릭** | `openPath`/브라우저 열기 |
| **R-C3** | 우클릭 메뉴 | 열기·복사·이름·아이콘·삭제 |
| **R-C4** | Drive 타입 카테고리(있을 때) | 브라우저·아이콘 SVG |
| **R-C5** | DevTools Console | 치명적(빨간) 에러 **0건** |

### Phase E — (선택) CDP 자동 회귀

환경에 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 및 release/dev 앱 기동 가능할 때만:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
node scripts/diag-p2.mjs
```

- **PASS** 시 `8_RESULT` §4에 stdout 요약(건수)
- **미실행/SKIP** 시 사유 명시 — **8단계 DoD 필수 아님**(수동 D가 필수)

### Phase F — 산출 문서 (필수)

| 순서 | 파일 | 내용 |
|------|------|------|
| 1 | `MDs/8_RESULT_draft.md` | §0~§6 — 회귀 표·static_check·HEAD·결함(있으면) |
| 2 | `MDs/8_RESULT.md` | draft 완성 후 **rename** |
| 3 | **`MDs/Final.md`** | R&D **최종 명세** (오케스트레이터 phase 999) |

#### Final.md 필수 형식 (오케스트레이터 파싱)

```markdown
# Final — 업무 대시보드 R&D 완료

[VERSION]: v2.0.3

[RELEASE_NOTES]:
- BUG-1: Tauri drag-drop 파일·폴더 경로 드롭
- BUG-2: workArea 스냅
- 개선 3~7: (한 줄씩 요약)
- 회귀: 단계 8 통합 검증 PASS

## 단계 완료 요약
| 단계 | 결과 |
| 1 | 베이스라인 static_check |
| 2~7 | (각 RESULT §0 한 줄) |
| 8 | 회귀 + Final |

## 검증
- `python scripts/static_check.py` → PASS
- 수동: R-B1~R-C5 (8_RESULT §3 참조)

## Known issues / 한계
(각 RESULT §6 통합 — 없으면 "없음")

## Git
- HEAD: (rev-parse)
- 기준 대비: c396771 → HEAD (요약)
```

> `[VERSION]`은 `tauri.conf.json` `version`과 **일치**. 불일치 시 Final FAIL.

---

## 4. Definition of Done (검증 가능 체크리스트)

- [ ] **F1** `python scripts/static_check.py` → exit **0**
- [ ] **F2** R-B1·R-B2 회귀 **PASS** (수동)
- [ ] **F3** R-G3~R-G7·R-G4b 회귀 **PASS** (수동)
- [ ] **F4** R-C1~R-C5 회귀 **PASS** (수동)
- [ ] **F5** 마스터플랜 DoD 표(§0) **8항목** Final·8_RESULT에 **충족** 명시
- [ ] **F6** `MDs/8_RESULT.md` 존재, DoD 항목별 §3 근거
- [ ] **F7** **`MDs/Final.md`** 존재, `[VERSION]`·`[RELEASE_NOTES]` 파싱 가능
- [ ] **F8** `git rev-parse HEAD`·`git log -1 --oneline` 8_RESULT §4
- [ ] **F9** 본 단계 **신규 기능 코드 없음**(결함 수정 시 §2 예외 명시)
- [ ] **F10** 마스터플랜 「단계 8」완료 + **R&D 종료** 한 줄 §0

**빌드/정적 게이트:**  
`python scripts/static_check.py` → **PASS (exit 0)**

**회귀 검증 (R&D 필수):**  
단계 2~7 **전체 DoD**를 단계 8 매트릭스(R-B·R-G·R-C)로 **한 번에** 재확인.

---

## 5. 영향 받는 파일 / 모듈 범위

| 구분 | 경로 | 본 단계 |
|------|------|---------|
| **주요 산출** | `MDs/8_RESULT_draft.md` → `MDs/8_RESULT.md` | 필수 |
| **주요 산출** | **`MDs/Final.md`** | **필수 (phase 999)** |
| **조건부 수정** | `src/index.html` 등 | 회귀 결함 **재현 시만** 최소 수정 |
| **수정 금지** | `scripts/static_check.py`, `agent_orchestrator.py` | 유지 |
| **참조** | `MDs/1_RESULT.md`~`7_RESULT.md` | 회귀 근거 |
| **선택 실행** | `scripts/diag-p2.mjs` | CDP 환경 있을 때 |

---

## 6. static_check FAIL 시에만 허용되는 최소 수정

1. stderr **맨 끝** `blocking_failures`만 대응  
2. 회귀와 **무관한 리팩터링 금지**  
3. 수정 후 static_check·**실패했던 회귀 항목만** 재실행  
4. RESULT §1·§2·§6에 기록  

---

## 7. 작업 규칙 (위반 금지)

1. **신규 PROMPT(9단계) 작성 금지** — R&D 종료
2. **기능 개선·UI 대규모 변경 금지**
3. **`git commit`은 사용자 요청 시에만** (오케스트레이터 checkpoint 제외)
4. **placeholder·`// TODO` 금지**
5. **`8_RESULT` 완성 전 `Final.md`만 먼저 쓰지 않음** — draft→rename 후 Final 권장
6. **Final.md 없이 8단계 완료 선언 금지**

---

## 8. RESULT 문서 요구 (요약)

| 절 | 내용 |
|----|------|
| §0 | 단계 8 완료 + R&D 종료 + Final 작성 여부 |
| §1 | 변경 파일(결함 수정 시만) + `8_RESULT.md` + `Final.md` |
| §2 | 회귀 매트릭스 결과 표·결함 수정 요약 |
| §3 | DoD F1~F10 항목별 근거 |
| §4 | static_check·tauri:dev·(선택)diag·git HEAD |
| §5 | static_check PASS/FAIL |
| §6 | 미해결·SKIP·오케스트레이터 phase 999 안내 |

---

## 9. 오케스트레이터 연동 (참고)

| 이벤트 | 동작 |
|--------|------|
| `8_PROMPT.md` 감지 | 회귀·Final 지시 |
| `8_RESULT.md` PASS | 1차 static_check · 2차 QA · `_git_checkpoint` phase **8** |
| **`Final.md` 감지** | **phase 999** — (설정 시) build.bat · GitHub draft 릴리즈 |

---

## 10. 문서 이력

| 날짜 | 내용 |
|------|------|
| 2026-06-04 | 7단계 PASS 후 최종 단계(8)·Final 지시서 초안 |
