"""
Interactive motor setup session manager for SO-ARM101.

Wraps `lerobot-setup-motors` and exposes:
  - start
  - status
  - send_enter
  - stop
  - get_logs
"""

from __future__ import annotations

import os
import re
import signal
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional


MOTOR_STEPS: List[Dict[str, Any]] = [
    {"key": "gripper", "id": 6},
    {"key": "wrist_roll", "id": 5},
    {"key": "wrist_flex", "id": 4},
    {"key": "elbow_flex", "id": 3},
    {"key": "shoulder_lift", "id": 2},
    {"key": "shoulder_pan", "id": 1},
]

SUCCESS_RE = re.compile(
    r"['\"]?(?P<key>[a-z_]+)['\"]?\s+motor id set to\s+(?P<id>\d+)",
    flags=re.IGNORECASE,
)
FAIL_HINT_RE = re.compile(r"(error|failed|exception|traceback)", flags=re.IGNORECASE)


class ConflictError(Exception):
    """Raised when a start request conflicts with an active setup session."""

    def __init__(self, message: str, current_status: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.current_status = current_status or {}


class MotorSetupManager:
    def __init__(self):
        self._lock = threading.Lock()
        self._process: Optional[subprocess.Popen] = None
        self._state = "idle"  # idle | running | stopping | stopped | completed | failed
        self._flow = ""
        self._port = ""
        self._session_id = ""
        self._started_at: Optional[float] = None
        self._ended_at: Optional[float] = None
        self._exit_code: Optional[int] = None
        self._last_error = ""
        self._command: List[str] = []

        self._logs: List[Dict[str, Any]] = []
        self._log_base_index = 0
        self._next_log_index = 0
        self._max_logs = 3000

        self._steps: List[Dict[str, Any]] = []
        self._current_step_index = 0

    # ----------------------------
    # Public API
    # ----------------------------

    def start(self, config: Dict[str, Any]) -> Dict[str, Any]:
        flow = str(config.get("flow", "follower")).strip().lower()
        port = str(config.get("port", "")).strip()

        if flow not in ("follower", "leader"):
            raise ValueError("Invalid 'flow'. Allowed: follower, leader")
        if not port:
            raise ValueError("Missing required field: 'port'")

        with self._lock:
            if self._is_running_locked():
                raise ConflictError(
                    "Motor setup session already running. Stop current session first.",
                    current_status=self._build_status_locked(),
                )
            self._reset_session_locked(flow=flow, port=port)
            self._command = self._build_command(flow, port)

        try:
            cwd = "/lerobot" if Path("/lerobot").exists() else None
            process = subprocess.Popen(
                self._command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                cwd=cwd,
                env={**os.environ, "PYTHONUNBUFFERED": "1"},
            )
        except FileNotFoundError:
            with self._lock:
                self._state = "failed"
                self._last_error = "lerobot-setup-motors command not found in runtime container."
            raise RuntimeError(self._last_error)
        except Exception as e:
            with self._lock:
                self._state = "failed"
                self._last_error = f"Failed to start motor setup process: {e}"
            raise RuntimeError(self._last_error)

        with self._lock:
            self._process = process
            self._state = "running"
            self._append_log_locked("system", "$ " + " ".join(self._command))

        if process.stdout is not None:
            threading.Thread(
                target=self._stream_reader,
                args=("stdout", process.stdout),
                daemon=True,
            ).start()

        if process.stderr is not None:
            threading.Thread(
                target=self._stream_reader,
                args=("stderr", process.stderr),
                daemon=True,
            ).start()

        threading.Thread(target=self._watch_process, daemon=True).start()
        return self.get_status()

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            return self._build_status_locked()

    def send_enter(self, times: int = 1) -> Dict[str, Any]:
        if times < 1 or times > 10:
            raise ValueError("'times' must be between 1 and 10")

        with self._lock:
            if not self._is_running_locked() or self._process is None:
                raise RuntimeError("No running motor setup session. Start first.")
            stdin = self._process.stdin
            if stdin is None:
                raise RuntimeError("Motor setup process stdin is unavailable.")

        sent = 0
        try:
            for _ in range(times):
                stdin.write("\n")
                sent += 1
            stdin.flush()
        except Exception as e:
            raise RuntimeError(f"Failed to send Enter to process: {e}")

        with self._lock:
            self._append_log_locked("system", f"[control] Enter sent x{sent}")
            return self._build_status_locked()

    def stop(self) -> Dict[str, Any]:
        with self._lock:
            process = self._process
            if process is None or process.poll() is not None:
                self._state = "stopped" if self._state != "idle" else "idle"
                self._ended_at = time.time()
                return self._build_status_locked()
            self._state = "stopping"
            self._append_log_locked("system", "Stopping motor setup process...")

        try:
            process.terminate()
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)
        except Exception:
            try:
                os.kill(process.pid, signal.SIGTERM)
            except Exception:
                pass

        with self._lock:
            self._exit_code = process.returncode
            self._ended_at = time.time()
            self._process = None
            self._state = "stopped"
            self._append_log_locked("system", f"Motor setup stopped (exit_code={self._exit_code}).")
            return self._build_status_locked()

    def get_logs(self, since: Optional[int] = None, tail: int = 200) -> Dict[str, Any]:
        with self._lock:
            if since is not None:
                start = max(since, self._log_base_index)
                items = [entry for entry in self._logs if entry["idx"] >= start]
            else:
                t = max(1, min(int(tail), 1000))
                items = self._logs[-t:]

            return {
                "session_id": self._session_id,
                "state": self._state,
                "logs": items,
                "next_index": self._next_log_index,
                "dropped_until": self._log_base_index,
            }

    # ----------------------------
    # Internal
    # ----------------------------

    def _build_command(self, flow: str, port: str) -> List[str]:
        cmd = ["lerobot-setup-motors"]
        if flow == "leader":
            cmd.extend(["--teleop.type=so101_leader", f"--teleop.port={port}"])
        else:
            cmd.extend(["--robot.type=so101_follower", f"--robot.port={port}"])
        return cmd

    def _stream_reader(self, stream_name: str, pipe) -> None:
        try:
            for raw_line in iter(pipe.readline, ""):
                line = raw_line.rstrip("\r\n")
                if not line:
                    continue
                with self._lock:
                    self._append_log_locked(stream_name, line)
                    self._apply_line_effects_locked(line)
        except Exception as e:
            with self._lock:
                self._append_log_locked("system", f"{stream_name} reader stopped: {e}")
        finally:
            try:
                pipe.close()
            except Exception:
                pass

    def _watch_process(self) -> None:
        process = None
        with self._lock:
            process = self._process
        if process is None:
            return

        try:
            exit_code = process.wait()
        except Exception:
            exit_code = None

        with self._lock:
            if self._process is not process:
                return
            self._exit_code = exit_code
            self._ended_at = time.time()
            self._process = None

            if self._state == "stopping":
                self._state = "stopped"
            elif exit_code == 0:
                if self._all_steps_completed_locked():
                    self._state = "completed"
                    self._append_log_locked("system", "Motor setup completed successfully.")
                else:
                    self._state = "completed"
                    self._append_log_locked(
                        "system",
                        "Motor setup process exited successfully. Verify all motor steps in logs.",
                    )
            else:
                self._state = "failed"
                if not self._last_error:
                    self._last_error = f"Process exited with code {exit_code}"
                self._mark_current_failed_locked(self._last_error)
                self._append_log_locked("system", self._last_error)

    def _apply_line_effects_locked(self, line: str) -> None:
        match = SUCCESS_RE.search(line)
        if match:
            key = (match.group("key") or "").lower()
            motor_id = int(match.group("id"))
            self._mark_motor_completed_locked(key, motor_id)
            return

        if FAIL_HINT_RE.search(line):
            self._last_error = line
            self._mark_current_failed_locked(line)

    def _mark_motor_completed_locked(self, key: str, motor_id: int) -> None:
        for i, step in enumerate(self._steps):
            if step["key"] == key and step["id"] == motor_id:
                step["status"] = "completed"
                if i + 1 < len(self._steps) and self._steps[i + 1]["status"] == "pending":
                    self._steps[i + 1]["status"] = "in_progress"
                self._current_step_index = min(i + 1, len(self._steps))
                return

    def _mark_current_failed_locked(self, reason: str) -> None:
        if self._current_step_index < len(self._steps):
            step = self._steps[self._current_step_index]
            if step.get("status") in ("pending", "in_progress"):
                step["status"] = "failed"
                step["error"] = reason

    def _all_steps_completed_locked(self) -> bool:
        return all(step["status"] == "completed" for step in self._steps)

    def _reset_session_locked(self, flow: str, port: str) -> None:
        self._flow = flow
        self._port = port
        self._session_id = uuid.uuid4().hex[:12]
        self._started_at = time.time()
        self._ended_at = None
        self._exit_code = None
        self._last_error = ""
        self._logs = []
        self._log_base_index = 0
        self._next_log_index = 0
        self._steps = [
            {"key": step["key"], "id": step["id"], "status": "pending"}
            for step in MOTOR_STEPS
        ]
        if self._steps:
            self._steps[0]["status"] = "in_progress"
        self._current_step_index = 0
        self._command = []
        self._state = "idle"

    def _is_running_locked(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def _append_log_locked(self, stream: str, line: str) -> None:
        ts = time.strftime("%H:%M:%S")
        self._logs.append(
            {
                "idx": self._next_log_index,
                "ts": ts,
                "stream": stream,
                "line": line,
            }
        )
        self._next_log_index += 1

        if len(self._logs) > self._max_logs:
            overflow = len(self._logs) - self._max_logs
            self._logs = self._logs[overflow:]
            self._log_base_index = self._logs[0]["idx"] if self._logs else self._next_log_index

    def _build_status_locked(self) -> Dict[str, Any]:
        current_step = None
        if self._current_step_index < len(self._steps):
            current_step = self._steps[self._current_step_index]

        return {
            "state": self._state,
            "session_id": self._session_id,
            "flow": self._flow,
            "port": self._port,
            "started_at": self._started_at,
            "ended_at": self._ended_at,
            "exit_code": self._exit_code,
            "last_error": self._last_error,
            "running": self._is_running_locked(),
            "command": self._command,
            "current_step_index": self._current_step_index,
            "total_steps": len(self._steps),
            "current_step": current_step,
            "steps": self._steps,
            "next_log_index": self._next_log_index,
        }
