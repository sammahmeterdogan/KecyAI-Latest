"""
Calibration Manager for SO-ARM101 (LeRobot).

State machine: idle -> running -> completed | stopped
Dry-run: simulates calibration data without hardware.
Conflict: mutual exclusion with teleop sessions.

This manager keeps the existing HTTP step API, but when a serial port is
provided it now opens a real LeRobot SO follower session, streams live joint
positions/load directly from the motor bus, and records min/max values from the
hardware instead of returning placeholder nominal limits.
"""

import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from teleop.lerobot_adapter import SERVO_ID_TO_JOINT as _SO101_ID_TO_JOINT

logger = logging.getLogger(__name__)

JOINT_IDS = [
    "shoulder_pan",
    "shoulder_lift",
    "elbow_flex",
    "wrist_flex",
    "wrist_roll",
    "gripper",
]

JOINT_ENCODER_LIMITS: Dict[str, tuple[int, int]] = {
    "shoulder_pan": (0, 4095),
    "shoulder_lift": (0, 4095),
    "elbow_flex": (0, 4095),
    "wrist_flex": (0, 4095),
    "wrist_roll": (0, 4095),
    "gripper": (0, 4095),
}

FULL_TURN_JOINTS = {"wrist_roll"}

CALIBRATION_STEPS: List[Dict[str, Any]] = [
    {
        "id": "zero_position",
        "title": "Center Position",
        "description": "Move all joints to their center position and confirm.",
        "joint": None,
        "action": "confirm",
    },
] + [
    {
        "id": f"range_{jid}",
        "title": f"Range: {jid.replace('_', ' ').title()}",
        "description": f"Move {jid.replace('_', ' ')} through its full range of motion.",
        "joint": jid,
        "action": "sweep",
    }
    for jid in JOINT_IDS
] + [
    {
        "id": "save",
        "title": "Save Calibration",
        "description": "Write measured calibration data to disk and the motor bus.",
        "joint": None,
        "action": "save",
    },
]

home_dir = Path(os.environ.get("HOME") or Path.home())


def _resolve_calibration_dir() -> Path:
    configured = os.environ.get("KECYAI_CALIBRATION_DIR", "").strip()
    candidates = []
    if configured:
        candidates.append(Path(configured))
    candidates.extend([
        home_dir / ".kecyai" / "calibration",
        Path("/tmp/kecyai-calibration"),
    ])
    for candidate in candidates:
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            test_file = candidate / ".write-test"
            with open(test_file, "w", encoding="utf-8") as handle:
                handle.write("ok")
            test_file.unlink(missing_ok=True)
            return candidate
        except Exception:
            continue
    raise PermissionError("No writable calibration directory available.")


CALIBRATION_DIR = _resolve_calibration_dir()


class CalibrationConflictError(Exception):
    """Raised when calibration conflicts with an active teleop session."""


