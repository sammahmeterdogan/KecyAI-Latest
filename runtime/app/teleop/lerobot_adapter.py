"""
LeRobot Teleop Adapter — Wraps real LeRobot robot or dry-run simulation.

Responsibilities:
  1) connect()     — Init LeRobot device; fallback to dry-run if hardware missing
  2) disconnect()  — Release device
  3) get_status()  — online / offline / dry-run
  4) get_joint_state() — Current joint positions (radians)
  5) set_joint_targets(joints) — Apply or simulate joint targets
  6) get_telemetry() — FPS, latency, joint state snapshot

Thread-safety: all public methods acquire self._lock.
"""

import json
import logging
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Joint whitelist and limits (radians)
JOINT_IDS = [
    "shoulder_pan",
    "shoulder_lift",
    "elbow_flex",
    "wrist_flex",
    "wrist_roll",
    "gripper",
]

JOINT_LIMITS: Dict[str, tuple] = {
    "shoulder_pan":  (-180.0, 180.0),
    "shoulder_lift": (-180.0, 180.0),
    "elbow_flex":    (-180.0, 180.0),
    "wrist_flex":    (-180.0, 180.0),
    "wrist_roll":    (-180.0, 180.0),
    "gripper":       (0.0, 100.0),
}

JOINT_SERVO_IDS: Dict[str, int] = {
    "shoulder_pan": 1,
    "shoulder_lift": 2,
    "elbow_flex": 3,
    "wrist_flex": 4,
    "wrist_roll": 5,
    "gripper": 6,
}

SERVO_ID_TO_JOINT = {servo_id: joint_id for joint_id, servo_id in JOINT_SERVO_IDS.items()}
REQUIRED_HARDWARE_JOINTS = {"shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll"}
EXPECTED_SERVO_MODEL_NUMBERS = {777, 2825}

HOME_POSE = {jid: 0.0 for jid in JOINT_IDS}
HOME_POSE["gripper"] = 100.0   # Gripper open at home (matches DEFAULT_HOME_POSE in kecyai_runtime_core)

READY_POSE = {
    "shoulder_pan":  0.0,
    "shoulder_lift": -0.45,
    "elbow_flex":    0.9,
    "wrist_flex":    0.35,
    "wrist_roll":    0.0,
    "gripper":       0.2,
}

# Rate limit: max command frequency per joint (Hz).
# Set to 60 to match the control loop frequency — the frontend already
# throttles keyboard commands to 30Hz, so this just prevents abuse.
MAX_COMMAND_HZ = 60
_MIN_COMMAND_INTERVAL = 1.0 / MAX_COMMAND_HZ
TEMPERATURE_POLL_INTERVAL_S = 0.5


