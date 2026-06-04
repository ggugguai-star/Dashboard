# -*- coding: utf-8 -*-
"""
agent_orchestrator.py V5.0 (Token-Optimized Edition 💸)
=====================================================
[ V5.0 변경점 — Cursor Pro 토큰 절감 & 품질 향상 ]
1. (토큰↓↓↓) Cursor CLI 세션 재사용:
   - --output-format json 으로 session_id 캡처 → ./MDs/.cursor_session 에 저장
   - 이후 모든 지시에 --resume <id> 부착 → 매 단계 코드베이스 재탐색 제거
   - resume 실패 시 자동 콜드 스타트 폴백 (세션 만료/유실 방어)
2. (품질↑↑) diff 기반 2차 QA:
   - 자기보고서(RESULT)가 아니라 실제 `git diff HEAD` 를 검수 대상에 포함
   - 토큰 폭발 방지를 위해 diff 길이 상한(QA_DIFF_MAX_CHARS) 적용
3. (안정성↑↑) 단계별 Git 체크포인트:
   - 단계 PASS 시 자동 커밋(checkpoint) → 손상 시 git reset 으로 복구 가능
4. (안정성↑↑) 단계별 최대 재시도 카운터:
   - 동일 단계 N회(MAX_PHASE_RETRIES) 초과 FAIL 시 자동화 중단 → 사람에게 에스컬레이션
   - 시맨틱 무한루프(디버깅→FAIL→디버깅)로 인한 조용한 토큰 소모 방어
5. (품질↑) Ollama structured output(JSON 스키마)로 QA 판정 파싱 안정화

[ 기존 V4.9 유지 기능 ]
- Final.md 감지 시 GitHub draft 릴리즈 자동 생성:
    1. Final.md 에서 [VERSION] / [RELEASE_NOTES] 자동 파싱
    2. build.bat 존재 시 → 로컬 빌드 실행 → .exe 첨부
    3. build.bat 없으면 → 소스코드만 draft 릴리즈 생성
    4. GitHub CLI(gh) + GITHUB_TOKEN 환경변수 사용 (토큰 직접 입력 불필요)

[ 기존 V4.8 유지 기능 ]
1. Headless Agent 전환 스위치 (cursor_cli / aider / gui)
2. Hybrid QA (Static Linter + LLM JSON 안정화 파싱)
3. Atomic Rename + Smart Debounce (AI 지시 불이행 및 무한루프 완벽 방어)
4. Final.md Phase(999) 고정 및 긴 에러 로그 토큰 폭발 방어
5. 신호 파일(.flag) 기반 프로세스 간 통신(IPC) 및 런타임 검수 강제 취소 기능
"""

import os
import sys
import re
import time
import json
import subprocess
from http.client import RemoteDisconnected

import requests
import pyperclip

try:
    import pyautogui
    import pygetwindow as gw
    pyautogui.FAILSAFE = False
    pyautogui.PAUSE    = 0.4
    _GUI_AVAILABLE = True
except Exception:
    pyautogui = None
    gw = None
    _GUI_AVAILABLE = False

from watchdog.observers import Observer
from watchdog.observers.polling import PollingObserver
from watchdog.events import FileSystemEventHandler

# ==========================================
# ⚙️ 시스템 마스터 설정
# ==========================================
WATCH_DIR      = "./MDs"

# [V5.0] Cursor CLI 세션 재사용 — session_id 영속화 파일
SESSION_FILE   = os.path.join(WATCH_DIR, ".cursor_session")
# [V5.0] 동일 단계 최대 재시도(FAIL) 허용 횟수. 초과 시 자동화 중단.
MAX_PHASE_RETRIES = 3
# [V5.0] diff 기반 QA 시 검수에 실어 보낼 diff 최대 길이(토큰 폭발 방지)
QA_DIFF_MAX_CHARS = 12000
# [V5.0] 단계 PASS 시 Git 체크포인트 커밋 사용 여부
GIT_CHECKPOINT_ENABLED = True
# [V5.1] Final 빌드 게이트: build.bat 실패 시 cursor-agent 자동수정 반복(한도)
MAX_BUILD_RETRIES = 3
# [V5.1] 빌드 성공 후 exe '즉시 크래시'만 보수적으로 검사(스모크)
SMOKE_TEST_ENABLED = True
# [V5.1] 스모크 크래시 자동수정 반복 한도(낮게 — 못 고치면 사람 위임)
MAX_SMOKE_RETRIES = 2
# [V5.1] exe를 이 초만큼 띄워보고 그 안에 비정상 종료면 크래시 판정
SMOKE_RUN_SECONDS = 8
# [V5.1] build.bat 최대 실행 시간(초) — 첫 Tauri/cargo 빌드 대비
BUILD_TIMEOUT_SECONDS = 1800

OLLAMA_URL     = "http://localhost:11434/api/generate"
OLLAMA_HOST    = os.environ.get("OLLAMA_HOST", "").strip()
OLLAMA_MODEL = "qwen3-coder:30b"
TYPING_DELAY   = 1.2
STABILITY_WAIT = 30

STATIC_CHECK_CMD = "python scripts/static_check.py"

_QA_APPENDIX_SECTION_RE = re.compile(r"^\s{0,3}##\s+7\b", re.MULTILINE)
OLLAMA_CONNECT_TIMEOUT = 5
OLLAMA_QA_READ_TIMEOUT = 600
OLLAMA_QA_NUM_PREDICT = 512
OLLAMA_QA_NUM_CTX = 8192   # 검수 입력이 2048로 잘리지 않도록 컨텍스트 명시
OLLAMA_QA_POST_RETRIES = 2

_QA_PASS_REASON_MARKERS = (
    "충족",
    "모두 통과",
    "모두 충족",
    "요구 사항",
    "요구사항",
    "통과했",
    "meet the requirements",
    "successfully passed",
    "no further changes",
    "works as expected",
)

_QA_FAIL_REASON_MARKERS = (
    "fail",
    "누락",
    "미충족",
    "불완전",
    "missing",
    "does not meet",
    "not meet",
)

_QA_PROSE_PASS_MARKERS = (
    "comprehensive",
    "well-structured",
    "well structured",
    "requirements are met",
    "all requirements",
    "meets the requirements",
    "looks good",
    "no issues found",
    "no further changes needed",
    "checklist to ensure all requirements are met",
)


def _extract_qa_review_body(content: str) -> str:
    """Return RESULT §0~§6 main body for 2nd-pass QA (exclude §7+ appendix)."""
    match = _QA_APPENDIX_SECTION_RE.search(content)
    if not match:
        return content
    body = content[: match.start()].rstrip()
    return (
        f"{body}\n\n"
        "[참고: §7+ 부록(전체 소스)은 QA 검토 대상에서 제외 — 본문(§0~§6)만 제출]\n"
    )


def _extract_reason_from_qa_data(data: dict) -> str:
    """Extract reason text from QA JSON, trying common alternate field names."""
    for key in ("reason", "explanation", "message", "review", "feedback", "comment"):
        val = data.get(key)
        if val is not None and str(val).strip():
            return str(val).strip()
    nested = data.get("response")
    if isinstance(nested, str) and nested.strip().startswith("{"):
        try:
            inner = json.loads(nested)
            if isinstance(inner, dict):
                nested_reason = _extract_reason_from_qa_data(inner)
                if nested_reason:
                    return nested_reason
        except json.JSONDecodeError:
            pass
    return ""


def _resolve_qa_verdict(status: str, reason: str, answer: str) -> tuple[str, str]:
    """Normalize QA JSON status/reason and reduce false FAIL from empty or mismatched fields."""
    status = (status or "FAIL").upper()
    reason = reason.strip()
    if not reason:
        reason = (
            f"QA JSON에 reason 필드가 비어 있습니다. "
            f"status={status}, score=N/A. "
            f"원본 응답 일부: {answer[:800]}"
        )
    reason_lower = reason.lower()
    if status != "PASS":
        has_pass = any(marker in reason_lower for marker in _QA_PASS_REASON_MARKERS)
        has_fail = any(marker in reason_lower for marker in _QA_FAIL_REASON_MARKERS)
        if has_pass and not has_fail:
            status = "PASS"
    return status, reason


