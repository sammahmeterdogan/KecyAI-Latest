# Startup Profiles and Preflight

Canonical startup entrypoint is `scripts/start.ps1`.

## Canonical Commands

```powershell
# Default dry-run profile
.\scripts\start.ps1

# Explicit profile selection
.\scripts\start.ps1 -Profile base
.\scripts\start.ps1 -Profile autostart
.\scripts\start.ps1 -Profile hardware
.\scripts\start.ps1 -Profile hardware-autostart

# Skip preflight only for advanced debugging
.\scripts\start.ps1 -Profile base -SkipPreflight
```

## Profile Map

| Profile | Compose Files | Typical Use |
|---|---|---|
| `base` | `docker-compose.yml` | Standard dry-run local development |
| `autostart` | `docker-compose.yml` + `docker-compose.autostart.yml` | Backend can auto-start runtime container |
| `hardware` | `docker-compose.yml` + `docker-compose.hardware.yml` | Real robot on Linux/WSL2 |
| `hardware-autostart` | `docker-compose.yml` + `docker-compose.hardware.yml` + `docker-compose.autostart.yml` | Real robot + backend runtime autostart |

## Known-Good Setup Matrix

| Host Setup | Goal | Command | Expected Result |
|---|---|---|---|
| Windows 11 + Docker Desktop (WSL2 backend) | Dry-run teleop/calibration | `.\scripts\start.ps1 -Profile base` | Frontend `:3000`, Backend `:8080`, Runtime `:8100` |
| Windows 11 + Docker Desktop + Autostart enabled | Dry-run with runtime autostart | `.\scripts\start.ps1 -Profile autostart` | Backend can start runtime if it is stopped |
| Linux/WSL2 with serial/camera devices exposed | Real hardware mode | `.\scripts\start.ps1 -Profile hardware` | Runtime sees `/dev/ttyUSB*` and camera devices |
| Linux/WSL2 with hardware + docker.sock mount | Hardware + autostart | `.\scripts\start.ps1 -Profile hardware-autostart` | Hardware flow + runtime autostart behavior |

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
  - `http://localhost:8100/health`
  - `http://localhost:8080/api/lerobot/health`
5. If hardware profile fails:
- Verify `/dev/ttyUSB*` and `/dev/video*` exist on Linux/WSL2 host.
- Recheck `infra/compose/docker-compose.hardware.yml` mappings.

## Notes

- `hardware*` profiles are intended for Linux/WSL2 with device passthrough.
- `autostart*` profiles mount Docker socket into backend; use only in trusted dev environments.