class LeRobotTeleopAdapter:
    """
    Adapter for SO-ARM101 (or compatible) via LeRobot library.
    Falls back to dry-run simulation when hardware is unavailable.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._robot = None  # Real LeRobot robot instance
        self._bus = None
        self._dry_run = False
        self._connected = False
        self._joint_positions: Dict[str, float] = {jid: 0.0 for jid in JOINT_IDS}
        self._joint_temperatures: Dict[str, Optional[float]] = {jid: None for jid in JOINT_IDS}
        self._joint_targets: Dict[str, float] = {jid: 0.0 for jid in JOINT_IDS}
        self._available_joints: set[str] = set(JOINT_IDS)
        self._loop_thread: Optional[threading.Thread] = None
        self._running = False
        self._fps = 0.0
        self._latency_ms = 0.0
        self._frame_times: list = []   # rolling window for FPS
        self._FPS_WINDOW = 30          # average over last 30 frames
        self._last_command_time: Dict[str, float] = {}
        self._robot_type = ""
        self._error_message = ""
        self._estop = False
        self._torque_enabled = True
        self._degraded_hardware = False
        self._last_temperature_poll_at = 0.0

    # ──────────── Connection ────────────

    def connect(self, robot_type: str = "so101_follower",
                port: str = "", cameras: Optional[dict] = None,
                calibration_path: Optional[str] = None,
                allow_dry_run: bool = True) -> Dict[str, Any]:
        """
        Attempt to connect to real robot. Falls back to dry-run if hardware
        is unavailable (no serial port, import error, connection failure).
        """
        with self._lock:
            if self._connected:
                return {"status": "already_connected", "dry_run": self._dry_run}

            self._robot_type = robot_type
            self._dry_run = False
            self._error_message = ""
            self._available_joints = set(JOINT_IDS)
            self._degraded_hardware = False

            preprobed_servo_ids: list[int] = []
            if port and robot_type in ("so101_follower", "so100_follower", "so_follower"):
                try:
                    preprobed_servo_ids = self._probe_available_servo_ids(port)
                    logger.info("Pre-probed servo ids on %s: %s", port, preprobed_servo_ids)
                except Exception:
                    logger.debug("Servo probe failed before connect", exc_info=True)

            available_preprobed_joints = {
                SERVO_ID_TO_JOINT[servo_id]
                for servo_id in preprobed_servo_ids
                if servo_id in SERVO_ID_TO_JOINT
            }
            if preprobed_servo_ids and REQUIRED_HARDWARE_JOINTS.issubset(available_preprobed_joints) and set(preprobed_servo_ids) != set(SERVO_ID_TO_JOINT):
                logger.warning(
                    "Using partial hardware mode on %s. Required arm joints present, missing ids: %s",
                    port,
                    sorted(set(SERVO_ID_TO_JOINT) - set(preprobed_servo_ids)),
                )
                self._connect_partial_hardware_bus(port, calibration_path, available_servo_ids=preprobed_servo_ids)
            else:
                # Try real robot connection
                try:
                    self._connect_lerobot_robot(robot_type, port, cameras, calibration_path)

                except Exception as e:
                    degraded_error = None
                    if port and robot_type in ("so101_follower", "so100_follower", "so_follower") and preprobed_servo_ids:
                        try:
                            # Re-probe on fallback — the initial probe may have found a flaky motor
                            # that then failed during full connect; a fresh probe gives accurate IDs.
                            self._connect_partial_hardware_bus(port, calibration_path, available_servo_ids=None)
                        except Exception as partial_exc:
                            degraded_error = partial_exc

                    if not self._connected:
                        connection_error = degraded_error or e
                        if not allow_dry_run:
                            raise RuntimeError(f"Real robot connection failed: {connection_error}") from connection_error
                        logger.warning(f"Real robot unavailable ({connection_error}), entering dry-run mode")
                        self._dry_run = True
                        self._connected = True
                        self._error_message = str(connection_error)
                        self._available_joints = set(JOINT_IDS)
                        self._joint_positions = {jid: 0.0 for jid in JOINT_IDS}
                        self._joint_temperatures = {jid: None for jid in JOINT_IDS}
                        self._joint_targets = {jid: 0.0 for jid in JOINT_IDS}

            # Start control loop
            self._running = True
            self._loop_thread = threading.Thread(
                target=self._control_loop, daemon=True
            )
            self._loop_thread.start()

            return {
                "status": "connected",
                "dry_run": self._dry_run,
                "robot_type": robot_type,
                "available_joints": sorted(self._available_joints),
                "degraded_hardware": self._degraded_hardware,
                "message": "dry-run: " + self._error_message if self._dry_run else (
                    "real robot connected (partial hardware mode)"
                    if self._degraded_hardware
                    else "real robot connected"
                ),
            }

    def disconnect(self) -> Dict[str, Any]:
        """Stop control loop and disconnect robot."""
        with self._lock:
            self._running = False

        # Wait for loop thread outside lock to avoid deadlock
        if self._loop_thread and self._loop_thread.is_alive():
            self._loop_thread.join(timeout=3)

        bus_was_active = False
        with self._lock:
            if self._robot:
                try:
                    self._robot.disconnect()
                except Exception as e:
                    logger.error(f"Error disconnecting robot: {e}")
                self._robot = None
            if self._bus:
                try:
                    self._bus.disconnect()
                    bus_was_active = True
                except Exception as e:
                    logger.error(f"Error disconnecting partial hardware bus: {e}")
                self._bus = None

            self._connected = False
            self._dry_run = False
            self._fps = 0.0
            self._latency_ms = 0.0
            self._estop = False
            self._torque_enabled = True
            self._available_joints = set(JOINT_IDS)
            self._degraded_hardware = False
            self._joint_temperatures = {jid: None for jid in JOINT_IDS}
            self._last_temperature_poll_at = 0.0

        # Give the OS time to fully release the serial port before the lock is
        # dropped, so any immediate reconnect attempt can open COM3 cleanly.
        if bus_was_active:
            time.sleep(0.5)

        return {"status": "disconnected"}

    # ──────────── Status / Telemetry ────────────

    def is_connected(self) -> bool:
        with self._lock:
            return self._connected

    def is_estop_active(self) -> bool:
        """Thread-safe check for E-STOP state."""
        with self._lock:
            return self._estop

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            if not self._connected:
                return {"state": "offline"}
            return {
                "state": "running",
                "dry_run": self._dry_run,
                "robot_type": self._robot_type,
                "fps": round(self._fps, 1),
                "latency_ms": round(self._latency_ms, 2),
                "estop": self._estop,
                "torque_enabled": self._torque_enabled,
                "available_joints": sorted(self._available_joints),
                "degraded_hardware": self._degraded_hardware,
            }

    def get_joint_state(self) -> List[Dict[str, Any]]:
        """Returns current joint positions as array of {id, name, position, min, max, temperature}."""
        with self._lock:
            result = []
            for jid in JOINT_IDS:
                lo, hi = JOINT_LIMITS[jid]
                result.append({
                    "id": jid,
                    "servo_id": JOINT_SERVO_IDS[jid],
                    "name": jid.replace("_", " ").title(),
                    "position": round(self._joint_positions[jid], 6),
                    "temperature": self._joint_temperatures[jid],
                    "min": lo,
                    "max": hi,
                })
            return result

    def get_telemetry(self) -> Dict[str, Any]:
        """Snapshot: fps, latency, all joints, dry_run flag."""
        with self._lock:
            temperature_values = [
                float(value)
                for value in self._joint_temperatures.values()
                if isinstance(value, (int, float))
            ]
            return {
                "fps": round(self._fps, 1),
                "latency_ms": round(self._latency_ms, 2),
                "dry_run": self._dry_run,
                "connected": self._connected,
                "estop": self._estop,
                "temperature": max(temperature_values) if temperature_values else None,
                "joints": [
                    {
                        "id": jid,
                        "servo_id": JOINT_SERVO_IDS[jid],
                        "position": round(self._joint_positions[jid], 6),
                        "temperature": self._joint_temperatures[jid],
                    }
                    for jid in JOINT_IDS
                ],
            }

    # ──────────── Commands ────────────

    def set_joint_targets(self, joints: Dict[str, float]) -> Dict[str, Any]:
        """
        Apply joint targets. Validates, range-clamps, rate-limits.
        Returns accepted joints list.
        """
        now = time.monotonic()
        accepted = []
        rejected = []

        with self._lock:
            if not self._connected:
                return {"code": "NOT_CONNECTED", "message": "not connected", "accepted": [], "rejected": list(joints.keys())}

            if self._estop:
                return {
                    "accepted": [],
                    "rejected": [{"id": jid, "reason": "E-STOP active"} for jid in joints],
                    "simulated": self._dry_run,
                    "estop": True,
                }

            for jid, value in joints.items():
                # Whitelist check
                if jid not in JOINT_LIMITS:
                    rejected.append({"id": jid, "reason": "unknown joint"})
                    continue
                if not self._dry_run and jid not in self._available_joints:
                    rejected.append({"id": jid, "reason": "joint_unavailable"})
                    continue

                # Rate limit check
                last_time = self._last_command_time.get(jid, 0)
                if (now - last_time) < _MIN_COMMAND_INTERVAL:
                    rejected.append({"id": jid, "reason": "rate limited"})
                    continue

                # Type + range check
                try:
                    numeric = float(value)
                except (TypeError, ValueError):
                    rejected.append({"id": jid, "reason": "invalid value"})
                    continue

                lo, hi = JOINT_LIMITS[jid]
                clamped = max(lo, min(hi, numeric))
                self._joint_targets[jid] = clamped
                self._last_command_time[jid] = now
                accepted.append({"id": jid, "value": clamped})

        simulated = self._dry_run
        return {
            "accepted": accepted,
            "rejected": rejected,
            "simulated": simulated,
        }

    def set_single_joint(self, joint_id: str, value: float) -> Dict[str, Any]:
        """Convenience: set a single joint."""
        return self.set_joint_targets({joint_id: value})

    def apply_pose(self, pose: Dict[str, float]) -> Dict[str, Any]:
        """Apply a named pose (home, ready, etc.)."""
        return self.set_joint_targets(pose)

    def home_pose(self) -> Dict[str, Any]:
        return self.apply_pose(HOME_POSE)

    def ready_pose(self) -> Dict[str, Any]:
        return self.apply_pose(READY_POSE)

    def gripper_open(self) -> Dict[str, Any]:
        return self.set_joint_targets({"gripper": JOINT_LIMITS["gripper"][1]})

    def gripper_close(self) -> Dict[str, Any]:
        return self.set_joint_targets({"gripper": JOINT_LIMITS["gripper"][0]})

    def read_torque(self) -> Dict[str, Any]:
        """Read motor load/torque values from the active robot when available."""
        with self._lock:
            if not self._connected:
                raise RuntimeError("Robot is not connected")
            robot = self._robot
            bus = self._bus
            is_dry_run = self._dry_run
            torque_enabled = self._torque_enabled

        if bus is not None:
            loads = bus.sync_read("Present_Load", sorted(self._available_joints))
            values = [loads.get(jid, 0) for jid in JOINT_IDS]
            return {
                "current_torque": values,
                "torque_enabled": torque_enabled,
                "simulated": False,
                "available_joints": sorted(self._available_joints),
            }

        if is_dry_run or robot is None or not hasattr(robot, "bus"):
            return {
                "current_torque": [0 for _ in JOINT_IDS],
                "torque_enabled": torque_enabled,
                "simulated": True,
            }

        loads = robot.bus.sync_read("Present_Load")
        values = [loads.get(jid, 0) for jid in JOINT_IDS]
        return {
            "current_torque": values,
            "torque_enabled": torque_enabled,
            "simulated": False,
        }

    def toggle_torque(self, enabled: bool) -> Dict[str, Any]:
        """Enable or disable motor torque on the active robot."""
        with self._lock:
            if not self._connected:
                raise RuntimeError("Robot is not connected")
            robot = self._robot
            bus = self._bus
            is_dry_run = self._dry_run

        if bus is not None:
            if enabled:
                bus.enable_torque(sorted(self._available_joints))
            else:
                bus.disable_torque(sorted(self._available_joints))

            with self._lock:
                self._torque_enabled = enabled

            return {
                "status": "ok",
                "torque_status": enabled,
                "simulated": False,
                "available_joints": sorted(self._available_joints),
            }

        if is_dry_run or robot is None or not hasattr(robot, "bus"):
            with self._lock:
                self._torque_enabled = enabled
            return {
                "status": "ok",
                "torque_status": enabled,
                "simulated": True,
                "message": "Torque updated in dry-run mode",
            }

        if enabled:
            robot.bus.enable_torque()
        else:
            robot.bus.disable_torque()

        with self._lock:
            self._torque_enabled = enabled

        return {
            "status": "ok",
            "torque_status": enabled,
            "simulated": False,
        }

    def estop_on(self) -> Dict[str, Any]:
        """Engage emergency stop. All commands will be rejected."""
        with self._lock:
            self._estop = True
            logger.warning("E-STOP ENGAGED")
            return {"estop": True, "message": "E-STOP engaged. All commands blocked."}

    def estop_off(self) -> Dict[str, Any]:
        """Release emergency stop. Commands will be accepted again."""
        with self._lock:
            self._estop = False
            logger.info("E-STOP released")
            return {"estop": False, "message": "E-STOP released. Commands accepted."}

    # ──────────── Internal ────────────

    def _connect_lerobot_robot(
        self,
        robot_type: str,
        port: str,
        cameras: Optional[dict],
        calibration_path: Optional[str],
    ) -> None:
        robot_instance = self._create_robot(robot_type, port, cameras, calibration_path)
        robot_instance.connect(calibrate=False)

        if robot_instance.calibration:
            try:
                robot_instance.bus.write_calibration(robot_instance.calibration)
                logger.info("Applied file-based calibration to motor bus")
            except Exception as cal_err:
                logger.warning("Failed to write file calibration to bus: %s", cal_err)
        else:
            try:
                live_cal = robot_instance.bus.read_calibration()
                robot_instance.calibration = live_cal
                robot_instance.bus.calibration = live_cal
                logger.info("Loaded live calibration from motor registers")
            except Exception as cal_err:
                logger.warning("Failed to read live calibration: %s", cal_err)

        try:
            obs = robot_instance.get_observation()
            for jid in JOINT_IDS:
                key = f"{jid}.pos"
                if key in obs:
                    self._joint_positions[jid] = float(obs[key])
                    self._joint_targets[jid] = float(obs[key])
        except Exception as obs_err:
            logger.warning("Failed to read initial positions: %s", obs_err)

        self._robot = robot_instance
        self._bus = None
        self._available_joints = set(JOINT_IDS)
        self._connected = True
        self._degraded_hardware = False
        self._joint_temperatures = {jid: None for jid in JOINT_IDS}
        self._last_temperature_poll_at = 0.0
        logger.info("Connected to full LeRobot follower: %s", robot_type)

    def _connect_partial_hardware_bus(
        self,
        port: str,
        calibration_path: Optional[str],
        available_servo_ids: Optional[list[int]] = None,
    ) -> None:
        from lerobot.motors import Motor, MotorNormMode
        from lerobot.motors.feetech import FeetechMotorsBus, OperatingMode

        available_servo_ids = available_servo_ids or self._probe_available_servo_ids(port)
        available_joints = [SERVO_ID_TO_JOINT[servo_id] for servo_id in available_servo_ids if servo_id in SERVO_ID_TO_JOINT]
        if not REQUIRED_HARDWARE_JOINTS.issubset(set(available_joints)):
            raise RuntimeError(
                f"Partial hardware mode requires arm joints {sorted(REQUIRED_HARDWARE_JOINTS)}. "
                f"Detected only {available_joints} on {port}."
            )

        motors = {
            joint_id: Motor(
                JOINT_SERVO_IDS[joint_id],
                "sts3215",
                MotorNormMode.RANGE_0_100 if joint_id == "gripper" else MotorNormMode.DEGREES,
            )
            for joint_id in available_joints
        }
        bus = FeetechMotorsBus(port=port, motors=motors)
        bus.connect(handshake=False)
        # Let the serial bus settle after opening — rapid reconnects can leave
        # stale bytes in the hardware buffer that cause "no status packet" errors.
        time.sleep(0.15)

        loaded_calibration = self._load_lerobot_calibration(calibration_path)
        filtered_calibration = {joint_id: calibration for joint_id, calibration in loaded_calibration.items() if joint_id in motors}
        if filtered_calibration:
            bus.calibration = filtered_calibration
            try:
                bus.write_calibration(filtered_calibration)
            except Exception as exc:
                logger.warning("Failed to write selected calibration to partial bus: %s", exc)

        if not bus.calibration:
            try:
                bus.calibration = bus.read_calibration()
            except Exception as exc:
                logger.warning("Failed to read live calibration for partial bus: %s", exc)

        for _cfg_attempt in range(3):
            try:
                bus.disable_torque()
                bus.configure_motors()
                for motor in motors:
                    bus.write("Operating_Mode", motor, OperatingMode.POSITION.value)
                    bus.write("P_Coefficient", motor, 16)
                    bus.write("I_Coefficient", motor, 0)
                    bus.write("D_Coefficient", motor, 32)
                    if motor == "gripper":
                        bus.write("Max_Torque_Limit", motor, 500)
                        bus.write("Protection_Current", motor, 250)
                        bus.write("Overload_Torque", motor, 25)
                break  # success
            except Exception as cfg_exc:
                if _cfg_attempt == 2:
                    raise
                logger.warning("Motor config attempt %d failed (%s), retrying…", _cfg_attempt + 1, cfg_exc)
                time.sleep(0.25)

        try:
            bus.enable_torque(sorted(motors))
        except Exception:
            logger.debug("Failed to re-enable torque on partial bus", exc_info=True)

        initial_positions = bus.sync_read("Present_Position", available_joints)

        for jid in JOINT_IDS:
            position = float(initial_positions.get(jid, 0.0))
            self._joint_positions[jid] = position
            self._joint_targets[jid] = position

        self._robot = None
        self._bus = bus
        self._available_joints = set(available_joints)
        self._connected = True
        self._degraded_hardware = set(available_joints) != set(JOINT_IDS)
        self._joint_temperatures = {jid: None for jid in JOINT_IDS}
        self._last_temperature_poll_at = 0.0
        logger.warning("Connected in partial hardware mode. Available joints: %s", sorted(available_joints))

    def _probe_available_servo_ids(self, port: str) -> list[int]:
        import scservo_sdk as scs

        port_handler = scs.PortHandler(port)
        packet_handler = scs.PacketHandler(0)
        # Retry once after a brief delay — Windows can hold a COM port for a
        # short period after the previous session closed it.
        if not port_handler.openPort():
            time.sleep(0.4)
            if not port_handler.openPort():
                raise RuntimeError(f"Failed to open {port}")
        try:
            if not port_handler.setBaudRate(1_000_000):
                raise RuntimeError(f"Failed to set baudrate on {port}")
            available_servo_ids = []
            for servo_id in sorted(SERVO_ID_TO_JOINT):
                model_number, comm, error = packet_handler.ping(port_handler, servo_id)
                if comm == scs.COMM_SUCCESS and error == 0 and model_number in EXPECTED_SERVO_MODEL_NUMBERS:
                    available_servo_ids.append(servo_id)
            return available_servo_ids
        finally:
            try:
                port_handler.closePort()
            except Exception:
                logger.debug("Failed to close %s after probing", port, exc_info=True)
            time.sleep(0.25)

    def _load_lerobot_calibration(self, calibration_path: Optional[str]) -> dict[str, Any]:
        from lerobot.motors import MotorCalibration

        resolved = self._resolve_calibration_file(calibration_path)
        if resolved is None:
            return {}
        try:
            with open(resolved, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except Exception as exc:
            logger.warning("Failed to load lerobot calibration %s: %s", resolved, exc)
            return {}

        calibration = {}
        for joint_id, entry in payload.items():
            if joint_id not in JOINT_SERVO_IDS or not isinstance(entry, dict):
                continue
            try:
                calibration[joint_id] = MotorCalibration(**entry)
            except Exception:
                logger.debug("Skipping invalid calibration entry for %s", joint_id, exc_info=True)
        return calibration

    def _create_robot(self, robot_type: str, port: str, cameras: Optional[dict], calibration_path: Optional[str] = None):
        """Create LeRobot robot instance from config."""
        from lerobot.robots import make_robot_from_config
        from lerobot.robots.so_follower.config_so_follower import SOFollowerRobotConfig

        if robot_type in ("so101_follower", "so100_follower", "so_follower"):
            if not port:
                raise ValueError("Robot port required for real hardware connection")

            kwargs = {
                "port": port,
                "cameras": {},
                "max_relative_target": 5.0,
            }

            calibration_file = self._resolve_calibration_file(calibration_path)
            if calibration_file is not None:
                kwargs["id"] = calibration_file.stem
                kwargs["calibration_dir"] = calibration_file.parent
                logger.info("Resolved lerobot calibration: id=%s, dir=%s", calibration_file.stem, calibration_file.parent)

            config = SOFollowerRobotConfig(**kwargs)

        else:
            raise ValueError(f"Unsupported robot type for web teleop: {robot_type}")

        return make_robot_from_config(config)

    def _resolve_calibration_file(self, calibration_path: Optional[str]) -> Optional[Path]:
        """
        Resolve a calibration path to a valid lerobot-format calibration JSON.

        Handles two formats:
          1) KECY artifact wrapper — contains a 'lerobot_calibration_path' field
             pointing to the real lerobot calibration file.
          2) Direct lerobot calibration file — keys are motor names, values are
             MotorCalibration dicts with id/drive_mode/homing_offset/range_min/range_max.

        Returns None when no valid lerobot calibration file can be resolved,
        which is safe: the robot will still connect (without pre-loaded calibration).
        """
        if not calibration_path:
            return None

        candidate = Path(calibration_path)
        if not candidate.exists():
            return None

        if candidate.suffix.lower() != ".json":
            return None

        try:
            with open(candidate, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except Exception:
            logger.warning("Failed to parse calibration JSON: %s", candidate)
            return None

        if not isinstance(payload, dict):
            return None

        # Case 1: KECY artifact wrapper — follow the lerobot_calibration_path pointer
        lerobot_path = payload.get("lerobot_calibration_path")
        if isinstance(lerobot_path, str) and lerobot_path:
            lerobot_candidate = Path(lerobot_path)
            if lerobot_candidate.exists():
                logger.info("Resolved lerobot calibration via wrapper: %s", lerobot_candidate)
                return lerobot_candidate
            logger.warning("lerobot_calibration_path not found on disk: %s", lerobot_path)

        # Case 2: check if the file itself is a valid lerobot calibration
        # (motor names as top-level keys, each value is a dict with 'id' and 'range_min')
        if self._is_lerobot_calibration_format(payload):
            return candidate

        # Not a valid lerobot calibration — return None so the robot can still connect
        logger.warning("Calibration file is not in lerobot format, skipping: %s", candidate)
        return None

    @staticmethod
    def _is_lerobot_calibration_format(payload: dict) -> bool:
        """Heuristic: a valid lerobot calibration JSON has motor-name keys
        whose values are dicts containing at least 'id' and 'range_min'."""
        if not payload:
            return False
        required_fields = {"id", "range_min"}
        for key, value in payload.items():
            if not isinstance(value, dict):
                return False
            if not required_fields.issubset(value.keys()):
                return False
        return True

    def _control_loop(self):
        """
        Main control loop (~60Hz).
        Reads targets, sends to robot (or updates simulation), reads observation.

        Real hardware: sends raw targets directly. The STS3215 servo firmware
        handles smoothing via its internal PID (P=16, I=0, D=32 — set by
        LeRobot during configure()). Adding software smoothing on top causes
        double-smoothing oscillation / shaking.

        Dry-run: uses velocity-limited interpolation for visual simulation.
        """
        logger.info("Adapter control loop started (dry_run=%s)", self._dry_run)
        target_dt = 1.0 / 60.0

        # Dry-run smoothing state
        with self._lock:
            smoothed = self._joint_positions.copy()
        MAX_DEG_PER_SEC = 200.0
        GRIPPER_DEG_PER_SEC = 150.0

        while self._running:
            t0 = time.perf_counter()

            try:
                with self._lock:
                    targets = self._joint_targets.copy()
                    is_dry_run = self._dry_run
                    robot = self._robot
                    bus = self._bus
                    available_joints = sorted(self._available_joints)
                    should_poll_temperatures = (
                        time.monotonic() - self._last_temperature_poll_at
                    ) >= TEMPERATURE_POLL_INTERVAL_S

                if is_dry_run:
                    # Velocity-limited interpolation for visual simulation
                    for jid in JOINT_IDS:
                        diff = targets[jid] - smoothed[jid]
                        if abs(diff) < 0.01:
                            smoothed[jid] = targets[jid]
                            continue
                        max_step = (GRIPPER_DEG_PER_SEC if jid == "gripper" else MAX_DEG_PER_SEC) * target_dt
                        if abs(diff) <= max_step:
                            smoothed[jid] = targets[jid]
                        else:
                            smoothed[jid] += max_step if diff > 0 else -max_step
                    with self._lock:
                        for jid in JOINT_IDS:
                            self._joint_positions[jid] = smoothed[jid]
                            self._joint_temperatures[jid] = None
                elif bus is not None:
                    if available_joints:
                        bus.sync_write("Goal_Position", {jid: targets[jid] for jid in available_joints})
                        observed = bus.sync_read("Present_Position", available_joints)
                        temperatures = None
                        temperature_read_at = None
                        if should_poll_temperatures:
                            temperatures = bus.sync_read("Present_Temperature", available_joints)
                            temperature_read_at = time.monotonic()
                        with self._lock:
                            for jid in available_joints:
                                if jid in observed:
                                    self._joint_positions[jid] = float(observed[jid])
                            if temperatures is not None:
                                for jid in JOINT_IDS:
                                    self._joint_temperatures[jid] = None
                                for jid in available_joints:
                                    value = temperatures.get(jid)
                                    self._joint_temperatures[jid] = (
                                        float(value) if isinstance(value, (int, float)) else None
                                    )
                                if temperature_read_at is not None:
                                    self._last_temperature_poll_at = temperature_read_at
                elif robot:
                    # Real hardware: send raw targets — servo PID handles smoothing
                    action = {f"{jid}.pos": targets[jid] for jid in JOINT_IDS}
                    robot.send_action(action)

                    # Read actual positions for UI feedback
                    obs = robot.get_observation()
                    temperatures = None
                    temperature_read_at = None
                    if should_poll_temperatures and hasattr(robot, "bus"):
                        temperatures = robot.bus.sync_read("Present_Temperature", JOINT_IDS)
                        temperature_read_at = time.monotonic()
                    with self._lock:
                        for jid in JOINT_IDS:
                            key = f"{jid}.pos"
                            if key in obs:
                                self._joint_positions[jid] = float(obs[key])
                        if temperatures is not None:
                            for jid in JOINT_IDS:
                                value = temperatures.get(jid)
                                self._joint_temperatures[jid] = (
                                    float(value) if isinstance(value, (int, float)) else None
                                )
                            if temperature_read_at is not None:
                                self._last_temperature_poll_at = temperature_read_at

            except Exception as e:
                logger.error(f"Control loop error: {e}")
                time.sleep(0.5)
                continue

            work_dt = time.perf_counter() - t0
            sleep_time = max(0, target_dt - work_dt)
            time.sleep(sleep_time)
            total_dt = time.perf_counter() - t0

            with self._lock:
                self._latency_ms = work_dt * 1000.0
                self._frame_times.append(total_dt)
                if len(self._frame_times) > self._FPS_WINDOW:
                    self._frame_times = self._frame_times[-self._FPS_WINDOW:]
                avg_dt = sum(self._frame_times) / len(self._frame_times)
                self._fps = 1.0 / avg_dt if avg_dt > 0 else 0.0

        logger.info("Adapter control loop stopped")