def _infer_qa_verdict_from_prose(answer: str) -> tuple[str, str] | None:
    """Infer QA verdict when the model returns prose instead of QA JSON."""
    text = answer.strip()
    if not text:
        return None
    lower = text.lower()
    markers = _QA_PASS_REASON_MARKERS + _QA_PROSE_PASS_MARKERS
    has_pass = any(marker in lower for marker in markers)
    has_fail = any(marker in lower for marker in _QA_FAIL_REASON_MARKERS)
    if has_pass and not has_fail:
        snippet = text[:500].replace("\n", " ")
        return (
            "PASS",
            f"QA JSON 파싱 실패 — 서술형 응답에서 PASS 추론: {snippet}",
        )
    return None


def _parse_qa_json_answer(answer: str) -> tuple[str, str] | None:
    """Parse status/reason from an Ollama QA JSON response string."""
    start_idx = answer.find("{")
    end_idx = answer.rfind("}")
    if start_idx == -1 or end_idx == -1:
        return None
    try:
        data = json.loads(answer[start_idx : end_idx + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    status = str(data.get("status", "FAIL")).upper()
    reason = _extract_reason_from_qa_data(data)
    return _resolve_qa_verdict(status, reason, answer)


def _get_wsl_windows_host_ip() -> str:
    """Return Windows host IP from WSL resolv.conf (for Ollama on Windows host)."""
    try:
        with open("/etc/resolv.conf", "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("nameserver"):
                    parts = line.split()
                    if len(parts) >= 2:
                        ip = parts[1]
                        if ip and not ip.startswith("127."):
                            return ip
    except OSError:
        pass
    return ""


def _build_ollama_generate_urls() -> list[str]:
    """Build candidate Ollama /api/generate URLs (host env, loopback, WSL→Windows)."""
    hosts: list[str] = []
    if OLLAMA_HOST:
        hosts.append(OLLAMA_HOST)
    hosts.extend(["127.0.0.1", "localhost"])
    wsl_win = _get_wsl_windows_host_ip()
    if wsl_win:
        hosts.append(wsl_win)
    seen: set[str] = set()
    urls: list[str] = []
    for host in hosts:
        url = f"http://{host}:11434/api/generate"
        if url not in seen:
            seen.add(url)
            urls.append(url)
    return urls or [OLLAMA_URL]


def _iter_exception_chain(exc: BaseException):
    seen: set[int] = set()
    cur: BaseException | None = exc
    while cur is not None and id(cur) not in seen:
        seen.add(id(cur))
        yield cur
        cur = cur.__cause__ or cur.__context__


def _message_indicates_ollama_unreachable(msg: str) -> bool:
    lower = msg.lower()
    markers = (
        "11434",
        "ollama",
        "connection refused",
        "failed to establish",
        "max retries exceeded",
        "10061",
        "연결을 거부",
        "newconnectionerror",
        "httpconnectionpool",
        "name or service not known",
    )
    return any(marker in lower for marker in markers)


def _message_indicates_ollama_transport_failure(msg: str) -> bool:
    lower = msg.lower()
    markers = (
        "connection aborted",
        "connection reset",
        "10054",
        "broken pipe",
        "remotedisconnected",
        "remote end closed",
        "closed connection without response",
        "without response",
        "강제로 끊",
        "forcibly closed",
    )
    return any(marker in lower for marker in markers)


def _message_indicates_ollama_server_error(msg: str) -> bool:
    lower = msg.lower()
    has_ollama_context = (
        "11434" in lower
        or "ollama" in lower
        or "/api/generate" in lower
    )
    server_markers = (
        "500 server error",
        "502",
        "503",
        "504",
        "internal server error",
        "server error",
    )
    if not has_ollama_context:
        return any(m in lower for m in ("500 server error", "internal server error"))
    return any(marker in lower for marker in server_markers)


def _is_ollama_connection_error(exc: BaseException) -> bool:
    for item in _iter_exception_chain(exc):
        if isinstance(
            item,
            (ConnectionError, ConnectionResetError, BrokenPipeError, RemoteDisconnected),
        ):
            return True
        if isinstance(item, requests.exceptions.HTTPError):
            resp = getattr(item, "response", None)
            if resp is not None and getattr(resp, "status_code", 0) >= 500:
                return True
        if isinstance(item, requests.exceptions.RequestException):
            text = str(item)
            if (
                _message_indicates_ollama_unreachable(text)
                or _message_indicates_ollama_transport_failure(text)
                or _message_indicates_ollama_server_error(text)
            ):
                return True
    text = str(exc)
    return (
        _message_indicates_ollama_unreachable(text)
        or _message_indicates_ollama_transport_failure(text)
        or _message_indicates_ollama_server_error(text)
    )


def _is_ollama_unreachable_reason_text(reason: str) -> bool:
    if not reason:
        return False
    if reason.startswith("QA 인프라"):
        return True
    if "QA 통신/파싱 중 예외 발생" in reason:
        body = reason.split(":", 1)[-1].strip()
        return (
            _message_indicates_ollama_unreachable(body)
            or _message_indicates_ollama_transport_failure(body)
            or _message_indicates_ollama_server_error(body)
        )
    return False


def _format_ollama_unreachable_reason(exc: BaseException, last_url: str = "") -> str:
    msg = str(exc)
    parts = [
        "QA 인프라 오류: 2차 AI QA(Ollama) 통신 실패 — Phase 구현 결함이 아닙니다.",
        "조치: `ollama serve` 실행, 모델 로드(`ollama pull`), VRAM·재시작 확인 후 재시도.",
    ]
    if _message_indicates_ollama_transport_failure(msg):
        parts.append(
            "전송 중 연결 끊김(Connection aborted/RemoteDisconnected/10054): "
            "Ollama 재시작 또는 더 작은 모델 사용."
        )
    elif _message_indicates_ollama_server_error(msg):
        parts.append("HTTP 5xx: `ollama pull` 후 `ollama serve` 재시작.")
    elif _message_indicates_ollama_unreachable(msg):
        parts.append(
            "연결 거부: OLLAMA_HOST·127.0.0.1·Windows 호스트 Ollama IP 확인."
        )
    if last_url:
        parts.append(f"마지막 URL: {last_url}")
    parts.append(
        "긴급 우회: `python agent_orchestrator.py --pass <phase>` "
        "또는 `./MDs/<phase>_OVERRIDE_PASS.flag` 생성."
    )
    return " ".join(parts)


def _qa_fail_from_exception(exc: BaseException, last_url: str = "") -> tuple[str, str]:
    if _is_ollama_connection_error(exc):
        return ("FAIL", _format_ollama_unreachable_reason(exc, last_url))
    return ("FAIL", f"QA 통신/파싱 중 예외 발생: {exc}")


def _post_ollama_generate(payload: dict) -> str:
    """POST to Ollama with multi-host URL fallbacks and transport/server retries."""
    last_exc: BaseException | None = None
    last_url = ""
    for url in _build_ollama_generate_urls():
        for attempt in range(1, OLLAMA_QA_POST_RETRIES + 1):
            try:
                res = requests.post(
                    url,
                    json=payload,
                    timeout=(OLLAMA_CONNECT_TIMEOUT, OLLAMA_QA_READ_TIMEOUT),
                )
                if res.status_code >= 500:
                    last_exc = requests.exceptions.HTTPError(
                        f"{res.status_code} Server Error for url: {url}",
                        response=res,
                    )
                    last_url = url
                    if attempt < OLLAMA_QA_POST_RETRIES:
                        time.sleep(1)
                        continue
                    break
                res.raise_for_status()
                return res.json().get("response", "").strip()
            except requests.exceptions.RequestException as e:
                last_exc = e
                last_url = url
                if _is_ollama_connection_error(e) and attempt < OLLAMA_QA_POST_RETRIES:
                    time.sleep(1)
                    continue
                if not _is_ollama_connection_error(e):
                    raise
                break
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("Ollama QA 요청 실패: URL 후보 없음")


# ------------------------------------------
# 🤖 작성 에이전트 전송 방식
#   "cursor_cli" : (권장) Cursor 터미널 에이전트로 백그라운드 전송.
#   "aider"      : Aider 헤드리스.
#   "gui"        : 기존 키보드 매크로(강화판). 최후의 수단.
# ------------------------------------------
AGENT_MODE = "cursor_cli"

# --- cursor_cli 옵션 ---
CURSOR_CLI_BIN     = "wsl /home/ggu/.local/bin/cursor-agent"
CURSOR_CLI_MODEL   = ""              # 비우면 Auto(Pro 포함분/무제한)
CURSOR_CLI_TIMEOUT = 1800

# --- aider 옵션 ---
AIDER_MODEL = "ollama_chat/qwen2.5-coder:32b"

# --- gui 옵션(강화판) ---
GUI_INPUT_X_RATIO = 0.80
GUI_INPUT_Y_RATIO = 0.92
GUI_PANE_WAIT     = 4.0

# ------------------------------------------
# [V4.9] GitHub 릴리즈 설정
#   GITHUB_TOKEN : Windows 환경변수에서 자동으로 읽어옴 (직접 입력 불필요)
#   GITHUB_REPO  : 자동 감지 (git remote origin 에서 파싱)
#                  자동 감지 실패 시 아래에 직접 입력: "username/repo-name"
# ------------------------------------------
GITHUB_REPO = ""  # 비워두면 git remote origin 에서 자동 파싱


# ==========================================
# [V4.9] GitHub 릴리즈 헬퍼 함수들
# ==========================================

def _get_github_repo(project_root):
    """git remote origin URL에서 'username/repo' 형식으로 파싱."""
    if GITHUB_REPO:
        return GITHUB_REPO
    try:
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=project_root
        )
        url = result.stdout.strip()
        # https://github.com/user/repo.git  또는  git@github.com:user/repo.git
        match = re.search(r"github\.com[:/](.+/.+?)(?:\.git)?$", url)
        if match:
            return match.group(1)
    except Exception:
        pass
    return ""


def _parse_final_md(final_path):
    """
    Final.md 에서 [VERSION] 과 [RELEASE_NOTES] 를 파싱해 반환.
    반환: (version, release_notes)
    """
    version = ""
    release_notes = ""
    try:
        with open(final_path, "r", encoding="utf-8") as f:
            content = f.read()

        v_match = re.search(r"\[VERSION\]:\s*(v[\d.]+)", content)
        if v_match:
            version = v_match.group(1).strip()

        rn_match = re.search(r"\[RELEASE_NOTES\]:\s*\n([\s\S]+?)(?:\n\n|\n#|$)", content)
        if rn_match:
            release_notes = rn_match.group(1).strip()
        else:
            rn_inline = re.search(r"\[RELEASE_NOTES\]:\s*(.+)", content)
            if rn_inline:
                release_notes = rn_inline.group(1).strip()

    except Exception as e:
        print(f"⚠️ Final.md 파싱 오류: {e}")

    return version, release_notes


def _run_build(project_root):
    """
    build.bat 이 존재하면 실행하고 생성된 .exe 경로를 반환.
    없으면 빈 문자열 반환.
    """
    build_bat = os.path.join(project_root, "build.bat")
    if not os.path.exists(build_bat):
        print("ℹ️  build.bat 없음 → 소스코드만 릴리즈합니다.")
        return ""

    print("🔨 [빌드] build.bat 실행 중...")
    try:
        result = subprocess.run(
            ["cmd", "/c", "build.bat"],
            cwd=project_root,
            capture_output=True,
            text=True,
            timeout=600,
            encoding="utf-8",
            errors="replace",
        )
        if result.returncode != 0:
            print(f"⚠️ 빌드 실패:\n{result.stdout[-500:]}\n{result.stderr[-500:]}")
            return ""

        print("✅ 빌드 완료.")

        # dist/ 또는 프로젝트 루트에서 .exe 탐색
        for search_dir in [os.path.join(project_root, "dist"), project_root]:
            if not os.path.exists(search_dir):
                continue
            for f in os.listdir(search_dir):
                if f.endswith(".exe"):
                    exe_path = os.path.join(search_dir, f)
                    print(f"📦 빌드 결과물: {exe_path}")
                    return exe_path

        print("⚠️ 빌드는 성공했지만 .exe 파일을 찾지 못했습니다.")
        return ""

    except subprocess.TimeoutExpired:
        print("⚠️ 빌드 타임아웃 (10분 초과).")
        return ""
    except Exception as e:
        print(f"⚠️ 빌드 실행 오류: {e}")
        return ""


def _find_built_exe(project_root):
    """빌드 산출물 .exe 탐색 (Tauri release/bundle, dist, 루트). deps 부산물 제외."""
    import glob
    patterns = [
        os.path.join(project_root, "src-tauri", "target", "release", "*.exe"),
        os.path.join(project_root, "src-tauri", "target", "release", "bundle", "**", "*.exe"),
        os.path.join(project_root, "dist", "*.exe"),
        os.path.join(project_root, "*.exe"),
    ]
    for pat in patterns:
        hits = [h for h in glob.glob(pat, recursive=True)
                if (os.sep + "deps" + os.sep) not in h]
        if hits:
            return max(hits, key=os.path.getmtime)
    return ""


def _run_build_once(project_root):
    """build.bat 1회 실행. 반환 (성공bool, exe경로, 로그꼬리).
       build.bat 없으면 (True, "", "(build.bat 없음)") — 기존 동작 보존."""
    build_bat = os.path.join(project_root, "build.bat")
    if not os.path.exists(build_bat):
        return True, "", "(build.bat 없음 — 빌드 단계 생략)"
    print(f"\U0001f528 [빌드] build.bat 실행 중... (최대 {BUILD_TIMEOUT_SECONDS}초)")
    try:
        result = subprocess.run(
            ["cmd", "/c", "build.bat"],
            cwd=project_root, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=BUILD_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return False, "", f"빌드 타임아웃({BUILD_TIMEOUT_SECONDS}초 초과)."
    except Exception as e:
        return False, "", f"빌드 실행 오류: {e}"
    log = ((result.stdout or "") + "\n" + (result.stderr or "")).strip()
    tail = log[-1500:] if len(log) > 1500 else log
    if result.returncode != 0:
        return False, "", tail
    return True, _find_built_exe(project_root), tail


def _smoke_test_exe(exe_path, seconds=None):
    """보수적 스모크: '명백한 즉시 크래시'만 FAIL. 반환 (정상bool, 사유).
       seconds 동안 살아있으면 GUI 상주로 보고 PASS(종료시킴)."""
    if seconds is None:
        seconds = SMOKE_RUN_SECONDS
    if not exe_path or not os.path.exists(exe_path):
        return True, "(exe 없음 — 스모크 생략)"
    print(f"\U0001f9ea [스모크] {os.path.basename(exe_path)} 실행 점검({seconds}초)...")
    try:
        proc = subprocess.Popen(
            [exe_path], cwd=(os.path.dirname(exe_path) or None),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
    except Exception as e:
        return False, f"exe 실행 자체 실패: {e}"
    markers = ("panicked", "unhandled exception", "access violation",
               "stack overflow", "0xc0000")
    try:
        out, err = proc.communicate(timeout=seconds)
        rc = proc.returncode
        blob = ((out or b"") + b"\n" + (err or b"")).decode("utf-8", "replace")
        if rc != 0:
            return False, f"실행 즉시 비정상 종료(exit={rc}).\n[로그꼬리]\n{blob[-1000:]}"
        low = blob.lower()
        if any(m in low for m in markers):
            return False, f"실행 중 크래시 신호 감지.\n[로그꼬리]\n{blob[-1000:]}"
        return True, "정상 종료(exit=0)"
    except subprocess.TimeoutExpired:
        try:
            proc.kill()
            proc.communicate(timeout=5)
        except Exception:
            pass
        return True, f"{seconds}초 동안 정상 구동(GUI 상주로 판단)"


def _create_github_draft_release(project_root, final_path, prebuilt_exe=None):
    """
    Final.md 파싱 → (필요 시) 빌드 → GitHub draft 릴리즈 생성.
    GitHub CLI(gh) + GITHUB_TOKEN 환경변수 사용.
    """
    print("\n🚀 [GitHub 릴리즈] draft 생성 시작...")

    # 1. 토큰 확인
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        print("❌ GITHUB_TOKEN 환경변수가 없습니다. Windows 환경변수를 확인하세요.")
        return

    # 2. 레포 확인
    repo = _get_github_repo(project_root)
    if not repo:
        print("❌ GitHub 레포를 확인할 수 없습니다. GITHUB_REPO 설정 또는 git remote origin 을 확인하세요.")
        return

    # 3. Final.md 파싱
    version, release_notes = _parse_final_md(final_path)
    if not version:
        version = f"v0.0.{int(time.time())}"
        print(f"⚠️ [VERSION] 파싱 실패. 임시 태그 사용: {version}")
    if not release_notes:
        release_notes = "자동 생성된 릴리즈입니다."

    print(f"   버전: {version}")
    print(f"   레포: {repo}")

    # 4. build.bat 실행 (있으면)
    exe_path = prebuilt_exe if prebuilt_exe is not None else _run_build(project_root)

    # 5. GitHub CLI로 draft 릴리즈 생성
    env = os.environ.copy()
    cmd = [
        "gh", "release", "create", version,
        "--repo", repo,
        "--title", f"{repo.split('/')[-1]} {version}",
        "--notes", release_notes,
        "--draft",
    ]

    if exe_path and os.path.exists(exe_path):
        cmd.append(exe_path)
        print(f"   첨부 파일: {os.path.basename(exe_path)}")
    else:
        print("   첨부 파일: 없음 (소스코드 릴리즈)")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            cwd=project_root,
        )
        if result.returncode == 0:
            release_url = result.stdout.strip()
            print(f"\n✅ [GitHub 릴리즈 완료] draft 생성됨!")
            print(f"   🔗 {release_url}")
            print(f"   → GitHub에서 확인 후 'Publish release' 버튼을 눌러 배포하세요.")
        else:
            print(f"❌ GitHub 릴리즈 생성 실패:\n{result.stderr.strip()}")
    except FileNotFoundError:
        print("❌ 'gh' CLI를 찾지 못했습니다.")
        print("   설치: https://cli.github.com/ 또는 winget install GitHub.cli")
    except Exception as e:
        print(f"❌ GitHub 릴리즈 오류: {e}")


# ==========================================
# [V5.0] 세션 재사용 / Git diff·체크포인트 헬퍼
# ==========================================

_SESSION_ID_RE = re.compile(
    r'"(?:session_id|sessionId|chatId|chat_id|chatID|id)"\s*:\s*"([^"]+)"'
)


def _load_session_id() -> str:
    """저장된 Cursor 세션 ID를 읽어온다(없으면 빈 문자열)."""
    try:
        with open(SESSION_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def _save_session_id(sid: str) -> None:
    """Cursor 세션 ID를 영속화한다."""
    if not sid:
        return
    try:
        os.makedirs(os.path.dirname(SESSION_FILE) or ".", exist_ok=True)
        with open(SESSION_FILE, "w", encoding="utf-8") as f:
            f.write(sid.strip())
    except OSError as e:
        print(f"⚠️ 세션 ID 저장 실패: {e}")


def _clear_session_id() -> None:
    """세션 ID 파일을 제거한다(resume 실패 시 콜드 스타트용)."""
    try:
        if os.path.exists(SESSION_FILE):
            os.remove(SESSION_FILE)
    except OSError:
        pass


def _extract_session_id(stdout: str) -> str:
    """cursor-agent JSON/stream-json 출력에서 세션 ID를 best-effort로 추출."""
    if not stdout:
        return ""
    # 1) 전체를 JSON으로 파싱 시도
    text = stdout.strip()
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            for key in ("session_id", "sessionId", "chatId", "chat_id", "chatID"):
                val = data.get(key)
                if val:
                    return str(val).strip()
    except (json.JSONDecodeError, TypeError):
        pass
    # 2) NDJSON(stream-json) 라인 단위 파싱 시도
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            for key in ("session_id", "sessionId", "chatId", "chat_id", "chatID"):
                val = obj.get(key)
                if val:
                    return str(val).strip()
    # 3) 정규식 폴백
    m = _SESSION_ID_RE.search(text)
    if m:
        return m.group(1).strip()
    return ""


def _stdout_indicates_resume_failure(returncode: int, stdout: str, stderr: str) -> bool:
    """--resume 가 만료/유실로 실패했는지 판단(콜드 스타트 폴백 트리거)."""
    blob = f"{stdout}\n{stderr}".lower()
    markers = (
        "no such session",
        "session not found",
        "unknown session",
        "invalid session",
        "chat not found",
        "could not resume",
        "failed to resume",
        "resume failed",
        "no chat with id",
    )
    if any(m in blob for m in markers):
        return True
    return False


def _get_git_diff(project_root: str) -> str:
    """현재 작업트리의 변경(추적+미추적 포함)을 git diff 로 반환. 길이 상한 적용."""
    try:
        # 미추적 파일도 diff 에 보이도록 intent-to-add (실제 staging 아님)
        subprocess.run(
            ["git", "add", "-A", "-N"],
            cwd=project_root, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
        )
        result = subprocess.run(
            ["git", "--no-pager", "diff", "HEAD"],
            cwd=project_root, capture_output=True, text=True,
            encoding="utf-8", timeout=60,
            errors="replace",
        )
        diff = (result.stdout or "").strip()
        if not diff:
            return ""
        if len(diff) > QA_DIFF_MAX_CHARS:
            head = diff[: QA_DIFF_MAX_CHARS // 2]
            tail = diff[-QA_DIFF_MAX_CHARS // 2 :]
            diff = (
                f"{head}\n\n"
                f"...(diff 가 너무 길어 중간 생략 — 총 {len(diff)}자)...\n\n"
                f"{tail}"
            )
        return diff
    except Exception as e:
        print(f"⚠️ git diff 수집 실패(무시하고 RESULT 본문만 검수): {e}")
        return ""


def _git_checkpoint(project_root: str, phase) -> None:
    """단계 PASS 시 자동 커밋(checkpoint). 실패해도 파이프라인은 계속 진행."""
    if not GIT_CHECKPOINT_ENABLED:
        return
    try:
        inside = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=project_root, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15,
        )
        if inside.returncode != 0 or "true" not in (inside.stdout or "").lower():
            return  # git 저장소가 아니면 조용히 패스
        subprocess.run(
            ["git", "add", "-A"],
            cwd=project_root, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
        )
        status = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=project_root, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15,
        )
        if not (status.stdout or "").strip():
            return  # 커밋할 변경 없음
        msg = f"[auto-checkpoint] phase {phase} passed"
        commit = subprocess.run(
            ["git", "commit", "-m", msg, "--no-verify"],
            cwd=project_root, capture_output=True, text=True,
            encoding="utf-8", timeout=60,
            errors="replace",
        )
        if commit.returncode == 0:
            print(f"📌 [Git 체크포인트] '{msg}' 커밋 완료 (손상 시 git reset 으로 복구 가능)")
        else:
            print(f"⚠️ Git 체크포인트 커밋 실패(무시): {(commit.stderr or '').strip()[:200]}")
    except FileNotFoundError:
        pass  # git 미설치 환경
    except Exception as e:
        print(f"⚠️ Git 체크포인트 오류(무시): {e}")


# ==========================================
# 메인 오케스트레이터 클래스
# ==========================================
class CursorOrchestrator(FileSystemEventHandler):

    def __init__(self):
        super().__init__()
        self.file_locks = {}
        self.fail_counts = {}          # [V5.0] phase -> 누적 FAIL 횟수
        self.halted = False            # [V5.0] 재시도 초과로 자동화 중단됨 여부
        self.current_phase = self._init_existing_files()

    def _get_phase(self, filename):
        if filename.endswith("Final.md"):
            return 999
        if "MASTER_PLAN" in filename:
            return 0
        try:
            return int(filename.split("_")[0])
        except ValueError:
            return -1

    def _init_existing_files(self):
        max_phase = 0
        if os.path.exists(WATCH_DIR):
            for f in os.listdir(WATCH_DIR):
                file_key = f.lower()
                if f.endswith("_PROMPT.md") or f.endswith("MASTER_PLAN.md") or f.endswith("Final.md"):
                    self.file_locks[file_key] = float('inf')
                if f.endswith(".md"):
                    phase = self._get_phase(f)
                    if phase > max_phase and phase != 999:
                        max_phase = phase
        return max_phase

    def _wait_for_stability(self, path, wait_seconds, phase=None):
        print(f"   ⏳ [안정화 대기] 파일 쓰기 완료 대기 중... ({wait_seconds}초)")
        last_size = -1
        stable_time = 0

        while stable_time < wait_seconds:
            if phase is not None:
                pass_flag = os.path.join(WATCH_DIR, f"{phase}_OVERRIDE_PASS.flag")
                qa_flag   = os.path.join(WATCH_DIR, f"{phase}_OVERRIDE_QA.flag")
                if os.path.exists(pass_flag) or os.path.exists(qa_flag):
                    print("🚨 [긴급 신호 감지] 사용자의 오버라이드 명령을 수신하여 기존 대기/검수를 즉시 취소합니다!")
                    return False

            try:
                current_size = os.path.getsize(path)
            except OSError:
                return False

            if current_size == last_size:
                stable_time += 1
            else:
                last_size = current_size
                stable_time = 0
            time.sleep(1)
        return True

    def on_created(self, event):
        if not event.is_directory: self._process_file(os.path.abspath(event.src_path))

    def on_modified(self, event):
        if not event.is_directory: self._process_file(os.path.abspath(event.src_path))

    def on_moved(self, event):
        if not event.is_directory: self._process_file(os.path.abspath(event.dest_path))

    def _register_fail_and_maybe_halt(self, phase) -> bool:
        """[V5.0] 단계 FAIL 누적 카운트. 한도 초과 시 자동화를 중단하고 True 반환."""
        key = str(phase)
        self.fail_counts[key] = self.fail_counts.get(key, 0) + 1
        count = self.fail_counts[key]
        print(f"   ↺ [재시도 카운터] {phase}단계 누적 FAIL: {count}/{MAX_PHASE_RETRIES}")
        if count >= MAX_PHASE_RETRIES:
            self.halted = True
            print("=" * 64)
            print(f"🛑 [자동화 중단] {phase}단계가 {MAX_PHASE_RETRIES}회 연속 FAIL 했습니다.")
            print("   시맨틱 무한루프(토큰 소모) 방어를 위해 추가 디버깅 지시를 보내지 않습니다.")
            print("   조치: 사람이 직접 확인 후, 수정하고 아래 중 하나로 재개하세요.")
            print(f"     - python agent_orchestrator.py --qa {phase}   (즉시 재검수)")
            print(f"     - python agent_orchestrator.py --pass {phase} (강제 통과)")
            print("=" * 64)
            return True
        return False

    def _reset_fail_count(self, phase) -> None:
        """[V5.0] 단계 PASS 시 해당 단계의 FAIL 카운트 초기화."""
        self.fail_counts.pop(str(phase), None)

    def _process_file(self, path):
        if self.halted:
            return
        name = os.path.basename(path)
        file_key = name.lower()

        if not (name.endswith(".md") or name.endswith(".flag")) or "_draft" in name:
            return

        file_phase = self._get_phase(name)

        if file_phase != -1:
            if file_phase < self.current_phase:
                return
            if file_phase > self.current_phase:
                self.current_phase = file_phase

        try:
            current_mtime = os.path.getmtime(path)
        except OSError:
            return

        locked_mtime = self.file_locks.get(file_key, 0)
        if current_mtime <= locked_mtime:
            return

        self.file_locks[file_key] = current_mtime
        print(f"\n[감지] 파일 포착 -> {name}")

        wait_time = STABILITY_WAIT if "RESULT.md" in name else 1
        if not name.endswith(".flag"):
            if not self._wait_for_stability(path, wait_time, file_phase):
                return

        try:
            self.file_locks[file_key] = os.path.getmtime(path)
        except OSError:
            pass

        # ----------------------------------------
        # 분기 처리
        # ----------------------------------------
        if name.endswith("_OVERRIDE_PASS.flag"):
            phase = name.split("_")[0]
            next_phase = int(phase) + 1
            os.remove(path)
            self.file_locks[f"{phase}_result.md"] = float('inf')
            print(f"🚀 [수동 개입 실행] {phase}단계 강제 PASS! 즉시 다음 단계 지시를 내립니다...")
            self.command_agent(
                f"사용자(관리자)에 의해 {phase}단계가 검수를 생략하고 강제 통과(PASS) 되었습니다. "
                f"바로 다음 단계인 ./MDs/{next_phase}_PROMPT.md 를 생성해줘. "
                f"(만약 최종 단계였다면 Final.md 를 만들어줘)"
            )

        elif name.endswith("_OVERRIDE_QA.flag"):
            phase = name.split("_")[0]
            os.remove(path)
            self.file_locks[f"{phase}_result.md"] = float('inf')
            print(f"⚡ [수동 개입 실행] 30초 대기 & 1차 검증 생략! 바로 {phase}단계 AI 검수(QA) 시작...")

            target_md = os.path.join(WATCH_DIR, f"{phase}_RESULT.md")
            if not os.path.exists(target_md):
                print(f"⚠️ {target_md} 파일이 존재하지 않아 QA를 진행할 수 없습니다.")
                return

            try:
                with open(target_md, "r", encoding="utf-8") as f:
                    content = f.read()
                # [V5.0] diff 기반 검수
                project_root = os.path.dirname(os.path.abspath(__file__))
                code_diff = _get_git_diff(project_root)
                verdict, reason = self.run_local_qa(content, code_diff=code_diff)
            except Exception as e:
                verdict, reason = "FAIL", f"파일 읽기 오류: {e}"

            if verdict == "PASS":
                next_phase = int(phase) + 1
                print(f"[QA] PASS -> {next_phase}단계 지시.")
                self._reset_fail_count(phase)                       # [V5.0]
                _git_checkpoint(                                    # [V5.0]
                    os.path.dirname(os.path.abspath(__file__)), phase
                )
                self.command_agent(
                    f"2차 AI 코드 리뷰를 완벽히 통과했습니다(PASS). "
                    f"다음 단계인 ./MDs/{next_phase}_PROMPT.md 를 생성해줘."
                )
            else:
                print(f"[QA] FAIL -> 디버깅 지시.")
                # ⭐ FAIL 시 RESULT 잠금 해제: cursor-agent가 만든 새 RESULT.md를
                #    PollingObserver가 다시 감지해 자동 재검수가 걸리도록 한다.
                #    (OVERRIDE_QA에서 inf로 잠갔던 것을 풀어줌)
                self.file_locks[f"{phase}_result.md"] = 0
                # [V5.0] 인프라 오류는 카운트 제외
                if not _is_ollama_unreachable_reason_text(reason):
                    if self._register_fail_and_maybe_halt(phase):
                        return
                self._command_agent_for_qa_fail(phase, reason, manual_qa=True)

        elif name.endswith("0_MASTER_PLAN.md"):
            self.file_locks[file_key] = float('inf')
            self.command_agent(
                "마스터플랜이 감지되었습니다. 이를 바탕으로 첫 번째 작업 지시서인 "
                "./MDs/1_PROMPT.md 파일을 생성해줘. (코드는 아직 짜지 마)"
            )

        elif name.endswith("_PROMPT.md"):
            self.file_locks[file_key] = float('inf')
            phase = name.split("_")[0]
            self.command_agent(
                f"{name} 의 명세대로 코드를 정확히 수정하고 작성해.\n"
                f"⚠️ [핵심 규칙]: 작업 도중 오케스트레이터가 가로채지 못하도록, 결과 요약본은 임시 파일인 `./MDs/{phase}_RESULT_draft.md` 에 작성하고, "
                f"마지막에 `./MDs/{phase}_RESULT.md` 로 이름을 변경해라."
            )

        elif name.endswith("_RESULT.md"):
            phase = name.split("_")[0]
            print("🔍 [1차 검증] 정적 분석 및 빌드 테스트 시작...")
            static_pass, static_reason = self.run_static_analysis()

            if not static_pass:
                print("❌ [1차 검증 FAIL] 에러 발생! AI 검수 생략 후 즉시 반려.")
                verdict, reason = "FAIL", f"코드 실행/컴파일 오류가 발생했습니다:\n{static_reason}"
            else:
                print("✅ [1차 검증 PASS] 로컬 AI 보안/로직 검수(2차)로 넘어갑니다...")
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        content = f.read()
                    # [V5.0] 자기보고서(RESULT)가 아니라 실제 변경(git diff)을 검수에 포함
                    project_root = os.path.dirname(os.path.abspath(__file__))
                    code_diff = _get_git_diff(project_root)
                    verdict, reason = self.run_local_qa(content, code_diff=code_diff)
                except Exception as e:
                    verdict, reason = "FAIL", f"파일 읽기 오류: {e}"

            if verdict == "PASS":
                print(f"[QA] PASS -> {phase}단계 완벽 통과. 다음 단계 지시.")
                self.file_locks[file_key] = float('inf')
                self._reset_fail_count(phase)                       # [V5.0]
                _git_checkpoint(                                    # [V5.0]
                    os.path.dirname(os.path.abspath(__file__)), phase
                )
                next_phase = int(phase) + 1
                self.command_agent(
                    f"1차 빌드 테스트와 2차 AI 코드 리뷰를 모두 통과했습니다(PASS). "
                    f"다음 단계인 ./MDs/{next_phase}_PROMPT.md 를 생성해줘. "
                    f"(만약 최종 단계였다면 Final.md 를 만들어줘)"
                )
            else:
                print(f"[QA] FAIL -> 디버깅 지시. 사유: {reason[:100]}...")
                # [V5.0] 인프라 오류(Ollama 등)는 재시도 카운트에서 제외 — 코드 결함이 아님
                if not _is_ollama_unreachable_reason_text(reason):
                    if self._register_fail_and_maybe_halt(phase):
                        return
                self._command_agent_for_qa_fail(
                    phase, reason, result_path=path, result_name=name
                )

        # [V4.9] Final.md — 빌드 + GitHub draft 릴리즈 자동 생성
        elif name.endswith("Final.md"):
            self.file_locks[file_key] = float('inf')
            print("\n🎉 [완료] 최종 명세서(Final.md)가 감지되었습니다.")
            project_root = os.path.dirname(os.path.abspath(__file__))
            built_exe = self._build_and_smoke_with_repair(project_root)
            _create_github_draft_release(project_root, path, prebuilt_exe=built_exe)
            print("\n릴리즈 종료.")
            os._exit(0)

    def _build_and_smoke_with_repair(self, project_root):
        """[V5.1] A: 빌드 게이트 + B: 보수적 exe 스모크. cursor-agent 자동수정 반복.
           최종 exe 경로(또는 "")를 반환. build.bat 없으면 즉시 ""(소스 릴리즈)."""
        exe = ""
        build_ok = False
        for attempt in range(1, MAX_BUILD_RETRIES + 1):
            build_ok, exe, log = _run_build_once(project_root)
            if build_ok:
                break
            print(f"❌ [빌드 게이트] build.bat 실패 ({attempt}/{MAX_BUILD_RETRIES})")
            if attempt >= MAX_BUILD_RETRIES:
                print("\U0001f6d1 [빌드 게이트] 한도 초과 — 자동수정 포기. 소스만 릴리즈하고 사람이 확인하세요.")
                return ""
            self.command_agent(
                "최종 빌드(build.bat)가 실패했습니다. 아래 빌드 오류 로그만 보고 "
                "코드를 최소 수정해 빌드가 통과하도록 고쳐라. 앱 기능/사양은 바꾸지 마라.\n\n"
                f"[빌드 오류 로그]\n{log}"
            )
        if not build_ok:
            return ""
        if SMOKE_TEST_ENABLED and exe:
            for attempt in range(1, MAX_SMOKE_RETRIES + 1):
                healthy, reason = _smoke_test_exe(exe)
                if healthy:
                    print(f"✅ [스모크] 정상 — {reason}")
                    break
                print(f"❌ [스모크] 즉시 크래시 감지 ({attempt}/{MAX_SMOKE_RETRIES})")
                if attempt >= MAX_SMOKE_RETRIES:
                    print("\U0001f6d1 [스모크] 한도 초과 — 자동수정 포기. exe는 첨부하되 '수동 확인 필요'.")
                    break
                self.command_agent(
                    "빌드는 성공했지만 생성된 실행파일이 시작하자마자 크래시합니다. "
                    "아래 크래시 로그를 보고 런타임 초기화 오류만 최소 수정해 고쳐라.\n\n"
                    f"[크래시 로그]\n{reason}"
                )
                rebuild_ok, exe2, _ = _run_build_once(project_root)
                if not rebuild_ok:
                    print("⚠️ [스모크] 수정 후 재빌드 실패 — 중단.")
                    break
                exe = exe2 or exe
        return exe

    def run_static_analysis(self):
        try:
            custom_env = os.environ.copy()
            custom_env.pop("CDP_PORT", None)
            custom_env["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--remote-debugging-port=9222"
            project_root = os.path.dirname(os.path.abspath(__file__))

            result = subprocess.run(
                STATIC_CHECK_CMD,
                shell=True,
                capture_output=True,
                text=True,
                timeout=300,
                encoding='utf-8',
                errors="replace",
                env=custom_env,
                cwd=project_root,
            )

            if result.returncode != 0:
                err_msg = f"[STDOUT]\n{result.stdout}\n[STDERR]\n{result.stderr}".strip()
                if len(err_msg) > 1500:
                    err_msg = "...(앞부분 생략됨)...\n" + err_msg[-1500:]
                return False, err_msg
            return True, "통과"
        except subprocess.TimeoutExpired:
            return False, "1차 검증(빌드)이 5분을 초과하여 강제 종료되었습니다. 무한 대기 상태인지 확인하세요."
        except Exception as e:
            return False, f"진단 스크립트 실행 실패: {e}"

    def run_local_qa(self, code_content, code_diff=""):
        qa_start = time.time()   # ⏱️ 검수 소요시간 측정 시작
        print(f"⏱️  [QA] AI 검수 시작... (모델: {OLLAMA_MODEL})")

        def _finish(verdict_tuple):
            elapsed = time.time() - qa_start
            mins, secs = divmod(int(elapsed), 60)
            if mins > 0:
                time_str = f"{mins}분 {secs}초"
            else:
                time_str = f"{secs}초"
            status = verdict_tuple[0] if verdict_tuple else "?"
            print(f"⏱️  [QA] AI 검수 완료 — 판정: {status} / 소요시간: {time_str} ({elapsed:.1f}s)")
            return verdict_tuple

        review_body = _extract_qa_review_body(code_content)

        # [V5.0] 실제 변경(git diff)을 1순위 증거로 제공. 자기보고서보다 신뢰도가 높다.
        if code_diff:
            evidence = (
                "----- 실제 코드 변경 (git diff HEAD) [1순위 검토 대상] -----\n"
                f"{code_diff}\n\n"
                "----- RESULT 문서 본문 (§0~§6) [보조 자료] -----\n"
                f"{review_body}\n"
            )
            diff_note = (
                "검수의 1순위 근거는 위 'git diff HEAD'(실제 변경)다. "
                "RESULT 문서의 자기보고가 diff 와 모순되면 FAIL 로 판정해라.\n"
            )
        else:
            evidence = review_body
            diff_note = (
                "(git diff 미수집 — RESULT 문서 본문만으로 검토한다.)\n"
            )

        system_rule = (
            "너는 매우 깐깐한 시니어 코드 리뷰어다. 제공된 자료의 "
            "요구사항·DoD·검증 결과를 점검해라. RESULT 문서의 §7+ 부록은 이미 제외되어 있다.\n"
            + diff_note +
            "반드시 아래 JSON 형식으로만 대답해라. 다른 텍스트는 절대 출력하지 마라.\n"
            '{"status": "PASS", "reason": "이유 설명", "score": 점수}\n'
            "reason 필드는 필수이며, PASS·FAIL 모두 50자 이상 한국어로 반드시 작성해라.\n"
            "PROMPT DoD·정적 검증·REPL 스모크가 모두 충족되면 status를 PASS로 설정해라.\n"
            "status와 reason은 반드시 일치해야 한다. 충족 시 status=PASS, reason에도 통과 근거를 적어라.\n"
            "결함이 있으면 status를 FAIL로 설정해라.\n\n"
            "----- 검토 대상 -----\n"
        )

        # [V5.0] Ollama structured output(JSON 스키마)로 판정 파싱 안정화.
        qa_schema = {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["PASS", "FAIL"]},
                "reason": {"type": "string"},
                "score": {"type": "integer"},
            },
            "required": ["status", "reason"],
        }
        payload = {
            "model": OLLAMA_MODEL,
            "prompt": system_rule + evidence,
            "format": qa_schema,
            "stream": False,
            "options": {"temperature": 0.1, "num_predict": OLLAMA_QA_NUM_PREDICT, "num_ctx": OLLAMA_QA_NUM_CTX},
        }
        try:
            answer = _post_ollama_generate(payload)

            parsed = _parse_qa_json_answer(answer)
            if parsed is not None:
                return _finish(parsed)

            inferred = _infer_qa_verdict_from_prose(answer)
            if inferred is not None:
                return _finish(inferred)

            return _finish(("FAIL", f"AI가 JSON 형식을 반환하지 않았습니다. 원본 응답:\n{answer[:1200]}"))

        except Exception as e:
            inferred = _infer_qa_verdict_from_prose(str(e))
            if inferred is not None:
                return _finish(inferred)
            return _finish(_qa_fail_from_exception(e))

    def _command_agent_for_qa_fail(
        self,
        phase: str,
        reason: str,
        *,
        manual_qa: bool = False,
        result_path: str = "",
        result_name: str = "",
    ):
        if _is_ollama_unreachable_reason_text(reason):
            print("[QA] Ollama 인프라 오류 — 앱 코드 디버깅·draft 복구 생략.")
            self.command_agent(
                f"2차 AI QA(Ollama) 인프라 오류로 검수가 중단되었습니다. "
                f"앱 코드 디버깅이 아닙니다. Ollama 복구 후 `./MDs/{phase}_RESULT.md` 재제출, "
                f"`python agent_orchestrator.py --qa {phase}` 재시도, "
                f"또는 `python agent_orchestrator.py --pass {phase}` 로 우회하세요.\n\n"
                f"[QA 반려 사유]\n{reason}"
            )
            return

        if manual_qa:
            self.command_agent(
                f"수동 QA 결과 결함이 발견되었습니다. 코드를 디버깅해.\n\n[QA 반려 사유]\n{reason}"
            )
            return

        draft_path = result_path.replace("_RESULT.md", "_RESULT_draft.md")
        try:
            if result_path and os.path.exists(result_path):
                if os.path.exists(draft_path):
                    os.remove(draft_path)
                os.rename(result_path, draft_path)
                print(
                    f"🔄 [오케스트레이터] {result_name} -> "
                    f"{os.path.basename(draft_path)} 로 강제 복구 (무한루프 방어)"
                )
        except Exception as e:
            print(f"⚠️ 파일 강제 전환 중 오류 발생: {e}")

        hint_message = ""
        if "CDP unavailable" in reason or "WEBVIEW2" in reason:
            hint_message = (
                "\n\n💡 [오케스트레이터 힌트]: 브라우저/WebView2 실행 시 "
                "`--remote-debugging-port=9222` 를 추가해 CDP를 활성화하세요."
            )

        self.command_agent(
            f"테스트/검수 결과 결함이 발견되었습니다. 아래 사유를 바탕으로 코드를 디버깅해.\n"
            f"⚠️ [핵심 규칙]: 수정 작업은 현재 생성된 임시 파일인 "
            f"`./MDs/{phase}_RESULT_draft.md` 에서 진행하고, "
            f"수정이 완전히 끝나면 `./MDs/{phase}_RESULT.md` 로 파일명을 변경해라.\n\n"
            f"[QA 반려 사유]\n{reason}"
            f"{hint_message}"
        )

    def command_agent(self, message):
        if AGENT_MODE == "cursor_cli":
            self._send_via_cursor_cli(message)
        elif AGENT_MODE == "aider":
            self._send_via_aider(message)
        else:
            self._send_via_gui(message)

    def _send_via_cursor_cli(self, message):
        print("[RPA] Cursor CLI 헤드리스 전송 (마우스 자유) 🚀")
        project_root = os.path.dirname(os.path.abspath(__file__))

        # ── 메시지를 명령줄 인자가 아니라 '환경변수'로 WSL에 전달 ──────────
        # message 안의 작은따옴표('), 백틱(`), $ 등이 bash 명령으로
        # 해석되어 "unexpected EOF" 오류가 나는 것을 원천 차단한다.
        # WSLENV 를 통해 Windows 환경변수를 WSL 안으로 그대로 넘기고,
        # WSL 안에서는 "$CURSOR_MSG" 로 안전하게 참조한다.
        cli_parts = CURSOR_CLI_BIN.split()          # 예: ["wsl", "/home/ggu/.local/bin/cursor-agent"]
        wsl_prefix = []
        agent_path = CURSOR_CLI_BIN
        if cli_parts and cli_parts[0].lower() == "wsl":
            wsl_prefix = ["wsl"]
            agent_path = " ".join(cli_parts[1:])    # 예: "/home/ggu/.local/bin/cursor-agent"

        # ── [V5.0] 세션 재사용 ──────────────────────────────────────────
        # 콜드 스타트(세션 없음): 새 세션을 만들고 session_id 를 캡처해 저장.
        # 워밍 스타트(세션 있음): --resume <id> 로 직전 컨텍스트를 이어받아
        #   코드베이스 재탐색을 생략 → 입력 토큰을 크게 절감한다.
        # resume 실패(만료/유실) 시: 세션 파일을 지우고 콜드 스타트로 1회 재시도.
        def _build_cmd(resume_id: str):
            # cursor-agent 에 넘길 옵션 (session_id 캡처 위해 json 출력)
            agent_opts = '-p -f --output-format json'
            if CURSOR_CLI_MODEL:
                agent_opts += f' -m {CURSOR_CLI_MODEL}'
            if resume_id:
                agent_opts += f' --resume {resume_id}'

            if wsl_prefix:
                # WSL 안에서 실행할 bash 한 줄: 메시지는 "$CURSOR_MSG" 로만 참조
                bash_line = f'{agent_path} {agent_opts} "$CURSOR_MSG"'
                return ["wsl", "-e", "bash", "-lc", bash_line]
            # WSL 이 아니라 네이티브 실행인 경우: 인자로 직접 전달
            native = cli_parts + ["-p", "-f", "--output-format", "json"]
            if CURSOR_CLI_MODEL:
                native += ["-m", CURSOR_CLI_MODEL]
            if resume_id:
                native += ["--resume", resume_id]
            native.append(message)
            return native

        # 환경변수 구성: CURSOR_MSG 에 메시지를 담고, WSLENV 로 WSL 에 공유
        run_env = os.environ.copy()
        run_env["CURSOR_MSG"] = message
        existing_wslenv = run_env.get("WSLENV", "")
        if "CURSOR_MSG" not in existing_wslenv:
            run_env["WSLENV"] = (existing_wslenv + ":" if existing_wslenv else "") + "CURSOR_MSG"

        def _run_once(resume_id: str):
            cmd = _build_cmd(resume_id)
            mode_label = f"--resume {resume_id[:8]}…" if resume_id else "콜드 스타트(신규 세션)"
            print(f"   🧵 [세션] {mode_label}")
            return subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=CURSOR_CLI_TIMEOUT,
                cwd=project_root,
                env=run_env,
            )

        try:
            session_id = _load_session_id()
            result = _run_once(session_id)

            # resume 실패 → 세션 파기 후 콜드 스타트 1회 폴백
            if (
                session_id
                and (
                    result.returncode != 0
                    or _stdout_indicates_resume_failure(
                        result.returncode, result.stdout or "", result.stderr or ""
                    )
                )
            ):
                print("   ⚠️ [세션] resume 실패 감지 — 세션을 파기하고 콜드 스타트로 재시도합니다.")
                _clear_session_id()
                session_id = ""
                result = _run_once("")

            # 새 세션이면 session_id 캡처 후 저장(다음 단계부터 재사용)
            if not session_id:
                new_sid = _extract_session_id(result.stdout or "")
                if new_sid:
                    _save_session_id(new_sid)
                    print(f"   💾 [세션] 새 session_id 저장: {new_sid[:8]}… (다음 단계부터 재사용)")
                else:
                    print("   ℹ️ [세션] 출력에서 session_id 를 찾지 못했습니다(다음 단계도 콜드 스타트).")

            if result.returncode != 0:
                print(f"⚠️ [cursor-agent 오류] {(result.stderr or '').strip()[:300]}")
            else:
                print("✅ [cursor-agent] 지시 처리 완료. (./MDs 변경을 watchdog가 감지)")
        except subprocess.TimeoutExpired:
            print("⚠️ [cursor-agent] 시간 초과 — 행 방지 위해 중단했습니다.")
        except FileNotFoundError:
            print("❌ 'cursor-agent' 를 찾지 못했습니다. 설치/PATH 또는 WSL 설정을 확인하세요.")

    def _send_via_aider(self, message):
        print("[RPA] Aider 헤드리스 전송 (마우스 자유) 🚀")
        project_root = os.path.dirname(os.path.abspath(__file__))
        cmd = ["aider", "--message", message, "--yes-always", "--no-auto-commits"]
        if AIDER_MODEL:
            cmd += ["--model", AIDER_MODEL]
        try:
            subprocess.run(cmd, cwd=project_root, timeout=1800)
            print("✅ [aider] 지시 처리 완료.")
        except subprocess.TimeoutExpired:
            print("⚠️ [aider] 시간 초과.")
        except FileNotFoundError:
            print("❌ 'aider' 를 찾지 못했습니다. pip install aider-chat 로 설치하세요.")

    def _send_via_gui(self, message):
        if not _GUI_AVAILABLE:
            print("❌ GUI 모드에는 pyautogui/pygetwindow 가 필요합니다.")
            return

        print("[RPA] Cursor GUI 에이전트 가동 (마우스 손 떼세요!) ⌨️")
        pyperclip.copy(message)
        time.sleep(0.4)
        if not pyperclip.paste():
            pyperclip.copy(message)
            time.sleep(0.4)

        if not self._focus_cursor_window():
            print("⚠️ Cursor 창 포커스 실패 — 좌표 기반으로 그래도 시도합니다.")

        w, h = pyautogui.size()
        pyautogui.hotkey("ctrl", "i")
        time.sleep(GUI_PANE_WAIT)
        pyautogui.click(int(w * GUI_INPUT_X_RATIO), int(h * GUI_INPUT_Y_RATIO))
        time.sleep(0.5)
        pyautogui.hotkey("ctrl", "a")
        time.sleep(0.2)
        pyautogui.hotkey("ctrl", "v")
        time.sleep(0.8)
        pyautogui.press("enter")
        print("✅ [GUI] 전송 시퀀스 완료 — Cursor 채팅창을 확인하세요.")

    def _focus_cursor_window(self):
        try:
            wins = [x for x in gw.getWindowsWithTitle("Cursor")
                    if x.title and x.title.strip().endswith("Cursor")]
            if not wins:
                wins = gw.getWindowsWithTitle("Cursor")
            if not wins:
                return False

            win = wins[0]
            for _ in range(3):
                try:
                    if win.isMinimized:
                        win.restore()
                    win.minimize(); time.sleep(0.2)
                    win.restore();  time.sleep(0.3)
                    try:
                        win.maximize()
                    except Exception:
                        pass
                    win.activate()
                    time.sleep(0.4)
                    if getattr(win, "isActive", False):
                        return True
                except Exception as e:
                    if "Error code from Windows: 0" in str(e):
                        return True
                    time.sleep(0.3)
            return True
        except Exception as e:
            print(f"⚠️ 창 활성화 예외: {e}")
            return False


def main():
    os.makedirs(WATCH_DIR, exist_ok=True)

    if len(sys.argv) > 1:
        cmd = sys.argv[1]

        if cmd == "--pass" and len(sys.argv) >= 3:
            phase = sys.argv[2]
            flag_path = os.path.join(WATCH_DIR, f"{phase}_OVERRIDE_PASS.flag")
            open(flag_path, 'w').close()
            print(f"📩 [{phase}단계 PASS] 신호를 백그라운드 오케스트레이터로 전송했습니다.")
            sys.exit(0)

        elif cmd == "--qa" and len(sys.argv) >= 3:
            phase = sys.argv[2]
            flag_path = os.path.join(WATCH_DIR, f"{phase}_OVERRIDE_QA.flag")
            open(flag_path, 'w').close()
            print(f"📩 [{phase}단계 QA 즉시시작] 신호를 백그라운드 오케스트레이터로 전송했습니다.")
            sys.exit(0)

    handler  = CursorOrchestrator()
    # WSL(cursor-agent)이 수정한 파일을 Windows watchdog 이벤트가 놓치는 문제 방지:
    # 이벤트 기반 Observer 대신 폴더를 주기적으로 직접 스캔하는 PollingObserver 사용.
    observer = PollingObserver(timeout=2)
    observer.schedule(handler, WATCH_DIR, recursive=False)
    observer.start()

    mode_map = {
        "cursor_cli": "Cursor CLI 헤드리스 (권장)",
        "aider":      "Aider 헤드리스",
        "gui":        "Cursor UI 매크로 (폴백)",
    }
    print("=" * 64)
    print("  AI ORCHESTRATOR V5.0  -  Token-Optimized Edition 💸")
    print(f"  [초기 상태] 최고 진척도 {handler.current_phase}단계부터 감시 시작")
    print(f"  [동작 모드] {mode_map.get(AGENT_MODE, AGENT_MODE)}")
    print(f"  [V5.0] 세션 재사용(--resume) · diff기반 QA · Git체크포인트 · 재시도한도({MAX_PHASE_RETRIES})")
    print(f"  [V4.9] Final.md → build.bat 실행 → GitHub draft 릴리즈 자동 생성")
    sid_preview = _load_session_id()
    if sid_preview:
        print(f"  [세션] 기존 세션 이어받기 예정: {sid_preview[:8]}…")
    else:
        print(f"  [세션] 세션 없음 → 첫 지시에서 새 세션 생성·저장")
    if AGENT_MODE == "gui" and not _GUI_AVAILABLE:
        print("  ⚠️ GUI 모드인데 pyautogui/pygetwindow 가 없습니다.")
    print("=" * 64)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


if __name__ == "__main__":
    main()
