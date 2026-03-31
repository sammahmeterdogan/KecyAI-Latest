# KECY AI Runtime

Dockerized Python runtime service for teleoperation, calibration, recording, and training-adjacent workflows.

## Responsibilities

- Provide the primary API service used directly by the frontend and desktop flow (`/api/health`, `/api/lerobot/*`).
- Integrate with vendored upstream LeRobot sources.
- Run in dry-run mode by default, with hardware mode via compose overlays.

## Source of Truth

- https://github.com/huggingface/lerobot
- https://huggingface.co/docs/lerobot/so101

## Layout

- `app/` runtime API server and managers
- `docker/` container build assets
- `upstream/lerobot/` vendored upstream dependency
