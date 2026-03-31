# KECY AI - Project Context

## Project Overview

KECY AI is a mono-repo robotics platform for teleoperation, calibration, recording, training, and hardware setup workflows.

### Current execution architecture

| Layer | Technology |
|-------|------------|
| Frontend | Vite + React 19, React Router, Three.js |
| Desktop | Tauri |
| Runtime service | Python FastAPI + uvicorn |
| Robotics core | Existing Python managers and LeRobot-derived hardware logic |
| Infrastructure | Docker Compose, Cloudflare Quick Tunnel |

The old Java proxy layer has been removed from the primary product flow. The main path is now direct frontend-to-runtime communication.

## Supported Paths

### Primary product path

`Tauri launcher -> local Python service on 8040 -> robotics managers / hardware`

### Secondary dev path

`Vite frontend on 3000 -> same-origin /api proxy -> Python service on 8040`

### Docker path

```bash
# Runtime only
docker compose -f infra/compose/docker-compose.yml up --build

# Runtime + frontend container
docker compose -f infra/compose/docker-compose.yml \
  -f infra/compose/docker-compose.web.yml up --build
```

### Desktop dev

```bash
cd desktop
npm install
npm run dev
```

## API Surface

The runtime service owns the API directly:

- `GET /api/health`
- `GET /api/lerobot/health`
- `GET /api/lerobot/capabilities`
- `GET /api/lerobot/version`
- `POST /api/lerobot/teleop/*`
- `POST /api/lerobot/calibration/*`
- `POST /api/lerobot/admin/*`
- `POST /api/lerobot/recording/*`
- `POST /api/lerobot/train/*`

Compatibility aliases remain for the older direct runtime paths where needed.

## Environment

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` | Unified frontend API base override |
| `KECYAI_SERVICE_HOST` | Python runtime bind host |
| `KECYAI_SERVICE_PORT` | Python runtime bind port, default `8040` |
| `KECYAI_FRONTEND_DIST` | Bundled frontend path served by runtime |
| `KECYAI_FRONTEND_DEV_URL` | Dev frontend URL for local-service mode |

## Verification notes

- Python transport layer can be statically verified with `py_compile`.
- Frontend has no automated test suite; use manual verification.
- Docker and Tauri flows should be validated against `/api/health`.
