from __future__ import annotations

import asyncio
from functools import wraps
import importlib.util
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

import uvicorn
from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse

from calibration.CalibrationManager import CalibrationConflictError
from hardware_check import HardwareConfig
from kecyai_runtime_core import KecyaiRuntimeState, detect_lerobot_version, normalize_unit
from motors import ConflictError as MotorSetupConflictError
from recording.RecordingManager import ConflictError as RecordingConflictError
from runtime_exec import lerobot_checkout_dir
from teleop.TeleopManager import ConflictError as TeleopConflictError
from training.TrainingManager import ConflictError as TrainingConflictError

DEFAULT_HOST = os.environ.get("KECYAI_SERVICE_HOST", "0.0.0.0")
DEFAULT_PORT = int(os.environ.get("KECYAI_SERVICE_PORT", os.environ.get("PORT", "8040")))
DEFAULT_FRONTEND_DEV_URL = os.environ.get("KECYAI_FRONTEND_DEV_URL", "http://127.0.0.1:3000")
DEFAULT_SERVICE_NAME = os.environ.get("KECYAI_SERVICE_NAME", "kecyai")


def _detect_repo_root() -> Path:
    current = Path(__file__).resolve()
    for candidate in (current.parent, *current.parents):
        if (candidate / "frontend").exists() and (candidate / "runtime").exists():
            return candidate
    return current.parents[2]


def _detect_frontend_dist() -> Optional[Path]:
    env_value = os.environ.get("KECYAI_FRONTEND_DIST", "").strip()
    repo_root = _detect_repo_root()
    candidates = []
    if env_value:
        candidates.append(Path(env_value))
    candidates.extend(
        [
            repo_root / "frontend" / "dist",
            Path(sys.executable).resolve().parent / "frontend",
        ]
    )
    for candidate in candidates:
        if candidate.exists() and candidate.is_dir():
            return candidate
    return None


def _compute_service_url(host: str, port: int) -> str:
    env_url = os.environ.get("KECYAI_SERVICE_URL", "").strip()
    if env_url:
        return env_url.rstrip("/")
    public_host = "127.0.0.1" if host in {"0.0.0.0", "::"} else host
    return f"http://{public_host}:{port}"


def _parse_int_list(raw: str | None) -> list[int] | None:
    if not raw:
        return None
    values: list[int] = []
    for token in raw.split(","):
        token = token.strip()
        if not token:
            continue
        try:
            values.append(int(token))
        except ValueError:
            continue
    return values or None


def _is_conflict_message(message: str) -> bool:
    lowered = message.lower()
    return any(
        fragment in lowered
        for fragment in [
            "session is active",
            "already running",
            "already active",
            "stop current session first",
            "cannot replay while state",
            "already running with",
        ]
    )


def _is_precondition_message(message: str) -> bool:
    lowered = message.lower()
    return any(
        fragment in lowered
        for fragment in [
            "e-stop active",
            "release emergency stop",
            "must be connected",
            "must be started",
            "call /teleop/start first",
            "web teleop not running",
            "no calibration session running",
            "no running motor setup session",
            "no runtime gamepad detected",
            "controller index",
            "teleop session must be connected",
        ]
    )


def _error_payload(
    code: str,
    message: str,
    *,
    details: list[Any] | None = None,
    current_status: Any | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "code": code,
        "message": message,
    }
    if details:
        payload["details"] = details
    if current_status is not None:
        payload["currentStatus"] = current_status
    if extra:
        payload.update(extra)
    return payload


def _error_response(
    status_code: int,
    code: str,
    message: str,
    *,
    details: list[Any] | None = None,
    current_status: Any | None = None,
    extra: dict[str, Any] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=_error_payload(code, message, details=details, current_status=current_status, extra=extra),
    )


def _translate_exception(exc: Exception) -> JSONResponse:
    expected = _translate_expected_exception(exc)
    if expected is not None:
        return expected
    if isinstance(exc, RuntimeError):
        return _error_response(500, "RUNTIME_ERROR", str(exc))
    return _error_response(500, "INTERNAL_ERROR", str(exc))


