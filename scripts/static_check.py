#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/static_check.py  —  1차 정적 검증 게이트 (V5.0)
=======================================================
오케스트레이터 계약:
  - 프로젝트 루트(cwd)에서 `python scripts/static_check.py` 로 실행된다.
  - 종료코드 0  → PASS
  - 종료코드 !=0 → FAIL (stdout/stderr 끝부분이 cursor-agent 디버깅 사유로 전달됨)

설계 원칙(시니어 베테랑 관행):
  - LLM 토큰 0원, 결정론적. 컴파일/타입/보안/논리 오류를 빌드 단계에서 차단.
  - 도구가 '설치 안 됨' → 경고(WARN, 비차단). 도구가 '진짜 결함 발견' → 실패(FAIL, 차단).
  - 검사할 소스가 아예 없으면(초기 단계) PASS — 기획/문서만 있는 단계의 헛FAIL 방지.
  - 차단 사유는 출력 '맨 끝'에 요약 → 오케스트레이터가 보존하는 마지막 1500자에 담기도록.

조정: 아래 BLOCK_* 플래그로 각 검사의 차단 여부를 켜고 끌 수 있다.
"""
import os
import sys
import json
import shutil
import subprocess
from pathlib import Path

# ───────────────────────── 설정 ─────────────────────────
BLOCK_SYNTAX  = True    # 파이썬 구문 오류 → 차단
BLOCK_RUFF    = True    # ruff (pyflakes 계열 실제 버그: 미정의/미사용/구문) → 차단
BLOCK_BANDIT  = True    # bandit 보안 이슈(중간 이상 심각도+신뢰도) → 차단
BLOCK_MYPY    = False   # mypy 타입 오류 → 기본 경고(비차단). 타입 강제 프로젝트면 True
BLOCK_PYTEST  = True    # tests 폴더가 있으면 pytest 실패 → 차단
BLOCK_TSC     = True    # tsconfig.json 이 있으면 `tsc --noEmit` 실패 → 차단
BLOCK_CARGO   = True    # Cargo.toml 이 있으면 `cargo check` 실패 → 차단 (Tauri v2 + Rust)

# 검사에서 제외할 디렉터리
EXCLUDE_DIRS = {
    ".git", "MDs", "node_modules", "venv", ".venv", "env",
    "build", "dist", "__pycache__", ".mypy_cache", ".ruff_cache", ".pytest_cache",
}
EXCLUDE_DIR_PREFIXES = ("MDs_backup_",)

ROOT = Path(os.getcwd()).resolve()
SELF = Path(__file__).resolve()

# 검사 결과 누적: (이름, 상태['PASS'|'WARN'|'FAIL'|'SKIP'], 상세)
results: "list[tuple[str, str, str]]" = []
blocking_failures: "list[str]" = []   # 차단 사유 요약(맨 끝 출력용)


def _configure_stdio():
    """Windows cp949 등 narrow 콘솔에서 UnicodeEncodeError 방지."""
    for stream in (sys.stdout, sys.stderr):
        if stream is None or not hasattr(stream, "reconfigure"):
            continue
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def log(msg=""):
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        enc = getattr(sys.stdout, "encoding", None) or "utf-8"
        safe = msg.encode(enc, errors="replace").decode(enc, errors="replace")
        print(safe, flush=True)


_configure_stdio()


def _excluded(path: Path) -> bool:
    try:
        parts = path.resolve().relative_to(ROOT).parts
    except ValueError:
        parts = path.parts
    for p in parts:
        if p in EXCLUDE_DIRS:
            return True
        if any(p.startswith(pre) for pre in EXCLUDE_DIR_PREFIXES):
            return True
    return False


def find_files(suffixes):
    out = []
    for p in ROOT.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() not in suffixes:
            continue
        if _excluded(p):
            continue
        if p.resolve() == SELF:   # 검사기 자신은 제외
            continue
        out.append(p)
    return out


def run(cmd, cwd=None, **kw):
    """도구 실행 헬퍼. (returncode, stdout, stderr) 반환. 미설치 시 (None, '', '')."""
    exe = cmd[0]
    if shutil.which(exe) is None:
        return None, "", ""
    try:
        r = subprocess.run(
            cmd, cwd=(cwd or str(ROOT)), capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=240, **kw,
        )
        return r.returncode, (r.stdout or ""), (r.stderr or "")
    except subprocess.TimeoutExpired:
        return 124, "", f"{exe} 실행이 시간 초과되었습니다."
    except Exception as e:
        return 1, "", f"{exe} 실행 오류: {e}"


def record(name, status, detail="", blocking=False):
    results.append((name, status, detail))
    icon = {"PASS": "✅", "WARN": "⚠️ ", "FAIL": "❌", "SKIP": "➖"}.get(status, "  ")
    log(f"{icon} [{name}] {status}" + (f" — {detail.splitlines()[0][:120]}" if detail else ""))
    if status == "FAIL" and detail:
        # 상세는 본문에도 일부 노출(디버깅 도움)
        snippet = detail.strip()
        if len(snippet) > 800:
            snippet = snippet[:800] + " ...(생략)"
        log(snippet)
    if blocking and status == "FAIL":
        head = detail.strip().splitlines()
        blocking_failures.append(f"[{name}] " + (head[0] if head else "결함 발견"))


# ───────────────────────── 검사들 ─────────────────────────
def check_python_syntax(py_files):
    bad = []
    for f in py_files:
        try:
            compile(f.read_text(encoding="utf-8", errors="replace"), str(f), "exec")
        except SyntaxError as e:
            rel = f.relative_to(ROOT)
            bad.append(f"{rel}:{e.lineno}: {e.msg}")
    if bad:
        record("py-syntax", "FAIL", "파이썬 구문 오류:\n" + "\n".join(bad[:30]),
               blocking=BLOCK_SYNTAX)
    else:
        record("py-syntax", "PASS")


def check_ruff():
    if shutil.which("ruff") is None:
        record("ruff", "WARN", "ruff 미설치 — `pip install ruff` 권장(논리/미정의 변수 검출)")
        return
    # E9(구문) + F(pyflakes: 미정의/미사용/중복 등 '진짜 버그') 만 차단 대상으로
    rc, out, err = run([
        "ruff", "check", ".", "--select", "E9,F", "--quiet",
        "--exclude", ",".join(sorted(EXCLUDE_DIRS)),
    ])
    detail = (out + "\n" + err).strip()
    if rc == 0:
        record("ruff", "PASS")
    else:
        record("ruff", "FAIL", detail or "ruff 위반 발견", blocking=BLOCK_RUFF)


def check_bandit():
    if shutil.which("bandit") is None:
        record("bandit", "WARN", "bandit 미설치 — `pip install bandit` 권장(보안 취약점 검출)")
        return
    # -ll: 중간 이상 심각도, -ii: 중간 이상 신뢰도, -q: 조용히, JSON 으로 파싱
    rc, out, err = run([
        "bandit", "-r", ".", "-ll", "-ii", "-q", "-f", "json",
        "-x", ",".join("./" + d for d in sorted(EXCLUDE_DIRS)),
    ])
    if rc is None:
        return
    issues = []
    try:
        data = json.loads(out or "{}")
        for r in data.get("results", []):
            issues.append(
                f"{r.get('filename')}:{r.get('line_number')} "
                f"[{r.get('issue_severity')}/{r.get('issue_confidence')}] "
                f"{r.get('test_id')} {r.get('issue_text')}"
            )
    except json.JSONDecodeError:
        if rc != 0:
            record("bandit", "FAIL", (err or out or "bandit 오류").strip(), blocking=BLOCK_BANDIT)
            return
    if issues:
        record("bandit", "FAIL", "보안 이슈(중간 이상):\n" + "\n".join(issues[:20]),
               blocking=BLOCK_BANDIT)
    else:
        record("bandit", "PASS")


def check_mypy(py_files):
    if shutil.which("mypy") is None:
        record("mypy", "WARN", "mypy 미설치 — `pip install mypy` 권장(타입 검사)")
        return
    rc, out, err = run([
        "mypy", ".", "--ignore-missing-imports", "--no-error-summary",
        "--exclude", "|".join(sorted(EXCLUDE_DIRS)),
    ])
    detail = (out + "\n" + err).strip()
    if rc == 0:
        record("mypy", "PASS")
    else:
        # 기본은 비차단(WARN). BLOCK_MYPY=True 면 차단.
        status = "FAIL" if BLOCK_MYPY else "WARN"
        record("mypy", status, detail or "mypy 타입 경고", blocking=BLOCK_MYPY)


def check_pytest():
    has_tests = any(
        (ROOT / d).is_dir() for d in ("tests", "test")
    ) or bool(find_files({".py"}) and [
        f for f in find_files({".py"})
        if f.name.startswith("test_") or f.name.endswith("_test.py")
    ])
    if not has_tests:
        record("pytest", "SKIP", "테스트 파일 없음")
        return
    if shutil.which("pytest") is None:
        record("pytest", "WARN", "pytest 미설치 — `pip install pytest` 권장")
        return
    rc, out, err = run(["pytest", "-q", "--no-header", "--maxfail=5"])
    detail = (out + "\n" + err).strip()
    if rc == 0:
        record("pytest", "PASS")
    elif rc == 5:   # 수집된 테스트 없음
        record("pytest", "SKIP", "수집된 테스트 없음")
    else:
        tail = detail[-1000:] if len(detail) > 1000 else detail
        record("pytest", "FAIL", tail or "테스트 실패", blocking=BLOCK_PYTEST)


def check_cargo():
    """Tauri v2 + Rust: Cargo.toml 이 있으면 cargo check(+clippy)로 컴파일/논리 검증."""
    cargo_tomls = [p for p in find_files({".toml"}) if p.name == "Cargo.toml"]
    if not cargo_tomls:
        return  # Rust 프로젝트 아님
    if shutil.which("cargo") is None:
        record("cargo", "WARN",
               "Rust 프로젝트 감지(Cargo.toml)이나 cargo 미설치 — https://rustup.rs 설치 권장")
        return
    manifest = min(cargo_tomls, key=lambda p: len(p.parts))   # 가장 상위 매니페스트
    workdir = str(manifest.parent)
    # 1) cargo check — 컴파일/타입/빌림(borrow) 검사 (핵심)
    rc, out, err = run(["cargo", "check", "--quiet", "--all-targets"], cwd=workdir)
    if rc is None:
        return
    detail = (err + "\n" + out).strip()
    if rc != 0:
        tail = detail[-1200:] if len(detail) > 1200 else detail
        record("cargo-check", "FAIL", tail or "cargo check 실패", blocking=BLOCK_CARGO)
        return
    record("cargo-check", "PASS")
    # 2) clippy — 린트(설치돼 있으면 추가, 경고/비차단)
    if shutil.which("cargo-clippy") or shutil.which("clippy-driver"):
        rc2, out2, err2 = run(["cargo", "clippy", "--quiet"], cwd=workdir)
        if rc2 not in (None, 0):
            d2 = (err2 + "\n" + out2).strip()
            record("clippy", "WARN", d2[-600:] if len(d2) > 600 else d2)
        else:
            record("clippy", "PASS")


def check_tsc():
    if not (ROOT / "tsconfig.json").exists():
        return  # TS 프로젝트 아님
    # npx 로 로컬 tsc 우선, 없으면 전역 tsc
    runner = None
    if shutil.which("npx"):
        runner = ["npx", "--no-install", "tsc", "--noEmit"]
    elif shutil.which("tsc"):
        runner = ["tsc", "--noEmit"]
    if runner is None:
        record("tsc", "WARN", "TypeScript 컴파일러 없음 — `npm i -D typescript` 권장")
        return
    rc, out, err = run(runner)
    detail = (out + "\n" + err).strip()
    if rc == 0:
        record("tsc", "PASS")
    else:
        tail = detail[-1000:] if len(detail) > 1000 else detail
        record("tsc", "FAIL", tail or "타입스크립트 컴파일 오류", blocking=BLOCK_TSC)


# ───────────────────────── 메인 ─────────────────────────
def main():
    log("=" * 60)
    log(f"  1차 정적 검증 게이트 (static_check.py)  @ {ROOT}")
    log("=" * 60)

    py_files = find_files({".py"})
    ts_files = find_files({".ts", ".tsx"})
    rs_files = find_files({".rs"})
    has_pkg  = (ROOT / "package.json").exists()
    has_cargo = any(p.name == "Cargo.toml" for p in find_files({".toml"}))

    if not py_files and not ts_files and not rs_files and not has_pkg and not has_cargo:
        log("➖ 검사할 소스가 없습니다(문서/기획 단계로 판단). PASS 처리합니다.")
        log("\n" + "=" * 60)
        log("STATIC CHECK SUMMARY: PASS (검사 대상 없음)")
        log("=" * 60)
        sys.exit(0)

    # Rust 검사 (Tauri v2 + Rust 기본 스택)
    if has_cargo:
        check_cargo()

    # 파이썬 검사
    if py_files:
        check_python_syntax(py_files)
        check_ruff()
        check_bandit()
        check_mypy(py_files)
        check_pytest()
    elif not has_cargo:
        log("➖ 파이썬 소스 없음 — 파이썬 검사 건너뜀")

    # TypeScript/JS 검사
    if (ROOT / "tsconfig.json").exists():
        check_tsc()

    # 요약(맨 끝 — 오케스트레이터가 마지막 1500자를 보존하므로 여기에 결론을 둔다)
    log("\n" + "=" * 60)
    log("STATIC CHECK SUMMARY")
    for name, status, _ in results:
        log(f"  - {name:10s}: {status}")
    log("=" * 60)

    if blocking_failures:
        log("❌ RESULT: FAIL  (1차 검증 실패 — 아래 항목을 수정해야 통과)")
        for b in blocking_failures:
            log(f"   • {b}")
        log("   * 위 '반려 사유'에 해당하는 부분만 최소 수정하세요(무관한 코드 건드리지 말 것).")
        sys.exit(1)

    log("✅ RESULT: PASS  (1차 검증 통과 — 2차 AI 검수로 진행)")
    sys.exit(0)


if __name__ == "__main__":
    _configure_stdio()
    try:
        main()
    except Exception as e:
        # 검사기 자체 오류는 파이프라인을 막지 않도록 명확히 알리되 FAIL 처리
        log(f"❌ static_check.py 자체 오류: {e}")
        sys.exit(2)
