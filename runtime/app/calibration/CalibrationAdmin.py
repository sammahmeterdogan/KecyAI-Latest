"""
Calibration Admin Module.
Manages listing, selecting, and applying calibration artifacts.
"""
import os
import json
import logging
import time
from pathlib import Path
from typing import List, Dict, Optional, Any

logger = logging.getLogger(__name__)

# Same path as CalibrationManager
home_dir = Path(os.environ.get("HOME", "/home/kecyai"))
CALIBRATION_DIR = home_dir / ".kecyai" / "calibration"
SELECTED_FILE = CALIBRATION_DIR / "selected.json"

class CalibrationAdmin:
    def __init__(self):
        CALIBRATION_DIR.mkdir(parents=True, exist_ok=True)

    def list_artifacts(self) -> List[Dict[str, Any]]:
        """List all available calibration artifacts."""
        artifacts = []
        if not CALIBRATION_DIR.exists():
            return artifacts

        for f in CALIBRATION_DIR.glob("calibration_*.json"):
            try:
                with open(f, "r") as fd:
                    data = json.load(fd)
                
                artifacts.append({
                    "id": f.name,
                    "path": str(f),
                    "robot_type": data.get("robot_type", "unknown"),
                    "timestamp": data.get("timestamp", ""),
                    "dry_run": data.get("dry_run", False),
                    "joint_count": len(data.get("joints", {}))
                })
            except Exception as e:
                logger.warning(f"Failed to read artifact {f}: {e}")
        
        # Sort by timestamp (filename has timestamp, so sorting by name works roughly, 
        # but sorting by parsed timestamp is better if available)
        artifacts.sort(key=lambda x: x["timestamp"], reverse=True)
        return artifacts

    def get_latest_artifact(self, robot_type: str) -> Optional[Dict[str, Any]]:
        """Get the most recent artifact for a specific robot type."""
        all_arts = self.list_artifacts()
        filtered = [a for a in all_arts if a["robot_type"] == robot_type]
        if not filtered:
            return None
        return filtered[0]

    def select_artifact(self, artifact_id: str) -> Dict[str, Any]:
        """Mark an artifact as selected for Teleop."""
        target_path = CALIBRATION_DIR / artifact_id
        if not target_path.exists():
            raise FileNotFoundError(f"Artifact {artifact_id} not found")

        # Read to verify
        with open(target_path, "r") as f:
            data = json.load(f)

        # Write selection
        selection = {
            "selected_artifact": artifact_id,
            "path": str(target_path),
            "selected_at": time.time(),
            "robot_type": data.get("robot_type"),
        }
        
        with open(SELECTED_FILE, "w") as f:
            json.dump(selection, f, indent=2)
            
        return selection

    def get_selected_artifact(self) -> Optional[Dict[str, Any]]:
        """Read currently selected artifact metadata."""
        if not SELECTED_FILE.exists():
            return None
        try:
            with open(SELECTED_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return None