def _translate_expected_exception(exc: Exception) -> JSONResponse | None:
    if isinstance(exc, ValueError):
        return _error_response(400, "VALIDATION_ERROR", str(exc))
    if isinstance(exc, FileNotFoundError):
        return _error_response(404, "NOT_FOUND", str(exc))
    if isinstance(exc, (TeleopConflictError, RecordingConflictError, TrainingConflictError, MotorSetupConflictError)):
        current_status = getattr(exc, "current_status", None)
        return _error_response(409, "CONFLICT", str(exc), current_status=current_status)
    if isinstance(exc, CalibrationConflictError):
        return _error_response(409, "CONFLICT", str(exc))
    if isinstance(exc, RuntimeError):
        message = str(exc)
        if _is_conflict_message(message):
            return _error_response(409, "CONFLICT", message)
        if _is_precondition_message(message):
            return _error_response(409, "PRECONDITION_FAILED", message)
    return None


async def read_json_body(request: Request, required: bool = False) -> dict[str, Any]:
    raw = await request.body()
    if not raw or not raw.strip():
        if required:
            raise ValueError("Request body is required.")
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON body: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ValueError(f"Request body must be a JSON object, got {type(parsed).__name__}.")
    return parsed


def _get_git_sha() -> str:
    checkout_dir = lerobot_checkout_dir()
    if checkout_dir is None:
        return "unknown"
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=str(checkout_dir), text=True).strip()
    except Exception:
        return "unknown"


def _capabilities_payload() -> dict[str, Any]:
    caps = []
    if importlib.util.find_spec("lerobot.scripts.lerobot_teleoperate") is not None:
        caps.append(
            {
                "id": "teleop",
                "title": "Teleop",
                "route": "/kecy/platform/teleop",
                "runnable": True,
                "source": "kecyai",
            }
        )
    caps.append(
        {
            "id": "calibration",
            "title": "Calibration",
            "route": "/kecy/platform/kalibrasyon",
            "runnable": True,
            "source": "kecyai",
        }
    )
    return {"capabilities": caps}


def _version_payload() -> dict[str, Any]:
    return {
        "lerobot_version": detect_lerobot_version(),
        "git_sha": _get_git_sha(),
        "backend": "kecyai-fastapi",
        "python": sys.version.split()[0],
    }


class RuntimeServiceContext:
    def __init__(self) -> None:
        self.host = DEFAULT_HOST
        self.port = DEFAULT_PORT
        self.service_name = DEFAULT_SERVICE_NAME
        self.service_url = _compute_service_url(self.host, self.port)
        self.frontend_dist = _detect_frontend_dist()
        self.frontend_dev_url = DEFAULT_FRONTEND_DEV_URL
        self._runtime_state: Optional[KecyaiRuntimeState] = None

    def configure(
        self,
        *,
        host: Optional[str] = None,
        port: Optional[int] = None,
        service_name: Optional[str] = None,
        service_url: Optional[str] = None,
        frontend_dist: Optional[Path] = None,
        frontend_dev_url: Optional[str] = None,
    ) -> None:
        if host:
            self.host = host
        if port is not None:
            self.port = port
        if service_name:
            self.service_name = service_name
        self.service_url = service_url.rstrip("/") if service_url else _compute_service_url(self.host, self.port)
        if frontend_dist is not None:
            self.frontend_dist = frontend_dist
        if frontend_dev_url:
            self.frontend_dev_url = frontend_dev_url

    def runtime_state(self) -> KecyaiRuntimeState:
        if self._runtime_state is None:
            self._runtime_state = KecyaiRuntimeState(HardwareConfig())
        return self._runtime_state

    def build_health(self) -> dict[str, Any]:
        if self._runtime_state is None:
            return {
                "status": "ok",
                "service": self.service_name,
                "service_url": self.service_url,
                "runtime_status": "ready",
                "teleop_state": "idle",
                "calibration_state": "idle",
                "mode": HardwareConfig().get().get("mode", "dry_run"),
            }
        return self._runtime_state.build_health(self.service_name, self.service_url)

    def build_readiness(self) -> dict[str, Any]:
        if detect_lerobot_version() == "unavailable":
            raise RuntimeError("LeRobot package is not importable.")
        return self.runtime_state().build_health(self.service_name, self.service_url)

    def cleanup(self) -> None:
        if self._runtime_state is not None:
            self._runtime_state.cleanup()
            self._runtime_state = None


