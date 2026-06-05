# 3_PROMPT — 작업 지시서 #3: [BUG-2] 작업표시줄 가려짐 (workArea 스냅)

> **문서 유형:** AI/개발자 작업 지시서  
> **작업 번호:** 3  
> **모드:** R&D (기존 Tauri v2 앱 개선)  
> **상위 문서:** [`0_MASTER_PLAN.md`](0_MASTER_PLAN.md) §「BUG-2」  
> **선행 완료:** [`2_RESULT.md`](2_RESULT.md) — BUG-1 PASS  
> **작성일:** 2026-06-04  
> **범위:** 마스터플랜 **단계 3** — BUG-2만. 개선 3~7 **착수 금지**

---

## 1. 목표 (무엇을)

앱 창이 **작업표시줄 위 작업 영역(work area)** 에 맞게 최대화되도록 `snapToCurrentMonitor()`를 수정한다. 현재는 모니터 **전체** `size`를 쓰어 창 하단이 작업표시줄에 가려진다.

**한 문장:**  
> `plugin:window|current_monitor`의 **`workArea`**(없으면 `screen.avail*` 폴백)로 `setPosition`/`setSize`를 설정해, 시작·이동 후 스냅 시 작업표시줄을 피한다.

---

## 2. 이유 (왜)

| 근거 | 설명 |
|------|------|
| BUG-2 원인 | `src/index.html` `snapToCurrentMonitor()`(약 L3287)이 `mon.position` + `mon.size` 사용 → 작업표시줄 포함 전체 모니터 영역 |
| 2단계 RESULT §6 | BUG-2 **미해결·단계 3 대상** |
| 마스터플랜 DoD | 「앱 실행 시 창이 작업표시줄 위로 딱 맞게 표시」 |
| 호출 경로 | `DOMContentLoaded` 초기 스냅, `tauri://move` 디바운스 스냅, `focusWindow()` — **동일 함수**만 고치면 일괄 반영 |

**API 참고 (`@tauri-apps/api` `Monitor`):**

```text
workArea: { position: PhysicalPosition, size: PhysicalSize }
```

`current_monitor` invoke 결과에 `workArea`가 있으면 **우선 사용**.

---

## 3. 접근 (어떻게)

### Phase A — 컨텍스트 로드 (코드 수정 전)

1. [`AGENTS.md`](../AGENTS.md) — 최소·국소 변경
2. [`MDs/0_MASTER_PLAN.md`](0_MASTER_PLAN.md) §「BUG-2」
3. [`src/index.html`](../src/index.html) — 아래만 읽기 (리포맷 금지)
   - L3277~3324: `snapToCurrentMonitor`, 초기 스냅, `tauri://move` 리스너
   - L3044~3057: `focusWindow()` (스냅 재사용)
4. [`node_modules/@tauri-apps/api/window.d.ts`](../node_modules/@tauri-apps/api/window.d.ts) — `Monitor.workArea` 타입

### Phase B — 설계 (구현 전 결정)

| 항목 | 지침 |
|------|------|
| **1차 소스** | `mon.workArea?.position`, `mon.workArea?.size` 가 유효하면 `pos`/`size`로 사용 |
| **폴백** | `workArea` 없거나 크기 0이면 `window.screen.availLeft/Top/Width/Height`(CSS px) × `mon.scaleFactor`(또는 `devicePixelRatio`) → Physical 정수 |
| **수정 범위** | `snapToCurrentMonitor` 내부 **pos/size 결정 4~10줄**만. 별도 헬퍼 `monitorWorkArea(mon)` 추가는 **허용**(가독성) |
| **단위** | `setPosition`/`setSize`는 기존과 동일 **`type: 'Physical'`** 유지 |
| **로그** | `console.info('[WindowSnap]', …)` 에 workArea 사용 여부만 반영(선택) |
| **Rust/설정** | `src-tauri/**`, `tauri.conf.json` **변경 없이** JS만으로 해결 우선 |

### Phase C — 구현 체크리스트

1. `workArea` 우선 분기 구현
2. 폴백 분기 구현 (`avail*` × scale)
3. 기존 `if (!mon?.size) return` → workArea/폴백 모두 실패 시에만 return
4. **회귀:** `tauri://move` 400ms 디바운스·`focusWindow` 동작 유지(로직 변경 없음)

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
| **W1** 앱 **최초 실행** | 창 하단이 작업표시줄 **위**에 맞닿음(가려지지 않음). 작업표시줄 아이콘·시계 영역이 보임 |
| **W2** 창을 **다른 모니터**로 드래그 후 놓기(400ms 후 스냅) | 해당 모니터 work area에 맞게 리사이즈 |
| **W3** 작업표시줄 **위치 변경**(하단/좌/우) 후 재스냅 | 해당 모니터에서 가려짐 없음(가능한 환경에서 1회 확인) |
| **W4** 알람/QA용 `focusWindow()` 호출 시 | 스냅 후에도 work area 준수 |
| **W5** BUG-1 회귀 | 파일·폴더 드롭 1회 — 단계 2 동작 유지 |
| **W6** DevTools Console | 치명적(빨간) 에러 **0건** |

