# Startup Profiles and Preflight

Canonical startup entrypoint is `scripts/start.ps1 -Target desktop`.

## Canonical Commands

```powershell
# Default dry-run profile
.\scripts\start.ps1 -Target desktop

# Explicit profile selection
.\scripts\start.ps1 -Target desktop -Profile base
.\scripts\start.ps1 -Target desktop -Profile hardware

# Skip preflight only for advanced debugging
.\scripts\start.ps1 -Target desktop -Profile base -SkipPreflight
```

## Profile Map

| Profile | Compose Files | Typical Use |
|---|---|---|
| `base` | `docker-compose.yml` | Standard dry-run local development |
| `hardware` | `docker-compose.yml` + `docker-compose.hardware.yml` | Real robot on Linux/WSL2 |

## Known-Good Setup Matrix

| Host Setup | Goal | Command | Expected Result |
|---|---|---|---|
| Windows 11 + Docker Desktop (WSL2 backend) | Dry-run teleop/calibration | `.\scripts\start.ps1 -Target desktop -Profile base` | Tauri opens, Frontend `:3000`, Runtime API `:8040` |
| Linux/WSL2 with serial/camera devices exposed | Real hardware mode | `.\scripts\start.ps1 -Target desktop -Profile hardware` | Runtime sees `/dev/ttyUSB*` and camera devices |

## Troubleshooting Decision Tree (Log-First)

1. Run preflight first:
```powershell
.\scripts\preflight.ps1
```
2. If preflight shows `FAIL`:
- `cpu.virtualization_firmware`: enable virtualization in BIOS/UEFI.
- `docker.engine`: start Docker Desktop and wait for engine ready.
- `docker.compose`: update Docker Desktop / Compose plugin.
3. If preflight is `PASS` or `WARN` but startup fails:
- Open latest `scripts/_logs/start_*.log`.
- Confirm compose profile and compose files used.
- Check first failing service build/run line in the log.
4. If services started but UI/API fails:
- `docker compose -p kecyai -f infra/compose/docker-compose.yml ps`
- Check health endpoints:
  - `http://localhost:8040/api/health`
5. If hardware profile fails:
- Verify `/dev/ttyUSB*` and `/dev/video*` exist on Linux/WSL2 host.
- Recheck `infra/compose/docker-compose.hardware.yml` mappings.

## Notes

- `hardware*` profiles are intended for Linux/WSL2 with device passthrough.
