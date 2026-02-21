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

import logging
import math
import threading
import time
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
    "shoulder_pan":  (-math.pi, math.pi),
    "shoulder_lift": (-math.pi / 2, math.pi / 2),
    "elbow_flex":    (-2.2, 2.2),
    "wrist_flex":    (-math.pi, math.pi),
    "wrist_roll":    (-math.pi, math.pi),
    "gripper":       (0.0, 1.0),
}

HOME_POSE = {jid: 0.0 for jid in JOINT_IDS}

READY_POSE = {
    "shoulder_pan":  0.0,
    "shoulder_lift": -0.45,
    "elbow_flex":    0.9,
    "wrist_flex":    0.35,
    "wrist_roll":    0.0,
    "gripper":       0.2,
}

# Rate limit: max command frequency per joint (Hz)
MAX_COMMAND_HZ = 30
_MIN_COMMAND_INTERVAL = 1.0 / MAX_COMMAND_HZ


class LeRobotTeleopAdapter:
    """
    Adapter for SO-ARM101 (or compatible) via LeRobot library.
    Falls back to dry-run simulation when hardware is unavailable.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._robot = None  # Real LeRobot robot instance
        self._dry_run = False
        self._connected = False
        self._joint_positions: Dict[str, float] = {jid: 0.0 for jid in JOINT_IDS}
        self._joint_targets: Dict[str, float] = {jid: 0.0 for jid in JOINT_IDS}
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

    # ──────────── Connection ────────────

    def connect(self, robot_type: str = "so101_follower",
                port: str = "", cameras: Optional[dict] = None,
                calibration_path: Optional[str] = None) -> Dict[str, Any]:
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

            # Try real robot connection
            try:
                robot_instance = self._create_robot(robot_type, port, cameras, calibration_path)
                robot_instance.connect()

                # Read initial position to avoid jump on first command
                obs = robot_instance.get_observation()
                for jid in JOINT_IDS:
                    key = f"{jid}.pos"
                    if key in obs:
                        self._joint_positions[jid] = float(obs[key])
                        self._joint_targets[jid] = float(obs[key])

                self._robot = robot_instance
                self._connected = True
                logger.info(f"Connected to real robot: {robot_type}")

            except Exception as e:
                # Fallback to dry-run
                logger.warning(f"Real robot unavailable ({e}), entering dry-run mode")
                self._dry_run = True
                self._connected = True
                self._error_message = str(e)
                # Reset positions to zero for simulation
                self._joint_positions = {jid: 0.0 for jid in JOINT_IDS}
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
                "message": "dry-run: " + self._error_message if self._dry_run else "real robot connected",
            }

    def disconnect(self) -> Dict[str, Any]:
        """Stop control loop and disconnect robot."""
        with self._lock:
            self._running = False

        # Wait for loop thread outside lock to avoid deadlock
        if self._loop_thread and self._loop_thread.is_alive():
            self._loop_thread.join(timeout=3)

        with self._lock:
            if self._robot:
                try:
                    self._robot.disconnect()
                except Exception as e:
                    logger.error(f"Error disconnecting robot: {e}")
                self._robot = None

            self._connected = False
            self._dry_run = False
            self._fps = 0.0
            self._latency_ms = 0.0
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
            }

    def get_joint_state(self) -> List[Dict[str, Any]]:
        """Returns current joint positions as array of {id, name, position, min, max}."""
        with self._lock:
            result = []
            for jid in JOINT_IDS:
                lo, hi = JOINT_LIMITS[jid]
                result.append({
                    "id": jid,
                    "name": jid.replace("_", " ").title(),
                    "position": round(self._joint_positions[jid], 6),
                    "min": lo,
                    "max": hi,
                })
            return result

    def get_telemetry(self) -> Dict[str, Any]:
        """Snapshot: fps, latency, all joints, dry_run flag."""
        with self._lock:
            return {
                "fps": round(self._fps, 1),
                "latency_ms": round(self._latency_ms, 2),
                "dry_run": self._dry_run,
                "connected": self._connected,
                "estop": self._estop,
                "joints": [
                    {
                        "id": jid,
                        "position": round(self._joint_positions[jid], 6),
                    }
                    for jid in JOINT_IDS
                ],
            }

    # ──────────── Commands ────────────

    def set_joint_targets(self, joints: Dict[str, float]) -> Dict[str, Any]:
        """
        Apply joint targets. Validates, clamps, rate-limits.
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

    def _create_robot(self, robot_type: str, port: str, cameras: Optional[dict], calibration_path: Optional[str] = None):
        """Create LeRobot robot instance from config."""
        # Import inside method to allow dry-run without LeRobot installed
        from lerobot.robots import make_robot_from_config
        from lerobot.robots.so_follower.config_so_follower import SOFollowerRobotConfig
        from pathlib import Path

        if robot_type in ("so101_follower", "so100_follower", "so_follower"):
            if not port:
                raise ValueError("Robot port required for real hardware connection")
            
            # Prepare config kwargs
            kwargs = {
                "type": robot_type,
                "port": port,
                "cameras": cameras or {},
            }
            
            # Inject calibration path if provided
            # We assume the config class accepts 'calibration_dir' (directory containing the .json)
            # My CalibrationAdmin provides the full file path.
            if calibration_path:
                cal_dir = Path(calibration_path).parent
                # We can't easily know if the config class accepts this arg without inspection.
                # However, most LeRobot configs inherit from RobotConfig which may support it.
                # If this fails, it will drop into exception handler -> dry run, which is safe failure mode.
                kwargs["calibration_dir"] = cal_dir

            try:
                config = SOFollowerRobotConfig(**kwargs)
            except TypeError:
                # Fallback: maybe it doesn't support calibration_dir arg directly in init?
                # or maybe it's named differently. Retrying without it to be safe.
                if "calibration_dir" in kwargs:
                     del kwargs["calibration_dir"]
                     logger.warning("SOFollowerRobotConfig rejected calibration_dir, using defaults.")
                     config = SOFollowerRobotConfig(**kwargs)
                else:
                    raise

        else:
            raise ValueError(f"Unsupported robot type for web teleop: {robot_type}")

        return make_robot_from_config(config)

    def _control_loop(self):
        """
        Main control loop (~60Hz).
        Reads targets, sends to robot (or updates simulation), reads observation.
        """
        logger.info("Adapter control loop started (dry_run=%s)", self._dry_run)
        target_dt = 1.0 / 60.0

        while self._running:
            t0 = time.perf_counter()

            try:
                with self._lock:
                    targets = self._joint_targets.copy()
                    is_dry_run = self._dry_run
                    robot = self._robot

                if is_dry_run:
                    # Simulate: smoothly interpolate toward targets
                    with self._lock:
                        for jid in JOINT_IDS:
                            current = self._joint_positions[jid]
                            target = targets[jid]
                            # Simple exponential smoothing
                            alpha = 0.3
                            self._joint_positions[jid] = current + alpha * (target - current)
                elif robot:
                    # Build action dict for LeRobot
                    action = {f"{jid}.pos": targets[jid] for jid in JOINT_IDS}
                    robot.send_action(action)

                    # Read observation
                    obs = robot.get_observation()
                    with self._lock:
                        for jid in JOINT_IDS:
                            key = f"{jid}.pos"
                            if key in obs:
                                self._joint_positions[jid] = float(obs[key])

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
