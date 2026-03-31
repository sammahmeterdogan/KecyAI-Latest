from __future__ import annotations

import time
from collections import deque
from pathlib import Path
from typing import Any, Optional

from calibration.CalibrationAdmin import CalibrationAdmin
from hardware_check import HardwareConfig, PreflightManager
from teleop.kecyai_gamepad_runtime import KecyaiGamepadRuntime

JOINT_ORDER = [
    {
        "name": "shoulder_pan",
        "servo_id": 1,
        "deg_min": -180.0,
        "deg_max": 180.0,
        "motor_min": 0.0,
        "motor_max": 4095.0,
    },
    {
        "name": "shoulder_lift",
        "servo_id": 2,
        "deg_min": -180.0,
        "deg_max": 180.0,
        "motor_min": 0.0,
        "motor_max": 4095.0,
    },
    {
        "name": "elbow_flex",
        "servo_id": 3,
        "deg_min": -180.0,
        "deg_max": 180.0,
        "motor_min": 0.0,
        "motor_max": 4095.0,
    },
    {
        "name": "wrist_flex",
        "servo_id": 4,
        "deg_min": -180.0,
        "deg_max": 180.0,
        "motor_min": 0.0,
        "motor_max": 4095.0,
    },
    {
        "name": "wrist_roll",
        "servo_id": 5,
        "deg_min": -180.0,
        "deg_max": 180.0,
        "motor_min": 0.0,
        "motor_max": 4095.0,
    },
    {
        "name": "gripper",
        "servo_id": 6,
        "deg_min": 0.0,
        "deg_max": 100.0,
        "motor_min": 0.0,
        "motor_max": 4095.0,
    },
]
JOINT_NAME_ORDER = [joint["name"] for joint in JOINT_ORDER]
SERVO_TO_NAME = {joint["servo_id"]: joint["name"] for joint in JOINT_ORDER}
NAME_TO_SERVO = {joint["name"]: joint["servo_id"] for joint in JOINT_ORDER}
DEFAULT_HOME_POSE = {joint_name: 0.0 for joint_name in JOINT_NAME_ORDER}
DEFAULT_HOME_POSE["gripper"] = 100.0


def normalize_unit(unit: str | None) -> str:
    if not unit:
        return "degrees"
    normalized = unit.strip().lower()
    if normalized in {"deg", "degree", "degrees"}:
        return "degrees"
    if normalized in {"motor", "motor_units", "ticks"}:
        return "motor_units"
    return "degrees"


def resolve_joint_names(joints_ids: list[int] | None) -> list[str]:
    if not joints_ids:
        return list(JOINT_NAME_ORDER)
    resolved = [SERVO_TO_NAME[servo_id] for servo_id in joints_ids if servo_id in SERVO_TO_NAME]
    return resolved or list(JOINT_NAME_ORDER)


def empty_joint_map() -> dict[str, float]:
    return {joint_name: 0.0 for joint_name in JOINT_NAME_ORDER}


def detect_lerobot_version() -> str:
    try:
        import lerobot  # type: ignore

        return str(getattr(lerobot, "__version__", "unknown"))
    except Exception:
        return "unavailable"


def resolve_lerobot_calibration_file(candidate: Path | None) -> Optional[Path]:
    if candidate is None or not candidate.exists() or candidate.suffix.lower() != ".json":
        return None
    try:
        import json

        with candidate.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    lerobot_path = payload.get("lerobot_calibration_path")
    if isinstance(lerobot_path, str) and lerobot_path:
        resolved = Path(lerobot_path)
        if resolved.exists():
            return resolved
    if payload and all(isinstance(value, dict) and {"id", "range_min"}.issubset(value.keys()) for value in payload.values()):
        return candidate
    return None


