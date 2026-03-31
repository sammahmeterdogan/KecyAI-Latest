"""
Teleoperation Manager for LeRobot Runtime.
Handles safe execution of the `lerobot-teleoperate` command and Web Teleoperation.

Refactored to use LeRobotTeleopAdapter for web teleop mode (with dry-run support).
Standard CLI teleop mode remains subprocess-based.
"""
import os
import subprocess
import signal
import json
import logging
import time
import threading
import sys
from pathlib import Path
from typing import Optional, Dict, Any, List

from .lerobot_adapter import LeRobotTeleopAdapter, JOINT_IDS, JOINT_LIMITS
from runtime_exec import build_runtime_command, lerobot_checkout_dir

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Constants
# Constants
home_dir = Path(os.environ.get("HOME") or Path.home())
DATA_DIR = home_dir / ".kecyai" / "teleop"
SESSION_FILE = DATA_DIR / "session.json"
LOG_FILE = DATA_DIR / "logs.txt"

# Whitelists for security (prevent arbitrary command injection)
ALLOWED_ROBOTS = {
    "so_100", "so100_follower", "so_follower", "bi_so_follower", "so101_follower",
    "aloha", "reachy2", "mobile_aloha", "koch_follower",
    "openarm_follower", "bi_openarm_follower", "unitree_g1"
}

ALLOWED_TELEOPERATORS = {
    "so_leader", "bi_so_leader", "aloha_leader", "koch_leader",
    "openarm_leader", "bi_openarm_leader", "gamepad", "keyboard",
    "homunculus", "reachy2_teleoperator", "web"
}


class ConflictError(Exception):
    """Raised when a start request conflicts with an already-running session."""
    def __init__(self, message: str, current_status: Dict[str, Any] = None):
        super().__init__(message)
        self.current_status = current_status or {}


