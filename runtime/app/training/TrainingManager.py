"""
Training Manager for KECY AI LeRobot Runtime.
Manages policy training jobs with dry-run mock training support.
"""
import json
import logging
import math
import os
import random
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

DATASETS_DIR = Path(os.environ.get("KECYAI_DATASETS_DIR", os.path.expanduser("~/.kecyai/datasets")))
MODELS_DIR = Path(os.environ.get("KECYAI_MODELS_DIR", os.path.expanduser("~/.kecyai/models")))

VALID_POLICY_TYPES = {"act", "diffusion", "tdmpc", "vqbet"}
DEFAULT_NUM_STEPS = 100
DEFAULT_BATCH_SIZE = 8


class TrainingManager:
    """Manages training jobs. Only one job at a time."""

    def __init__(self):
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        self._state = "idle"  # idle | training | completed | stopped | failed
        self._job: Optional[Dict[str, Any]] = None
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        self._current_step = 0
        self._total_steps = 0
        self._metrics: Dict[str, Any] = {}
        # Ring buffer for log lines (last 500)
        self._log_buffer: deque = deque(maxlen=500)
        self._log_cursor = 0  # monotonically increasing counter for SSE
        # Clear stale state on boot
        logger.info("TrainingManager initialized. State cleared to idle.")

    # ── Queries ──

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            if self._state == "idle":
                return {"state": "idle"}
            progress = 0.0
            if self._total_steps > 0:
                progress = round(self._current_step / self._total_steps * 100, 1)
            return {
                "state": self._state,
                "job_id": self._job.get("id", "") if self._job else "",
                "dataset_id": self._job.get("dataset_id", "") if self._job else "",
                "policy_type": self._job.get("policy_type", "") if self._job else "",
                "current_step": self._current_step,
                "total_steps": self._total_steps,
                "progress_pct": progress,
                "metrics": dict(self._metrics),
                "started_at": self._job.get("started_at", "") if self._job else "",
            }

    def list_artifacts(self) -> List[Dict[str, Any]]:
        artifacts = []
        if not MODELS_DIR.exists():
            return artifacts
        for d in sorted(MODELS_DIR.iterdir(), reverse=True):
            config_path = d / "config.json"
            if d.is_dir() and config_path.exists():
                try:
                    with open(config_path, "r") as f:
                        cfg = json.load(f)
                    metrics_path = d / "metrics.json"
                    final_loss = None
                    if metrics_path.exists():
                        with open(metrics_path, "r") as f:
                            m = json.load(f)
                        final_loss = m.get("final_loss")
                    artifacts.append({
                        "id": d.name,
                        "dataset_id": cfg.get("dataset_id", ""),
                        "policy_type": cfg.get("policy_type", ""),
                        "num_steps": cfg.get("num_steps", 0),
                        "status": cfg.get("status", "unknown"),
                        "final_loss": final_loss,
                        "created_at": cfg.get("created_at", ""),
                    })
                except Exception as e:
                    logger.warning(f"Failed to read training artifact {d}: {e}")
        return artifacts

    def get_logs(self, since_cursor: int = 0) -> Dict[str, Any]:
        """Return log lines since cursor for SSE streaming."""
        with self._lock:
            all_logs = list(self._log_buffer)
            new_logs = [l for l in all_logs if l["cursor"] > since_cursor]
            return {
                "logs": [l["line"] for l in new_logs],
                "cursor": self._log_cursor,
                "state": self._state,
            }

    # ── Commands ──

    def start(self, config: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            if self._state == "training":
                raise ConflictError(
                    "Training job already active.",
                    current_status=self.get_status()
                )

            dataset_id = config.get("dataset_id")
            if not dataset_id:
                raise ValueError("dataset_id is required.")

            # Validate dataset exists
            dataset_dir = DATASETS_DIR / dataset_id
            if not dataset_dir.exists() or not (dataset_dir / "meta.json").exists():
                raise ValueError(f"Dataset '{dataset_id}' not found.")

            policy_type = config.get("policy_type", "act")
            if policy_type not in VALID_POLICY_TYPES:
                raise ValueError(
                    f"Invalid policy_type '{policy_type}'. Valid: {sorted(VALID_POLICY_TYPES)}"
                )

            num_steps = int(config.get("num_steps", DEFAULT_NUM_STEPS))
            batch_size = int(config.get("batch_size", DEFAULT_BATCH_SIZE))

            if num_steps < 1 or num_steps > 100000:
                raise ValueError("num_steps must be between 1 and 100000.")
            if batch_size < 1 or batch_size > 512:
                raise ValueError("batch_size must be between 1 and 512.")

            job_id = f"job_{policy_type}_{time.strftime('%Y%m%d_%H%M%S')}"

            self._job = {
                "id": job_id,
                "dataset_id": dataset_id,
                "policy_type": policy_type,
                "num_steps": num_steps,
                "batch_size": batch_size,
                "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            }
            self._state = "training"
            self._current_step = 0
            self._total_steps = num_steps
            self._metrics = {}
            self._log_buffer.clear()
            self._log_cursor = 0
            self._stop_event.clear()

            self._thread = threading.Thread(
                target=self._training_loop,
                args=(job_id, dataset_id, policy_type, num_steps, batch_size),
                daemon=True,
            )
            self._thread.start()
            logger.info(f"Training started: job={job_id}, dataset={dataset_id}, policy={policy_type}")
            return self.get_status()

    def stop(self) -> Dict[str, Any]:
        with self._lock:
            if self._state != "training":
                return {"state": self._state, "message": "No active training job."}
            self._stop_event.set()

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5.0)

        with self._lock:
            result = self.get_status()
            if self._state == "training":
                self._state = "stopped"
                result["state"] = "stopped"
            logger.info(f"Training stopped at step {self._current_step}/{self._total_steps}")
            return result

    # ── Internal ──

    def _append_log(self, line: str):
        with self._lock:
            self._log_cursor += 1
            self._log_buffer.append({"cursor": self._log_cursor, "line": line})

    def _training_loop(self, job_id, dataset_id, policy_type, num_steps, batch_size):
        """Background loop: simulates training with realistic loss curve."""
        job_dir = MODELS_DIR / job_id
        job_dir.mkdir(parents=True, exist_ok=True)

        self._append_log(f"[INFO] Training job {job_id} started")
        self._append_log(f"[INFO] Dataset: {dataset_id}")
        self._append_log(f"[INFO] Policy: {policy_type}, Steps: {num_steps}, Batch: {batch_size}")
        self._append_log(f"[INFO] Mode: dry-run (simulated)")
        self._append_log("")

        # Simulate initial dataset loading
        self._append_log("[INFO] Loading dataset...")
        if self._stop_event.wait(timeout=0.5):
            self._finalize_job(job_dir, "stopped")
            return
        self._append_log(f"[INFO] Dataset loaded: {dataset_id}")
        self._append_log(f"[INFO] Initializing {policy_type} policy...")
        if self._stop_event.wait(timeout=0.3):
            self._finalize_job(job_dir, "stopped")
            return
        self._append_log("[INFO] Policy initialized. Starting training loop.")
        self._append_log("")

        # Training loop with realistic loss curve
        initial_loss = 2.5 + random.uniform(-0.3, 0.3)
        final_target = 0.05 + random.uniform(-0.02, 0.02)
        loss_history = []

        try:
            for step in range(1, num_steps + 1):
                if self._stop_event.is_set():
                    break

                # Exponential decay with noise
                progress = step / num_steps
                base_loss = initial_loss * math.exp(-4.0 * progress) + final_target
                noise = random.gauss(0, base_loss * 0.08)
                loss = max(0.001, round(base_loss + noise, 6))
                lr = round(1e-4 * (1 - progress * 0.9), 8)

                with self._lock:
                    self._current_step = step
                    self._metrics = {
                        "loss": loss,
                        "lr": lr,
                        "step": step,
                    }

                loss_history.append(loss)

                # Log every N steps (more frequent at start, less at end)
                log_interval = max(1, num_steps // 20)
                if step == 1 or step % log_interval == 0 or step == num_steps:
                    pct = round(step / num_steps * 100, 1)
                    self._append_log(
                        f"[TRAIN] Step {step}/{num_steps} ({pct}%) | "
                        f"loss={loss:.6f} | lr={lr:.2e}"
                    )

                # Simulate ~2 steps/sec for visibility
                if self._stop_event.wait(timeout=0.5):
                    break

            # Determine final status
            if self._stop_event.is_set():
                status = "stopped"
                self._append_log(f"\n[WARN] Training stopped by user at step {self._current_step}")
            else:
                status = "completed"
                avg_final = sum(loss_history[-5:]) / min(5, len(loss_history))
                self._append_log(f"\n[INFO] Training completed! Final loss: {avg_final:.6f}")

        except Exception as e:
            status = "failed"
            self._append_log(f"\n[ERROR] Training failed: {str(e)}")
            logger.error(f"Training loop error: {e}")

        self._finalize_job(job_dir, status, loss_history)

    def _finalize_job(self, job_dir: Path, status: str, loss_history: List[float] = None):
        """Save training artifacts and update state."""
        loss_history = loss_history or []

        # Save config
        config_data = {
            **self._job,
            "status": status,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "final_step": self._current_step,
        }
        with open(job_dir / "config.json", "w") as f:
            json.dump(config_data, f, indent=2)

        # Save metrics
        metrics_data = {
            "final_loss": loss_history[-1] if loss_history else None,
            "min_loss": min(loss_history) if loss_history else None,
            "loss_history_sample": loss_history[::max(1, len(loss_history) // 50)],
            "total_steps_completed": self._current_step,
            "status": status,
        }
        with open(job_dir / "metrics.json", "w") as f:
            json.dump(metrics_data, f, indent=2)

        # Create placeholder model file for dry-run
        placeholder = job_dir / "model_checkpoint.safetensors"
        if not placeholder.exists():
            with open(placeholder, "wb") as f:
                f.write(b"\x00" * 64)  # 64 byte placeholder

        with self._lock:
            self._state = status

        self._append_log(f"[INFO] Artifacts saved to {job_dir}")
        logger.info(f"Training finalized: {status}, artifacts at {job_dir}")


class ConflictError(Exception):
    """Raised when a training operation conflicts with current state."""
    def __init__(self, message: str, current_status: Dict[str, Any] = None):
        super().__init__(message)
        self.current_status = current_status or {}
