# KECY AI Infrastructure

Docker Compose setup for the KECY AI platform.

Compose files live under [`infra/compose/`](./compose).

## Services

| Service | Port | Description |
|---|---|---|
| **runtime** | 8100 | LeRobot runtime (Python/Docker) |
| **backend** | 8080 | Spring Boot API |

## Usage

1. **Copy environment file**:
   ```bash
   cp infra/.env.example infra/.env
   ```

2. **Start services**:
   ```bash
   docker compose -f infra/compose/docker-compose.yml up --build
   ```

3. **Hardware overlay (Linux/WSL2)**:
   ```bash
   docker compose -f infra/compose/docker-compose.yml \
                  -f infra/compose/docker-compose.hardware.yml up -d
   ```

4. **Verify**:
   - Runtime: `http://localhost:8100/health`
   - Backend: `http://localhost:8080/api/lerobot/health`