class PassiveRobotIO:
    def __init__(self, hardware_config: HardwareConfig, calibration_admin: CalibrationAdmin) -> None:
        self.hardware_config = hardware_config
        self.calibration_admin = calibration_admin
        self._robot = None
        self._serial_port = ""
        self._robot_type = ""
        self._dry_run = True

    def _disconnect(self) -> None:
        robot = self._robot
        self._robot = None
        self._serial_port = ""
        self._robot_type = ""
        self._dry_run = True
        if robot is None:
            return
        # Try the graceful LeRobot disconnect first.
        try:
            robot.disconnect()
        except Exception:
            pass
        # Regardless of whether disconnect() raised, force-close the underlying
        # serial port so COM3 is not left locked for the teleop adapter.
        try:
            bus = getattr(robot, "bus", None)
            port_handler = getattr(bus, "port_handler", None) if bus is not None else None
            if port_handler is not None:
                port_handler.closePort()
        except Exception:
            pass

    def disconnect(self) -> None:
        self._disconnect()

    def _selected_calibration_file(self, robot_type: str) -> Optional[Path]:
        selected = self.calibration_admin.get_selected_artifact()
        if not selected:
            return None
        if selected.get("robot_type") not in {"", None, robot_type}:
            return None
        selected_path = selected.get("path")
        if not isinstance(selected_path, str) or not selected_path:
            return None
        return resolve_lerobot_calibration_file(Path(selected_path))

    def _apply_calibration(self, robot: Any) -> None:
        if getattr(robot, "calibration", None):
            try:
                robot.bus.write_calibration(robot.calibration)
            except Exception:
                pass
            return
        try:
            live_calibration = robot.bus.read_calibration()
            robot.calibration = live_calibration
            robot.bus.calibration = live_calibration
        except Exception:
            pass

    def _ensure_connected(self) -> tuple[Any | None, dict[str, Any]]:
        config = self.hardware_config.get()
        serial_port = str(config.get("serial_port", "") or "").strip()
        robot_type = str(config.get("robot_type", "so101_follower") or "so101_follower").strip()
        dry_run = bool(config.get("dry_run", True) or not serial_port)

        if dry_run:
            self._disconnect()
            self._dry_run = True
            return None, config

        if self._robot is not None and self._serial_port == serial_port and self._robot_type == robot_type:
            self._dry_run = False
            return self._robot, config

        self._disconnect()

        try:
            from lerobot.robots import make_robot_from_config
            from lerobot.robots.so_follower.config_so_follower import SOFollowerRobotConfig
        except Exception as exc:
            raise RuntimeError(f"LeRobot imports failed: {exc}") from exc

        kwargs: dict[str, Any] = {
            "port": serial_port,
            "cameras": {},
            "max_relative_target": 5.0,
        }
        calibration_file = self._selected_calibration_file(robot_type)
        if calibration_file is not None:
            kwargs["id"] = calibration_file.stem
            kwargs["calibration_dir"] = calibration_file.parent

        try:
            robot_config = SOFollowerRobotConfig(**kwargs)
            robot = make_robot_from_config(robot_config)
            robot.connect(calibrate=False)
            self._apply_calibration(robot)
        except Exception as exc:
            self._disconnect()
            raise RuntimeError(f"Passive robot connection failed: {exc}") from exc

        self._robot = robot
        self._serial_port = serial_port
        self._robot_type = robot_type
        self._dry_run = False
        return robot, config

    def read_positions(self, unit: str = "degrees", joint_names: list[str] | None = None) -> dict[str, float]:
        target_joints = joint_names or list(JOINT_NAME_ORDER)
        robot, _config = self._ensure_connected()
        if robot is None:
            return {joint_name: 0.0 for joint_name in target_joints}
        try:
            values = robot.bus.sync_read("Present_Position", target_joints, normalize=unit != "motor_units")
        except Exception as exc:
            self._disconnect()
            raise RuntimeError(f"Passive joint read failed: {exc}") from exc
        return {joint_name: float(values.get(joint_name, 0.0)) for joint_name in target_joints}

    def read_temperatures(self, joint_names: list[str] | None = None) -> dict[str, float | None]:
        target_joints = joint_names or list(JOINT_NAME_ORDER)
        robot, _config = self._ensure_connected()
        if robot is None:
            return {joint_name: None for joint_name in target_joints}
        try:
            values = robot.bus.sync_read("Present_Temperature", target_joints)
        except Exception as exc:
            self._disconnect()
            raise RuntimeError(f"Passive temperature read failed: {exc}") from exc
        return {
            joint_name: (float(values.get(joint_name)) if isinstance(values.get(joint_name), (int, float)) else None)
            for joint_name in target_joints
        }

    def read_torque(self, joint_names: list[str] | None = None) -> dict[str, Any]:
        target_joints = joint_names or list(JOINT_NAME_ORDER)
        robot, _config = self._ensure_connected()
        if robot is None:
            return {
                "current_torque": [0.0 for _ in target_joints],
                "torque_enabled": False,
                "simulated": True,
            }
        try:
            values = robot.bus.sync_read("Present_Load", target_joints)
        except Exception as exc:
            self._disconnect()
            raise RuntimeError(f"Passive torque read failed: {exc}") from exc
        return {
            "current_torque": [float(values.get(joint_name, 0.0)) for joint_name in target_joints],
            "torque_enabled": True,
            "simulated": False,
        }

    def toggle_torque(self, enabled: bool) -> dict[str, Any]:
        robot, _config = self._ensure_connected()
        if robot is None:
            return {
                "status": "ok",
                "torque_status": enabled,
                "simulated": True,
                "message": "Torque updated in dry-run mode.",
            }
        try:
            if enabled:
                robot.bus.enable_torque()
            else:
                robot.bus.disable_torque()
        except Exception as exc:
            self._disconnect()
            raise RuntimeError(f"Passive torque update failed: {exc}") from exc
        return {
            "status": "ok",
            "torque_status": enabled,
            "simulated": False,
        }

    def write_positions(self, joints: dict[str, float], unit: str = "degrees") -> dict[str, Any]:
        robot, _config = self._ensure_connected()
        accepted = [{"id": joint_name, "value": value} for joint_name, value in joints.items()]
        if robot is None:
            return {
                "accepted": accepted,
                "rejected": [],
                "simulated": True,
            }
        try:
            robot.bus.sync_write("Goal_Position", joints, normalize=unit != "motor_units")
        except Exception as exc:
            self._disconnect()
            raise RuntimeError(f"Passive joint write failed: {exc}") from exc
        return {
            "accepted": accepted,
            "rejected": [],
            "simulated": False,
        }


