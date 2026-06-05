# 2_RESULT — 단계 2: [BUG-1] 파일·폴더 드래그&드롭 경로 취득

## §0 요약

마스터플랜 **단계 2 / BUG-1** 완료: Tauri **`tauri://drag-drop`** 네이티브 이벤트로 OS 경로를 수신해 `addPathsToCat`으로 카테고리 아이템 추가. Electron 전용 `dataTransfer.files[].path` 의존 제거. `static_check` **PASS (exit 0)**.

## §1 변경된 파일 목록

- `src/index.html` — 수정 (`setupTauriFileDrop`, `addPathsToCat`, `catFromDropPoint`, `dataset.catIdx`, 웹 `Files` drop 분기 제거, `statPath` → `plugin:fs|stat` 보강)
- `MDs/2_RESULT.md` — 신규 (본 문서, draft 완성 후 rename)

## §2 핵심 로직

- **원인:** `handleFileDrop`이 WebView2에서 경로 없는 `File` 객체만 받아 `path` 빈 문자열 → 열기 실패.
- **수정:** `tListen('tauri://drag-drop')` — `type:'drop'` 시 `payload.paths` + `position`(Physical) → `scaleFactor`로 논리 좌표 변환 → `elementFromPoint` → `.cat-panel[data-cat-idx]` → `CATS[idx]`.
- **아이템 생성:** 경로별 `statPath`(fs `stat` 우선)로 폴더/파일 구분 → 기존 `getFileStyle`·`cat.items.push`·`buildCatPanels`·토스트 유지.
- **회귀:** HTML5 `_dragSrc`용 `body`/`cp-drop` drop·dragover는 **아이템 이동만** 유지. OS `Files`용 웹 drop 분기 제거(중복·무경로 추가 방지).
- **HEAD:** `9849dac320c59c8688c2b85e4f222e8677720401` (`9849dac [auto-checkpoint] phase 1 passed`).

## §3 DoD 충족 근거

| 항목 | 결과 |
|------|------|
| **D1** | 충족 — `python3 scripts/static_check.py` → exit **0**, `RESULT: PASS` |
| **D2** | 충족(설계·코드) — `addPathsToCat`이 `paths[]` 전체를 `item.path`에 저장. **F1 수동:** `npm run tauri:dev`에서 탐색기 파일 드롭 확인 권장 |
| **D3** | 충족(설계·코드) — `statPath` + `isDirectory`로 폴더 `📁/폴더` 태그. **F2 수동** 권장 |
| **D4** | 충족(설계·코드) — `catFromDropPoint`로 드롭 좌표 아래 패널만 대상. 미검출 시 첫 패널+토스트 |
| **D5** | 충족(코드) — `_dragSrc` 분기·`row.draggable` 미변경. **F3 수동** 권장 |
| **D6** | 충족 — HEAD `9849dac`, `git log -1` 위와 동일 |
| **D7** | 충족 — 본 `MDs/2_RESULT.md` 및 §3 |
| **D8** | 충족 — §0 단계 2 / BUG-1 완료 |

**빌드/정적 게이트:** `python scripts/static_check.py` → **PASS (exit 0)**

**회귀 검증:** `_dragSrc` HTML5 이동 로직 유지 — OS 파일은 Tauri 전용 경로로만 추가.

## §4 실행/테스트 방법

```powershell
cd C:\AI\AiCoding\Dashboard
python scripts\static_check.py
npm run tauri:dev
```

**static_check (WSL):** cargo WARN, 나머지 PASS, `EXIT=0`.

**수동 F1~F5 (`tauri:dev`):**

| ID | 확인 |
|----|------|
| F1 | `.txt`/`.pdf`를 cat body·드롭존에 드롭 → 토스트 `N개 항목 추가`, 클릭 시 열림 |
| F2 | 폴더 드롭 → `📁` / `폴더` 태그, `path` 유효 |
| F3 | 카테고리 A 아이템 → B로 드래그 이동 |
| F4 | Drive 행 드롭(연동 시) |
| F5 | Console 치명 에러 0건 |

## §5 정적 검증 결과

**PASS** — 종료 코드 **0**.

## §6 검수 포인트

- **`tauri.conf.json`:** `dragDropEnabled` 명시 변경 없음(기본 true). Windows에서 HTML5 아이템 드래그와 네이티브 드롭 충돌 시 F3 수동 확인 — 이슈 시 RESULT 후속 또는 단계 8 회귀에서 기록.
- **패널 미검출:** `CATS[0]` 폴백 + 안내 토스트 — 침묵 실패 없음.
- **미해결:** BUG-2(작업표시줄), 개선 3~7 — 단계 3 이후.
