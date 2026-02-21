# KECY AI Init Status and Roadmap

Last updated: 2026-02-21

This file is the quick answer to: "Where are we now?" and "What is next?"

## Current Station (Now)

Station: Phase 11 baseline is implemented (Hardware Onboarding + Live-Ready switch), with active stabilization and integration work.

## Project Stations Snapshot

| Station | Scope | Status | Notes |
|---|---|---|---|
| S1 Infrastructure | Docker Compose stack, start/stop scripts | IN PROGRESS | Compose files and scripts exist; local host virtualization and Docker access can still block startup on some machines. |
| S2 Runtime | Python runtime with teleop + calibration + admin endpoints | DONE | Runtime server routes for health, teleop, calibration, recording/training hooks are present. |
| S3 Backend Gateway | Spring Boot API, structured errors, runtime orchestration | DONE | Controllers and runtime client/orchestrator are implemented. |
| S4 Frontend Platform | React/Vite platform routes and teleop pages | IN PROGRESS | Platform pages exist; integration hardening and UX consistency continue. |
| S5 Hardware Mode | Linux/WSL2 hardware overlay, serial/video passthrough | IN PROGRESS | Compose hardware overlay and config paths exist; requires real device validation flow. |
| S6 Operations | Health checks, startup runbooks, troubleshooting docs | IN PROGRESS | Good docs exist, but some docs are inconsistent/outdated and need consolidation. |
| S7 QA and Release | Automated tests, CI checks, release checklist | WILL GO | No full E2E gate yet; backend tests exist but broader quality gate is pending. |

## DONE (Completed Foundations)

1. Dockerized 3-service architecture is defined (`runtime`, `backend`, `frontend`).
2. Runtime health and teleop/calibration/admin API surface exists.
3. Backend gateway includes structured error handling and runtime orchestration path.
4. Frontend platform routing and API integration scaffolding exist.
5. Windows helper scripts for start/stop and Cloudflare demo are available.
6. Hardware and autostart compose overlays are already prepared.
7. Upstream LeRobot dependency is pinned and vendored with documented sync metadata.

## IN PROGRESS (Current Workstream)

1. Environment stability (Docker Desktop/WSL/virtualization differences across developer machines).
2. End-to-end validation for both dry-run mode and real hardware mode.
3. Documentation cleanup to align actual code state vs older "skeleton" notes.
4. UI and backend behavior hardening for conflict paths and recovery flows.

## WILL GO (Big Roadmap)

### Roadmap A: Platform Stability (Short Term)

1. Standardize one canonical startup path (`scripts/start.ps1` + compose variants).
2. Add a machine preflight script for Windows (virtualization, WSL, Docker engine checks).
3. Publish a single "known-good" local setup matrix (Windows dry-run, WSL2 hardware).
4. Add startup troubleshooting decision tree and log-first workflow.

Roadmap A progress (2026-02-21):
- DONE: Canonical startup path implemented in `scripts/start.ps1` with `base`, `autostart`, `hardware`, `hardware-autostart` profiles.
- DONE: Windows preflight script added at `scripts/preflight.ps1`.
- DONE: Setup matrix and troubleshooting decision tree documented in `docs/guides/startup_profiles.md`.
- WILL GO: Add profile-aware one-click launchers for non-terminal users (optional VBS variants).

Success criteria:
- New developer can run stack in under 15 minutes.
- Startup failures return actionable error messages in one place.

### Roadmap B: Runtime and Hardware Reliability (Short-Mid Term)

1. Freeze and validate dry-run teleop contract (start/status/command/stop).
2. Validate calibration lifecycle end-to-end including artifact select and reuse.
3. Add explicit state guards for teleop/calibration/recording/training conflicts.
4. Add hardware smoke suite for SO-101: serial detection, camera detection, calibration apply.

Success criteria:
- Dry-run flow is deterministic across restarts.
- Hardware flow passes preflight + calibration + teleop without manual patching.

### Roadmap C: Frontend Productization (Mid Term)

1. Tighten API typing and error rendering across teleop/calibration pages.
2. Add station-level status panel in UI (Runtime, Backend, Hardware, Dataset).
3. Add operational views: selected calibration, active session, live diagnostics.
4. Improve route-level loading/error boundaries for platform pages.

Success criteria:
- Operator can identify platform state from UI without terminal usage.
- Critical failures have clear recovery actions in UI.

### Roadmap D: Data and Training Pipeline (Mid Term)

1. Finalize recording workflow contracts and dataset metadata schema.
2. Define training job submission/status schema and minimal job lifecycle.
3. Expose dataset/model artifact listing and selection in backend + UI.
4. Add retention and storage policy for datasets/models/calibration artifacts.

Success criteria:
- Record -> Train -> Evaluate loop runs from same platform with traceable artifacts.

### Roadmap E: Quality and Release Discipline (Mid-Long Term)

1. Expand backend test coverage for teleop/calibration conflict and error contract cases.
2. Add runtime contract tests (health, command validation, conflict responses).
3. Add lightweight CI gate (build + tests + compose config validation).
4. Create release checklist with rollback and compatibility notes.

Success criteria:
- Every merge passes automated checks.
- Regression risk is visible before release.

### Roadmap F: Security and Operations (Long Term)

1. Define trusted/dev-only boundaries for Docker socket autostart mode.
2. Add environment profiles (`dev`, `hardware-dev`, `demo`) with explicit risk labels.
3. Add audit-oriented logs for admin/config and start/stop operations.
4. Publish incident runbook (runtime unreachable, calibration invalid, teleop stuck).

Success criteria:
- Risky capabilities are explicit and controlled.
- Operators can recover incidents quickly with documented steps.

## Next Milestone Plan (Execution Board)

| Item | Owner | Status | Target |
|---|---|---|---|
| M1. Canonical startup and preflight checks | Platform | IN PROGRESS | Week 1 |
| M2. Dry-run E2E validation pass | Runtime + Backend | IN PROGRESS | Week 1 |
| M3. Docs consistency pass (remove stale skeleton wording) | Docs | WILL GO | Week 1 |
| M4. Hardware path validation on WSL2/Linux | Runtime | WILL GO | Week 2 |
| M5. UI status dashboard for station health | Frontend | WILL GO | Week 2 |
| M6. Contract test pack + CI baseline | Backend | WILL GO | Week 3 |

## Definition of Done (Per Station)

1. Infrastructure DONE:
- Stack starts from documented command.
- Service health checks pass.

2. Runtime DONE:
- Teleop + calibration flows work in dry-run.
- Error codes are consistent and documented.

3. Backend DONE:
- API contract stable for teleop/calibration/admin.
- Runtime orchestration behavior deterministic.

4. Frontend DONE:
- All critical platform pages consume live API safely.
- Failure states and recovery guidance are visible.

5. Hardware DONE:
- Preflight true on real hardware setup.
- Calibration artifact selected and used by teleop.

6. QA/Release DONE:
- Automated tests run in CI.
- Release checklist and rollback flow validated.

## Risks Right Now

1. Host environment mismatch (virtualization/WSL/Docker Desktop).
2. Documentation drift between implementation and old "skeleton" statements.
3. Hardware path variability by OS/device permissions.
4. Missing full regression automation across runtime + backend + frontend.

## Immediate Priority Order

1. Stabilize startup reliability and preflight diagnostics.
2. Lock dry-run teleop/calibration behavior with repeatable tests.
3. Align docs to current implementation state.
4. Validate and harden hardware mode.
5. Add CI quality gate before larger feature expansion.
