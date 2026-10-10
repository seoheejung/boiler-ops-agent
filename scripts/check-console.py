"""Windows 실제 콘솔과 키 발급 CLI의 프로세스 통합 검증."""
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def worker(folder, output):
    from dotenv import dotenv_values
    import msvcrt
    sys.path.insert(0, str(ROOT / "scripts"))
    from start import Runner, StartError

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.SetStdHandle.argtypes = [wintypes.DWORD, wintypes.HANDLE]
    kernel.GetConsoleMode.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    sys.stdout = open("CONOUT$", "w", encoding="utf-8", buffering=1)
    sys.stderr = sys.stdout
    handle = msvcrt.get_osfhandle(sys.stdout.fileno())
    kernel.SetStdHandle(wintypes.DWORD(-11), handle)
    kernel.SetStdHandle(wintypes.DWORD(-12), handle)
    mode = wintypes.DWORD()
    assert kernel.GetConsoleMode(handle, ctypes.byref(mode)), "A real console handle is required"

    class Coord(ctypes.Structure):
        _fields_ = [("x", ctypes.c_short), ("y", ctypes.c_short)]

    kernel.ReadConsoleOutputCharacterW.argtypes = [wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, Coord, ctypes.POINTER(wintypes.DWORD)]

    def terminal_text():
        sys.stdout.flush()
        buffer = ctypes.create_unicode_buffer(32768)
        count = wintypes.DWORD()
        assert kernel.ReadConsoleOutputCharacterW(handle, buffer, 32767, Coord(0, 0), ctypes.byref(count)), "Console buffer read failed"
        return buffer.value

    def visible_keys():
        return re.findall(r"Access key: ([A-Za-z0-9_-]{43})", terminal_text())

    runner = Runner(folder)
    runner.env.pop("AUTH_USERS_JSON", None)
    result = {"real_console": True, "checks": []}
    try:
        command = [sys.executable, str(ROOT / "scripts/setup-security.py")]
        runner.run(command, "initial-keys", console=True, cwd=folder)
        keys = visible_keys()
        assert len(keys) == 2, f"Initial keys visible in console: {len(keys)}; expected 2"
        accounts = json.loads(dotenv_values(folder / ".env.security")["AUTH_USERS_JSON"])
        assert {hashlib.sha256(key.encode()).hexdigest() for key in keys} == {account["key_hash"] for account in accounts}, "Visible keys must match stored hashes"
        result["checks"].append("Initial operator and viewer keys are visible and match stored hashes")
        runner.run(command + ["--reset-user", "operator"], "reset-key", console=True, cwd=folder)
        updated = visible_keys()
        assert len(updated) == 3 and updated[-1] not in keys, "Reissued key must appear in the real console"
        accounts = json.loads(dotenv_values(folder / ".env.security")["AUTH_USERS_JSON"])
        operator = next(account for account in accounts if account["user_id"] == "operator")
        assert hashlib.sha256(updated[-1].encode()).hexdigest() == operator["key_hash"], "Displayed recovery key must authenticate"
        result["checks"].append("Reissued operator key is visible and matches its new hash")
        try:
            runner.run(command + ["--reset-user", "missing"], "missing-user", console=True, cwd=folder)
        except StartError:
            assert "error:" in terminal_text(), "CLI error must reach the console"
        else:
            raise AssertionError("Missing user must fail")
        result["checks"].append("Credential CLI errors remain visible")
        assert not list(runner.logs.glob("*.log")), "Credential output must not create log files"
        result["checks"].append("No credential log files are created")
        result["passed"] = True
    except Exception as error:
        result.update(passed=False, error_type=type(error).__name__, error=str(error))
    finally:
        runner.close()
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if result["passed"] else 1


def main():
    if os.name != "nt":
        raise SystemExit("This verification requires Windows")
    out = ROOT / "artifacts/e2e/phase7/console" / time.strftime("%Y%m%d-%H%M%S")
    out.mkdir(parents=True, exist_ok=True)
    folder = Path(tempfile.mkdtemp(prefix=".env.console-e2e-", dir=ROOT))
    try:
        startup = subprocess.STARTUPINFO()
        startup.dwFlags = subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 0
        completed = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--worker", str(folder), str(out / "run.json")],
                                   cwd=ROOT, env=dict(os.environ, PYTHONUTF8="1"), creationflags=subprocess.CREATE_NEW_CONSOLE,
                                   startupinfo=startup, timeout=90)
        result = json.loads((out / "run.json").read_text(encoding="utf-8"))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return completed.returncode
    finally:
        assert folder.resolve().parent == ROOT and folder.name.startswith(".env.console-e2e-")
        shutil.rmtree(folder)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--worker":
        raise SystemExit(worker(Path(sys.argv[2]), Path(sys.argv[3])))
    raise SystemExit(main())