RUNTIME = RuntimeServiceContext()


def configure_runtime_service(
    *,
    host: Optional[str] = None,
    port: Optional[int] = None,
    service_name: Optional[str] = None,
    service_url: Optional[str] = None,
    frontend_dist: Optional[Path] = None,
    frontend_dev_url: Optional[str] = None,
) -> None:
    RUNTIME.configure(
        host=host,
        port=port,
        service_name=service_name,
        service_url=service_url,
        frontend_dist=frontend_dist,
        frontend_dev_url=frontend_dev_url,
    )


def _motor_setup_running(state: KecyaiRuntimeState) -> bool:
    try:
        return bool(state.motor_setup.get_status().get("running", False))
    except Exception:
        return False


def _guard_teleop_start(state: KecyaiRuntimeState) -> None:
    if _motor_setup_running(state):
        raise RuntimeError("Motor setup session is active. Stop motor setup before starting teleop.")


def _guard_calibration_start(state: KecyaiRuntimeState) -> None:
    if _motor_setup_running(state):
        raise RuntimeError("Motor setup session is active. Stop motor setup before starting calibration.")


def _guard_motor_setup_start(state: KecyaiRuntimeState) -> None:
    if state.calibration.is_running():
        raise RuntimeError("Calibration session is active. Stop calibration before starting motor setup.")
    if state.teleop.adapter.is_connected():
        raise RuntimeError("Teleop session is active. Stop teleop before starting motor setup.")


async def _proxy_frontend_response(url: str) -> Response:
    def _fetch() -> tuple[int, str, bytes]:
        request = urllib.request.Request(url, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=5.0) as upstream:
                return upstream.status, upstream.headers.get("Content-Type", "text/html; charset=utf-8"), upstream.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.headers.get("Content-Type", "text/plain; charset=utf-8"), exc.read()

    status_code, content_type, body = await asyncio.to_thread(_fetch)
    return Response(content=body, status_code=status_code, media_type=content_type.split(";", 1)[0], headers={"Content-Type": content_type})


async def _serve_frontend(full_path: str, request: Request) -> Response:
    if full_path.startswith("api/"):
        return _error_response(404, "NOT_FOUND", f"Unknown endpoint: /{full_path}")

    file_path = full_path.lstrip("/")
    frontend_dist = RUNTIME.frontend_dist
    if frontend_dist:
        asset_candidate = frontend_dist / file_path
        if file_path and asset_candidate.exists() and asset_candidate.is_file():
            return FileResponse(asset_candidate)

        index_file = frontend_dist / "index.html"
        if index_file.exists():
            return FileResponse(index_file)

    frontend_dev_url = (RUNTIME.frontend_dev_url or "").rstrip("/")
    if frontend_dev_url:
        target = urllib.parse.urljoin(frontend_dev_url + "/", file_path)
        query = request.url.query
        if not file_path:
            target = frontend_dev_url + "/"
        if query:
            separator = "&" if urllib.parse.urlparse(target).query else "?"
            target = f"{target}{separator}{query}"
        return await _proxy_frontend_response(target)

    return _error_response(
        503,
        "FRONTEND_UNAVAILABLE",
        "Frontend assets are unavailable. Build frontend/dist or start the Vite dev server.",
    )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    RUNTIME.cleanup()


