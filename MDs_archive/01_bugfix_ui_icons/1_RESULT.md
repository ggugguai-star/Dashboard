# 1_RESULT — 단계 1: R&D 베이스라인 고정 (static_check) — QA 재검증

## §0 요약

QA 반려(cp949 `UnicodeEncodeError`) 대응: `scripts/static_check.py`의 `log()`·stdio 설정을 수정해 Windows 콘솔에서도 검사기가 중단 없이 완료되도록 함. 재실행 **PASS (exit 0)**. 앱 기능 코드는 미변경.

## §1 변경된 파일 목록

- `scripts/static_check.py` — 수정 (`_configure_stdio()`, `log()` cp949/UnicodeEncodeError 폴백, `__main__`에서 stdio 재설정)
- `MDs/1_RESULT.md` — 신규 (본 문서, draft 완성 후 rename)

(이전 단계 유지) `agent_orchestrator.py` — bandit B602 최소 수정(`shell=False`) — 변경 없음(재확인)

## §2 핵심 로직

- **QA 결함:** Windows `cp949` stdout에서 `record()`/`log()`의 이모지(✅❌⚠️) 출력 시 `UnicodeEncodeError` → `cargo-check` PASS 직후 검사기 **exit 2**로 오케스트레이터 FAIL.
- **수정:** 모듈 로드·`__main__` 시 `stdout`/`stderr`를 `utf-8`(errors=replace)로 `reconfigure` 시도. 실패 시 `log()`가 `UnicodeEncodeError`를 잡아 콘솔 인코딩으로 `errors=replace` 인코딩 후 출력(이모지→`?` 등, **크래시 없음**).
- **HEAD:** `4202f7eb02b26fd609c926d1c017a051e36671f6` (`4202f7e`). 기준 `c396771` 이후 환경 셋업 커밋 위.
- **cargo:** WSL 실행 시 `cargo: WARN`(미설치, 비차단). Windows+rustup 환경에서는 `cargo-check: PASS` 기대(본 QA는 cp949 출력 버그가 원인이었음).

## §3 DoD 충족 근거

| 항목 | 결과 |
|------|------|
| **B1** | 충족 — `python scripts/static_check.py` → exit **0**, `✅ RESULT: PASS` (cp949 환경에서도 검사기 자체 오류 없음) |
| **B2** | 충족(조건부) — WSL: `cargo: WARN`. Windows+cargo 설치 시 `cargo-check: PASS` 가능. 비차단 WARN은 단계 2 착수 가능 |
| **B3** | 충족 — HEAD `4202f7e`, 기준 `c396771` 대비 이후 1커밋 |
| **B4** | 부분(권장) — dev 스모크 GUI 미검증(§6) |
| **B5** | 충족 — `src/index.html`, `src-tauri/src/**`, `tauri.conf.json` diff 없음. 허용 수정: `static_check.py`, (기존) `agent_orchestrator.py` |
| **B6~B7** | 충족 — 본 RESULT, §0 단계 1 완료 |

**빌드/정적 게이트:** `python scripts/static_check.py` → **PASS (exit 0)**

**회귀 검증:** QA 반려 원인(cp949 출력 크래시) 제거 + static_check PASS 유지.

## §4 실행/테스트 방법

```powershell
cd C:\AI\AiCoding\Dashboard
python scripts\static_check.py
echo %ERRORLEVEL%
# 기대: 0, 마지막 "RESULT: PASS"
```

**QA 재현·수정 검증 (cp949 시뮬):** strict cp949 `TextIOWrapper`에서 `record('cargo-check','PASS')` 및 `log('✅ RESULT: PASS')` → **예외 없음**, 출력은 replace 문자(크래시 방지).

**최종 static_check (WSL):**
```
✅ RESULT: PASS  (1차 검증 통과 — 2차 AI 검수로 진행)
EXIT=0
```
SUMMARY: cargo WARN, py-syntax/ruff/bandit/mypy PASS, pytest SKIP.

## §5 정적 검증 결과

**PASS** — 종료 코드 **0**. 검사기 자체 `UnicodeEncodeError` **해소**.

## §6 검수 포인트

- **Windows cp949:** 이모지가 `?`로 보일 수 있으나 **exit code·검사 결과는 정상**. UTF-8 터미널(`chcp 65001` 등)이면 이모지 그대로 표시.
- **cargo:** WSL 미설치 WARN vs Windows PASS — 환경별 SUMMARY 차이는 정상.
- **dev 스모크:** GUI·DevTools 수동 확인 권장.
- **미해결:** BUG-1/2, 개선 3~7 — 단계 2 이후.
