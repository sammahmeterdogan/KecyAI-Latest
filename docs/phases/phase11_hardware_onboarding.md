# Phase 11: Hardware Onboarding + Live-Ready Switch

## Architecture

```
Frontend (:3000)  →  Backend (:8080)  →  Runtime (:8100)  →  LeRobot
    Vite              Spring Boot           Docker/Python       SO-101
```

**Two modes:**
- `dry_run` (default) — no hardware required, simulated responses
- `hardware` — real robot connected via serial

## API Reference

### Hardware Configuration

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/lerobot/admin/config` | Get current hardware config |
| POST | `/api/lerobot/admin/config` | Update hardware config |

**POST body:**
```json
{
  "serial_port": "/dev/ttyUSB0",
  "robot_type": "so101_follower",
  "driver": "feetech",
  "dry_run": false
}
```

**Valid `robot_type`:** `so101_follower`, `so101_leader`, `koch`, `koch_bimanual`
**Valid `driver`:** `feetech`, `dynamixel`

### Preflight Checks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/lerobot/admin/preflight` | Run hardware readiness checks |

**Response:**
```json
{
  "ready": false,
  "mode": "dry_run",
  "robot_type": "so101_follower",
  "driver": "feetech",
  "serial_port": "",
  "checks": [
    {"id": "runtime_env", "status": "ok", "details": "Python 3.10.x"},
    {"id": "lerobot_pkg", "status": "ok", "details": "LeRobot 0.x.x"},
    {"id": "driver_feetech", "status": "ok", "details": "Driver module importable"},
    {"id": "serial_enumeration", "status": "info", "details": "No serial ports detected"},
    {"id": "hardware_config", "status": "skipped", "details": "No serial port configured"}
  ],
  "hints": ["Configure serial_port via POST /admin/config to enable hardware checks."]
}
```

### Calibration Artifacts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/lerobot/admin/calibration/list` | List all artifacts |
| GET | `/api/lerobot/admin/calibration/latest?robot_type=so101_follower` | Get latest |
| POST | `/api/lerobot/admin/calibration/select` | Select artifact for teleop |

**Select body:** `{"artifactId": "calibration_so101_follower_20260215_100000.json"}`

---

## Admin Setup (One-Time, Terminal Required)

### 1. Standard Mode (Dry-Run, Windows-Safe)

```bash
docker compose -f infra/compose/docker-compose.yml up -d
```

### 2. Hardware Mode (Linux/WSL2 Only)

```bash
# Plug in robot first, then:
docker compose -f infra/compose/docker-compose.yml \\
               -f infra/compose/docker-compose.hardware.yml up -d
```

### 3. With Backend Autostart

```bash
docker compose -f infra/compose/docker-compose.yml \\
               -f infra/compose/docker-compose.hardware.yml \
               -f infra/compose/docker-compose.autostart.yml up -d
```

---

## When Robot Arrives — Exact Steps

### Step 1: Connect Hardware (Admin Terminal)

```bash
# 1. Plug robot USB into Linux/WSL2 host
# 2. Verify serial port:
ls -la /dev/ttyUSB*

# 3. Start with hardware overlay:
docker compose -f infra/compose/docker-compose.yml \\
               -f infra/compose/docker-compose.hardware.yml up -d

# 4. Verify runtime can see the device:
docker exec kecyai-runtime ls -la /dev/ttyUSB0
```

### Step 2: Configure Runtime (UI or API)

```powershell
# Set hardware mode via API:
Invoke-RestMethod -Uri http://localhost:8080/api/lerobot/admin/config `
  -Method POST `
  -Body '{"serial_port":"/dev/ttyUSB0","robot_type":"so101_follower","driver":"feetech","dry_run":false}' `
  -ContentType 'application/json'
```

### Step 3: Run Preflight

```powershell
Invoke-RestMethod http://localhost:8080/api/lerobot/admin/preflight
# Expected: ready=true when all checks pass
```

### Step 4: Calibrate (Real)

```powershell
# Start calibration (no dry-run flag = use runtime config):
Invoke-RestMethod -Uri http://localhost:8080/api/lerobot/calibration/start `
  -Method POST `
  -Body '{"robot_type":"so101_follower"}' `
  -ContentType 'application/json'

# Step through each calibration step (physically move joints):
Invoke-RestMethod -Uri http://localhost:8080/api/lerobot/calibration/step `
  -Method POST -ContentType 'application/json'
# Repeat 8 times for all steps

# Select the generated artifact:
Invoke-RestMethod -Uri http://localhost:8080/api/lerobot/admin/calibration/select `
  -Method POST `
  -Body '{"artifactId":"calibration_so101_follower_YYYYMMDD_HHMMSS.json"}' `
  -ContentType 'application/json'
```

### Step 5: Start Teleop (Real Hardware)

```powershell
Invoke-RestMethod -Uri http://localhost:8080/api/lerobot/teleop/start `
  -Method POST `
  -Body '{"robot_type":"so101_follower","teleop_type":"web"}' `
  -ContentType 'application/json'
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Preflight `serial_port: failed` | Robot not plugged in or wrong device | Check `ls /dev/ttyUSB*` on host |
| Preflight `driver_feetech: failed` | Missing lerobot deps | Rebuild runtime image |
| 502 on all endpoints | Runtime container down | `docker compose -f infra/compose/docker-compose.yml up -d runtime` |
| Config reverts after restart | Env vars override file config | Remove env vars or update `infra/compose/docker-compose.hardware.yml` |

