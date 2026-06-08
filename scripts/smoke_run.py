#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/smoke_run.py  —  스모크 런 (실행 가능성 게이트)
========================================================
빌드된 실행물을 실제로 띄워서 "기동 직후 죽는지"를 잡는다.
`cargo check`/`cargo tauri build` 가 통과해도 런타임에 패닉/즉시 종료하는 결함을 마지막으로 거른다.

오케스트레이터 계약: 종료코드 0=PASS, !=0=FAIL. 요약은 출력 맨 끝.

사용법:
  python scripts/smoke_run.py [--timeout 8] <실행물 경로 또는 명령> [인자...]
예:
  python scripts/smoke_run.py src-tauri/target/release/myapp.exe
  python scripts/smoke_run.py --timeout 10 ./build/app

판정:
  - timeout 안에 비정상 종료(코드 != 0)  → FAIL (기동 크래시)
  - stderr 에 패닉 흔적('panicked' 등)    → FAIL
  - timeout 까지 살아있음(GUI 정상 기동)  → PASS (프로세스 종료시키고 통과)
  - timeout 전에 코드 0 으로 조용히 종료  → WARN(PASS) (CLI/단발 실행일 수 있음)
"""
import sys
import time
import subprocess

PANIC_MARKERS = (
    "panicked", "thread 'main' panicked", "error while running tauri",
    "Traceback (most recent call last)", "fatal runtime error",
)


def main():
    args = sys.argv[1:]
    timeout = 8.0
    if args and args[0] == "--timeout":
        timeout = float(args[1])
        args = args[2:]
    if not args:
        print("사용법: smoke_run.py [--timeout N] <실행물> [인자...]")
        print("SMOKE RUN: FAIL (실행물 경로 없음)")
        sys.exit(2)

    cmd = args
    print("=" * 60)
    print(f"  스모크 런: {' '.join(cmd)}  (timeout={timeout}s)")
    print("=" * 60)

    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace",
        )
    except (OSError, ValueError) as e:
        print(f"실행 불가: {e}")
        print("\nSMOKE RUN: FAIL (프로세스를 시작하지 못함)")
        sys.exit(1)

    try:
        rc = proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        # timeout 까지 살아있음 = 정상 기동. 종료시키고 PASS.
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        # 살아있던 동안의 stderr 일부라도 패닉 검사
        err = _drain(proc.stderr)
        if _has_panic(err):
            _tail("STDERR", err)
            print("\nSMOKE RUN: FAIL (기동했으나 패닉 로그 감지)")
            sys.exit(1)
        print(f"\nSMOKE RUN: PASS (정상 기동 — {timeout}s 생존 후 종료)")
        sys.exit(0)

    # timeout 전에 종료됨
    out = _drain(proc.stdout)
    err = _drain(proc.stderr)
    if rc != 0:
        _tail("STDERR", err or out)
        print(f"\nSMOKE RUN: FAIL (기동 직후 비정상 종료, exit={rc})")
        sys.exit(1)
    if _has_panic(err) or _has_panic(out):
        _tail("STDERR", err or out)
        print("\nSMOKE RUN: FAIL (exit 0 이나 패닉 로그 감지)")
        sys.exit(1)
    print(f"\nSMOKE RUN: PASS (exit 0 으로 정상 종료 — CLI/단발 실행으로 간주)")
    sys.exit(0)


def _drain(stream):
    try:
        return stream.read() or "" if stream else ""
    except (OSError, ValueError):
        return ""


def _has_panic(text):
    low = (text or "").lower()
    return any(m.lower() in low for m in PANIC_MARKERS)


def _tail(label, text, n=1000):
    t = (text or "").strip()
    if not t:
        return
    print(f"----- {label} (끝부분) -----")
    print(t[-n:])


if __name__ == "__main__":
    main()
