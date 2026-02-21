# KECY AI Backend

Spring Boot 3 (Java 17) gateway service between the frontend and runtime.

## Responsibilities

- Expose `/api/lerobot/*` endpoints to the frontend.
- Proxy runtime operations with a stable error contract.
- Enforce state guards and orchestration logic (teleop, calibration, recording, training).
- Optionally autostart runtime container when enabled.

## Architecture

Clean Architecture package layout:
- `api`
- `application`
- `domain`
- `infrastructure`

## Local Development

```bash
cd backend
mvn test
```

Runtime base URL is configured via `LEROBOT_RUNTIME_BASE_URL`.
