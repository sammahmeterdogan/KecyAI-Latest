from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import List, Optional


def is_frozen_runtime() -> bool:
    return bool(getattr(sys, "frozen", False))


def app_dir() -> Path:
    return Path(__file__).resolve().parent


def repo_root() -> Path:
    return app_dir().parents[1]


def lerobot_checkout_dir() -> Optional[Path]:
    candidate = repo_root() / "runtime" / "upstream" / "lerobot"
    return candidate if candidate.exists() else None


def lerobot_source_dir() -> Optional[Path]:
    candidate = repo_root() / "runtime" / "upstream" / "lerobot" / "src"
    return candidate if candidate.exists() else None


def runtime_entry_script() -> Path:
    return app_dir() / "runtime_entry.py"


def build_runtime_command(subcommand: str, *args: str) -> List[str]:
    if is_frozen_runtime():
        return [str(Path(sys.executable).resolve()), subcommand, *args]

    return [sys.executable, str(runtime_entry_script()), subcommand, *args]


def home_dir() -> Path:
    return Path(os.environ.get("HOME") or Path.home())
