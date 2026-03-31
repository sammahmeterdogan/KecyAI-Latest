# KECY AI

Web-based robotics platform for teleoperation, calibration, recording, and training workflows.

## Quick Start

### Windows Desktop (recommended)

```powershell
.\scripts\start.ps1 -Target desktop -Profile base
```

This launches the canonical desktop path: Tauri desktop shell, host Vite dev server, and the local Python runtime service when requested from the launcher.

### Docker Compose (runtime only)

```bash
docker compose -f infra/compose/docker-compose.yml up --build
```

Services:
- Runtime API: `http://localhost:8040`
- Frontend dev server: `http://localhost:3000` when started through the desktop path

## Startup Profiles

Use the canonical startup script:

```powershell
.\scripts\start.ps1 -Target desktop -Profile base
.\scripts\start.ps1 -Target desktop -Profile hardware
```

Preflight check only:

```powershell
.\scripts\preflight.ps1
```

See `docs/guides/startup_profiles.md` for profile mapping and troubleshooting.

## Project Structure

```text
desktop/   Tauri desktop shell and launcher
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

Desktop:

```bash
npm --prefix desktop run dev
```

## Documentation

- Docs index: `docs/README.md`
- Setup and API runbook: `docs/guides/zero_terminal_setup.md`
- Startup profiles: `docs/guides/startup_profiles.md`
- Project station and roadmap: `INIT.md`

## Security Notes

- Hardware mode requires Linux/WSL2 device passthrough.
- Cloudflare demo profile exposes your local stack publicly.

## License

MIT. See `LICENSE`.