app = FastAPI(title="KECYAI Runtime API", version="0.4.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(Exception)
async def _global_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    return _translate_exception(exc)


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    details = []
    for error in exc.errors():
        location = ".".join(str(part) for part in error.get("loc", []))
        message = error.get("msg", "Invalid request.")
        details.append(f"{location}: {message}" if location else message)
    return _error_response(400, "VALIDATION_ERROR", "Request validation failed.", details=details)


async def health() -> dict[str, Any]:
    return RUNTIME.build_health()


async def lerobot_health() -> dict[str, Any]:
    return RUNTIME.build_health()


async def readiness() -> Response:
    try:
        return JSONResponse(status_code=200, content=RUNTIME.build_readiness())
    except Exception as exc:
        return _error_response(503, "RUNTIME_NOT_READY", str(exc))


async def capabilities() -> dict[str, Any]:
    return _capabilities_payload()


async def version() -> dict[str, Any]:
    return _version_payload()


async def teleop_status() -> dict[str, Any]:
    return RUNTIME.runtime_state().teleop_status_payload()


async def teleop_start(request: Request) -> dict[str, Any]:
    payload = await read_json_body(request)
    state = RUNTIME.runtime_state()
    _guard_teleop_start(state)
    return state.start_teleop(payload)


async def teleop_stop() -> dict[str, Any]:
    return RUNTIME.runtime_state().stop_teleop()


async def teleop_logs(tail: int = Query(150, ge=1, le=500)) -> dict[str, Any]:
    return {"logs": RUNTIME.runtime_state().combined_logs(tail=tail)}


async def teleop_joints(
    unit: str = Query("degrees"),
    joints_ids: Optional[str] = Query(default=None),
) -> dict[str, Any]:
    state = RUNTIME.runtime_state()
    return state.read_joint_payload(normalize_unit(unit), _parse_int_list(joints_ids))


async def teleop_telemetry_stream(request: Request) -> StreamingResponse:
    state = RUNTIME.runtime_state()

    async def stream():
        while True:
            if await request.is_disconnected():
                break
            try:
                payload = state.telemetry_snapshot()
                yield f"data: {json.dumps(payload)}\n\n"
                await asyncio.sleep(0.25)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                yield f"event: error\ndata: {json.dumps({'message': str(exc)})}\n\n"
                await asyncio.sleep(1.0)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


async def teleop_set_joint(request: Request) -> dict[str, Any]:
    payload = await read_json_body(request, required=True)
    joint_id = str(payload.get("jointId") or "").strip()
    if not joint_id:
        raise ValueError("jointId is required.")
    try:
        value = float(payload.get("value"))
    except Exception as exc:
        raise ValueError("value must be a number.") from exc
    return RUNTIME.runtime_state().set_joint(joint_id, value)


async def teleop_command(request: Request) -> dict[str, Any]:
    payload = await read_json_body(request, required=True)
    return RUNTIME.runtime_state().write_joint_positions(payload)


async def teleop_pose_home() -> dict[str, Any]:
    return RUNTIME.runtime_state().apply_home_pose()


async def teleop_pose_ready() -> dict[str, Any]:
    return RUNTIME.runtime_state().apply_ready_pose()


async def teleop_gripper_open() -> dict[str, Any]:
    return RUNTIME.runtime_state().set_gripper(True)


async def teleop_gripper_close() -> dict[str, Any]:
    return RUNTIME.runtime_state().set_gripper(False)


async def teleop_estop_on() -> dict[str, Any]:
    state = RUNTIME.runtime_state()
    result = state.teleop.estop_on()
    state.append_log("E-STOP engaged.")
    return result


async def teleop_estop_off() -> dict[str, Any]:
    state = RUNTIME.runtime_state()
    result = state.teleop.estop_off()
    state.append_log("E-STOP released.")
    return result


async def teleop_torque_read() -> dict[str, Any]:
    return RUNTIME.runtime_state().read_torque_payload()


async def teleop_torque_toggle(request: Request) -> dict[str, Any]:
    payload = await read_json_body(request, required=True)
    if "torque_status" not in payload:
        raise ValueError("torque_status is required.")
    return RUNTIME.runtime_state().toggle_torque(bool(payload.get("torque_status")))


async def gamepad_status() -> dict[str, Any]:
    return RUNTIME.runtime_state().gamepad_status_payload()


async def gamepad_start(request: Request) -> dict[str, Any]:
    payload = await read_json_body(request)
    return RUNTIME.runtime_state().start_gamepad(payload)


async def gamepad_stop() -> dict[str, Any]:
    return RUNTIME.runtime_state().stop_gamepad()


async def gamepad_config(request: Request) -> dict[str, Any]:
    payload = await read_json_body(request)
    return RUNTIME.runtime_state().configure_gamepad(payload)


async def calibration_status() -> dict[str, Any]:
    return RUNTIME.runtime_state().calibration.get_status()


async def calibration_start(request: Request) -> dict[str, Any]:
    payload = await read_json_body(request)
    state = RUNTIME.runtime_state()
    _guard_calibration_start(state)
    return state.start_calibration(payload)


async def calibration_step(request: Request) -> dict[str, Any]:
    payload = await read_json_body(request)
    return RUNTIME.runtime_state().step_calibration(payload)


async def calibration_stop() -> dict[str, Any]:
    return RUNTIME.runtime_state().stop_calibration()


async def admin_preflight(robot_type: str = Query("so101_follower")) -> dict[str, Any]:
    return RUNTIME.runtime_state().build_preflight(robot_type)


async def admin_get_config() -> dict[str, Any]:
    return RUNTIME.runtime_state().get_config()


async def admin_set_config(request: Request) -> dict[str, Any]:
    payload = await read_json_body(request, required=True)
    return RUNTIME.runtime_state().update_config(payload)


async def admin_ports_scan() -> dict[str, Any]:
    state = RUNTIME.runtime_state()
    ports = state.list_ports()
    return {
        "status": "ok" if ports else "empty",
        "ports": ports,
        "source": "kecyai_scan",
        "stdout": [],
        "stderr": [],
        "exit_code": 0,
    }


async def admin_calibration_list() -> dict[str, Any]:
    return {"artifacts": RUNTIME.runtime_state().list_calibration_artifacts()}


async def admin_calibration_latest(robot_type: str = Query("so101_follower")) -> dict[str, Any]:
    artifact = RUNTIME.runtime_state().calibration_admin.get_latest_artifact(robot_type)
    if not artifact:
        raise FileNotFoundError(f"No calibration artifact for {robot_type}.")
    return artifact


async def admin_calibration_select(request: Request) -> dict[str, Any]:
    payload = await read_json_body(request, required=True)
    artifact_id = str(payload.get("artifactId") or "").strip()
    if not artifact_id:
        raise ValueError("artifactId is required.")
    return RUNTIME.runtime_state().select_calibration_artifact(artifact_id)


async def admin_motor_setup_start(request: Request) -> dict[str, Any]:
    payload = await read_json_body(request, required=True)
    state = RUNTIME.runtime_state()
    _guard_motor_setup_start(state)
    return state.motor_setup.start(payload)


async def admin_motor_setup_status() -> dict[str, Any]:
    return RUNTIME.runtime_state().motor_setup.get_status()


async def admin_motor_setup_enter(request: Request) -> dict[str, Any]:
    payload = await read_json_body(request)
    times = int(payload.get("times", 1))
    return RUNTIME.runtime_state().motor_setup.send_enter(times)


async def admin_motor_setup_stop() -> dict[str, Any]:
    return RUNTIME.runtime_state().motor_setup.stop()


async def admin_motor_setup_logs(
    since: Optional[int] = Query(default=None, ge=0),
    tail: int = Query(200, ge=1, le=1000),
) -> dict[str, Any]:
    return RUNTIME.runtime_state().motor_setup.get_logs(since=since, tail=tail)


async def recording_start(request: Request) -> dict[str, Any]:
    payload = await read_json_body(request)
    return RUNTIME.runtime_state().recording.start(payload)


async def recording_stop(request: Request) -> dict[str, Any]:
    payload = await read_json_body(request)
    return RUNTIME.runtime_state().recording.stop(bool(payload.get("save", True)))


async def recording_replay(request: Request) -> dict[str, Any]:
    payload = await read_json_body(request)
    episode_index = int(payload.get("episode_index", -1))
    return RUNTIME.runtime_state().recording.replay(episode_index)


async def recording_status() -> dict[str, Any]:
    return RUNTIME.runtime_state().recording.get_status()


async def recording_datasets() -> dict[str, Any]:
    return {"datasets": RUNTIME.runtime_state().recording.list_datasets()}


async def training_start(request: Request) -> dict[str, Any]:
    payload = await read_json_body(request, required=True)
    return RUNTIME.runtime_state().training.start(payload)


async def training_stop() -> dict[str, Any]:
    return RUNTIME.runtime_state().training.stop()


async def training_status() -> dict[str, Any]:
    return RUNTIME.runtime_state().training.get_status()


async def training_artifacts() -> dict[str, Any]:
    return {"artifacts": RUNTIME.runtime_state().training.list_artifacts()}


async def training_logs_stream(
    request: Request,
    since: int = Query(0, ge=0),
) -> StreamingResponse:
    training = RUNTIME.runtime_state().training

    async def stream():
        cursor = since
        while True:
            if await request.is_disconnected():
                break
            try:
                payload = training.get_logs(cursor)
                cursor = int(payload.get("cursor", cursor))
                payload["done"] = payload.get("state") in {"completed", "stopped", "failed", "idle"}
                yield f"data: {json.dumps(payload)}\n\n"
                await asyncio.sleep(0.5)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                yield f"event: error\ndata: {json.dumps({'message': str(exc)})}\n\n"
                await asyncio.sleep(1.0)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


async def frontend_entry(request: Request, full_path: str = "") -> Response:
    return await _serve_frontend(full_path, request)


def _wrap_expected_api_errors(endpoint):
    @wraps(endpoint)
    async def wrapper(*args, **kwargs):
        try:
            return await endpoint(*args, **kwargs)
        except Exception as exc:
            translated = _translate_expected_exception(exc)
            if translated is not None:
                return translated
            raise

    return wrapper


def _add_route(paths: list[str], endpoint, methods: list[str]) -> None:
    wrapped = _wrap_expected_api_errors(endpoint)
    for path in paths:
        app.add_api_route(path, wrapped, methods=methods)


_add_route(["/health", "/api/health"], health, ["GET"])
_add_route(["/api/lerobot/health"], lerobot_health, ["GET"])
_add_route(["/ready", "/api/ready"], readiness, ["GET"])
_add_route(["/api/lerobot/ready"], readiness, ["GET"])
_add_route(["/capabilities", "/api/lerobot/capabilities"], capabilities, ["GET"])
_add_route(["/version", "/api/lerobot/version"], version, ["GET"])

_add_route(["/api/lerobot/teleop/status", "/teleop/status"], teleop_status, ["GET"])
_add_route(["/api/lerobot/teleop/start", "/teleop/start"], teleop_start, ["POST"])
_add_route(["/api/lerobot/teleop/stop", "/teleop/stop"], teleop_stop, ["POST"])
_add_route(["/api/lerobot/teleop/logs", "/teleop/logs"], teleop_logs, ["GET"])
_add_route(["/api/lerobot/teleop/joints", "/teleop/joints"], teleop_joints, ["GET"])
_add_route(["/api/lerobot/teleop/telemetry/stream", "/teleop/telemetry/stream"], teleop_telemetry_stream, ["GET"])
_add_route(["/api/lerobot/teleop/joints/set", "/teleop/joints/set"], teleop_set_joint, ["POST"])
_add_route(["/api/lerobot/teleop/command", "/teleop/command"], teleop_command, ["POST"])
_add_route(["/api/lerobot/teleop/pose/home", "/teleop/pose/home"], teleop_pose_home, ["POST"])
_add_route(["/api/lerobot/teleop/pose/ready", "/teleop/pose/ready"], teleop_pose_ready, ["POST"])
_add_route(["/api/lerobot/teleop/gripper/open", "/teleop/gripper/open"], teleop_gripper_open, ["POST"])
_add_route(["/api/lerobot/teleop/gripper/close", "/teleop/gripper/close"], teleop_gripper_close, ["POST"])
_add_route(["/api/lerobot/teleop/estop/on", "/teleop/estop/on"], teleop_estop_on, ["POST"])
_add_route(["/api/lerobot/teleop/estop/off", "/teleop/estop/off"], teleop_estop_off, ["POST"])
_add_route(["/api/lerobot/teleop/torque/read", "/teleop/torque/read"], teleop_torque_read, ["POST"])
_add_route(["/api/lerobot/teleop/torque/toggle", "/teleop/torque/toggle"], teleop_torque_toggle, ["POST"])

_add_route(["/api/lerobot/gamepad/status", "/gamepad/status"], gamepad_status, ["GET"])
_add_route(["/api/lerobot/gamepad/start", "/gamepad/start"], gamepad_start, ["POST"])
_add_route(["/api/lerobot/gamepad/stop", "/gamepad/stop"], gamepad_stop, ["POST"])
_add_route(["/api/lerobot/gamepad/config", "/gamepad/config"], gamepad_config, ["POST"])

_add_route(["/api/lerobot/calibration/status", "/calibration/status"], calibration_status, ["GET"])
_add_route(["/api/lerobot/calibration/start", "/calibration/start"], calibration_start, ["POST"])
_add_route(["/api/lerobot/calibration/step", "/calibration/step"], calibration_step, ["POST"])
_add_route(["/api/lerobot/calibration/stop", "/calibration/stop"], calibration_stop, ["POST"])

_add_route(["/api/lerobot/admin/preflight", "/admin/preflight"], admin_preflight, ["GET"])
_add_route(["/api/lerobot/admin/config", "/admin/config"], admin_get_config, ["GET"])
_add_route(["/api/lerobot/admin/config", "/admin/config"], admin_set_config, ["POST"])
_add_route(["/api/lerobot/admin/ports/scan", "/admin/ports/scan"], admin_ports_scan, ["GET"])
_add_route(["/api/lerobot/admin/calibration/list", "/admin/calibration/list"], admin_calibration_list, ["GET"])
_add_route(["/api/lerobot/admin/calibration/latest", "/admin/calibration/latest"], admin_calibration_latest, ["GET"])
_add_route(["/api/lerobot/admin/calibration/select", "/admin/calibration/select"], admin_calibration_select, ["POST"])
_add_route(["/api/lerobot/admin/motors/setup/start", "/admin/motors/setup/start"], admin_motor_setup_start, ["POST"])
_add_route(["/api/lerobot/admin/motors/setup/status", "/admin/motors/setup/status"], admin_motor_setup_status, ["GET"])
_add_route(["/api/lerobot/admin/motors/setup/enter", "/admin/motors/setup/enter"], admin_motor_setup_enter, ["POST"])
_add_route(["/api/lerobot/admin/motors/setup/stop", "/admin/motors/setup/stop"], admin_motor_setup_stop, ["POST"])
_add_route(["/api/lerobot/admin/motors/setup/logs", "/admin/motors/setup/logs"], admin_motor_setup_logs, ["GET"])

_add_route(["/api/lerobot/recording/start", "/recording/start"], recording_start, ["POST"])
_add_route(["/api/lerobot/recording/stop", "/recording/stop"], recording_stop, ["POST"])
_add_route(["/api/lerobot/recording/replay", "/recording/replay"], recording_replay, ["POST"])
_add_route(["/api/lerobot/recording/status", "/recording/status"], recording_status, ["GET"])
_add_route(["/api/lerobot/recording/datasets", "/recording/datasets"], recording_datasets, ["GET"])

_add_route(["/api/lerobot/train/start", "/train/start"], training_start, ["POST"])
_add_route(["/api/lerobot/train/stop", "/train/stop"], training_stop, ["POST"])
_add_route(["/api/lerobot/train/status", "/train/status"], training_status, ["GET"])
_add_route(["/api/lerobot/train/artifacts", "/train/artifacts"], training_artifacts, ["GET"])
_add_route(["/api/lerobot/train/logs/stream", "/train/logs/stream"], training_logs_stream, ["GET"])

app.add_api_route("/", frontend_entry, methods=["GET"])
app.add_api_route("/{full_path:path}", frontend_entry, methods=["GET"])


def bootstrap_check() -> None:
    print(f"KECYAI runtime booting with Python {sys.version.split()[0]}")
    print(f"Service target: {RUNTIME.host}:{RUNTIME.port}")
    print(f"Frontend dist: {RUNTIME.frontend_dist or 'none'}")
    try:
        import lerobot  # type: ignore

        print(f"LeRobot import ok ({getattr(lerobot, '__version__', 'unknown')})")
    except Exception as exc:
        print(f"LeRobot import warning: {exc}")


def run_uvicorn(*, host: Optional[str] = None, port: Optional[int] = None) -> None:
    effective_host = host or RUNTIME.host
    effective_port = port if port is not None else RUNTIME.port
    uvicorn.run(app, host=effective_host, port=effective_port, log_level="info")


def main() -> None:
    bootstrap_check()
    run_uvicorn()


if __name__ == "__main__":
    main()
