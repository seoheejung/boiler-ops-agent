"""기존 서비스를 묶어서 실행하는 로컬 시작 도구."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from urllib.error import URLError
from urllib.request import urlopen
import webbrowser

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
URL = "http://127.0.0.1:5173"
PYTHON = sys.executable


class StartError(Exception):
    pass


def say(message):
    print(message, flush=True)


def json_get(url):
    try:
        with urlopen(url, timeout=2) as response:
            return json.load(response)
    except (URLError, TimeoutError, OSError, ValueError):
        return None


def require_free(port):
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            raise StartError(f"{port} 포트를 사용 중입니다. 앞서 실행한 본인 서버를 종료한 뒤 다시 실행하세요.") from None


class Runner:
    def __init__(self, config_dir):
        self.env = dict(os.environ, PYTHONUTF8="1")
        self.logs = config_dir / "artifacts/local-start" / time.strftime("%Y%m%d-%H%M%S")
        self.logs.mkdir(parents=True, exist_ok=True)
        self.children = []
        self.files = []
        self.stopping = threading.Event()
        self.started_kafka = False
        self.compose = ["docker", "compose", "--project-directory", str(ROOT), "-f", str(ROOT / "docker-compose.yml"),
                        "--env-file", str(config_dir / ".env"), "--env-file", str(config_dir / ".env.security")]

    def start(self, args, name, *, transient=False, console=False, cwd=ROOT):
        log = None if console else (self.logs / f"{name}.log").open("w", encoding="utf-8")
        if log:
            self.files.append(log)
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        try:
            child = subprocess.Popen(args, cwd=cwd, env=self.env, stdin=subprocess.DEVNULL,
                                     stdout=subprocess.PIPE if console else log,
                                     stderr=subprocess.STDOUT if console else log, creationflags=flags,
                                     start_new_session=os.name != "nt")
        except OSError:
            raise StartError(f"{name} 명령을 실행하지 못했습니다. 필요한 프로그램 설치 상태를 확인하세요.") from None
        self.children.append((child, name, transient))
        return child

    def check(self):
        if self.stopping.is_set():
            raise KeyboardInterrupt
        for child, name, transient in self.children:
            if not transient and child.poll() is not None:
                if name == "replay" and child.returncode == 0:
                    continue
                raise StartError(f"{name} 실행이 중단됐습니다. 로그: {self.logs / (name + '.log')}")

    def run(self, args, name, *, timeout=180, console=False, cwd=ROOT):
        child = self.start(args, name, transient=True, console=console, cwd=cwd)
        display_failed = threading.Event()
        forwarding = None
        if console:
            def forward_console():
                try:
                    with child.stdout:
                        for line in child.stdout:
                            sys.stdout.write(line.decode("utf-8"))
                            sys.stdout.flush()
                except (OSError, UnicodeError):
                    display_failed.set()

            forwarding = threading.Thread(target=forward_console, daemon=True)
            forwarding.start()
        self.wait_ready(lambda: child.poll() is not None, name, timeout)
        if forwarding:
            forwarding.join(timeout=5)
            if forwarding.is_alive() or display_failed.is_set():
                raise StartError("키 발급 안내를 터미널에 표시하지 못했습니다. npm run start:reset-key로 다시 발급하세요.")
        if child.returncode:
            detail = "위 안내를 확인하세요." if console else f"로그: {self.logs / (name + '.log')}"
            raise StartError(f"{name} 단계에 실패했습니다. {detail}")
        if not console:
            return (self.logs / f"{name}.log").read_text(encoding="utf-8", errors="replace")
        return ""

    def wait_ready(self, probe, label, timeout=60):
        deadline = time.monotonic() + timeout
        notice = time.monotonic() + 10
        while time.monotonic() < deadline:
            self.check()
            if probe():
                return
            if time.monotonic() > notice:
                say(f"  {label} 준비 중입니다…")
                notice = time.monotonic() + 10
            self.stopping.wait(.25)
        raise StartError(f"{label} 준비 시간이 초과됐습니다. 로그 폴더: {self.logs}")

    def close(self):
        for child, _, _ in reversed(self.children):
            if child.poll() is None:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(child.pid), "/T", "/F"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   creationflags=subprocess.CREATE_NO_WINDOW, timeout=20)
                else:
                    os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
        if self.started_kafka:
            say("이번에 시작한 Kafka를 종료합니다. 저장된 파일은 유지합니다.")
            try:
                stopped = subprocess.run(self.compose + ["stop", "kafka"], cwd=ROOT, env=self.env,
                                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=45,
                                         creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
                if stopped.returncode:
                    say("Kafka 종료를 완료하지 못했습니다. Docker Desktop에서 해당 컨테이너를 확인하세요.")
            except (OSError, subprocess.TimeoutExpired):
                say("Kafka 종료를 완료하지 못했습니다. Docker Desktop에서 해당 컨테이너를 확인하세요.")
        for log in self.files:
            log.close()


def prepare_config(runner, config_dir, reset_key=False):
    config_file = config_dir / ".env"
    if not config_file.exists():
        candidates = list((ROOT / "data/raw").glob("*.csv"))
        if len(candidates) != 1:
            raise StartError("data/raw 폴더에 원본 CSV 한 개를 넣어 주세요. 여러 개라면 .env에 사용할 경로를 지정하세요.")
        contents = (ROOT / ".env.example").read_text(encoding="utf-8")
        lines = [f'BOILER_DATASET_PATH="{candidates[0].as_posix()}"' if line.startswith("BOILER_DATASET_PATH=") else line
                 for line in contents.splitlines()]
        with config_file.open("x", encoding="utf-8") as target:
            target.write("\n".join(lines) + "\n")
    security_file = config_dir / ".env.security"
    if not security_file.exists():
        say("처음 실행: 로그인 키를 발급합니다. 아래 operator의 Access key를 안전한 곳에 보관하세요.")
        runner.run([PYTHON, str(ROOT / "scripts/setup-security.py"), "--origin", URL],
                   "login-key-setup", console=True, cwd=config_dir)
    elif reset_key:
        say("operator의 개인 접근 키를 재발급합니다. 다른 사용자와 Kafka 설정은 유지합니다.")
        runner.run([PYTHON, str(ROOT / "scripts/setup-security.py"), "--reset-user", "operator"],
                   "login-key-reset", console=True, cwd=config_dir)
    values = {**dotenv_values(config_file), **dotenv_values(security_file)}
    runner.env = {**{key: value for key, value in values.items() if value is not None}, **runner.env}
    env = runner.env
    required = ("BOILER_DATASET_PATH", "KAFKA_BOOTSTRAP_SERVERS", "KAFKA_TOPIC", "KAFKA_SECURITY_PROTOCOL",
                "APP_PUBLIC_ORIGIN", "OLLAMA_BASE_URL", "OLLAMA_MODEL", "FORECAST_MODEL_PATH")
    missing = [key for key in required if not env.get(key)]
    if missing:
        raise StartError(f"설정이 빠져 있습니다: {', '.join(missing)}. .env와 .env.security를 확인하세요.")
    if env.get("APP_PUBLIC_ORIGIN") != URL:
        raise StartError(f"기존 화면 주소 설정이 {URL}과 다릅니다. docs/local-development.md의 수동 실행을 사용하세요.")
    port = env.get("KAFKA_HOST_PORT", "9092")
    if env.get("KAFKA_BOOTSTRAP_SERVERS") != f"127.0.0.1:{port}" or env.get("KAFKA_SECURITY_PROTOCOL") != "SASL_PLAINTEXT":
        raise StartError("별도 Kafka 설정이 있습니다. 기존 설정을 유지했습니다. docs/local-development.md의 수동 실행을 사용하세요.")
    if env.get("OLLAMA_BASE_URL") != "http://127.0.0.1:11434":
        raise StartError("별도 모델 서버 설정이 있습니다. docs/local-development.md의 수동 실행을 사용하세요.")
    dataset = Path(env.get("BOILER_DATASET_PATH", ""))
    if not dataset.is_file():
        raise StartError("원본 CSV가 없습니다. data/raw 폴더와 .env의 BOILER_DATASET_PATH를 확인하세요.")
    return dataset


def main(config_dir, no_browser, reset_key=False):
    os.chdir(ROOT)
    config_dir.mkdir(parents=True, exist_ok=True)
    runner = Runner(config_dir)
    try:
        say("BoilerOps를 시작합니다. 처음에는 설치와 화면 준비에 시간이 걸립니다.")
        for program in ("node", "npm.cmd" if os.name == "nt" else "npm", "docker", "ollama"):
            if not shutil.which(program):
                raise StartError(f"{program}이 설치되어 있지 않습니다. README의 '처음 한 번 준비'를 확인하세요.")
        for port in (8000, 5173):
            require_free(port)
        npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
        say("[1/6] Docker와 설정을 확인합니다.")
        try:
            runner.run(["docker", "info", "--format", "{{.ServerVersion}}"], "docker-check", timeout=25)
        except StartError:
            raise StartError("Docker Desktop을 켜고 엔진이 준비되면 npm start를 다시 실행하세요.") from None
        dataset = prepare_config(runner, config_dir, reset_key)
        env = runner.env
        say("[2/6] 데이터 전달 서비스를 준비합니다.")
        running = runner.run(runner.compose + ["ps", "--status", "running", "--quiet", "kafka"], "kafka-status").strip()
        if not running:
            require_free(int(env.get("KAFKA_HOST_PORT", "9092")))
            runner.started_kafka = True
        runner.run(runner.compose + ["up", "-d", "--wait", "kafka"], "kafka-start", timeout=300)
        runner.run(runner.compose + ["exec", "-T", "kafka", "bash", "/opt/boiler/admin.sh", "init-topic", env["KAFKA_TOPIC"]], "kafka-topic")
        say("[3/6] AI와 예측 모델을 준비합니다.")
        tags_url = "http://127.0.0.1:11434/api/tags"
        if json_get(tags_url) is None:
            runner.start(["ollama", "serve"], "ollama")
            runner.wait_ready(lambda: json_get(tags_url) is not None, "Ollama")
        model = env["OLLAMA_MODEL"]
        tags = json_get(tags_url)
        if not tags or not isinstance(tags.get("models"), list):
            raise StartError("Ollama 모델 목록을 읽지 못했습니다. Ollama 실행 상태를 확인하세요.")
        if model not in [item["name"] for item in tags["models"]]:
            say(f"  처음 사용할 모델 {model}을 다운로드합니다. 수 GB의 공간과 시간이 필요합니다.")
            runner.run(["ollama", "pull", model], "model-download", timeout=1800)
        with dataset.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        model_file = Path(env["FORECAST_MODEL_PATH"])
        report = None
        if model_file.is_file():
            try:
                report = json.loads(model_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
        if not isinstance(report, dict) or report.get("dataset_sha256") != digest or not isinstance(report.get("test_start_row"), int):
            runner.run([PYTHON, "-m", "backend.app.forecast.train"], "forecast-training", timeout=180)
            report = json.loads(model_file.read_text(encoding="utf-8"))
        env["REPLAY_START_ROW"] = str(max(int(env.get("REPLAY_START_ROW", "1")), report["test_start_row"]))
        say(f"  예측을 확인할 수 있는 CSV {env['REPLAY_START_ROW']}행부터 재생합니다.")
        say("[4/6] 화면을 준비합니다.")
        if not (ROOT / "frontend/node_modules/vite/bin/vite.js").is_file():
            runner.run([npm, "ci", "--prefix", "frontend"], "frontend-install", timeout=600)
        runner.run([npm, "run", "build", "--prefix", "frontend"], "frontend-build", timeout=180)
        say("[5/6] API와 화면 서버를 시작합니다.")
        runner.start([PYTHON, "-m", "uvicorn", "backend.app.main:app", "--host", "127.0.0.1", "--port", "8000",
                      "--ws-max-size", "1024", "--ws-max-queue", "8", "--limit-concurrency", "64", "--timeout-keep-alive", "5"], "api")
        runner.wait_ready(lambda: json_get("http://127.0.0.1:8000/api/health") == {"status": "ok"}, "API")
        runner.start(["node", str(ROOT / "frontend/node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1",
                      "--port", "5173", "--strictPort"], "frontend", cwd=ROOT / "frontend")
        runner.wait_ready(lambda: json_get(URL + "/api/health") == {"status": "ok"}, "화면")
        say("[6/6] 원본 데이터를 재생합니다.")
        replay = runner.start([PYTHON, "-m", "backend.app.replay.producer"], "replay")
        def replay_started():
            for line in (runner.logs / "replay.log").read_text(encoding="utf-8", errors="replace").splitlines():
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                if isinstance(event, dict) and event.get("sequence") == 1 and event.get("source_time"):
                    return True
            return False

        runner.wait_ready(replay_started, "CSV 재생")
        runner.check()
        say(f"\n화면이 준비됐습니다: {URL}\n사용자 ID: operator / 개인 접근 키: 발급할 때 표시된 Access key\n키를 모르면 Enter로 종료한 뒤 npm run start:reset-key를 실행하세요.\n종료하려면 이 창에서 Enter 또는 Ctrl+C를 누르세요.\n실행 로그: {runner.logs}")
        if not no_browser and not webbrowser.open(URL):
            say(f"브라우저 주소창에 {URL}을 입력하세요.")

        def read_stop():
            try:
                input()
                runner.stopping.set()
            except EOFError:
                pass

        threading.Thread(target=read_stop, daemon=True).start()
        replay_done = False
        while not runner.stopping.wait(.5):
            runner.check()
            if replay.poll() == 0 and not replay_done:
                say("CSV 재생이 끝났습니다. 새 값이 없어 STALE로 표시됩니다. 종료 후 npm start로 다시 재생할 수 있습니다.")
                replay_done = True
        return 0
    except KeyboardInterrupt:
        return 0
    except (StartError, OSError, ValueError, KeyError) as error:
        say(f"\n시작하지 못했습니다: {error if isinstance(error, StartError) else '설정 또는 파일 형식을 확인하세요.'}")
        if not isinstance(error, StartError):
            say(f"오류 종류: {type(error).__name__}. 기존 설정은 자동으로 교체하지 않습니다.")
        return 1
    finally:
        say("실행한 서비스를 정리합니다…")
        runner.close()
        say("종료했습니다.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-dir", type=Path, default=ROOT, help=".env와 .env.security가 있는 폴더")
    parser.add_argument("--no-browser", action="store_true", help="브라우저 자동 열기 생략")
    parser.add_argument("--reset-key", action="store_true", help="operator의 개인 키를 재발급한 뒤 시작")
    args = parser.parse_args()
    raise SystemExit(main(args.config_dir.resolve(), args.no_browser, args.reset_key))
