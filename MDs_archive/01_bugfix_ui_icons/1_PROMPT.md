# 1_PROMPT — 작업 지시서 #1: R&D 베이스라인 고정 (static_check)

> **문서 유형:** AI/개발자 작업 지시서  
> **작업 번호:** 1  
> **모드:** R&D (기존 Tauri v2 앱 개선)  
> **상위 문서:** [`0_MASTER_PLAN.md`](0_MASTER_PLAN.md)  
> **작성일:** 2026-06-04  
> **범위:** 마스터플랜 **단계 1** — 기능·버그 수정 **없음**, 빌드/정적 게이트 통과 상태 확인 및 기록

---

## 1. 목표 (무엇을)

현재 저장소가 **단계 2~7(버그·개선)** 에 들어가기 전에, **애플리케이션 동작을 바꾸지 않고** 1차 정적 검증 게이트(`scripts/static_check.py`)를 **PASS** 상태로 고정하고, 그 근거를 `1_RESULT`에 남긴다.

**한 문장:**  
> R&D 파이프라인의 출발점으로, `static_check` 통과와 (가능하면) Tauri dev 스모크 실행을 확인해 **베이스라인을 문서화**한다.

---

## 2. 이유 (왜)

| 근거 | 설명 |
|------|------|
| 마스터플랜 원칙 | R&D **1단계 = 베이스라인 확인** — 이후 최소·국소 변경·회귀 금지의 기준점 |
| AGENTS.md | 모든 단계 종료 시 **항상 녹색**(컴파일/1차 검증 통과) |
| 오케스트레이터 | `agent_orchestrator.py` → `STATIC_CHECK_CMD = python scripts/static_check.py` |
| 리스크 | 베이스라인 미확인 상태에서 `index.html` 수정 시, 실패 원인이 **기존 결함**인지 **신규 변경**인지 구분 불가 |

마스터플랜 기준 커밋: `c396771` (Tauri **2.0.3**).  
실제 작업 시점의 `git rev-parse HEAD`는 RESULT §2·§4에 **반드시 기록**한다(기준 커밋과 다를 수 있음).

---

## 3. 접근 (어떻게)

### Phase A — 컨텍스트 로드 (코드 수정 전)

1. [`AGENTS.md`](../AGENTS.md) — 단계·RESULT 프로토콜, Zero Placeholder
2. [`MDs/0_MASTER_PLAN.md`](0_MASTER_PLAN.md) — 작업 목록·단계 2~7 범위(본 단계에서 **착수 금지**)
3. [`scripts/static_check.py`](../scripts/static_check.py) — 차단 항목(`cargo check`, ruff, bandit 등)
4. [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) — 앱 버전 **2.0.3** 확인

### Phase B — 환경 준비

```powershell
cd C:\AI\AiCoding\Dashboard
# node_modules 없으면
npm install
# Rust 미설치 시 cargo check는 WARN — 가능하면 rustup 설치 후 재실행
```

| 조건 | 조치 |
|------|------|
| `node_modules` 없음 | `npm install` |
| `cargo` 없음 | 설치 권장; 미설치 시 static_check는 WARN·일부 SKIP — RESULT에 명시 |
| 첫 `cargo check` | `src-tauri/target` 생성으로 **수 분** 소요 가능 |

### Phase C — 1차 정적 검증 (필수)

```powershell
python scripts/static_check.py
```

- **종료 코드 0** → PASS (본 단계 핵심 DoD)
- **종료 코드 1** → FAIL: stdout/stderr **맨 끝** `blocking_failures` 요약을 RESULT에 인용하고, **차단 사유에 해당하는 최소 수정만** 허용(아래 §6)
- **종료 코드 2** → 검사기 자체 오류: 수정 없이 RESULT §3에 보고

### Phase D — 실행 스모크 (권장, 수동)

기능 변경 없이 **앱이 뜨는지**만 확인한다.

```powershell
npm run tauri:dev
```

| 확인 항목 | 기대 |
|-----------|------|
| 창 표시 | 메인 WebView 로드, 치명적 빈 화면 없음 |
| DevTools | Console **치명적(빨간) 에러 0건** (경고는 기록만) |
| 클릭 스모크 | 대시보드·설정 위저드 버튼 **1회 이상** 반응 (무반응이면 **수정하지 말고** RESULT §6 한계로 기록 → 단계 2 이전 이슈로 분류) |

> **주의:** BUG-1(파일 DnD), BUG-2(작업표시줄), 개선 3~7은 **본 단계 범위 밖**. 재현만 하고 고치지 않는다.

### Phase E — RESULT 작성

1. `MDs/1_RESULT_draft.md` 작성 (§0~§6, `result-docs` 규칙)
2. 완성 후 `MDs/1_RESULT.md`로 **rename** (처음부터 `_RESULT.md` 직접 작성 금지)
3. PASS 승인 전 **단계 2 PROMPT/구현 착수 금지**

---

## 4. Definition of Done (검증 가능 체크리스트)

