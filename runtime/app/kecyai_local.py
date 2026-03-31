from __future__ import annotations

import atexit
import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path
from typing import Any, Optional

from hardware_check import HardwareConfig
from kecyai_runtime_core import detect_lerobot_version

APP_VERSION = "0.4.0"
SERVICE_NAME = "kecyai-local"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8040
DEFAULT_PORT_FALLBACK_END = 8059
DEFAULT_FRONTEND_DEV_URL = "http://127.0.0.1:3000"
SERVICE_STATE_FILE = Path.home() / ".kecyai" / "state" / "service.json"
LOG_DIR = Path.home() / ".kecyai" / "logs"


def ensure_dirs() -> None:
    SERVICE_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)


def read_json_file(path: Path, default: Any) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return default


def write_json_file(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def is_port_in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return sock.connect_ex((host, port)) == 0


def is_pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        result = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}"],
            capture_output=True,
            text=True,
            check=False,
        )
        return str(pid) in result.stdout
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def find_available_port(host: str, preferred: int, fallback_end: int) -> int:
    if not is_port_in_use(host, preferred):
        return preferred
    for candidate in range(preferred + 1, fallback_end + 1):
        if not is_port_in_use(host, candidate):
            return candidate
    raise RuntimeError(f"No free port available in range {preferred}-{fallback_end}.")


def detect_repo_root() -> Path:
    current = Path(__file__).resolve()
    for candidate in (current.parent, *current.parents):
        if (candidate / "frontend").exists() and (candidate / "runtime").exists():
            return candidate
    return current.parents[2]


def detect_frontend_dist(repo_root: Path) -> Optional[Path]:
    env_value = os.environ.get("KECYAI_FRONTEND_DIST", "").strip()
    candidates = []
    if env_value:
        candidates.append(Path(env_value))
    candidates.extend([repo_root / "frontend" / "dist", Path(sys.executable).resolve().parent / "frontend"])
    for candidate in candidates:
        if candidate.exists() and candidate.is_dir():
            return candidate
    return None


def detect_frontend_dev_url() -> str:
    return os.environ.get("KECYAI_FRONTEND_DEV_URL", DEFAULT_FRONTEND_DEV_URL).strip() or DEFAULT_FRONTEND_DEV_URL


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def service_url(host: str, port: int) -> str:
    return f"http://{host}:{port}"


def write_service_state(
    *,
    host: str,
    port: int,
    frontend_dist: Optional[Path],
    frontend_dev_url: str,
) -> None:
    write_json_file(
        SERVICE_STATE_FILE,
        {
            "pid": os.getpid(),
            "service_url": service_url(host, port),
            "service_port": port,
            "started_at": now_iso(),
            "frontend_dist": str(frontend_dist) if frontend_dist else "",
            "frontend_dev_url": frontend_dev_url,
            "logs_dir": str(LOG_DIR),
        },
    )


def remove_service_state() -> None:
    try:
        SERVICE_STATE_FILE.unlink(missing_ok=True)
    except Exception:
        pass


def stop_existing_service() -> int:
    state = read_json_file(SERVICE_STATE_FILE, {})
    pid = int(state.get("pid", 0) or 0)
    if pid <= 0:
        remove_service_state()
        return 0
    if not is_pid_alive(pid):
        remove_service_state()
        return 0
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, check=False)
    else:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            remove_service_state()
            return 0

    deadline = time.time() + 12
    while time.time() < deadline:
        if not is_pid_alive(pid):
            remove_service_state()
            return 0
        if not SERVICE_STATE_FILE.exists():
            return 0
        time.sleep(0.25)

    print("Timed out waiting for KECYAI local service to stop.", file=sys.stderr)
    return 1


def open_dashboard() -> int:
    state = read_json_file(SERVICE_STATE_FILE, {})
    url = str(state.get("service_url") or service_url(DEFAULT_HOST, DEFAULT_PORT))
    webbrowser.open(f"{url}/kecy/platform")
    return 0