class CalibrationManager:
    """Thread-safe calibration session manager."""

    def __init__(self):
        self._lock = threading.Lock()
        self._state = "idle"
        self._dry_run = True
        self._robot_type = ""
        self._serial_port = ""
        self._current_step_index = 0
        self._step_results: Dict[str, Any] = {}
        self._session_start_time: Optional[float] = None
        self._artifact_path: Optional[str] = None
        self._lerobot_calibration_path: Optional[str] = None
        self._error_message = ""
        self._homing_offsets: Dict[str, int] = {}
        self._robot = None
        self._motor_bus = None
        self._live_positions = self._empty_joint_snapshot()
        self._live_torque = self._empty_joint_snapshot()
        self._range_tracker: Optional[Dict[str, Any]] = None
        self._missing_joints: List[str] = []
        self._active_steps: List[Dict[str, Any]] = CALIBRATION_STEPS
        CALIBRATION_DIR.mkdir(parents=True, exist_ok=True)

    def get_status(self) -> Dict[str, Any]:
        """Return current calibration state and the latest live telemetry."""
        with self._lock:
            if self._state == "running" and not self._dry_run:
                self._refresh_live_data_locked()

            result: Dict[str, Any] = {
                "state": self._state,
                "dry_run": self._dry_run,
                "robot_type": self._robot_type,
                "serial_port": self._serial_port,
                "current_step_index": self._current_step_index,
                "total_steps": len(self._active_steps),
                "steps": self._build_steps_summary(),
                "live_joint_positions": dict(self._live_positions),
                "live_torque": dict(self._live_torque),
            }
            if self._missing_joints:
                result["missing_joints"] = list(self._missing_joints)
                result["partial_hardware"] = True
            if self._state == "running":
                result["current_step"] = self._active_steps[self._current_step_index]
            if self._range_tracker:
                result["live_range"] = dict(self._range_tracker)
            if self._artifact_path:
                result["artifact_path"] = self._artifact_path
            if self._lerobot_calibration_path:
                result["lerobot_calibration_path"] = self._lerobot_calibration_path
            if self._error_message:
                result["error"] = self._error_message
            if self._session_start_time:
                result["elapsed_seconds"] = round(time.time() - self._session_start_time, 1)
            return result

    def start(self, config: Dict[str, Any], teleop_running: bool = False) -> Dict[str, Any]:
        """
        Start a calibration session.
        Raises CalibrationConflictError if teleop is running.
        """
        if teleop_running:
            raise CalibrationConflictError("Teleop session is active. Stop teleop before starting calibration.")

        robot_type = str(config.get("robot_type", "so101_follower") or "so101_follower").strip()
        serial_port = str(config.get("serial_port", "") or "").strip()

        with self._lock:
            if self._state == "running":
                raise CalibrationConflictError("Calibration already running. Stop current session first.")

            self._reset_session_locked()
            self._state = "running"
            self._dry_run = not bool(serial_port)
            self._robot_type = robot_type
            self._serial_port = serial_port
            self._session_start_time = time.time()

            if self._dry_run:
                self._live_positions = self._build_dry_run_positions()
                self._live_torque = self._empty_joint_snapshot()
            else:
                self._connect_hardware_locked(robot_type=robot_type, serial_port=serial_port)
                self._refresh_live_data_locked()

            self._enter_current_step_locked()

            logger.info("Calibration started: robot_type=%s, dry_run=%s, serial_port=%s", robot_type, self._dry_run, serial_port or "none")

            return {
                "state": "running",
                "dry_run": self._dry_run,
                "robot_type": robot_type,
                "serial_port": serial_port,
                "message": "Calibration started" + (" (dry-run)" if self._dry_run else ""),
                "current_step": self._active_steps[0],
                "current_step_index": 0,
                "total_steps": len(self._active_steps),
            }

    def step(self, config: Dict[str, Any] = None, estop_active: bool = False) -> Dict[str, Any]:
        """Advance the calibration session to the next step."""
        config = config or {}

        with self._lock:
            if self._state != "running":
                raise RuntimeError("No calibration session running. Call /calibration/start first.")

            if self._current_step_index >= len(self._active_steps):
                raise RuntimeError("All steps already completed. Save or stop the session.")

            step_def = self._active_steps[self._current_step_index]
            if estop_active and step_def["action"] == "sweep":
                raise RuntimeError("E-STOP active. Release emergency stop before calibration step.")

            if not self._dry_run:
                self._refresh_live_data_locked()

            step_result = self._execute_step_locked(step_def)
            self._step_results[step_def["id"]] = step_result
            self._current_step_index += 1

            if self._current_step_index >= len(self._active_steps):
                self._state = "completed"
                self._range_tracker = None
                self._disconnect_hardware_locked()
                logger.info("Calibration completed.")
                return {
                    "state": "completed",
                    "step_completed": step_def["id"],
                    "step_result": step_result,
                    "message": "All calibration steps completed.",
                    "artifact_path": self._artifact_path,
                    "dry_run": self._dry_run,
                }

            self._enter_current_step_locked()
            next_step = self._active_steps[self._current_step_index]
            return {
                "state": "running",
                "step_completed": step_def["id"],
                "step_result": step_result,
                "next_step": next_step,
                "current_step_index": self._current_step_index,
                "total_steps": len(self._active_steps),
                "dry_run": self._dry_run,
            }

    def stop(self) -> Dict[str, Any]:
        """Stop and clear the current calibration session."""
        with self._lock:
            if self._state == "idle":
                return {"state": "idle", "message": "No calibration session to stop."}

            prev_state = self._state
            self._disconnect_hardware_locked()
            self._reset_runtime_data_locked()
            self._state = "stopped"
            logger.info("Calibration stopped (was: %s).", prev_state)
            return {
                "state": "stopped",
                "message": "Calibration session stopped.",
                "steps_completed": len(self._step_results),
                "total_steps": len(self._active_steps),
                "dry_run": self._dry_run,
            }

    def is_running(self) -> bool:
        with self._lock:
            return self._state == "running"

    def _execute_step_locked(self, step_def: Dict[str, Any]) -> Dict[str, Any]:
        step_id = step_def["id"]
        action = step_def["action"]
        joint = step_def.get("joint")

        if action == "confirm":
            if self._dry_run:
                self._homing_offsets = {jid: 2047 for jid in JOINT_IDS}
                positions = dict(self._live_positions)
            else:
                if self._motor_bus is None:
                    raise RuntimeError("Hardware not connected. Restart calibration.")
                available = list(self._motor_bus.motors.keys())
                self._homing_offsets = {
                    name: int(value)
                    for name, value in self._motor_bus.set_half_turn_homings(available).items()
                }
                self._refresh_live_data_locked()
                positions = dict(self._live_positions)

            return {
                "id": step_id,
                "status": "confirmed",
                "positions": positions,
                "homing_offsets": dict(self._homing_offsets),
                "simulated": self._dry_run,
            }

        if action == "sweep" and joint:
            if self._dry_run:
                nominal_min, nominal_max = JOINT_ENCODER_LIMITS[joint]
                margin = 192 if joint != "gripper" else 128
                return {
                    "id": step_id,
                    "joint": joint,
                    "status": "recorded",
                    "measured_min": nominal_min + margin,
                    "measured_max": nominal_max - margin,
                    "nominal_min": nominal_min,
                    "nominal_max": nominal_max,
                    "simulated": True,
                }

            tracker = self._range_tracker or self._start_range_tracker_locked(joint)
            measured_min = int(round(float(tracker["measured_min"])))
            measured_max = int(round(float(tracker["measured_max"])))
            nominal_min, nominal_max = JOINT_ENCODER_LIMITS[joint]

            if joint in FULL_TURN_JOINTS:
                measured_min, measured_max = nominal_min, nominal_max
            elif measured_min == measured_max:
                raise ValueError(f"No movement recorded for joint '{joint}'. Move the joint through its range before confirming.")

            return {
                "id": step_id,
                "joint": joint,
                "status": "recorded",
                "measured_min": measured_min,
                "measured_max": measured_max,
                "nominal_min": nominal_min,
                "nominal_max": nominal_max,
                "current_position": self._live_positions.get(joint),
                "simulated": False,
            }

        if action == "save":
            lerobot_path = None if (self._dry_run or self._robot is None) else self._write_lerobot_calibration_locked()
            artifact = self._build_artifact_locked(lerobot_path)
            artifact_path = self._save_artifact(artifact)
            self._artifact_path = str(artifact_path)
            if lerobot_path:
                self._lerobot_calibration_path = lerobot_path
            return {
                "id": step_id,
                "status": "saved",
                "artifact_path": self._artifact_path,
                "lerobot_calibration_path": self._lerobot_calibration_path,
                "simulated": self._dry_run,
            }

        return {"id": step_id, "status": "unknown_action"}

    def _enter_current_step_locked(self) -> None:
        step_def = self._active_steps[self._current_step_index]
        if step_def["action"] == "sweep" and step_def.get("joint"):
            self._start_range_tracker_locked(step_def["joint"])
        else:
            self._range_tracker = None

    def _start_range_tracker_locked(self, joint: str) -> Dict[str, Any]:
        current_position = float(self._live_positions.get(joint, 0.0))
        self._range_tracker = {
            "joint": joint,
            "measured_min": current_position,
            "measured_max": current_position,
            "current_position": current_position,
        }
        return self._range_tracker

    def _refresh_live_data_locked(self) -> None:
        if self._dry_run or self._motor_bus is None:
            return

        # In partial mode the bus only contains the responding motors — use its
        # actual motor list instead of the full JOINT_IDS to avoid KeyError.
        active_joints = list(self._motor_bus.motors.keys())

        try:
            positions = self._motor_bus.sync_read("Present_Position", active_joints, normalize=False, num_retry=3)
            torque = self._motor_bus.sync_read("Present_Load", active_joints, num_retry=3)
        except Exception as exc:
            self._error_message = f"Hardware telemetry read failed: {exc}"
            logger.warning(self._error_message)
            return

        # Feetech SDK getData() returns 0 silently for motors that missed the sync read
        # window. When ALL motors come back as 0 (impossible in practice — they are never
        # all at raw encoder 0 simultaneously), fall back to individual reads which have
        # proper per-motor error handling.
        all_pos_zero = all(v == 0 for v in positions.values())
        if all_pos_zero:
            for joint in active_joints:
                try:
                    val = self._motor_bus.read("Present_Position", joint, normalize=False, num_retry=2)
                    if val is not None and val != 0:
                        self._live_positions[joint] = float(val)
                except Exception as exc:
                    logger.debug("Individual position read failed for %s: %s", joint, exc)
        else:
            for joint in active_joints:
                pos_val = positions.get(joint)
                if pos_val is not None and pos_val != 0:
                    self._live_positions[joint] = float(pos_val)

        for joint in active_joints:
            torque_val = torque.get(joint)
            if torque_val is not None:
                self._live_torque[joint] = float(torque_val)

        if self._range_tracker:
            joint = self._range_tracker["joint"]
            position = float(self._live_positions.get(joint, 0.0))
            self._range_tracker["current_position"] = position
            self._range_tracker["measured_min"] = min(float(self._range_tracker["measured_min"]), position)
            self._range_tracker["measured_max"] = max(float(self._range_tracker["measured_max"]), position)

    def _connect_hardware_locked(self, robot_type: str, serial_port: str) -> None:
        try:
            from lerobot.motors.feetech import OperatingMode
            from lerobot.robots import make_robot_from_config
            from lerobot.robots.so_follower.config_so_follower import SOFollowerRobotConfig
        except Exception as exc:
            raise RuntimeError(f"LeRobot imports failed: {exc}") from exc

        robot = None
        last_exc: Exception | None = None
        try:
            config = SOFollowerRobotConfig(
                port=serial_port,
                cameras={},
                id=self._build_robot_id(robot_type, serial_port),
            )
            robot = make_robot_from_config(config)
            robot.connect(calibrate=False)
            robot.bus.disable_torque()
            for motor_name in robot.bus.motors:
                robot.bus.write("Operating_Mode", motor_name, OperatingMode.POSITION.value)

            self._robot = robot
            self._motor_bus = robot.bus
            self._lerobot_calibration_path = str(robot.calibration_fpath)
            self._error_message = ""
            self._missing_joints = []
            self._active_steps = CALIBRATION_STEPS
            return  # full connect succeeded
        except Exception as exc:
            last_exc = exc
            # Always close the port on failure — the robot.connect() handshake
            # opens the port before the motor check, so it stays open on error.
            if robot is not None:
                try:
                    robot.bus.port_handler.closePort()
                except Exception:
                    pass

        # If specific motors were missing, fall back to a partial connect instead of failing
        if "Missing motor IDs" in str(last_exc):
            logger.warning("Full connect failed; attempting partial connect: %s", last_exc)
            self._connect_partial_hardware_locked(serial_port, last_exc)
            return

        raise RuntimeError(f"Failed to connect calibration hardware: {last_exc}") from last_exc

    def _connect_partial_hardware_locked(self, serial_port: str, original_exc: Exception) -> None:
        """Connect using only the motors that physically responded, skipping the missing ones."""
        import re

        try:
            from lerobot.motors import Motor, MotorNormMode
            from lerobot.motors.feetech import FeetechMotorsBus, OperatingMode
        except Exception as exc:
            raise RuntimeError(f"LeRobot imports failed: {exc}") from exc

        # Parse found motor IDs from error: "Full found motor list (id: model_number): {1: 777, ...}"
        found_match = re.search(r"Full found motor list[^{]*\{([^}]+)\}", str(original_exc))
        if not found_match:
            raise RuntimeError(f"Failed to connect calibration hardware: {original_exc}") from original_exc

        found_ids: set[int] = set()
        for token in found_match.group(1).split(","):
            try:
                found_ids.add(int(token.split(":")[0].strip()))
            except ValueError:
                continue

        if not found_ids:
            raise RuntimeError("No motors responded on the bus — check USB and power.") from original_exc

        missing_ids = set(_SO101_ID_TO_JOINT) - found_ids
        self._missing_joints = [_SO101_ID_TO_JOINT[i] for i in sorted(missing_ids) if i in _SO101_ID_TO_JOINT]
        available_joints = [_SO101_ID_TO_JOINT[i] for i in sorted(found_ids) if i in _SO101_ID_TO_JOINT]

        logger.warning("Partial connect: available=%s  missing=%s", available_joints, self._missing_joints)

        # Build FeetechMotorsBus with only the responding motors
        norm_body = MotorNormMode.DEGREES
        _motor_defs = {
            "shoulder_pan":  Motor(1, "sts3215", norm_body),
            "shoulder_lift": Motor(2, "sts3215", norm_body),
            "elbow_flex":    Motor(3, "sts3215", norm_body),
            "wrist_flex":    Motor(4, "sts3215", norm_body),
            "wrist_roll":    Motor(5, "sts3215", norm_body),
            "gripper":       Motor(6, "sts3215", MotorNormMode.RANGE_0_100),
        }
        partial_motors = {name: _motor_defs[name] for name in available_joints if name in _motor_defs}

        bus = FeetechMotorsBus(port=serial_port, motors=partial_motors)
        try:
            bus.connect()
        except Exception as exc:
            try: bus.port_handler.closePort()
            except Exception: pass
            raise RuntimeError(f"Partial connect failed — port still open? {exc}") from exc
        bus.disable_torque()
        for motor_name in bus.motors:
            bus.write("Operating_Mode", motor_name, OperatingMode.POSITION.value)

        self._motor_bus = bus
        self._robot = None          # no robot wrapper in partial mode
        self._lerobot_calibration_path = None  # lerobot cal write skipped in partial mode
        self._error_message = ""

        # Skip sweep steps for missing joints; keep confirm, all other sweeps, and save
        self._active_steps = [
            s for s in CALIBRATION_STEPS
            if not (s["action"] == "sweep" and s.get("joint") in self._missing_joints)
        ]

    def _disconnect_hardware_locked(self) -> None:
        robot = self._robot
        bus = self._motor_bus if self._robot is None else None  # partial-mode bus
        self._robot = None
        self._motor_bus = None
        self._range_tracker = None
        if robot is not None:
            try:
                robot.disconnect()
            except Exception as exc:
                logger.warning("Calibration hardware disconnect failed: %s", exc)
        elif bus is not None:
            # Partial connect — no robot wrapper, close the raw bus port directly
            try:
                bus.disconnect(disable_torque=False)
            except Exception as exc:
                logger.warning("Partial bus disconnect failed: %s", exc)

    def _build_lerobot_calibration_locked(self):
        from lerobot.motors import MotorCalibration

        calibration = {}
        for joint in JOINT_IDS:
            range_result = self._step_results.get(f"range_{joint}", {})
            motor = self._motor_bus.motors[joint]
            nominal_min, nominal_max = JOINT_ENCODER_LIMITS[joint]
            calibration[joint] = MotorCalibration(
                id=motor.id,
                drive_mode=0,
                homing_offset=int(self._homing_offsets.get(joint, 0)),
                range_min=int(range_result.get("measured_min", nominal_min)),
                range_max=int(range_result.get("measured_max", nominal_max)),
            )
        return calibration

    def _write_lerobot_calibration_locked(self) -> str:
        calibration = self._build_lerobot_calibration_locked()
        self._robot.calibration = calibration
        self._motor_bus.write_calibration(calibration)
        self._robot._save_calibration()
        return str(self._robot.calibration_fpath)

    def _build_artifact_locked(self, lerobot_path: Optional[str]) -> Dict[str, Any]:
        joints_data = {}
        for joint in JOINT_IDS:
            range_result = self._step_results.get(f"range_{joint}", {})
            nominal_min, nominal_max = JOINT_ENCODER_LIMITS[joint]
            joints_data[joint] = {
                "measured_min": range_result.get("measured_min", nominal_min),
                "measured_max": range_result.get("measured_max", nominal_max),
                "nominal_min": nominal_min,
                "nominal_max": nominal_max,
                "homing_offset": self._homing_offsets.get(joint, 0),
                "current_position": self._live_positions.get(joint, 0.0),
            }

        return {
            "version": "2.0",
            "robot_type": self._robot_type,
            "serial_port": self._serial_port,
            "dry_run": self._dry_run,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "lerobot_calibration_path": lerobot_path,
            "joints": joints_data,
        }

    def _save_artifact(self, artifact: Dict[str, Any]) -> Path:
        ts = time.strftime("%Y%m%d_%H%M%S")
        filename = f"calibration_{self._robot_type}_{ts}.json"
        path = CALIBRATION_DIR / filename
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(artifact, handle, indent=2)
        logger.info("Calibration artifact saved: %s", path)
        return path

    def _build_steps_summary(self) -> List[Dict[str, Any]]:
        summary = []
        for index, step_def in enumerate(self._active_steps):
            entry = {
                "id": step_def["id"],
                "title": step_def["title"],
                "status": "pending",
            }
            if step_def["id"] in self._step_results:
                entry["status"] = "completed"
                entry["result"] = self._step_results[step_def["id"]]
            elif index == self._current_step_index and self._state == "running":
                entry["status"] = "current"
            summary.append(entry)
        return summary

    def _reset_session_locked(self) -> None:
        self._disconnect_hardware_locked()
        self._reset_runtime_data_locked()
        self._state = "idle"

    def _reset_runtime_data_locked(self) -> None:
        self._current_step_index = 0
        self._step_results = {}
        self._session_start_time = None
        self._artifact_path = None
        self._lerobot_calibration_path = None
        self._error_message = ""
        self._homing_offsets = {}
        self._serial_port = ""
        self._live_positions = self._empty_joint_snapshot()
        self._live_torque = self._empty_joint_snapshot()
        self._range_tracker = None
        self._missing_joints = []
        self._active_steps = CALIBRATION_STEPS

    @staticmethod
    def _empty_joint_snapshot() -> Dict[str, float]:
        return {joint: 0.0 for joint in JOINT_IDS}

    @staticmethod
    def _build_dry_run_positions() -> Dict[str, float]:
        return {
            "shoulder_pan": 2048.0,
            "shoulder_lift": 2048.0,
            "elbow_flex": 2048.0,
            "wrist_flex": 2048.0,
            "wrist_roll": 2048.0,
            "gripper": 1024.0,
        }

    @staticmethod
    def _build_robot_id(robot_type: str, serial_port: str) -> str:
        safe_port = serial_port.replace("/", "_").replace("\\", "_").replace(":", "_") or "default"
        return f"kecyai_{robot_type}_{safe_port}"