### Phase F — RESULT 작성

1. `MDs/3_RESULT_draft.md` (§0~§6)
2. 완성 후 `MDs/3_RESULT.md`로 **rename**
3. PASS 전 **단계 4 PROMPT/구현 착수 금지**

---

## 4. Definition of Done (검증 가능 체크리스트)

- [ ] **E1** `python scripts/static_check.py` → exit **0**, `RESULT: PASS`
- [ ] **E2** 최초 실행(W1) 시 창이 작업표시줄에 **가리지 않음**
- [ ] **E3** 모니터 이동 후 스냅(W2) 시 work area 적용
- [ ] **E4** `snapToCurrentMonitor`가 `mon.workArea` 우선 사용(코드·§2 근거). 폴백 경로 §6 명시
- [ ] **E5** BUG-1 파일 드롭 회귀 없음(W5)
- [ ] **E6** `git rev-parse HEAD` 및 `git log -1 --oneline`을 RESULT §4에 기록
- [ ] **E7** `MDs/3_RESULT.md` 존재, DoD E1~E7 항목별 §3 근거
- [ ] **E8** 마스터플랜 「단계 3 / BUG-2」완료 한 줄이 §0에 있음

**빌드/정적 게이트:**  
`python scripts/static_check.py` → **PASS (exit 0)**

**회귀 검증 (R&D 필수 한 줄):**  
BUG-2 수정 후 **파일 드롭(BUG-1)·카테고리 아이템 HTML5 드래그** 기존 동작 유지.

---

## 5. 영향 받는 파일 / 모듈 범위

| 구분 | 경로 | 본 단계 |
|------|------|---------|
| **주요 수정** | `src/index.html` | `snapToCurrentMonitor()` (+ 선택 `monitorWorkArea` 헬퍼) |
| **수정 금지** | `src/index.html` BUG-1·개선 3~7 관련 코드 | 범위 외 |
| **수정 금지** | `src-tauri/**`, `tauri.conf.json`, capabilities | JS 우선 |
| **수정 금지** | `agent_orchestrator.py`, `scripts/static_check.py` | 유지 |
| **수정 금지** | Electron `main.js` / `preload.js` | 레거시 |
| **산출 문서** | `MDs/3_RESULT_draft.md` → `MDs/3_RESULT.md` | 필수 |

---

## 6. static_check FAIL 시에만 허용되는 최소 수정

1. stderr **맨 끝** `blocking_failures`만 대응  
2. BUG-2·회귀와 **무관한 리팩터링 금지**  
3. 수정 후 `python scripts/static_check.py` 재실행 → PASS  
4. RESULT §1·§2에 기록  

---

## 7. 작업 규칙 (위반 금지)

1. **단계 4~7 구현·PROMPT 작성 착수 금지**
2. **`src/index.html` 무분별 리포맷·대량 CSS 변경 금지**
3. **링크 토글(lb)·아이콘 피커·UI.md 대규모 CSS 수정 금지** — 단계 4~7
4. **capabilities 와일드카드 확대 금지**
5. **`git commit`은 사용자 요청 시에만**
6. **placeholder(`// TODO`) 금지**

---

## 8. RESULT 문서 요구 (요약)

| 절 | 내용 |
|----|------|
| §0 | BUG-2 해결 여부 한 줄 |
| §1 | 변경 파일 경로만 |
| §2 | workArea vs 폴백 선택·Physical 좌표 2~5줄 |
| §3 | DoD E1~E8 항목별 충족 근거 |
| §4 | static_check·`tauri:dev` W1~W6(소스 복붙 금지) |
| §5 | static_check PASS/FAIL |
| §6 | 다중 모니터·DPI·폴백 한계, 미해결 개선 3~7 |

---

## 9. 다음 작업 예고 (#4)

PASS 후 [`MDs/4_PROMPT.md`](4_PROMPT.md) (별도 작성):

- **단계 4** — [개선] 링크 추가 토글 버튼 제거 (인라인 폼 항상 표시)

---

## 10. 문서 이력

| 날짜 | 내용 |
|------|------|
| 2026-06-04 | 2단계 PASS 후 BUG-2 지시서 초안 |
