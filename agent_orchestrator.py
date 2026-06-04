# -*- coding: utf-8 -*-
"""
agent_orchestrator.py V4.8 (Headless Edition 🛡️📡)
=====================================================
[ V4.8 변경점 ]
- command_agent 전송 방식을 3-way 로 재설계:
    "cursor_cli" : (권장) Cursor 터미널 에이전트(cursor-agent)로 백그라운드 전송.
                   마우스/창 포커스와 완전히 무관. 오류 없이 안정적.
    "aider"      : Aider 헤드리스 전송(로컬 Ollama 모델이면 작성까지 무료).
    "gui"        : 기존 키보드 매크로(포그라운드 락 우회 · 입력창 직접 클릭으로 강화). 폴백용.
- GUI 전용 라이브러리(pyautogui/pygetwindow)를 '선택적 import' 로 변경
  → cursor_cli/aider 모드만 쓰면 두 라이브러리가 없어도 정상 동작.

[ 기존 V4.7 유지 기능 ]
1. Headless Agent 전환 스위치
2. Hybrid QA (Static Linter + LLM JSON 안정화 파싱)
3. Atomic Rename + Smart Debounce (AI 지시 불이행 및 무한루프 완벽 방어)
4. Final.md Phase(999) 고정 및 긴 에러 로그 토큰 폭발 방어
5. 신호 파일(.flag) 기반 프로세스 간 통신(IPC) 및 런타임 검수 강제 취소 기능
"""

import os
import sys
import time
import json
import subprocess
import requests
import pyperclip

# [V4.8] GUI 매크로(폴백) 전용 의존성 — cursor_cli/aider 모드만 쓰면 없어도 됩니다.
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
from watchdog.events import FileSystemEventHandler

# ==========================================
# ⚙️ 시스템 마스터 설정
# ==========================================
WATCH_DIR      = "./MDs"
OLLAMA_URL     = "http://localhost:11434/api/generate"
OLLAMA_MODEL   = "qwen2.5-coder:32b"
TYPING_DELAY   = 1.2
STABILITY_WAIT = 30  # RESULT.md 쓰기 완료 대기(초). 초안→리네임 구조라 더 줄여도 무방.

STATIC_CHECK_CMD = "node scripts/diag-p2.mjs"  # ⚠️ 본인 프로젝트의 빌드/진단 명령으로 교체

# ------------------------------------------
# 🤖 작성 에이전트 전송 방식 (한 줄로 전환)
#   "cursor_cli" : (권장) Cursor 터미널 에이전트로 백그라운드 전송. GUI/마우스 무관.
#   "aider"      : Aider 헤드리스. 로컬 Ollama 모델이면 작성까지 완전 무료.
#   "gui"        : 기존 키보드 매크로(강화판). 최후의 수단.
# ------------------------------------------
AGENT_MODE = "cursor_cli"

# --- cursor_cli 옵션 ---
CURSOR_CLI_BIN     = "wsl cursor-agent"  # WSL 사용 시: "wsl cursor-agent"
CURSOR_CLI_MODEL   = ""              # 비우면 Auto(Pro 포함분/무제한). 예: "claude-4.5-sonnet"(크레딧 차감)
CURSOR_CLI_TIMEOUT = 1800            # 한 단계 지시 최대 대기(초). 행(hang) 방어용.

# --- aider 옵션 ---
# 로컬 Ollama로 작성(무료). 모델 접두사는 aider 버전에 따라 "ollama/..." 또는
# "ollama_chat/..." 이니 aider 문서 확인. 필요 시 env OLLAMA_API_BASE=http://localhost:11434
AIDER_MODEL = "ollama_chat/qwen2.5-coder:32b"

# --- gui 옵션(강화판) ---
GUI_INPUT_X_RATIO = 0.80   # 채팅 입력창 클릭 좌표 비율(창 최대화 기준, 우측)
GUI_INPUT_Y_RATIO = 0.92   # 하단
GUI_PANE_WAIT     = 4.0    # Ctrl+I 후 패널 로딩 대기(초). 32B 추론 직후엔 넉넉히.


