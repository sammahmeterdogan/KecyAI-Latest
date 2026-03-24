"""
Recording Manager for KECY AI LeRobot Runtime.
Manages dataset recording sessions with dry-run episode generation.
"""
import json
import logging
import math
import os
import random
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

DATASETS_DIR = Path(os.environ.get("KECYAI_DATASETS_DIR", os.path.expanduser("~/.kecyai/datasets")))

# SO-101 joint names (6 DOF)
SO101_JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]

# Joint range for dry-run simulation (degrees)
JOINT_RANGE = (-150.0, 150.0)


class RecordingManager:
    """Manages recording sessions. Only one session at a time."""

    def __init__(self):
        DATASETS_DIR.mkdir(parents=True, exist_ok=True)
        self._state = "idle"  # idle | recording | replaying
        self._session: Optional[Dict[str, Any]] = None
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._should_save = True
        self._lock = threading.Lock()
        self._frame_count = 0
        self._episode_count = 0
        # Clear stale state on boot
        logger.info("RecordingManager initialized. State cleared to idle.")

    # ── Queries ──

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            if self._state == "idle":
                return {"state": "idle", "episode_count": self._episode_count}
            return {
                "state": self._state,
                "session_id": self._session.get("id", "") if self._session else "",
                "dataset_id": self._session.get("dataset_id", "") if self._session else "",
                "robot_type": self._session.get("robot_type", "") if self._session else "",
                "mode": self._session.get("mode", "dry_run") if self._session else "dry_run",
                "episode_count": self._episode_count,
                "frame_count": self._frame_count,
                "started_at": self._session.get("started_at", "") if self._session else "",
            }

    def list_datasets(self) -> List[Dict[str, Any]]:
        datasets = []
        if not DATASETS_DIR.exists():
            return datasets
        for d in sorted(DATASETS_DIR.iterdir(), reverse=True):
            meta_path = d / "meta.json"
            if d.is_dir() and meta_path.exists():
                try:
                    with open(meta_path, "r") as f:
                        meta = json.load(f)
                    datasets.append({
                        "id": d.name,
                        "robot_type": meta.get("robot_type", "unknown"),
                        "episode_count": meta.get("episode_count", 0),
                        "total_frames": meta.get("total_frames", 0),
                        "mode": meta.get("mode", "unknown"),
                        "created_at": meta.get("created_at", ""),
                        "duration_sec": meta.get("duration_sec", 0),
                    })
                except Exception as e:
                    logger.warning(f"Failed to read dataset meta {d}: {e}")
        return datasets

    # ── Commands ──

    def start(self, config: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            if self._state == "recording":
                raise ConflictError(
                    "Recording session already active.",
                    current_status=self.get_status()
                )

            robot_type = config.get("robot_type", "so101_follower")
            mode = config.get("mode", "dry_run")
            episode_duration = config.get("episode_duration_sec", 5)
            num_episodes = config.get("num_episodes", 3)
            hz = int(config.get("hz", 30))

            dataset_id = f"dataset_{robot_type}_{time.strftime('%Y%m%d_%H%M%S')}"
            session_id = str(uuid.uuid4())[:8]

            self._session = {
                "id": session_id,
                "dataset_id": dataset_id,
                "robot_type": robot_type,
                "mode": mode,
                "episode_duration_sec": episode_duration,
                "num_episodes": num_episodes,
                "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            }
            self._state = "recording"
            self._frame_count = 0
            self._episode_count = 0
            self._stop_event.clear()

            self._thread = threading.Thread(
                target=self._recording_loop,
                args=(dataset_id, robot_type, mode, episode_duration, num_episodes, hz),
                daemon=True,
            )
            self._thread.start()
            logger.info(f"Recording started: session={session_id}, dataset={dataset_id}")
            return self.get_status()

    def stop(self, save: bool = True) -> Dict[str, Any]:
        with self._lock:
            if self._state != "recording":
                return {"state": "idle", "message": "No active recording session."}
            self._should_save = save
            self._stop_event.set()

        # Wait for thread to finish (max 3 sec)
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3.0)

        with self._lock:
            result = self.get_status()
            result["state"] = "stopped"
            result["saved"] = save
            self._state = "idle"
            if save:
                logger.info(f"Recording stopped (saved). Episodes: {self._episode_count}, Frames: {self._frame_count}")
            else:
                logger.info(f"Recording discarded. Episodes and data removed.")
            return result

    def replay(self, episode_index: int = -1) -> Dict[str, Any]:
        with self._lock:
            if self._state != "idle":
                raise ConflictError(
                    f"Cannot replay while state is '{self._state}'.",
                    current_status=self.get_status()
                )

        # Find the most recent dataset
        datasets = self.list_datasets()
        if not datasets:
            return {"status": "error", "message": "No recorded datasets available for replay."}

        dataset = datasets[0]  # most recent (sorted descending)
        dataset_dir = DATASETS_DIR / dataset["id"] / "episodes"

        if not dataset_dir.exists():
            return {"status": "error", "message": "No episodes found in latest dataset."}

        episode_files = sorted(dataset_dir.glob("episode_*.json"))
        if not episode_files:
            return {"status": "error", "message": "No episode files found."}

        # Resolve index
        idx = episode_index if episode_index >= 0 else len(episode_files) + episode_index
        if idx < 0 or idx >= len(episode_files):
            return {"status": "error", "message": f"Episode index {episode_index} out of range (0-{len(episode_files)-1})."}

        ep_path = episode_files[idx]
        try:
            with open(ep_path, "r") as f:
                episode_data = json.load(f)
        except Exception as e:
            return {"status": "error", "message": f"Failed to read episode: {e}"}

        logger.info(f"Replaying episode {idx} from dataset {dataset['id']} ({episode_data.get('frame_count', 0)} frames)")

        return {
            "status": "ok",
            "dataset_id": dataset["id"],
            "episode_index": idx,
            "episode_id": episode_data.get("episode_id", idx),
            "frame_count": episode_data.get("frame_count", 0),
            "duration_sec": episode_data.get("duration_sec", 0),
            "frames": episode_data.get("frames", []),
        }

    # ── Internal ──

    def _recording_loop(self, dataset_id, robot_type, mode, episode_duration, num_episodes, hz):
        """Background loop: generates episodes and saves them."""
        dataset_dir = DATASETS_DIR / dataset_id
        episodes_dir = dataset_dir / "episodes"
        episodes_dir.mkdir(parents=True, exist_ok=True)

        total_frames = 0
        t_start = time.time()

        try:
            for ep_idx in range(num_episodes):
                if self._stop_event.is_set():
                    break

                frames = []
                ep_start = time.time()

                for frame_idx in range(int(episode_duration * hz)):
                    if self._stop_event.is_set():
                        break

                    t = frame_idx / hz
                    frame = self._generate_dry_run_frame(t, robot_type)
                    frames.append(frame)

                    with self._lock:
                        self._frame_count += 1

                    # Simulate real-time recording pace
                    elapsed = time.time() - ep_start
                    target = (frame_idx + 1) / hz
                    sleep_t = target - elapsed
                    if sleep_t > 0:
                        # Sleep in small chunks so stop_event is responsive
                        if self._stop_event.wait(timeout=sleep_t):
                            break

                # Save episode only if save flag is set
                if self._should_save:
                    episode_data = {
                        "episode_id": ep_idx,
                        "robot_type": robot_type,
                        "mode": mode,
                        "frame_count": len(frames),
                        "duration_sec": round(len(frames) / hz, 2),
                        "frames": frames,
                    }
                    ep_path = episodes_dir / f"episode_{ep_idx:04d}.json"
                    with open(ep_path, "w") as f:
                        json.dump(episode_data, f)

                    with self._lock:
                        self._episode_count += 1
                        total_frames += len(frames)

                    logger.info(f"Episode {ep_idx} saved: {len(frames)} frames")
                else:
                    logger.info(f"Episode {ep_idx} discarded (save=False)")

        except Exception as e:
            logger.error(f"Recording loop error: {e}")
        finally:
            if self._should_save:
                # Save dataset metadata
                duration = round(time.time() - t_start, 2)
                meta = {
                    "dataset_id": dataset_id,
                    "robot_type": robot_type,
                    "mode": mode,
                    "episode_count": self._episode_count,
                    "total_frames": total_frames,
                    "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    "duration_sec": duration,
                    "hz": hz,
                }
                with open(dataset_dir / "meta.json", "w") as f:
                    json.dump(meta, f, indent=2)
                logger.info(f"Recording loop finished. Dataset: {dataset_id}")
            else:
                # Discard: remove the dataset directory
                import shutil
                try:
                    shutil.rmtree(dataset_dir)
                    logger.info(f"Discarded dataset directory: {dataset_dir}")
                except Exception as e:
                    logger.warning(f"Failed to clean up discarded dataset: {e}")

            with self._lock:
                if self._state == "recording":
                    self._state = "idle"

    def _generate_dry_run_frame(self, t: float, robot_type: str) -> Dict[str, Any]:
        """Generate a synthetic frame with smooth sinusoidal joint motion."""
        action = {}
        observation = {}
        for i, joint in enumerate(SO101_JOINTS):
            # Smooth sinusoidal motion with per-joint phase offset
            phase = i * (2 * math.pi / len(SO101_JOINTS))
            freq = 0.3 + i * 0.05  # slightly different frequency per joint
            val = round(math.sin(2 * math.pi * freq * t + phase) * 90.0, 2)
            noise = round(random.gauss(0, 0.5), 2)
            action[joint] = val
            observation[joint] = round(val + noise, 2)  # observation has slight noise
        return {
            "timestamp": round(t, 4),
            "action": action,
            "observation": observation,
        }


class ConflictError(Exception):
    """Raised when a recording operation conflicts with current state."""
    def __init__(self, message: str, current_status: Dict[str, Any] = None):
        super().__init__(message)
        self.current_status = current_status or {}
