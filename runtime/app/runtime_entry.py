from __future__ import annotations

import os
import runpy
import sys
from pathlib import Path
from typing import Iterable, List

RUNTIME_COMMANDS = {
    "serve",
    "run",
    "stop",
    "open",
    "doctor",
    "version",
    "teleoperate",
    "setup-motors",
    "find-port",
    "auto-configure",
    "diagnose",
    "scan",
    "twitch",
}


def _bootstrap_paths() -> None:
    app_dir = Path(__file__).resolve().parent
    repo_root = app_dir.parents[1]
    lerobot_src = repo_root / "runtime" / "upstream" / "lerobot" / "src"

    for path in (app_dir, lerobot_src):
        path_str = str(path)
        if path.exists() and path_str not in sys.path:
            sys.path.insert(0, path_str)


def _run_module(module_name: str, argv0: str, args: List[str]) -> int:
    sys.argv = [argv0, *args]
    runpy.run_module(module_name, run_name="__main__")
    return 0


def _run_hardware_diagnostics(args: List[str]) -> int:
    from hardware_diagnostics import _main

    return _main(args)


def _extract_preferred_port(args: List[str]) -> tuple[str, List[str]]:
    preferred_port = ""
    remaining: List[str] = []
    index = 0

    while index < len(args):
        token = args[index]
        if token == "--preferred-port":
            if index + 1 >= len(args):
                raise ValueError("--preferred-port requires a value.")
            preferred_port = args[index + 1]
            index += 2
            continue
        if token.startswith("--preferred-port="):
            preferred_port = token.split("=", 1)[1]
            index += 1
            continue

        remaining.append(token)
        index += 1

    return preferred_port, remaining


def _resolve_command(args: List[str], preferred_port: str) -> tuple[str, List[str]]:
    if args and args[0] in RUNTIME_COMMANDS:
        return args[0], args[1:]

    if preferred_port:
        return "auto-configure", args

    if not args:
        return "serve", []

    return args[0], args[1:]


def _diagnostic_args(command: str, preferred_port: str, rest: List[str]) -> List[str]:
    args = [command]
    if preferred_port:
        args.extend(["--preferred-port", preferred_port])
    args.extend(rest)
    return args


def main(argv: Iterable[str] | None = None) -> int:
    _bootstrap_paths()
    args = list(argv if argv is not None else sys.argv[1:])

    try:
        preferred_port, remaining = _extract_preferred_port(args)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    command, rest = _resolve_command(remaining, preferred_port)

    if command == "serve":
        if preferred_port:
            os.environ["KECYAI_PREFERRED_PORT"] = preferred_port
        import server

        server.main()
        return 0
    if command in {"run", "stop", "open", "doctor", "version"}:
        from kecyai_local import main as kecyai_main

        forward_args = [command]
        if preferred_port and command == "run":
            forward_args.extend(["--port", preferred_port])
        forward_args.extend(rest)
        return kecyai_main(forward_args)
    if command == "teleoperate":
        return _run_module("lerobot.scripts.lerobot_teleoperate", "lerobot-teleoperate", rest)
    if command == "setup-motors":
        return _run_module("lerobot.scripts.lerobot_setup_motors", "lerobot-setup-motors", rest)
    if command == "find-port":
        if preferred_port:
            return _run_hardware_diagnostics(_diagnostic_args("scan", preferred_port, rest))
        return _run_module("lerobot.scripts.lerobot_find_port", "lerobot-find-port", rest)
    if command == "auto-configure":
        return _run_hardware_diagnostics(_diagnostic_args("auto-configure", preferred_port, rest))
    if command == "diagnose":
        return _run_hardware_diagnostics(_diagnostic_args("diagnose", preferred_port, rest))
    if command == "scan":
        return _run_hardware_diagnostics(_diagnostic_args("scan", preferred_port, rest))
    if command == "twitch":
        return _run_hardware_diagnostics(_diagnostic_args("twitch", preferred_port, rest))

    print(f"Unknown runtime command: {command}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
