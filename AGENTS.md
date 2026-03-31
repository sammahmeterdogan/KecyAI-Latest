# Repository Guidelines

## Project Structure & Module Organization
- `frontend/`: Vite + React UI (routes under `src/`, static assets in `public/`).
- `desktop/`: Tauri desktop shell that launches the local Python runtime service.
- `runtime/`: Python runtime service and vendored LeRobot sources.
- `infra/`: Docker Compose files and environment templates (see `infra/compose/`).
- `docs/`: API, architecture, and runbooks.
- `scripts/`: Windows-friendly helpers (`start.ps1`, `start.vbs`, `stop.*`).

## Build, Test, and Development Commands
- Full stack (Docker Compose): `docker compose -f infra/compose/docker-compose.yml up --build`
- Frontend dev server:
  - `cd frontend`
  - `npm install`
  - `npm run dev` (serves at `http://localhost:3000`, proxies `/api/*` to `http://127.0.0.1:8040` by default)
- One-click Windows start: double-click `scripts/start.vbs` (logs in `scripts/_logs/`).

## Coding Style & Naming Conventions
- Formatting is governed by `.editorconfig`:
  - Default: 2-space indent, LF, trim trailing whitespace.
  - Java/XML/Python: 4-space indent.
  - Markdown: trailing whitespace preserved.
- Frontend styling is primarily vanilla CSS + inline styles (see `frontend/README.md`).
- Use descriptive, domain-focused class and route names (example: `/kecy/platform/:capId`).

## Upstream Reference Workflow
- For robotics feature work, inspect the local desktop clone at `C:\Users\ASUS\Desktop\phosphobot` first.
- If `phosphobot` does not already implement the needed behavior or its implementation is incomplete for the task, inspect `C:\Users\ASUS\Desktop\lerobot-main` next.
- Treat `phosphobot` and `LeRobot` as reference implementations only. Extract the useful logic, flow, and architecture patterns, then adapt them into KECYAI's own `frontend/`, `runtime/`, and `desktop/` structure.
- Do not introduce a direct product dependency on `phosphobot` or `LeRobot` unless the task explicitly requires it and that decision is documented.
- End-user workflows must land in KECYAI's own UI and desktop flow so users do not need to clone repos, install upstream dependencies, edit config files, or run terminal commands manually.
- When implementing a robotics feature, note which upstream paths were consulted and what was adapted.

## Testing Guidelines
- Runtime service:
  - Run focused Python checks with `C:\Users\ASUS\miniforge3\python.exe -m py_compile runtime/app/*.py` when changing transport or runtime entry logic.
- No dedicated frontend test setup is present; include manual verification steps for UI changes.

## Commit & Pull Request Guidelines
- This repo does not include Git history or a formal commit convention.
  - Use short, imperative commit subjects (example: “Add runtime health check endpoint”).
- PRs should include:
  - Clear summary and scope.
  - Test status (commands run and results).
  - Screenshots or screen recordings for UI changes.

## Security & Configuration Tips
- Hardware mode requires trusted local hardware access and host serial permissions.


