# 5_RESULT — 단계 5: [개선-4] 카테고리 아이템 제목 더블클릭 수정 진입

## §0 요약

마스터플랜 **단계 5 / 개선-4** 완료: `makeRow()`의 `.item-lbl` **더블클릭** → `_ctxCat`/`_ctxItem` 설정 → `showRenamePopup`. `row.onclick`은 **250ms 디바운스**로 더블클릭 시 `openPath` 이중 호출 방지. 우클릭 「이름 수정」·`confirmRename` **미변경**. `static_check` **PASS (exit 0)**.

## §1 변경된 파일 목록

- `src/index.html` — 수정 (`makeRow` dblclick·클릭 디바운스)
- `MDs/5_RESULT.md` — 신규 (본 문서, draft 완성 후 rename)

## §2 핵심 로직

- **dblclick:** `row.querySelector('.item-lbl')` — `preventDefault`·`stopPropagation`, `_ctxCat`/`_ctxItem` 할당, `showRenamePopup(e.clientX, e.clientY)`.
- **click 디바운스:** `row.onclick` → 250ms `setTimeout` 후 `openPath`; dblclick 시 타이머 `clearTimeout`으로 단일 클릭 열기 취소.
- **재사용:** `showRenamePopup`, `closeRenamePopup`, `confirmRename`, `initCtxHandlers` btnRename 경로 **그대로**.
- **HEAD(검증 시점):** `cf32d619e648e5a67d0170e76d942d4c9cf5d646` (`cf32d61 [auto-checkpoint] phase 4 passed`).

## §3 DoD 충족 근거

| 항목 | 결과 |
|------|------|
| **N1** | 충족 — `python3 scripts/static_check.py` → exit **0**, `RESULT: PASS` |
| **N2** | 충족 — `.item-lbl` `dblclick` → `_ctxCat`/`_ctxItem` + `showRenamePopup` |
| **N3** | 충족(코드) — `confirmRename`·`buildCatPanels` 재사용. **수동 N1·N2** 권장 |
| **N4** | 충족(코드) — `closeRenamePopup` 미변경. **수동 N3** 권장 |
| **N5** | 충족 — 250ms 디바운스 + dblclick 시 타이머 해제. **수동 N4** 권장 |
| **N6** | 충족(코드) — `showCtx`·btnRename 미변경. **수동 N5·N6** 권장 |
| **N7** | 충족(코드) — drag/drop·링크 폼·BUG-1·BUG-2 코드 미변경. **수동 N7~N9** 권장 |
| **N8** | 충족 — `confirmRename`/`closeRenamePopup` 본문 미변경 |
| **N9** | 충족 — HEAD `cf32d61` |
| **N10** | 충족 — 본 `MDs/5_RESULT.md` |
| **N11** | 충족 — §0 단계 5 / 개선-4 완료 |

**빌드/정적 게이트:** `python scripts/static_check.py` → **PASS (exit 0)**

**회귀 검증:** `makeRow` 클릭·라벨 dblclick만 변경 — rename 저장·우클릭·드래그·링크·파일 드롭·스냅 로직 미변경.

## §4 실행/테스트 방법

```powershell
cd C:\AI\AiCoding\Dashboard
python scripts\static_check.py
npm run tauri:dev
```

**static_check:** cargo WARN, py-syntax/ruff/bandit/mypy PASS, `EXIT=0`.

**수동 N1~N10:** 라벨 더블클릭 rename(N1~N3)·단일 클릭 열기(N4)·우클릭 메뉴(N5~N6)·드래그·링크·드롭·스냅(N7~N9).

## §5 정적 검증 결과

**PASS** — 종료 코드 **0**.

## §6 검수 포인트

- **디바운스 250ms:** 단일 클릭 열기에 최대 250ms 지연 — UX 트레이드오프(의도적).
- **라벨만 dblclick:** 아이콘·태그 클릭은 기존 `row.onclick`(열기)만 적용.
- **drive 패널 `db-lbl` dblclick(L5653):** 별도 브라우저 행 — 본 단계 범위 외.
- **미해결:** 개선 6~7(UI.md, 아이콘) — 단계 6 이후.
