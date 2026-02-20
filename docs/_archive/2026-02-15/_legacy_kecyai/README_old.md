# KECY AI

Mono-repo for the KECY AI robotics platform.

## Structure

| Folder | Description |
|---|---|
| [`frontend/`](./frontend) | Vite + React UI (platform pages, sidebar) |
| [`backend/`](./backend) | Spring Boot Java 17 backend |
| [`runtime/`](./runtime) | Dockerized LeRobot + ROS runtime |
| [`infra/`](./infra) | Compose files, environment templates, infra guides |
| [`docs/`](./docs) | API, guides, architecture, phase documentation |
| [`scripts/`](./scripts) | Dev helpers |

## Quick Start (Full Stack)

```bash
docker compose -f infra/compose/docker-compose.yml up --build
```

## Quick Start (Frontend Only)

```bash
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:3000
