# KECY AI

Web-based robotics platform for teleoperation, calibration, recording, and training workflows.

## Quick Start

### Windows (recommended)

```powershell
.\scripts\start.ps1 -Profile base
```

### Docker Compose (all platforms)

```bash
docker compose -f infra/compose/docker-compose.yml up --build
```

Services:
- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8080`
- Runtime: `http://localhost:8100`

## Startup Profiles

Use the canonical startup script:

```powershell
.\scripts\start.ps1 -Profile base
.\scripts\start.ps1 -Profile autostart
.\scripts\start.ps1 -Profile hardware
.\scripts\start.ps1 -Profile hardware-autostart
```

Preflight check only:

```powershell
.\scripts\preflight.ps1
```

See `docs/guides/startup_profiles.md` for profile mapping and troubleshooting.

## Project Structure

```text
backend/   Spring Boot API and orchestration layer
frontend/  Vite + React platform UI
runtime/   Python runtime service and vendored LeRobot sources
infra/     Docker Compose files and infra templates
docs/      Long-lived API, architecture, guide, and phase docs
scripts/   Windows-friendly start/stop and utility scripts
```

## Development

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Backend tests:

```bash
cd backend
mvn test
```

## Documentation

- Docs index: `docs/README.md`
- Setup and API runbook: `docs/guides/zero_terminal_setup.md`
- Startup profiles: `docs/guides/startup_profiles.md`
- Project station and roadmap: `INIT.md`

## Security Notes

- Docker socket mount (`autostart` profiles) is for trusted development only.
- Hardware mode requires Linux/WSL2 device passthrough.
- Cloudflare demo profile exposes your local stack publicly.

## License

MIT. See `LICENSE`.
