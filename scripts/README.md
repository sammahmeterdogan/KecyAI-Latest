# KECY AI - Scripts

Cross-platform dev helpers and utilities.

- `preflight.ps1`: Run Windows host checks (virtualization, WSL, Docker, Compose).
- `dev-stack.ps1`: Shared bootstrap for the Python runtime service plus the host Vite dev server.
- `start.ps1`: Canonical startup entrypoint with profile support.
- `stop.ps1`: Stop local stack.
- `start-cloudflare-demo.ps1`: Start stack with Cloudflare Quick Tunnel and print the public demo URL.

## Startup Profiles

```powershell
.\scripts\start.ps1 -Target desktop -Profile base
.\scripts\start.ps1 -Target desktop -Profile hardware
```

Windows note:
- `start.ps1` now auto-promotes to the host hardware path when it detects a live USB robot and no explicit `-Profile` was provided.
- On Windows, `hardware` profiles start the Python runtime on the host instead of Docker so the robot COM port stays accessible.
- The host-safe probe can also be run directly with `C:\Users\ASUS\miniforge3\python.exe .\scripts\hardware_probe.py diagnose`.

Options:
- `-SkipPreflight`: skip preflight checks.
- `-Target services`: start only the Python runtime service without launching Tauri.