def doctor() -> int:
    repo_root = detect_repo_root()
    frontend_dist = detect_frontend_dist(repo_root)
    payload = {
        "repo_root": str(repo_root),
        "python": sys.executable,
        "frontend_dist": str(frontend_dist) if frontend_dist else "",
        "frontend_dev_url": detect_frontend_dev_url(),
        "lerobot_version": detect_lerobot_version(),
        "hardware_config": HardwareConfig().get(),
        "service_state_file": str(SERVICE_STATE_FILE),
        "log_dir": str(LOG_DIR),
    }
    print(json.dumps(payload, indent=2))
    return 0


def run_server(host: str, port: int, port_fallback_end: int) -> int:
    ensure_dirs()
    repo_root = detect_repo_root()
    frontend_dist = detect_frontend_dist(repo_root)
    frontend_dev_url = detect_frontend_dev_url()
    resolved_port = find_available_port(host, port, port_fallback_end)

    import server

    server.configure_runtime_service(
        host=host,
        port=resolved_port,
        service_name=SERVICE_NAME,
        service_url=service_url(host, resolved_port),
        frontend_dist=frontend_dist,
        frontend_dev_url=frontend_dev_url,
    )
    write_service_state(
        host=host,
        port=resolved_port,
        frontend_dist=frontend_dist,
        frontend_dev_url=frontend_dev_url,
    )
    atexit.register(remove_service_state)

    print(f"KECYAI local service listening on {service_url(host, resolved_port)}")
    try:
        server.bootstrap_check()
        server.run_uvicorn(host=host, port=resolved_port)
    finally:
        server.RUNTIME.cleanup()
        remove_service_state()
    return 0


def spawn_detached(args: list[str]) -> int:
    ensure_dirs()
    if getattr(sys, "frozen", False):
        command = [sys.executable, *args]
    else:
        command = [sys.executable, __file__, *args]

    stdout_handle = (LOG_DIR / "kecyai_service_stdout.log").open("ab")
    stderr_handle = (LOG_DIR / "kecyai_service_stderr.log").open("ab")
    kwargs: dict[str, Any] = {
        "stdin": subprocess.DEVNULL,
        "stdout": stdout_handle,
        "stderr": stderr_handle,
        "cwd": str(detect_repo_root()),
        "close_fds": True,
    }
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]

    process = subprocess.Popen(command, **kwargs)
    stdout_handle.close()
    stderr_handle.close()

    deadline = time.time() + 20
    while time.time() < deadline:
        state = read_json_file(SERVICE_STATE_FILE, {})
        url = str(state.get("service_url") or "")
        if url:
            try:
                request = urllib.request.Request(f"{url}/api/ready", method="GET")
                with urllib.request.urlopen(request, timeout=1.5) as response:
                    if response.status == 200:
                        return 0
            except Exception:
                time.sleep(0.25)
                continue
        time.sleep(0.25)

    return 1


def main(argv: list[str]) -> int:
    if not argv:
        print("Usage: run|stop|open|doctor|version [options]", file=sys.stderr)
        return 2

    command = argv[0]
    if command == "version":
        print(APP_VERSION)
        return 0
    if command == "stop":
        return stop_existing_service()
    if command == "open":
        return open_dashboard()
    if command == "doctor":
        return doctor()
    if command != "run":
        print(f"Unknown command: {command}", file=sys.stderr)
        return 2

    host = DEFAULT_HOST
    port = DEFAULT_PORT
    port_fallback_end = DEFAULT_PORT_FALLBACK_END
    detach = False
    index = 1
    while index < len(argv):
        token = argv[index]
        if token == "--detach":
            detach = True
            index += 1
            continue
        if token == "--host" and index + 1 < len(argv):
            host = argv[index + 1]
            index += 2
            continue
        if token == "--port" and index + 1 < len(argv):
            port = int(argv[index + 1])
            index += 2
            continue
        if token == "--port-fallback-end" and index + 1 < len(argv):
            port_fallback_end = int(argv[index + 1])
            index += 2
            continue
        index += 1

    if detach:
        return spawn_detached(["run", "--host", host, "--port", str(port), "--port-fallback-end", str(port_fallback_end)])

    return run_server(host=host, port=port, port_fallback_end=port_fallback_end)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
