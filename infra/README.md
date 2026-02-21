# KECY AI Infrastructure

Docker Compose setup for the KECY AI platform.

Compose files live under `infra/compose/`.

## Services

| Service | Port | Description |
|---|---|---|
| `runtime` | 8100 | Python runtime (LeRobot integration) |
| `backend` | 8080 | Spring Boot gateway API |
| `frontend` | 3000 | React web UI |

## Compose Profiles (by file overlay)

- Base: `docker-compose.yml`
- Hardware: `docker-compose.hardware.yml`
- Backend runtime autostart: `docker-compose.autostart.yml`
- Cloudflare demo: `docker-compose.cloudflare.yml`

## Usage

```bash
docker compose -f infra/compose/docker-compose.yml up --build
```

Hardware mode (Linux/WSL2):

```bash
docker compose -f infra/compose/docker-compose.yml \
               -f infra/compose/docker-compose.hardware.yml up -d
```

## Health Checks

- Runtime: `http://localhost:8100/health`
- Backend: `http://localhost:8080/api/lerobot/health`
- Frontend: `http://localhost:3000`
