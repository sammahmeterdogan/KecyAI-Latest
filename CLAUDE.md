# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## What This Project Is

KECY AI is a robotics platform for teleoperation, calibration, recording, training, and hardware setup workflows. The primary product path is now:

`Tauri / React frontend -> Python FastAPI runtime service -> robotics managers / hardware`

## Commands

### Runtime + Frontend (Docker)

```bash
# Base mode (dry-run, no hardware)
docker compose -f infra/compose/docker-compose.yml up --build

# Add frontend container
docker compose -f infra/compose/docker-compose.yml \
  -f infra/compose/docker-compose.web.yml up --build

# Hardware passthrough (Linux/WSL2 only)
docker compose -f infra/compose/docker-compose.yml \
  -f infra/compose/docker-compose.hardware.yml up --build
```

### Windows Quick Start

```powershell
.\scripts\preflight.ps1
.\scripts\start.ps1 -Profile base
.\scripts\start.ps1 -Profile hardware
```

### Frontend (local dev)

```bash
cd frontend
npm install
npm run dev      # http://localhost:3000, proxies /api/* -> runtime:8040
npm run build
npm run preview
```

### Desktop (local dev)

```bash
cd desktop
npm install
npm run dev
```

### Runtime verification

```bash
C:\Users\ASUS\miniforge3\python.exe -m py_compile runtime/app/server.py runtime/app/kecyai_local.py
```

## Architecture

The repository has two supported paths:

| Path | Port(s) | Role |
|------|---------|------|
| Tauri desktop + local Python service | 8040-8059 | Primary product path |
| Browser dev frontend + Python runtime service | 3000 + 8040 | Secondary dev path |

The runtime service is implemented in FastAPI and keeps the robotics managers intact. Hardware-facing subsystems remain lazily initialized on first use, and state conflicts still return HTTP 409 style responses.

### Runtime guarantees

- Teleop, calibration, recording, training, and motor setup remain in Python.
- Conflict guards are preserved:
  - Teleop vs calibration
  - Recording vs training
  - E-STOP and other precondition failures
- The HTTP layer was refactored, not the robotics behavior.

### Frontend routing

API calls resolve through `frontend/src/lib/api/lerobotClient.ts`.

- Browser localhost dev prefers same-origin `/api`, with Vite proxying to the runtime service.
- Tauri uses `http://127.0.0.1:8040` by default.
- Explicit override uses `VITE_API_BASE_URL`.

## Key Configuration

- `VITE_API_BASE_URL`: unified frontend API base override.
- `KECYAI_SERVICE_HOST`: Python service bind host.
- `KECYAI_SERVICE_PORT`: Python service bind port. Default `8040`.
- `KECYAI_FRONTEND_DIST`: optional bundled frontend path served by the runtime.
- `KECYAI_FRONTEND_DEV_URL`: optional dev frontend proxy target for local service mode.

Compose volumes `kecyai-datasets` and `kecyai-models` persist ML artifacts across restarts. The hardware overlay mounts serial/video devices when needed.

## Error Shape

Runtime API errors follow the existing structured contract:

```json
{ "code": "CONFLICT", "message": "...", "details": { } }
```

HTTP 409 remains the transport for state conflicts and precondition failures that used to be surfaced by the old proxy chain.

## Testing

- Frontend: no automated test setup; include manual verification notes.
- Runtime transport changes: validate with `py_compile`, path tracing, and startup checks.

## Docs Index

- `docs/guides/startup_profiles.md`
- `docs/guides/zero_terminal_setup.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `INIT.md`