class KecyaiRuntimeState:
    def __init__(self, hardware_config: HardwareConfig) -> None:
        from calibration.CalibrationManager import CalibrationManager
        from teleop.TeleopManager import TeleopManager

        self.hardware_config = hardware_config
        self.preflight = PreflightManager(self.hardware_config)
        self.teleop = TeleopManager()
        self.gamepad = KecyaiGamepadRuntime(self.teleop.adapter, log_callback=self.append_log)
        self.calibration = CalibrationManager()
        self.calibration_admin = CalibrationAdmin()
        self.passive_io = PassiveRobotIO(self.hardware_config, self.calibration_admin)
        self.service_logs: deque[str] = deque(maxlen=300)
        self.started_at = time.time()
        self._recording = None
        self._training = None
        self._motor_setup = None
        self._hardware_diagnostics = None

    def append_log(self, message: str) -> None:
        self.service_logs.appendleft(f"[{time.strftime('%H:%M:%S')}] {message}")

    def get_config(self) -> dict[str, Any]:
        return self.hardware_config.get()

    def update_config(self, updates: dict[str, Any]) -> dict[str, Any]:
        payload = dict(updates)
        if "serial_port" in payload and "dry_run" not in payload:
            payload["dry_run"] = not bool(str(payload.get("serial_port", "")).strip())
        updated = self.hardware_config.update(payload)
        self.passive_io.disconnect()
        return updated

    def list_ports(self) -> list[str]:
        try:
            from serial.tools.list_ports import comports

            return sorted(port.device for port in comports())
        except Exception:
            return []

    @property
    def recording(self):
        if self._recording is None:
            from recording.RecordingManager import RecordingManager

            self._recording = RecordingManager()
        return self._recording

    @property
    def training(self):
        if self._training is None:
            from training.TrainingManager import TrainingManager

            self._training = TrainingManager()
        return self._training

    @property
    def motor_setup(self):
        if self._motor_setup is None:
            from motors.MotorSetupManager import MotorSetupManager

            self._motor_setup = MotorSetupManager()
        return self._motor_setup

    @property
    def hardware_diagnostics(self):
        if self._hardware_diagnostics is None:
            from hardware_diagnostics import HardwareDiagnostics

            self._hardware_diagnostics = HardwareDiagnostics()
        return self._hardware_diagnostics

    def build_preflight(self, robot_type: str = "so101_follower") -> dict[str, Any]:
        result = self.preflight.run_checks({"robot_type": robot_type})
        if not self.get_config().get("serial_port"):
            result.setdefault("hints", []).append("Configure a serial port to enable live hardware mode.")
        return result

    def build_health(self, service_name: str, service_url: str) -> dict[str, Any]:
        teleop_status = self.teleop.get_status()
        calibration_status = self.calibration.get_status()
        if teleop_status.get("state") in {"running", "starting"}:
            runtime_status = "running"
        elif calibration_status.get("state") == "running":
            runtime_status = "calibrating"
        else:
            runtime_status = "ready"
        return {
            "status": "ok",
            "service": service_name,
            "service_url": service_url,
            "runtime_status": runtime_status,
            "teleop_state": teleop_status.get("state", "idle"),
            "calibration_state": calibration_status.get("state", "idle"),
            "mode": self.get_config().get("mode", "dry_run"),
        }

    def teleop_status_payload(self) -> dict[str, Any]:
        status = self.teleop.get_status()
        metadata = status.get("metadata", {})
        if "dry_run" not in status:
            status["dry_run"] = bool(metadata.get("dry_run", self.get_config().get("dry_run", True)))
        if "message" not in status:
            state = status.get("state", "idle")
            status["message"] = {
                "running": "Teleop session is active.",
                "starting": "Teleop session is starting.",
                "error": "Teleop session is unavailable.",
            }.get(state, "Teleop session is idle.")
        return status

    def _active_joint_positions(self, unit: str, joint_names: list[str]) -> dict[str, float]:
        if self.calibration.is_running():
            status = self.calibration.get_status()
            live_positions = status.get("live_joint_positions", {})
            return {joint_name: float(live_positions.get(joint_name, 0.0)) for joint_name in joint_names}

        if self.teleop.adapter.is_connected():
            if unit == "motor_units":
                robot = getattr(self.teleop.adapter, "_robot", None)
                dry_run = bool(getattr(self.teleop.adapter, "_dry_run", False))
                if robot is not None and not dry_run:
                    values = robot.bus.sync_read("Present_Position", joint_names, normalize=False)
                    return {joint_name: float(values.get(joint_name, 0.0)) for joint_name in joint_names}
            joint_state = {entry["id"]: float(entry.get("position", 0.0)) for entry in self.teleop.get_joint_state()}
            return {joint_name: float(joint_state.get(joint_name, 0.0)) for joint_name in joint_names}

        return self.passive_io.read_positions(unit=unit, joint_names=joint_names)

    def _active_joint_temperatures(self, joint_names: list[str]) -> dict[str, float | None]:
        if self.calibration.is_running():
            return {joint_name: None for joint_name in joint_names}

        if self.teleop.adapter.is_connected():
            joint_state = {entry["id"]: entry for entry in self.teleop.get_joint_state()}
            return {
                joint_name: (
                    float(joint_state[joint_name]["temperature"])
                    if joint_name in joint_state and isinstance(joint_state[joint_name].get("temperature"), (int, float))
                    else None
                )
                for joint_name in joint_names
            }

        return self.passive_io.read_temperatures(joint_names=joint_names)

    def read_joint_payload(self, unit: str, joints_ids: list[int] | None) -> dict[str, Any]:
        joint_names = resolve_joint_names(joints_ids)
        positions = self._active_joint_positions(unit, joint_names)
        temperatures = self._active_joint_temperatures(joint_names)
        joints_payload = []
        for joint in JOINT_ORDER:
            if joint["name"] not in joint_names:
                continue
            joints_payload.append(
                {
                    "id": joint["name"],
                    "servo_id": joint["servo_id"],
                    "name": joint["name"].replace("_", " ").title(),
                    "position": float(positions.get(joint["name"], 0.0)),
                    "temperature": temperatures.get(joint["name"]),
                    "min": joint["motor_min"] if unit == "motor_units" else joint["deg_min"],
                    "max": joint["motor_max"] if unit == "motor_units" else joint["deg_max"],
                }
            )
        return {
            "joints": joints_payload,
            "angles": [joint["position"] for joint in joints_payload],
            "unit": unit,
        }

    def telemetry_snapshot(self) -> dict[str, Any]:
        config = self.get_config()
        if self.teleop.adapter.is_connected():
            snapshot = self.teleop.get_telemetry()
            snapshot["uptime_s"] = int(time.time() - self.started_at)
            snapshot["connected"] = True
            return snapshot

        positions = empty_joint_map()
        temperatures: dict[str, float | None] = {joint_name: None for joint_name in JOINT_NAME_ORDER}
        connected = False
        try:
            positions = self._active_joint_positions("degrees", list(JOINT_NAME_ORDER))
            temperatures = self._active_joint_temperatures(list(JOINT_NAME_ORDER))
            connected = bool(config.get("serial_port")) or bool(config.get("dry_run", True))
        except Exception:
            connected = False
        temperature_values = [
            float(value)
            for value in temperatures.values()
            if isinstance(value, (int, float))
        ]
        return {
            "fps": 0,
            "latency_ms": 0,
            "dry_run": bool(config.get("dry_run", True)),
            "connected": connected,
            "uptime_s": int(time.time() - self.started_at),
            "temperature": max(temperature_values) if temperature_values else None,
            "joints": [
                {
                    "id": joint_name,
                    "servo_id": NAME_TO_SERVO[joint_name],
                    "position": float(positions.get(joint_name, 0.0)),
                    "temperature": temperatures.get(joint_name),
                }
                for joint_name in JOINT_NAME_ORDER
            ],
        }

    def read_torque_payload(self) -> dict[str, Any]:
        if self.calibration.is_running():
            status = self.calibration.get_status()
            live_torque = status.get("live_torque", {})
            return {
                "current_torque": [float(live_torque.get(joint_name, 0.0)) for joint_name in JOINT_NAME_ORDER],
                "torque_enabled": False,
                "simulated": bool(status.get("dry_run", True)),
            }
        if self.teleop.adapter.is_connected():
            return self.teleop.read_torque()
        return self.passive_io.read_torque()

    def toggle_torque(self, enabled: bool) -> dict[str, Any]:
        result = self.teleop.toggle_torque(enabled) if self.teleop.adapter.is_connected() else self.passive_io.toggle_torque(enabled)
        self.append_log(f"Torque {'enabled' if enabled else 'disabled'}.")
        return result

    def start_teleop(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.calibration.is_running():
            raise RuntimeError("Calibration session is active. Stop calibration before starting teleop.")
        self.passive_io.disconnect()
        # Give Windows time to fully release the COM port before the teleop
        # adapter opens it.  Without this, the probe fails with PermissionError
        # when passive_io was holding the port for joint monitoring.
        time.sleep(0.4)
        result = self.teleop.start(payload or {"robot_type": "so101_follower", "teleop_type": "web"})
        self.gamepad.stop()
        self.append_log(result.get("message", "Teleop session started."))
        return self.teleop_status_payload()

    def stop_teleop(self) -> dict[str, Any]:
        self.gamepad.stop()
        result = self.teleop.stop()
        self.append_log(result.get("message", "Teleop session stopped."))
        return self.teleop_status_payload()

    def start_calibration(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.passive_io.disconnect()
        self.gamepad.stop()
        result = self.calibration.start(payload or {}, teleop_running=self.teleop.adapter.is_connected())
        self.append_log(result.get("message", "Calibration session started."))
        return result

    def step_calibration(self, payload: dict[str, Any]) -> dict[str, Any]:
        result = self.calibration.step(payload or {}, estop_active=self.teleop.adapter.is_estop_active())
        self.append_log(result.get("message", f"Calibration advanced: {result.get('step_completed', '')}".strip()))
        return result

    def stop_calibration(self) -> dict[str, Any]:
        result = self.calibration.stop()
        self.append_log(result.get("message", "Calibration session stopped."))
        return result

    def list_calibration_artifacts(self) -> list[dict[str, Any]]:
        return self.calibration_admin.list_artifacts()

    def select_calibration_artifact(self, artifact_id: str) -> dict[str, Any]:
        result = self.calibration_admin.select_artifact(artifact_id)
        self.append_log(f"Selected calibration artifact: {artifact_id}")
        self.passive_io.disconnect()
        return result

    def combined_logs(self, tail: int = 150) -> list[str]:
        return (list(self.service_logs) + self.teleop.get_logs(tail=max(tail, 50)))[:tail]

    def _write_connected_robot_positions(self, joints: dict[str, float], unit: str) -> dict[str, Any]:
        if self.teleop.adapter.is_estop_active():
            raise RuntimeError("E-STOP active. Release emergency stop before sending commands.")
        if unit == "motor_units":
            robot = getattr(self.teleop.adapter, "_robot", None)
            dry_run = bool(getattr(self.teleop.adapter, "_dry_run", False))
            accepted = [{"id": joint_name, "value": value} for joint_name, value in joints.items()]
            if robot is None or dry_run:
                return {
                    "accepted": accepted,
                    "rejected": [],
                    "simulated": True,
                }
            robot.bus.sync_write("Goal_Position", joints, normalize=False)
            return {
                "accepted": accepted,
                "rejected": [],
                "simulated": False,
            }
        return self.teleop.send_command([{"id": joint_name, "position": value} for joint_name, value in joints.items()])

    def write_joint_positions(self, payload: dict[str, Any]) -> dict[str, Any]:
        unit = normalize_unit(payload.get("unit"))
        if str(payload.get("mode") or "manual") == "cartesian_delta":
            return {
                "accepted": [],
                "rejected": [],
                "simulated": not self.teleop.adapter.is_connected(),
                "message": "Cartesian control is not implemented in KECYAI local runtime yet.",
            }
        joints_list = payload.get("joints") or []
        if not isinstance(joints_list, list) or not joints_list:
            raise ValueError("Expected a non-empty joints array.")

        valid_joints: dict[str, float] = {}
        rejected = []
        for item in joints_list:
            if not isinstance(item, dict):
                rejected.append({"reason": "entry must be an object"})
                continue
            joint_name = str(item.get("id") or "").strip()
            if joint_name not in NAME_TO_SERVO:
                rejected.append({"id": joint_name or "unknown", "reason": "unsupported_joint"})
                continue
            try:
                valid_joints[joint_name] = float(item.get("position"))
            except Exception:
                rejected.append({"id": joint_name, "reason": "invalid_position"})

        if not valid_joints:
            return {
                "accepted": [],
                "rejected": rejected,
                "simulated": not self.teleop.adapter.is_connected(),
            }

        if self.teleop.adapter.is_connected():
            result = self._write_connected_robot_positions(valid_joints, unit)
        else:
            if self.calibration.is_running():
                raise RuntimeError("Calibration session is active. Stop calibration before motor commands.")
            result = self.passive_io.write_positions(valid_joints, unit=unit)

        result["rejected"] = rejected + list(result.get("rejected", []))
        # NOTE: do NOT call append_log here — this is invoked at 30 Hz by the
        # keyboard/slider loop and would flood the log file.
        return result

    def set_joint(self, joint_id: str, value: float) -> dict[str, Any]:
        if joint_id not in NAME_TO_SERVO:
            raise ValueError(f"Unknown joint: {joint_id}")
        if self.teleop.adapter.is_connected():
            self.teleop.set_joint(joint_id, value)
            self.append_log(f"Joint updated: {joint_id}={value:.3f}")
            return {"status": "ok"}
        if self.calibration.is_running():
            raise RuntimeError("Calibration session is active. Stop calibration before motor commands.")
        result = self.passive_io.write_positions({joint_id: value}, unit="degrees")
        self.append_log(f"Joint updated: {joint_id}={value:.3f}")
        return {"status": "ok", **result}

    def apply_home_pose(self) -> dict[str, Any]:
        if self.teleop.adapter.is_connected():
            result = self.teleop.home_pose()
        else:
            if self.calibration.is_running():
                raise RuntimeError("Calibration session is active. Stop calibration before moving the robot.")
            result = {"status": "ok", "pose": "home", **self.passive_io.write_positions(DEFAULT_HOME_POSE, unit="degrees")}
        self.append_log("Home pose command applied.")
        return result

    def apply_ready_pose(self) -> dict[str, Any]:
        if self.teleop.adapter.is_connected():
            result = self.teleop.ready_pose()
        else:
            result = self.apply_home_pose()
        self.append_log("Ready pose command applied.")
        return result

    def set_gripper(self, opened: bool) -> dict[str, Any]:
        if self.teleop.adapter.is_connected():
            result = self.teleop.gripper_open() if opened else self.teleop.gripper_close()
        else:
            if self.calibration.is_running():
                raise RuntimeError("Calibration session is active. Stop calibration before moving the gripper.")
            target = JOINT_ORDER[-1]["deg_max"] if opened else JOINT_ORDER[-1]["deg_min"]
            result = {"status": "ok", "gripper": "open" if opened else "close", **self.passive_io.write_positions({"gripper": target}, unit="degrees")}
        self.append_log(f"Gripper {'open' if opened else 'close'} command applied.")
        return result

    def gamepad_status_payload(self) -> dict[str, Any]:
        return self.gamepad.get_status()

    def start_gamepad(self, payload: dict[str, Any]) -> dict[str, Any]:
        controller_index = payload.get("controller_index")
        speed = payload.get("speed")
        result = self.gamepad.start(
            controller_index=int(controller_index) if controller_index is not None else None,
            speed=float(speed) if speed is not None else None,
        )
        self.append_log("Runtime gamepad control started.")
        return result

    def stop_gamepad(self) -> dict[str, Any]:
        result = self.gamepad.stop()
        self.append_log("Runtime gamepad control stopped.")
        return result

    def configure_gamepad(self, payload: dict[str, Any]) -> dict[str, Any]:
        controller_index = payload.get("controller_index")
        speed = payload.get("speed")
        result = self.gamepad.configure(
            controller_index=int(controller_index) if controller_index is not None else None,
            speed=float(speed) if speed is not None else None,
        )
        return result

    def cleanup(self) -> None:
        try:
            self.gamepad.stop()
        except Exception:
            pass
        try:
            self.teleop.stop()
        except Exception:
            pass
        try:
            self.calibration.stop()
        except Exception:
            pass
        try:
            if self._recording is not None:
                self._recording.stop(save=False)
        except Exception:
            pass
        try:
            if self._training is not None:
                self._training.stop()
        except Exception:
            pass
        try:
            if self._motor_setup is not None:
                self._motor_setup.stop()
        except Exception:
            pass
        self.passive_io.disconnect()
