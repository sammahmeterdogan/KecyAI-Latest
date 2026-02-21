"""
Calibration Manager for SO-ARM101 (LeRobot).

State machine: idle → running → completed | stopped
Dry-run: simulates calibration data without hardware.
Conflict: mutual exclusion with teleop sessions.

Steps follow the HuggingFace LeRobot SO-101 calibration flow:
  1. zero_position — confirm all joints at center
  2-7. range_{joint} — sweep each joint through full range, record min/max
  8. save — write calibration artifact to disk

Reference: https://huggingface.co/docs/lerobot/so101#calibrate
"""

import json
import logging
import math
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Joint definitions (same as lerobot_adapter) ──

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

# ── Calibration step definitions ──

CALIBRATION_STEPS: List[Dict[str, Any]] = [
    {
        "id": "zero_position",
        "title": "Center Position",
        "description": "Move all joints to their center (zero) position and confirm.",
        "joint": None,
        "action": "confirm",
    },
] + [
    {
        "id": f"range_{jid}",
        "title": f"Range: {jid.replace('_', ' ').title()}",
        "description": f"Slowly move {jid.replace('_', ' ')} through its full range of motion.",
        "joint": jid,
        "action": "sweep",
    }
    for jid in JOINT_IDS
] + [
    {
        "id": "save",
        "title": "Save Calibration",
        "description": "Review recorded ranges and save calibration artifact.",
        "joint": None,
        "action": "save",
    },
]

# ── Output path ──

home_dir = Path(os.environ.get("HOME", "/home/kecyai"))
CALIBRATION_DIR = home_dir / ".kecyai" / "calibration"


class CalibrationConflictError(Exception):
    """Raised when calibration conflicts with an active teleop session."""
    pass


