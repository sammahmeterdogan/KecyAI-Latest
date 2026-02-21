"""
Hardware Preflight Checks & Configuration for LeRobot Runtime.

HardwareConfig: manages runtime hardware configuration (serial port, robot type, driver).
PreflightManager: checks for serial ports, camera devices, driver importability, and mode detection.
"""
import os
import sys
import json
import glob
import logging
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Valid values ──

VALID_ROBOT_TYPES = {"so101_follower", "so101_leader", "koch", "koch_bimanual"}
VALID_DRIVERS = {"feetech", "dynamixel"}
DRIVER_IMPORT_MAP = {
    "feetech": "lerobot.common.robot_devices.motors.feetech",
    "dynamixel": "lerobot.common.robot_devices.motors.dynamixel",
}

# ── Config persistence path ──

_home_dir = Path(os.environ.get("HOME", "/home/kecyai"))
CONFIG_DIR = _home_dir / ".kecyai"
CONFIG_FILE = CONFIG_DIR / "hardware_config.json"


class HardwareConfig:
    """
    Manages hardware configuration for the runtime.
    Sources (priority order):
      1. Runtime POST /admin/config (stored in ~/.kecyai/hardware_config.json)
      2. Environment variables (SERIAL_PORT, ROBOT_TYPE, DRIVER_TYPE, DRY_RUN)
      3. Defaults (dry-run, no serial port)
    """

    def __init__(self):
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        self._config = self._load()

    def _defaults(self) -> Dict[str, Any]:
        return {
            "serial_port": os.environ.get("SERIAL_PORT", ""),
            "robot_type": os.environ.get("ROBOT_TYPE", "so101_follower"),
            "driver": os.environ.get("DRIVER_TYPE", "feetech"),
            "dry_run": os.environ.get("DRY_RUN", "true").lower() in ("true", "1", "yes"),
        }

    def _load(self) -> Dict[str, Any]:
        """Load from file, fall back to env/defaults."""
        defaults = self._defaults()
        if CONFIG_FILE.exists():
            try:
                with open(CONFIG_FILE, "r") as f:
                    saved = json.load(f)
                # Merge: saved overrides defaults
                defaults.update({k: v for k, v in saved.items() if v is not None})
            except Exception as e:
                logger.warning("Failed to load hardware config: %s", e)
        # Derive mode
        defaults["mode"] = "hardware" if defaults.get("serial_port") and not defaults.get("dry_run") else "dry_run"
        return defaults

    def get(self) -> Dict[str, Any]:
        """Return current config as dict."""
        return dict(self._config)

    def update(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validate and apply config updates. Persists to file.
        Raises ValueError on invalid input.
        """
        errors = []

        if "robot_type" in updates:
            rt = updates["robot_type"]
            if rt not in VALID_ROBOT_TYPES:
                errors.append(f"Invalid robot_type '{rt}'. Valid: {sorted(VALID_ROBOT_TYPES)}")

        if "driver" in updates:
            drv = updates["driver"]
            if drv not in VALID_DRIVERS:
                errors.append(f"Invalid driver '{drv}'. Valid: {sorted(VALID_DRIVERS)}")

        if "serial_port" in updates:
            sp = updates["serial_port"]
            if sp and not isinstance(sp, str):
                errors.append("serial_port must be a string")

        if "dry_run" in updates:
            dr = updates["dry_run"]
            if not isinstance(dr, bool):
                errors.append("dry_run must be a boolean")

        if errors:
            raise ValueError("; ".join(errors))

        # Apply updates
        for key in ("serial_port", "robot_type", "driver", "dry_run"):
            if key in updates:
                self._config[key] = updates[key]

        # Derive mode
        self._config["mode"] = (
            "hardware"
            if self._config.get("serial_port") and not self._config.get("dry_run")
            else "dry_run"
        )

        # Persist
        self._save()
        return self.get()

    def _save(self):
        """Persist current config to disk."""
        to_save = {k: v for k, v in self._config.items() if k != "mode"}
        try:
            with open(CONFIG_FILE, "w") as f:
                json.dump(to_save, f, indent=2)
        except Exception as e:
            logger.error("Failed to save hardware config: %s", e)


class PreflightManager:
    """Runs hardware preflight checks and returns structured results."""

    def __init__(self, hardware_config: Optional[HardwareConfig] = None):
        self.checks: List[Dict[str, Any]] = []
        self.hints: List[str] = []
        self._hw_config = hardware_config or HardwareConfig()

    def check_serial_port(self, port: str) -> bool:
        """Check if configured serial port exists."""
        if not port:
            self.hints.append("No serial port configured. Set via POST /admin/config or SERIAL_PORT env var.")
            return False

        exists = os.path.exists(port)
        if exists:
            self.checks.append({"id": "serial_port", "status": "ok", "details": f"Port {port} found"})
            return True
        else:
            self.checks.append({"id": "serial_port", "status": "failed", "details": f"Port {port} not found"})
            self.hints.append(f"Check USB connection. Expected port: {port}")
            return False

    def check_serial_enumeration(self) -> List[str]:
        """Enumerate all available serial ports in container."""
        usb_ports = glob.glob("/dev/ttyUSB*")
        acm_ports = glob.glob("/dev/ttyACM*")
        all_ports = sorted(usb_ports + acm_ports)
        self.checks.append({
            "id": "serial_enumeration",
            "status": "ok" if all_ports else "info",
            "details": f"Found {len(all_ports)} serial ports: {all_ports}" if all_ports else "No serial ports detected",
        })
        return all_ports

    def check_cameras(self, limit: int = 2) -> bool:
        """Check if video devices exist (/dev/video*)."""
        devices = glob.glob("/dev/video*")
        count = len(devices)
        if count >= limit:
            self.checks.append({"id": "cameras", "status": "ok", "details": f"Found {count} cameras"})
            return True
        else:
            self.checks.append({"id": "cameras", "status": "warning", "details": f"Found {count} cameras, expected {limit}"})
            self.hints.append("Ensure cameras are connected and mapped to container.")
            return False

    def check_lerobot_import(self) -> bool:
        """Check if lerobot package is importable."""
        try:
            import lerobot
            self.checks.append({
                "id": "lerobot_pkg",
                "status": "ok",
                "details": f"LeRobot {getattr(lerobot, '__version__', 'unknown')}",
            })
            return True
        except ImportError:
            self.checks.append({"id": "lerobot_pkg", "status": "failed", "details": "lerobot package not importable"})
            self.hints.append("Install lerobot or check PYTHONPATH.")
            return False

    def check_driver_import(self, driver: str) -> bool:
        """Try importing the specific motor driver module."""
        module_path = DRIVER_IMPORT_MAP.get(driver)
        if not module_path:
            self.checks.append({
                "id": f"driver_{driver}",
                "status": "skipped",
                "details": f"Unknown driver type: {driver}",
            })
            return False

        try:
            import importlib
            mod = importlib.import_module(module_path)
            self.checks.append({
                "id": f"driver_{driver}",
                "status": "ok",
                "details": f"Driver module '{module_path}' importable",
            })
            return True
        except ImportError as e:
            self.checks.append({
                "id": f"driver_{driver}",
                "status": "failed",
                "details": f"Cannot import '{module_path}': {e}",
            })
            self.hints.append(f"Install {driver} dependencies or check lerobot installation.")
            return False
        except Exception as e:
            self.checks.append({
                "id": f"driver_{driver}",
                "status": "warning",
                "details": f"Driver import partially failed: {e}",
            })
            return False

    def run_checks(self, config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Run all preflight checks and return structured result.
        Config can override hardware_config values for this check run.
        """
        self.checks = []
        self.hints = []

        # Merge: explicit config overrides stored config
        hw = self._hw_config.get()
        if config:
            for k in ("robot_type", "serial_port", "driver"):
                if k in config:
                    hw[k] = config[k]

        robot_type = hw.get("robot_type", "so101_follower")
        serial_port = hw.get("serial_port", "")
        driver = hw.get("driver", "feetech")
        mode = "hardware" if serial_port and not hw.get("dry_run", True) else "dry_run"

        # 1. Runtime environment
        self.checks.append({
            "id": "runtime_env",
            "status": "ok",
            "details": f"Python {sys.version.split()[0]}",
        })

        # 2. LeRobot package
        lerobot_ok = self.check_lerobot_import()

        # 3. Motor driver
        driver_ok = self.check_driver_import(driver)

        # 4. Serial enumeration (always — informational)
        available_ports = self.check_serial_enumeration()

        # 5. Hardware checks (only meaningful when serial_port configured)
        hw_ok = True
        if serial_port:
            hw_ok = self.check_serial_port(serial_port)
            hw_ok = self.check_cameras() and hw_ok
        else:
            self.checks.append({
                "id": "hardware_config",
                "status": "skipped",
                "details": "No serial port configured (dry-run mode)",
            })
            self.hints.append("Configure serial_port via POST /admin/config to enable hardware checks.")
            hw_ok = False

        ready = lerobot_ok and driver_ok and hw_ok

        return {
            "ready": ready,
            "mode": mode,
            "robot_type": robot_type,
            "driver": driver,
            "serial_port": serial_port,
            "checks": self.checks,
            "hints": self.hints,
        }