class CursorOrchestrator(FileSystemEventHandler):

    def __init__(self):
        super().__init__()
        self.file_locks = {}
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
            # 💡 [V4.7 방어망] 대기 도중 터미널 명령어(신호)가 들어왔는지 실시간 감시
            if phase is not None:
                pass_flag = os.path.join(WATCH_DIR, f"{phase}_OVERRIDE_PASS.flag")
                qa_flag   = os.path.join(WATCH_DIR, f"{phase}_OVERRIDE_QA.flag")
                if os.path.exists(pass_flag) or os.path.exists(qa_flag):
                    print("🚨 [긴급 신호 감지] 사용자의 오버라이드 명령을 수신하여 기존 대기/검수를 즉시 취소합니다!")
                    return False  # 즉시 대기 중단 및 현재 파일 처리 취소

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

    # ==========================================
    # 🔍 이벤트 리스너
    # ==========================================
    def on_created(self, event):
        if not event.is_directory: self._process_file(os.path.abspath(event.src_path))

    def on_modified(self, event):
        if not event.is_directory: self._process_file(os.path.abspath(event.src_path))

    def on_moved(self, event):
        if not event.is_directory: self._process_file(os.path.abspath(event.dest_path))

    # ==========================================
    # 🧠 메인 비즈니스 로직
    # ==========================================
    def _process_file(self, path):
        name = os.path.basename(path)
        file_key = name.lower()

        # [V4.7] .md 파일뿐만 아니라 신호용 .flag 파일도 감지하도록 조건 수정
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

        # 신호 파일(.flag)은 대기할 필요 없음, RESULT.md만 대기
        wait_time = STABILITY_WAIT if "RESULT.md" in name else 1
        if not name.endswith(".flag"):
            if not self._wait_for_stability(path, wait_time, file_phase):
                return  # 오버라이드 신호로 인해 취소된 경우 종료

        try:
            self.file_locks[file_key] = os.path.getmtime(path)
        except OSError:
            pass

        # ----------------------------------------
        # 분기 처리
        # ----------------------------------------
        # 💡 [V4.7 신규 분기] 관리자 강제 PASS 신호 처리
        if name.endswith("_OVERRIDE_PASS.flag"):
            phase = name.split("_")[0]
            next_phase = int(phase) + 1
            os.remove(path)  # 신호 파일 청소

            # 진행 중이던 RESULT.md 락을 무한대로 걸어 중복 처리 방지
            self.file_locks[f"{phase}_result.md"] = float('inf')

            print(f"🚀 [수동 개입 실행] {phase}단계 강제 PASS! 즉시 다음 단계 지시를 내립니다...")
            self.command_agent(
                f"사용자(관리자)에 의해 {phase}단계가 검수를 생략하고 강제 통과(PASS) 되었습니다. "
                f"바로 다음 단계인 ./MDs/{next_phase}_PROMPT.md 를 생성해줘. "
                f"(만약 최종 단계였다면 Final.md 를 만들어줘)"
            )

        # 💡 [V4.7 신규 분기] 관리자 즉시 QA 신호 처리
        elif name.endswith("_OVERRIDE_QA.flag"):
            phase = name.split("_")[0]
            os.remove(path)  # 신호 파일 청소

            self.file_locks[f"{phase}_result.md"] = float('inf')
            print(f"⚡ [수동 개입 실행] 30초 대기 & 1차 검증 생략! 바로 {phase}단계 AI 검수(QA) 시작...")

            target_md = os.path.join(WATCH_DIR, f"{phase}_RESULT.md")
            if not os.path.exists(target_md):
                print(f"⚠️ {target_md} 파일이 존재하지 않아 QA를 진행할 수 없습니다.")
                return

            try:
                with open(target_md, "r", encoding="utf-8") as f:
                    content = f.read()
                verdict, reason = self.run_local_qa(content)
            except Exception as e:
                verdict, reason = "FAIL", f"파일 읽기 오류: {e}"

            if verdict == "PASS":
                next_phase = int(phase) + 1
                print(f"[QA] PASS -> {next_phase}단계 지시.")
                self.command_agent(
                    f"2차 AI 코드 리뷰를 완벽히 통과했습니다(PASS). "
                    f"다음 단계인 ./MDs/{next_phase}_PROMPT.md 를 생성해줘."
                )
            else:
                print(f"[QA] FAIL -> 디버깅 지시.")
                self.command_agent(
                    f"수동 QA 결과 결함이 발견되었습니다. 코드를 디버깅해.\n\n[QA 반려 사유]\n{reason}"
                )

        # 기존 일반 로직들
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
                    verdict, reason = self.run_local_qa(content)
                except Exception as e:
                    verdict, reason = "FAIL", f"파일 읽기 오류: {e}"

            if verdict == "PASS":
                print(f"[QA] PASS -> {phase}단계 완벽 통과. 다음 단계 지시.")
                self.file_locks[file_key] = float('inf')
                next_phase = int(phase) + 1
                self.command_agent(
                    f"1차 빌드 테스트와 2차 AI 코드 리뷰를 모두 통과했습니다(PASS). "
                    f"다음 단계인 ./MDs/{next_phase}_PROMPT.md 를 생성해줘. "
                    f"(만약 최종 단계였다면 Final.md 를 만들어줘)"
                )
            else:
                print(f"[QA] FAIL -> 디버깅 지시. 사유: {reason[:100]}...")
                draft_path = path.replace("_RESULT.md", "_RESULT_draft.md")
                try:
                    if os.path.exists(path):
                        if os.path.exists(draft_path):
                            os.remove(draft_path)
                        os.rename(path, draft_path)
                        print(f"🔄 [오케스트레이터] {name} -> {os.path.basename(draft_path)} 로 강제 복구 (무한루프 방어)")
                except Exception as e:
                    print(f"⚠️ 파일 강제 전환 중 오류 발생: {e}")

                hint_message = ""
                if "CDP unavailable" in reason or "WEBVIEW2" in reason:
                    hint_message = "\n\n💡 [오케스트레이터 힌트]: 브라우저/WebView2 실행 시 환경변수나 인자로 `--remote-debugging-port=9222`를 추가해 CDP를 활성화하세요."

                self.command_agent(
                    f"테스트/검수 결과 결함이 발견되었습니다. 아래 사유를 바탕으로 코드를 디버깅해.\n"
                    f"⚠️ [핵심 규칙]: 수정 작업은 현재 생성된 임시 파일인 `./MDs/{phase}_RESULT_draft.md` 에서 진행하고, "
                    f"수정이 완전히 끝나면 `./MDs/{phase}_RESULT.md` 로 파일명을 변경해라.\n\n"
                    f"[QA 반려 사유]\n{reason}"
                    f"{hint_message}"
                )

        elif name.endswith("Final.md"):
            self.file_locks[file_key] = float('inf')
            print("\n🎉 [완료] 최종 명세서(Final.md)가 감지되었습니다. 릴리즈 종료.")
            os._exit(0)

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

    def run_local_qa(self, code_content):
        system_rule = (
            "너는 매우 깐깐한 시니어 코드 리뷰어다. 제공된 코드와 문서의 버그, 취약점을 점검해라.\n"
            "반드시 아래 JSON 형식으로만 대답해라. 다른 텍스트는 절대 출력하지 마라.\n"
            '{"status": "PASS", "reason": "이유 설명", "score": 점수}\n'
            "결함이 있으면 status를 FAIL로 설정해라.\n\n"
            "----- 검토 대상 -----\n"
        )
        payload = {
            "model":  OLLAMA_MODEL,
            "prompt": system_rule + code_content,
            "format": "json",
            "stream": False,
            "options": {"temperature": 0.1},
        }
        try:
            res = requests.post(OLLAMA_URL, json=payload, timeout=1800)
            res.raise_for_status()
            answer = res.json().get("response", "").strip()

            start_idx = answer.find('{')
            end_idx = answer.rfind('}')

            if start_idx != -1 and end_idx != -1:
                clean_json = answer[start_idx:end_idx+1]
                data = json.loads(clean_json)
                status = data.get("status", "FAIL").upper()
                reason = data.get("reason", "이유가 누락되었습니다.")
                return (status, reason)
            else:
                return ("FAIL", f"AI가 JSON 형식을 반환하지 않았습니다. 원본 응답:\n{answer}")

        except Exception as e:
            return ("FAIL", f"QA 통신/파싱 중 예외 발생: {e}")

    # ==========================================
    # 📡 작성 에이전트 전송 (V4.8 - 3-way)
    # ==========================================
    def command_agent(self, message):
        if AGENT_MODE == "cursor_cli":
            self._send_via_cursor_cli(message)
        elif AGENT_MODE == "aider":
            self._send_via_aider(message)
        else:
            self._send_via_gui(message)

    # ---------- (A) Cursor CLI 헤드리스 (권장) ----------
    def _send_via_cursor_cli(self, message):
        print("[RPA] Cursor CLI 헤드리스 전송 (마우스 자유) 🚀")
        project_root = os.path.dirname(os.path.abspath(__file__))

        # -p: 비대화형 / -f: 도구 자동승인(무인 필수) / 출력은 text 로 받아 깔끔히 종료
        cmd = CURSOR_CLI_BIN.split() + ["-p", "-f", "--output-format", "text"]
        if CURSOR_CLI_MODEL:
            cmd += ["-m", CURSOR_CLI_MODEL]
        cmd.append(message)  # 프롬프트는 위치 인자로 전달

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=CURSOR_CLI_TIMEOUT,
                cwd=project_root,   # .cursorrules / ./MDs 인식용
            )
            if result.returncode != 0:
                print(f"⚠️ [cursor-agent 오류] {(result.stderr or '').strip()[:300]}")
            else:
                print("✅ [cursor-agent] 지시 처리 완료. (./MDs 변경을 watchdog가 감지)")
        except subprocess.TimeoutExpired:
            # 과거 -p 모드 행(hang) 버그 방어. 타임아웃이면 다음 파일 이벤트로 회복.
            print("⚠️ [cursor-agent] 시간 초과 — 행 방지 위해 중단했습니다.")
        except FileNotFoundError:
            print("❌ 'cursor-agent' 를 찾지 못했습니다. 설치/PATH 또는 WSL 설정을 확인하세요.")
        # 참고: 위치 인자가 무시되는 버전이면 stdin 파이프로 시도하세요.
        #   echo "프롬프트" | cursor-agent -p -f --output-format text

    # ---------- (B) Aider 헤드리스 ----------
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

    # ---------- (C) GUI 매크로 (강화판, 최후의 수단) ----------
    def _send_via_gui(self, message):
        if not _GUI_AVAILABLE:
            print("❌ GUI 모드에는 pyautogui/pygetwindow 가 필요합니다. pip install pyautogui pygetwindow")
            return

        print("[RPA] Cursor GUI 에이전트 가동 (마우스 손 떼세요!) ⌨️")
        pyperclip.copy(message)
        time.sleep(0.4)
        if not pyperclip.paste():          # 클립보드 적재 확인 후 재시도
            pyperclip.copy(message)
            time.sleep(0.4)

        # 1) Cursor 창을 확실히 포그라운드로 (Windows 포그라운드 락 우회)
        if not self._focus_cursor_window():
            print("⚠️ Cursor 창 포커스 실패 — 좌표 기반으로 그래도 시도합니다.")

        w, h = pyautogui.size()

        # 2) Agent(Composer) 패널 열기/포커스
        pyautogui.hotkey("ctrl", "i")
        time.sleep(GUI_PANE_WAIT)          # 32B 추론 직후 UI 지연 대비 넉넉히

        # 3) 에디터가 아니라 '채팅 입력창'을 직접 클릭해 포커스
        pyautogui.click(int(w * GUI_INPUT_X_RATIO), int(h * GUI_INPUT_Y_RATIO))
        time.sleep(0.5)

        # 4) 기존 입력 내용 정리 후 붙여넣기 → 전송
        pyautogui.hotkey("ctrl", "a")
        time.sleep(0.2)
        pyautogui.hotkey("ctrl", "v")
        time.sleep(0.8)
        pyautogui.press("enter")
        print("✅ [GUI] 전송 시퀀스 완료 — Cursor 채팅창을 확인하세요.")

    def _focus_cursor_window(self):
        """Windows 포그라운드 락을 우회해 Cursor 창을 맨 앞으로 가져온다."""
        try:
            # 제목이 'Cursor'로 끝나는 창만(브라우저 탭 등 오탐 제거)
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
                    # 최소화→복원 토글이 activate() 보다 포그라운드 전환에 안정적
                    win.minimize(); time.sleep(0.2)
                    win.restore();  time.sleep(0.3)
                    try:
                        win.maximize()   # 좌표 클릭을 예측 가능하게
                    except Exception:
                        pass
                    win.activate()
                    time.sleep(0.4)
                    if getattr(win, "isActive", False):
                        return True
                except Exception as e:
                    # SetForegroundWindow 가 0 반환(락) — 실제로는 떠 있는 경우가 많음
                    if "Error code from Windows: 0" in str(e):
                        return True
                    time.sleep(0.3)
            return True
        except Exception as e:
            print(f"⚠️ 창 활성화 예외: {e}")
            return False