class CalibrationManager:
    """
    Manages calibration sessions with a simple state machine.
    Thread-safe via self._lock.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._state = "idle"  # idle | running | completed | stopped
        self._dry_run = True
        self._robot_type = ""
        self._current_step_index = 0
        self._step_results: Dict[str, Any] = {}
        self._session_start_time: Optional[float] = None
        self._artifact_path: Optional[str] = None
        self._error_message = ""
        CALIBRATION_DIR.mkdir(parents=True, exist_ok=True)

    # ──────────── Public API ────────────

    def get_status(self) -> Dict[str, Any]:
        """Return current calibration state."""
        with self._lock:
            result: Dict[str, Any] = {
                "state": self._state,
                "dry_run": self._dry_run,
                "robot_type": self._robot_type,
                "current_step_index": self._current_step_index,
                "total_steps": len(CALIBRATION_STEPS),
                "steps": self._build_steps_summary(),
            }
            if self._state == "running":
                result["current_step"] = CALIBRATION_STEPS[self._current_step_index]
            if self._artifact_path:
                result["artifact_path"] = self._artifact_path
            if self._error_message:
                result["error"] = self._error_message
            if self._session_start_time:
                result["elapsed_seconds"] = round(time.time() - self._session_start_time, 1)
            return result

    def start(self, config: Dict[str, Any], teleop_running: bool = False) -> Dict[str, Any]:
        """
        Start a calibration session.
        Raises CalibrationConflictError if teleop is running.
        Raises ValueError for invalid config.
        """
        if teleop_running:
            raise CalibrationConflictError(
                "Teleop session is active. Stop teleop before starting calibration."
            )

        robot_type = config.get("robot_type", "so101_follower")
        if not robot_type:
            raise ValueError("Missing required field: 'robot_type'")

        with self._lock:
            if self._state == "running":
                raise CalibrationConflictError(
                    "Calibration already running. Stop current session first."
                )

            # Determine dry-run: if serial_port not provided → dry-run
            serial_port = config.get("serial_port", "")
            camera_id = config.get("camera_id", "")
            self._dry_run = not bool(serial_port)

            self._state = "running"
            self._robot_type = robot_type
            self._current_step_index = 0
            self._step_results = {}
            self._session_start_time = time.time()
            self._artifact_path = None
            self._error_message = ""

            logger.info(
                "Calibration started: robot_type=%s, dry_run=%s",
                robot_type, self._dry_run,
            )

            return {
                "state": "running",
                "dry_run": self._dry_run,
                "robot_type": robot_type,
                "message": "Calibration started" + (" (dry-run)" if self._dry_run else ""),
                "current_step": CALIBRATION_STEPS[0],
                "total_steps": len(CALIBRATION_STEPS),
            }

    def step(self, config: Dict[str, Any] = None, estop_active: bool = False) -> Dict[str, Any]:
        """
        Advance to the next calibration step or confirm current step.
        
        In dry-run mode, simulates joint range data.
        If E-STOP is active and the step involves actuator movement, returns 409.
        """
        config = config or {}

        with self._lock:
            if self._state != "running":
                raise RuntimeError("No calibration session running. Call /calibration/start first.")

            if self._current_step_index >= len(CALIBRATION_STEPS):
                raise RuntimeError("All steps already completed. Save or stop the session.")

            step_def = CALIBRATION_STEPS[self._current_step_index]

            # E-STOP guard: steps that move actuators
            if estop_active and step_def["action"] == "sweep":
                raise RuntimeError("E-STOP active. Release emergency stop before calibration step.")

            # Execute step
            step_result = self._execute_step(step_def, config)
            self._step_results[step_def["id"]] = step_result

            # Advance
            self._current_step_index += 1

            # Check if all steps done
            if self._current_step_index >= len(CALIBRATION_STEPS):
                self._state = "completed"
                logger.info("Calibration completed (all steps done).")
                return {
                    "state": "completed",
                    "step_completed": step_def["id"],
                    "step_result": step_result,
                    "message": "All calibration steps completed.",
                    "artifact_path": self._artifact_path,
                    "dry_run": self._dry_run,
                }

            next_step = CALIBRATION_STEPS[self._current_step_index]
            return {
                "state": "running",
                "step_completed": step_def["id"],
                "step_result": step_result,
                "next_step": next_step,
                "current_step_index": self._current_step_index,
                "total_steps": len(CALIBRATION_STEPS),
                "dry_run": self._dry_run,
            }

    def stop(self) -> Dict[str, Any]:
        """Stop the current calibration session."""
        with self._lock:
            if self._state == "idle":
                return {"state": "idle", "message": "No calibration session to stop."}

            prev_state = self._state
            self._state = "stopped"
            logger.info("Calibration stopped (was: %s, steps completed: %d/%d)",
                        prev_state, self._current_step_index, len(CALIBRATION_STEPS))
            return {
                "state": "stopped",
                "message": "Calibration session stopped.",
                "steps_completed": self._current_step_index,
                "total_steps": len(CALIBRATION_STEPS),
                "dry_run": self._dry_run,
            }

    def is_running(self) -> bool:
        """Thread-safe check if calibration is active."""
        with self._lock:
            return self._state == "running"

    # ──────────── Internal ────────────

    def _execute_step(self, step_def: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a single calibration step. Simulates data in dry-run."""
        step_id = step_def["id"]
        action = step_def["action"]
        joint = step_def.get("joint")

        if action == "confirm":
            # Zero position confirmation
            return {
                "id": step_id,
                "status": "confirmed",
                "positions": {jid: 0.0 for jid in JOINT_IDS},
                "simulated": self._dry_run,
            }

        elif action == "sweep" and joint:
            # Joint range sweep
            if self._dry_run:
                lo, hi = JOINT_LIMITS[joint]
                # Simulate: record min/max with small random-like offset
                return {
                    "id": step_id,
                    "joint": joint,
                    "status": "recorded",
                    "measured_min": round(lo * 0.95, 4),
                    "measured_max": round(hi * 0.95, 4),
                    "nominal_min": lo,
                    "nominal_max": hi,
                    "simulated": True,
                }
            else:
                # Hardware path (future)
                lo, hi = JOINT_LIMITS[joint]
                return {
                    "id": step_id,
                    "joint": joint,
                    "status": "recorded",
                    "measured_min": lo,
                    "measured_max": hi,
                    "nominal_min": lo,
                    "nominal_max": hi,
                    "simulated": False,
                }

        elif action == "save":
            # Write calibration artifact
            artifact = self._build_artifact()
            artifact_path = self._save_artifact(artifact)
            self._artifact_path = str(artifact_path)
            return {
                "id": step_id,
                "status": "saved",
                "artifact_path": self._artifact_path,
                "simulated": self._dry_run,
            }

        return {"id": step_id, "status": "unknown_action"}

    def _build_artifact(self) -> Dict[str, Any]:
        """Build the calibration artifact from step results."""
        joints_data = {}
        for jid in JOINT_IDS:
            range_key = f"range_{jid}"
            if range_key in self._step_results:
                r = self._step_results[range_key]
                joints_data[jid] = {
                    "measured_min": r.get("measured_min"),
                    "measured_max": r.get("measured_max"),
                    "nominal_min": r.get("nominal_min"),
                    "nominal_max": r.get("nominal_max"),
                }
            else:
                lo, hi = JOINT_LIMITS[jid]
                joints_data[jid] = {
                    "measured_min": lo,
                    "measured_max": hi,
                    "nominal_min": lo,
                    "nominal_max": hi,
                }

        return {
            "version": "1.0",
            "robot_type": self._robot_type,
            "dry_run": self._dry_run,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "joints": joints_data,
        }

    def _save_artifact(self, artifact: Dict[str, Any]) -> Path:
        """Write artifact JSON to disk."""
        ts = time.strftime("%Y%m%d_%H%M%S")
        filename = f"calibration_{self._robot_type}_{ts}.json"
        path = CALIBRATION_DIR / filename
        with open(path, "w", encoding="utf-8") as f:
            json.dump(artifact, f, indent=2)
        logger.info("Calibration artifact saved: %s", path)
        return path

    def _build_steps_summary(self) -> List[Dict[str, Any]]:
        """Build a summary of all steps with their completion status."""
        summary = []
        for i, step_def in enumerate(CALIBRATION_STEPS):
            entry = {
                "id": step_def["id"],
                "title": step_def["title"],
                "status": "pending",
            }
            if step_def["id"] in self._step_results:
                entry["status"] = "completed"
                entry["result"] = self._step_results[step_def["id"]]
            elif i == self._current_step_index and self._state == "running":
                entry["status"] = "current"
            summary.append(entry)
        return summary
