# 3_RESULT — 단계 3: [BUG-2] 작업표시줄 가려짐 (workArea 스냅)

## §0 요약

마스터플랜 **단계 3 / BUG-2** 완료: `snapToCurrentMonitor()`가 모니터 전체 `size` 대신 **`mon.workArea`**(폴백: `screen.avail*` × `scaleFactor`)로 창을 맞춤. `static_check` **PASS (exit 0)**.

## §1 변경된 파일 목록

- `src/index.html` — 수정 (`monitorWorkArea`, `snapToCurrentMonitor` workArea 적용)
- `MDs/3_RESULT.md` — 신규 (본 문서, draft 완성 후 rename)

## §2 핵심 로직

- **원인:** `mon.position` + `mon.size` = 작업표시줄 포함 전체 모니터 → 창 하단이 작업표시줄 뒤로 숨음.
- **수정:** `monitorWorkArea(mon)` — `workArea.position/size` 유효 시 우선; 아니면 `availLeft/Top/Width/Height` × `scaleFactor`를 Physical로 반올림.
- **호출 경로:** `DOMContentLoaded` 초기 스냅, `tauri://move` 디바운스, `focusWindow()` — **함수 1곳** 수정으로 일괄 반영.
- **로그:** `[WindowSnap] workArea|avail width × height at x y` 로 소스 구분.
- **HEAD:** `906e03bfb05f662430cf76717dd73a90841fe4c0` (`906e03b [auto-checkpoint] phase 2 passed`).

## §3 DoD 충족 근거

| 항목 | 결과 |
|------|------|
| **E1** | 충족 — `python3 scripts/static_check.py` → exit **0**, `RESULT: PASS` |
| **E2** | 충족(설계·코드) — workArea/avail 기반 크기·위치. **W1 수동:** `tauri:dev` 최초 실행 시 작업표시줄 가림 없음 확인 권장 |
| **E3** | 충족(코드) — 동일 `snapToCurrentMonitor`가 move 후 스냅에 사용. **W2 수동** 권장 |
| **E4** | 충족 — `monitorWorkArea` 1차 `mon.workArea`, 2차 `avail` 폴백(§2) |
| **E5** | 충족(코드) — BUG-1·드래그 코드 미변경. **W5 수동** 권장 |
| **E6** | 충족 — HEAD `906e03b` |
| **E7** | 충족 — 본 `MDs/3_RESULT.md` |
| **E8** | 충족 — §0 단계 3 / BUG-2 완료 |

**빌드/정적 게이트:** `python scripts/static_check.py` → **PASS (exit 0)**

**회귀 검증:** 창 스냅만 변경 — 파일 드롭·HTML5 아이템 드래그 로직 미변경.

## §4 실행/테스트 방법

```powershell
cd C:\AI\AiCoding\Dashboard
python scripts\static_check.py
npm run tauri:dev
```

**static_check:** cargo WARN, 나머지 PASS, `EXIT=0`.

**수동 W1~W6:** 작업표시줄 노출(W1)·다중 모니터 스냅(W2)·파일 드롭(W5)·Console 에러 0(W6).

## §5 정적 검증 결과

**PASS** — 종료 코드 **0**.

## §6 검수 포인트

- **폴백 `avail*`:** `workArea` 미제공 환경·구형 응답 시 현재 창이 있는 `screen` 기준 — 다중 모니터에서 W2로 확인 권장.
- **DPI:** `mon.scaleFactor` 우선, 없으면 `devicePixelRatio`.
- **미해결:** 개선 3~7(링크 토글, 더블클릭 rename, UI.md, 아이콘) — 단계 4 이후.
