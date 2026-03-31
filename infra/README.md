# KECY AI Infrastructure

Docker Compose setup for the KECY AI platform.

Compose files live under `infra/compose/`.

## Services

| Service | Port | Description |
|---|---|---|
| `runtime` | 8040 | Python runtime API and hardware integration |
| `frontend` | 3000 | React web UI (`docker-compose.web.yml` only) |

## Compose Profiles (by file overlay)

- Base: `docker-compose.yml`
- Optional web UI: `docker-compose.web.yml`
- Hardware: `docker-compose.hardware.yml`
- Cloudflare demo: `docker-compose.cloudflare.yml`

## Usage

```bash
docker compose -f infra/compose/docker-compose.yml up --build
```

Web/container demo mode:

```bash
docker compose -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.web.yml up --build
```

Hardware mode (Linux/WSL2):

```bash
docker compose -f infra/compose/docker-compose.yml \
               -f infra/compose/docker-compose.hardware.yml up -d
```

## Health Checks

- Runtime: `http://localhost:8040/api/health`
- Frontend: `http://localhost:3000` when using `docker-compose.web.yml` or the desktop dev server
