# 4_RESULT — 단계 4: [개선-3] 링크 추가 토글 버튼 제거 (인라인 폼 항상 표시)

## §0 요약

마스터플랜 **단계 4 / 개선-3** 완료: `🔗 링크 추가` 토글 버튼(`lb`) 제거, 카테고리 패널마다 `link-input-row` **항상 표시**. `취소`/Esc는 입력 초기화, `✓ 추가` 후 `buildCatPanels()`로 폼 유지·필드 비움. `static_check` **PASS (exit 0)**.

## §1 변경된 파일 목록

- `src/index.html` — 수정 (`buildCatPanels` 링크 폼 블록, `.cp-drop-btns` CSS)
- `MDs/4_RESULT.md` — 신규 (본 문서, draft 완성 후 rename)

## §2 핵심 로직

- **제거:** `lb` 버튼·`onclick` 토글·`acts.querySelector` 중복 분기·`row.remove()`(성공/취소/Esc).
- **항상 표시:** `buildCatPanels()` 루프에서 `acts`에 `link-input-row`를 패널마다 즉시 append.
- **`clearLinkInputs()`:** `취소`·Esc → 제목/URL 비우고 `titleInp.focus()` (폼 DOM 유지).
- **`submitLink()`:** URL 정규화·hostname `lbl` 폴백·`cat.items.push` **기존과 동일** → `buildCatPanels()`(내부 `saveState` 포함).
- **포커스:** 패널 빌드 시 자동 focus **생략** (다중 패널 포커스 스틸 방지).
- **CSS:** `.cp-drop-btns` → `flex-direction: column` (버튼 행 제거 후 레이아웃).
- **HEAD(검증 시점):** `1757e11dc03c037bb8c27cc3ac2e2bcc370242ce` (`1757e11 [auto-checkpoint] phase 3 passed`).

## §3 DoD 충족 근거

| 항목 | 결과 |
|------|------|
| **G1** | 충족 — `python3 scripts/static_check.py` → exit **0**, `RESULT: PASS` |
| **G2** | 충족 — `lb`·토글 `onclick` 코드 제거 |
| **G3** | 충족 — non-drive 패널 `acts`에 `link-input-row` 항상 렌더 |
| **G4** | 충족(코드) — `submitLink`·hostname `lbl`·`buildCatPanels` 유지. **L2·L3 수동** 권장 |
| **G5** | 충족 — `clearLinkInputs`·Esc `preventDefault` |
| **G6** | 충족(코드) — 아이템 행·`openPath` 미변경. **L5 수동** 권장 |
| **G7** | 충족(코드) — BUG-1 drag-drop·BUG-2 `snapToCurrentMonitor`·`_dragSrc` 분기 미변경. **L6 수동** 권장 |
| **G8** | 충족 — HEAD `1757e11` |
| **G9** | 충족 — 본 `MDs/4_RESULT.md` |
| **G10** | 충족 — §0 단계 4 / 개선-3 완료 |

**빌드/정적 게이트:** `python scripts/static_check.py` → **PASS (exit 0)**

**회귀 검증:** 링크 UI 블록만 변경 — 파일 드롭·workArea 스냅·HTML5 아이템 드래그·우클릭 메뉴 코드 경로 미변경.

## §4 실행/테스트 방법

```powershell
cd C:\AI\AiCoding\Dashboard
python scripts\static_check.py
npm run tauri:dev
```

**static_check:** cargo WARN, py-syntax/ruff/bandit/mypy PASS, `EXIT=0`.

**수동 L1~L7:** 토글 버튼 없음·폼 항상 표시(L1)·링크 추가(L2~L3)·취소/Esc 초기화(L4)·링크 열기(L5)·파일 드롭·workArea(L6).

## §5 정적 검증 결과

**PASS** — 종료 코드 **0**.

## §6 검수 포인트

- **drive 타입 패널:** 링크 폼 없음(기존과 동일 — `buildDriveBrowser` 분기).
- **추가 후 재빌드:** `buildCatPanels()`가 전 패널 DOM을 갱신하므로 입력은 자동 초기화됨.
- **`.cp-dbtn` CSS:** 미사용 상태(레거시 유지, 범위 외 삭제 안 함).
- **미해결:** 개선 4~7(더블클릭 rename, UI.md, 아이콘) — 단계 5 이후.