- [ ] **B1** 프로젝트 루트에서 `python scripts/static_check.py` 실행 → **exit code 0**, 요약에 `✅ RESULT: PASS`
- [ ] **B2** SUMMARY에 `cargo-check: PASS` **또는** cargo 미설치로 `WARN`인 경우 — 사유·영향(단계 2 착수 가능 여부)을 §3에 명시
- [ ] **B3** `git rev-parse HEAD` 및 `git log -1 --oneline` 결과를 RESULT §4에 기록 (마스터플랜 기준 `c396771`와 비교 한 줄)
- [ ] **B4** (권장) `npm run tauri:dev`로 앱 기동 확인 — 성공/실패·Console 에러 개수를 §4에 기록
- [ ] **B5** **애플리케이션 기능 코드 미변경** — `src/index.html`, `src-tauri/src/**`, `tauri.conf.json` 등 ** diff 없음**  
  (static_check FAIL로 인한 **최소 수정**만 예외 — §6)
- [ ] **B6** `MDs/1_RESULT.md` 존재, PROMPT DoD 항목별 §3 충족 근거 기재
- [ ] **B7** 마스터플랜 작업 목록 중 **「단계 1」** 완료 근거가 RESULT §0에 한 줄로 요약됨

**빌드/정적 게이트 (마스터플랜 필수 한 줄):**  
`python scripts/static_check.py` → **PASS (exit 0)**

**회귀 검증 (R&D 필수 한 줄):**  
본 단계는 코드 미변경이 원칙이므로, **「기존 Tauri 2.0.3 빌드 가능 상태 유지」** — static_check PASS + (권장) dev 스모크에서 치명적 Console 에러 없음.

---

## 5. 영향 받는 파일 / 모듈 범위

| 구분 | 경로 | 본 단계 |
|------|------|---------|
| **읽기 전용** | `AGENTS.md`, `MDs/0_MASTER_PLAN.md`, `UI.md`, `scripts/static_check.py` | 필수 |
| **검증 대상** | `src-tauri/` (`cargo check`), 루트 `*.py`, `package.json` | 실행만 |
| **기본 변경 없음** | `src/index.html`, `src/google-api.js`, `src/token-store.js`, `src-tauri/src/**`, `tauri.conf.json` | **수정 금지** |
| **산출 문서** | `MDs/1_RESULT_draft.md` → `MDs/1_RESULT.md` | 필수 |
| **선택(실패 시만)** | `Cargo.toml`, `py` 스크립트, 설정 파일 | static_check **차단 사유**에 한정 |

---

## 6. static_check FAIL 시에만 허용되는 최소 수정

AGENTS.md §4(FAIL 최소 수정)와 동일:

1. stderr **맨 끝** `blocking_failures` 항목만 대응
2. 버그픽스·UI 개선·마스터플랜 단계 2~7 항목과 **무관한 리팩터링 금지**
3. 수정 후 **반드시** `python scripts/static_check.py` 재실행 → PASS 확인
4. 수정한 파일·이유를 RESULT §1·§2에 기록

**금지 예:** BUG-1 `tauri://file-drop`, BUG-2 `workArea`, 링크 토글 제거, UI.md 대규모 CSS 등.

---

## 7. 작업 규칙 (위반 금지)

1. **단계 2~7 구현·PROMPT 작성 착수 금지** (오케스트레이터 PASS 전)
2. **`src/index.html` 무분별 리포맷 금지**
3. **Electron `main.js` / `preload.js` 수정 금지** (레거시 참고용)
4. **Google API Rust 이전 금지**
5. **capabilities 와일드카드 확대 금지**
6. **`git commit`은 사용자 요청 시에만**
7. **placeholder(`// TODO` 등) 금지** — 검증 불가 시 RESULT에 사유 명시

---

## 8. RESULT 문서 요구 (요약)

`result-docs` 규칙 준수:

| 절 | 내용 |
|----|------|
| §0 | 베이스라인 static_check PASS 여부 한 줄 |
| §1 | 변경 파일 경로만 (없으면 「변경 없음」) |
| §2 | HEAD vs `c396771`, static_check 요약, dev 스모크 결과 2~5줄 |
| §3 | 본 PROMPT DoD B1~B7 항목별 충족 근거 |
| §4 | 실행 커맨드 + stdout/exit code 인용(전체 소스 복붙 금지) |
| §5 | static_check PASS/FAIL |
| §6 | 리뷰 포인트: cargo WARN 여부, 알려진 BUG-1/2는 **미해결·다음 단계** |

---

## 9. 다음 작업 예고 (#2)

PASS 후 [`MDs/2_PROMPT.md`](2_PROMPT.md) (별도 작성)에서:

- **단계 2** — [BUG] 파일·폴더 드래그&드롭 (`handleFileDrop` → `tauri://file-drop`)
- 마스터플랜 §「BUG-1」 및 `0_MASTER_PLAN.md` 수정 방향 참조

---

## 10. 문서 이력

| 날짜 | 내용 |
|------|------|
| 2026-06-04 | `0_MASTER_PLAN.md` R&D 단계 1 기반 지시서 초안 |
