# Phase 11: Hardware Onboarding + Live-Ready Switch

This phase note predates the transport simplification. The current execution path is:

```text
Frontend / Tauri -> Python runtime service (:8040) -> LeRobot / hardware
```

## Modes

- `dry_run`: default, simulated responses without hardware
- `hardware`: real robot connected via serial

## Admin setup

### Standard mode

```bash
docker compose -f infra/compose/docker-compose.yml up -d
```

### Hardware mode

```bash
docker compose -f infra/compose/docker-compose.yml \
               -f infra/compose/docker-compose.hardware.yml up -d
```

## When Robot Arrives

### Configure runtime

```powershell
Invoke-RestMethod -Uri http://localhost:8040/api/lerobot/admin/config `
  -Method POST `
  -Body '{"serial_port":"/dev/ttyUSB0","robot_type":"so101_follower","driver":"feetech","dry_run":false}' `
  -ContentType 'application/json'
```

### Run preflight

```powershell
Invoke-RestMethod http://localhost:8040/api/lerobot/admin/preflight
```

### Calibrate

```powershell
Invoke-RestMethod -Uri http://localhost:8040/api/lerobot/calibration/start `
  -Method POST `
  -Body '{"robot_type":"so101_follower"}' `
  -ContentType 'application/json'

Invoke-RestMethod -Uri http://localhost:8040/api/lerobot/calibration/step `
  -Method POST `
  -ContentType 'application/json'
```

### Start teleop

```powershell
Invoke-RestMethod -Uri http://localhost:8040/api/lerobot/teleop/start `
  -Method POST `
  -Body '{"robot_type":"so101_follower","teleop_type":"web"}' `
  -ContentType 'application/json'
```

## Notes

- The Python service now owns the API directly.
- Old Java gateway references in older notes should be treated as legacy only.