class TeleopManager:
    def __init__(self):
        # Ensure data directory exists
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.process: Optional[subprocess.Popen] = None
        self.adapter = LeRobotTeleopAdapter()
        self.lock = threading.Lock()
        self._load_session()

    def _append_log(self, message: str):
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{timestamp}] {message}\n")

    def _load_session(self):
        """Clear stale sessions on startup. After restart, no previous session is valid."""
        if SESSION_FILE.exists():
            logger.info("Clearing stale session file from previous run.")
            self._clear_session()

    def _clear_session(self):
        if SESSION_FILE.exists():
            SESSION_FILE.unlink()

    def _is_pid_running(self, pid: int) -> bool:
        """Checks if a PID is running."""
        try:
            os.kill(pid, 0)
        except OSError:
            return False
        return True

    # ───────────── Start / Stop ─────────────

    def start(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Starts a teleop session (idempotent).

        - If already running with same (robot_type, teleop_type) -> return current status (200).
        - If already running with different config -> raise ConflictError (409).
        - Otherwise start new session.
        """
        robot_type = config.get("robot_type")
        teleop_type = config.get("teleop_type")

        # --- Validate inputs first ---
        if not robot_type:
            raise ValueError("Missing required field: 'robot_type'")
        if not teleop_type:
            raise ValueError("Missing required field: 'teleop_type'")
        if robot_type not in ALLOWED_ROBOTS:
            raise ValueError(
                f"Invalid robot_type '{robot_type}'. Allowed: {sorted(ALLOWED_ROBOTS)}"
            )
        if teleop_type not in ALLOWED_TELEOPERATORS:
            raise ValueError(
                f"Invalid teleop_type '{teleop_type}'. Allowed: {sorted(ALLOWED_TELEOPERATORS)}"
            )

        # --- Idempotency check ---
        status = self.get_status()
        if status["state"] == "running":
            current_meta = status.get("metadata", {})
            current_robot = current_meta.get("robot_type", "")
            current_teleop = current_meta.get("teleop_type", "")

            if current_robot == robot_type and current_teleop == teleop_type:
                # Idempotent: same config already running -> return current status
                logger.info("Idempotent start: session already running with matching config")
                self._append_log(f"Idempotent start request (already running, same config)")
                return {
                    "state": "running",
                    "pid": status.get("pid"),
                    "dry_run": current_meta.get("dry_run", False),
                    "message": "Session already running with matching configuration",
                    "idempotent": True,
                }
            else:
                # Conflict: different config already running
                raise ConflictError(
                    f"Teleop already running with robot_type='{current_robot}', "
                    f"teleop_type='{current_teleop}'. Stop current session first.",
                    current_status=status,
                )

        # Cleanup old logs
        if LOG_FILE.exists():
            LOG_FILE.unlink()

        if teleop_type == "web":
            return self._start_web_teleop(config)
        return self._start_standard_teleop(config, robot_type, teleop_type)


    def _start_web_teleop(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Start web teleop using LeRobotTeleopAdapter.
        Falls back to dry-run only when the runtime is explicitly configured
        for dry-run mode.
        """
        robot_type = config.get("robot_type", "so101_follower")
        if robot_type == "so_100":
            robot_type = "so100_follower"
        robot_port = config.get("robot_port", "")
        allow_dry_run = True

        # Fall back to admin config serial_port if not provided in request
        if not robot_port:
            try:
                from hardware_check import HardwareConfig
                hw = HardwareConfig()
                hw_config = hw.get()
                robot_port = hw_config.get("serial_port", "")
                allow_dry_run = bool(hw_config.get("dry_run", True))
                if robot_port:
                    logger.info(f"Using serial_port from admin config: {robot_port}")
            except Exception:
                pass
        else:
            allow_dry_run = False

        # Resolve calibration: prefer the lerobot-native calibration file
        # stored inside the KECY artifact wrapper.
        calibration_path = None
        try:
            from calibration.CalibrationAdmin import CalibrationAdmin
            import json as _json
            admin = CalibrationAdmin()
            selected = admin.get_selected_artifact()
            if selected and selected.get("robot_type") == robot_type:
                artifact_path = selected.get("path", "")
                if artifact_path:
                    try:
                        with open(artifact_path, "r", encoding="utf-8") as _f:
                            artifact_data = _json.load(_f)
                        lr_path = artifact_data.get("lerobot_calibration_path")
                        if lr_path and Path(lr_path).exists():
                            calibration_path = lr_path
                            logger.info("Using lerobot calibration from artifact: %s", calibration_path)
                        else:
                            # Fallback: let the adapter try to resolve it
                            calibration_path = artifact_path
                            logger.info("Using artifact path for calibration resolution: %s", calibration_path)
                    except Exception:
                        calibration_path = artifact_path
        except Exception as e:
            logger.warning(f"Failed to resolve selected calibration: {e}")

        try:
            result = self.adapter.connect(
                robot_type=robot_type,
                port=robot_port,
                cameras=config.get("cameras"),
                calibration_path=calibration_path,
                allow_dry_run=allow_dry_run,
            )

            self._append_log(f"Web teleop started. dry_run={result.get('dry_run')}")

            # Save session
            session_data = {
                "pid": os.getpid(),
                "start_time": time.time(),
                "teleop_type": "web",
                "robot_type": robot_type,
                "dry_run": result.get("dry_run", False),
            }
            with open(SESSION_FILE, "w") as f:
                json.dump(session_data, f)

            return {
                "state": "starting",
                "pid": os.getpid(),
                "dry_run": result.get("dry_run", False),
                "message": result.get("message", "Web teleop started"),
            }

        except Exception as e:
            logger.error(f"Failed to start web teleop: {e}")
            self._append_log(f"Web teleop start failed: {e}")
            raise RuntimeError(f"Web Teleop Failure: {e}")

    def stop(self) -> Dict[str, Any]:
        """Stops the current teleop session."""
        # Check adapter (web teleop)
        if self.adapter.is_connected():
            result = self.adapter.disconnect()
            self._clear_session()
            self._append_log("Web teleop session stopped.")
            return {"message": "Web teleop stopped", "state": "idle"}

        # Standard process stop
        status = self.get_status()
        pid = status.get("pid")
        if not pid or status["state"] == "idle":
            if SESSION_FILE.exists():
                self._clear_session()
            return {"message": "No active session to stop", "state": "idle"}

        try:
            os.kill(pid, signal.SIGTERM)
            time.sleep(1)
            if self._is_pid_running(pid):
                os.kill(pid, signal.SIGKILL)

            self._clear_session()
            self._append_log("Teleop process stopped.")
            return {"message": "Teleop stopped", "state": "idle"}
        except Exception as e:
            logger.error(f"Error stopping PID {pid}: {e}")
            self._clear_session()
            raise RuntimeError(f"Failed to stop process: {e}")

    # ───────────── Status / Joints / Telemetry ─────────────

    def get_status(self) -> Dict[str, Any]:
        """Returns { state, pid, metadata }."""
        # Check adapter first (web teleop)
        if self.adapter.is_connected():
            adapter_status = self.adapter.get_status()
            return {
                "state": adapter_status.get("state", "running"),
                "pid": os.getpid(),
                "metadata": {
                    "teleop_type": "web",
                    "dry_run": adapter_status.get("dry_run", False),
                    "fps": adapter_status.get("fps", 0),
                    "latency_ms": adapter_status.get("latency_ms", 0),
                    "robot_type": adapter_status.get("robot_type", ""),
                    "voltage": 0.0,
                    "estop": adapter_status.get("estop", False),
                },
            }

        # Check session file for standard teleop
        if not SESSION_FILE.exists():
            return {"state": "idle", "pid": None}

        try:
            with open(SESSION_FILE, "r") as f:
                data = json.load(f)

            if data.get("teleop_type") == "web":
                # Session file says web but adapter not connected -> error
                return {"state": "error", "message": "Web Teleop died", "last_session": data}

            pid = data.get("pid")
            if pid and self._is_pid_running(pid):
                return {"state": "running", "pid": pid, "metadata": data}
            else:
                return {"state": "error", "message": "Process died unexpectedly", "last_session": data}
        except Exception:
            return {"state": "idle", "pid": None}

    def get_joint_state(self) -> List[Dict[str, Any]]:
        """Returns current joint positions from adapter."""
        if self.adapter.is_connected():
            return self.adapter.get_joint_state()
        # Return default zeros when not connected
        return [
            {
                "id": jid,
                "servo_id": JOINT_IDS.index(jid) + 1,
                "name": jid.replace("_", " ").title(),
                "position": 0.0,
                "temperature": None,
                "min": lo,
                "max": hi,
            }
            for jid, (lo, hi) in JOINT_LIMITS.items()
        ]

    def get_telemetry(self) -> Dict[str, Any]:
        """Returns telemetry snapshot from adapter."""
        if self.adapter.is_connected():
            return self.adapter.get_telemetry()
        return {
            "fps": 0, "latency_ms": 0, "dry_run": False,
            "connected": False,
            "temperature": None,
            "joints": [
                {"id": jid, "servo_id": JOINT_IDS.index(jid) + 1, "position": 0.0, "temperature": None}
                for jid in JOINT_IDS
            ],
        }

    # ───────────── E-STOP ─────────────

    def estop_on(self) -> Dict[str, Any]:
        """Engage emergency stop via adapter."""
        if not self.adapter.is_connected():
            raise RuntimeError("Web Teleop not running")
        result = self.adapter.estop_on()
        self._append_log("E-STOP ENGAGED")
        return result

    def estop_off(self) -> Dict[str, Any]:
        """Release emergency stop via adapter."""
        if not self.adapter.is_connected():
            raise RuntimeError("Web Teleop not running")
        result = self.adapter.estop_off()
        self._append_log("E-STOP released")
        return result

    # ───────────── Torque ─────────────

    def read_torque(self) -> Dict[str, Any]:
        """Read motor torque values from the active adapter."""
        if self.adapter.is_connected():
            return self.adapter.read_torque()
        return {"current_torque": []}

    def toggle_torque(self, enabled: bool) -> Dict[str, Any]:
        """Enable or disable motor torque on the active adapter."""
        if not self.adapter.is_connected():
            raise RuntimeError("Web Teleop not running")
        result = self.adapter.toggle_torque(enabled)
        self._append_log(f"Torque {'enabled' if enabled else 'disabled'}")
        return result

    # ───────────── Joint Commands ─────────────

    def _check_preconditions(self):
        """Guard: teleop must be connected and E-STOP must be off."""
        if not self.adapter.is_connected():
            raise RuntimeError("Web Teleop not running. Call /teleop/start first.")
        if self.adapter.is_estop_active():
            raise RuntimeError("E-STOP active. Release emergency stop before sending commands.")

    def set_joint(self, joint_id: str, value: float):
        """Set single joint via adapter."""
        self._check_preconditions()
        result = self.adapter.set_single_joint(joint_id, value)
        if result.get("rejected"):
            raise ValueError(f"Rejected: {result['rejected']}")
        self._append_log(f"Joint updated: {joint_id}={value:.3f}")

    def set_joints(self, joints: Dict[str, float]):
        """Set multiple joints via adapter."""
        self._check_preconditions()
        result = self.adapter.set_joint_targets(joints)
        if result.get("rejected"):
            logger.warning(f"Some joints rejected: {result['rejected']}")
        return result

    def send_command(self, joints_list: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Batch command: accepts [{id, position}, ...].
        Returns adapter result with accepted/rejected lists and simulated flag.

        Validates each joint entry; collects parse errors in rejected list
        rather than failing the entire request.
        """
        self._check_preconditions()

        if not joints_list:
            return {"accepted": [], "rejected": [], "simulated": self.adapter._dry_run}

        targets = {}
        parse_errors = []
        for idx, j in enumerate(joints_list):
            if not isinstance(j, dict):
                parse_errors.append({"index": idx, "reason": "entry must be an object"})
                continue
            jid = j.get("id")
            pos = j.get("position")
            if not jid:
                parse_errors.append({"index": idx, "reason": "missing 'id'"})
                continue
            if pos is None:
                parse_errors.append({"index": idx, "reason": f"missing 'position' for joint '{jid}'"})
                continue
            try:
                targets[jid] = float(pos)
            except (TypeError, ValueError):
                parse_errors.append({"index": idx, "reason": f"invalid position value for '{jid}'"})

        result = self.adapter.set_joint_targets(targets)
        # Merge parse errors into rejected list
        result["rejected"] = parse_errors + result.get("rejected", [])
        self._append_log(f"Batch command: {len(result.get('accepted', []))} accepted, {len(result['rejected'])} rejected")
        return result

    def home_pose(self):
        self._check_preconditions()
        self.adapter.home_pose()
        self._append_log("Home pose command applied.")
        return {"status": "ok", "pose": "home"}

    def ready_pose(self):
        self._check_preconditions()
        self.adapter.ready_pose()
        self._append_log("Ready pose command applied.")
        return {"status": "ok", "pose": "ready"}

    def gripper_open(self):
        self._check_preconditions()
        self.adapter.gripper_open()
        self._append_log("Gripper open command applied.")
        return {"status": "ok", "gripper": "open"}

    def gripper_close(self):
        self._check_preconditions()
        self.adapter.gripper_close()
        self._append_log("Gripper close command applied.")
        return {"status": "ok", "gripper": "close"}

    def get_logs(self, tail: int = 200) -> List[str]:
        """Returns the last N lines of the log file."""
        if not LOG_FILE.exists():
            return []
        try:
            with open(LOG_FILE, "r") as f:
                lines = f.readlines()
                return [line.rstrip("\n") for line in lines[-tail:]]
        except Exception as e:
            return [f"Error reading logs: {e}"]

    # ───────────── Standard Teleop (subprocess) ─────────────

    def _start_standard_teleop(self, config, robot_type, teleop_type):
        cmd = build_runtime_command("teleoperate")
        cmd.extend([f"--robot.type={robot_type}"])
        cmd.extend([f"--teleop.type={teleop_type}"])

        if config.get("robot_port"):
            cmd.extend([f"--robot.port={config['robot_port']}"])
        if config.get("teleop_port"):
            cmd.extend([f"--teleop.port={config['teleop_port']}"])

        logger.info(f"Starting teleop: {' '.join(cmd)}")
        try:
            log_f = open(LOG_FILE, "w")
            checkout_dir = lerobot_checkout_dir()
            self.process = subprocess.Popen(
                cmd,
                stdout=log_f,
                stderr=subprocess.STDOUT,
                cwd=str(checkout_dir) if checkout_dir is not None else None,
                env={**os.environ, "PYTHONUNBUFFERED": "1"}
            )

            session_data = {
                "pid": self.process.pid,
                "start_time": time.time(),
                "command": cmd,
                "robot_type": robot_type,
                "teleop_type": teleop_type,
            }
            with open(SESSION_FILE, "w") as f:
                json.dump(session_data, f)

            return {
                "state": "starting",
                "pid": self.process.pid,
                "message": "Teleop process started",
            }

        except Exception as e:
            logger.error(f"Failed to start teleop: {e}")
            raise RuntimeError(f"Failed to launch process: {str(e)}")
