# KECYAI Local Launcher Flow

## New default flow

KECYAI now targets a browser-first local runtime:

1. `KECYAI Desktop` starts a local `kecyai` service.
2. The local service serves the frontend on `http://127.0.0.1:<port>`.
3. Teleop and calibration requests stay under `/api/lerobot/*`.
4. The local service runs KECYAI's own teleop/calibration runtime.
5. The desktop window is only a launcher, not the main application shell.

## Main entrypoints

- Desktop launcher UI: `frontend/src/pages/platform/DesktopLauncher.jsx`
- Desktop shell commands: `desktop/src-tauri/src/main.rs`
- Local runtime CLI and server: `runtime/app/runtime_entry.py`
- Browser-first local service: `runtime/app/kecyai_local.py`
- CLI wrappers:
  - `scripts/kecyai.ps1`
  - `scripts/kecyai.cmd`

## Commands

- `scripts\kecyai.cmd run`
- `scripts\kecyai.cmd open`
- `scripts\kecyai.cmd stop`
- `scripts\kecyai.cmd doctor`

## Ports

- KECYAI local service: prefers `8040`, falls back through `8059`
