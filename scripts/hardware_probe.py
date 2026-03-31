from __future__ import annotations

import sys
from pathlib import Path


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    runtime_app = repo_root / "runtime" / "app"
    sys.path.insert(0, str(runtime_app))

    from hardware_diagnostics import _main

    return _main(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