def main():
    os.makedirs(WATCH_DIR, exist_ok=True)

    # 💡 [V4.7 통신 구조] 터미널 B에서 명령 입력 시, 신호(Flag) 파일만 전송하고 즉시 종료
    if len(sys.argv) > 1:
        cmd = sys.argv[1]

        if cmd == "--pass" and len(sys.argv) >= 3:
            phase = sys.argv[2]
            flag_path = os.path.join(WATCH_DIR, f"{phase}_OVERRIDE_PASS.flag")
            open(flag_path, 'w').close()  # 빈 신호 파일 생성
            print(f"📩 [{phase}단계 PASS] 신호를 백그라운드 오케스트레이터로 전송했습니다.")
            sys.exit(0)

        elif cmd == "--qa" and len(sys.argv) >= 3:
            phase = sys.argv[2]
            flag_path = os.path.join(WATCH_DIR, f"{phase}_OVERRIDE_QA.flag")
            open(flag_path, 'w').close()
            print(f"📩 [{phase}단계 QA 즉시시작] 신호를 백그라운드 오케스트레이터로 전송했습니다.")
            sys.exit(0)

    # ==========================================
    # 일반 감시 모드 (터미널 A)
    # ==========================================
    handler  = CursorOrchestrator()
    observer = Observer()
    observer.schedule(handler, WATCH_DIR, recursive=False)
    observer.start()

    mode_map = {
        "cursor_cli": "Cursor CLI 헤드리스 (권장)",
        "aider":      "Aider 헤드리스",
        "gui":        "Cursor UI 매크로 (폴백)",
    }
    print("=" * 64)
    print("  AI ORCHESTRATOR V4.8  -  Headless Edition 📡")
    print(f"  [초기 상태] 최고 진척도 {handler.current_phase}단계부터 감시 시작")
    print(f"  [동작 모드] {mode_map.get(AGENT_MODE, AGENT_MODE)}")
    if AGENT_MODE == "gui" and not _GUI_AVAILABLE:
        print("  ⚠️ GUI 모드인데 pyautogui/pygetwindow 가 없습니다. pip install pyautogui pygetwindow")
    print("=" * 64)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


if __name__ == "__main__":
    main()
