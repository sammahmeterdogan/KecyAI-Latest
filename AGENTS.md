# Repository Guidelines

## Project Structure & Module Organization
- `frontend/`: Vite + React UI (routes under `src/`, static assets in `public/`).
- `backend/`: Spring Boot 3 (Java 17) service. Clean Architecture layers under `src/main/java/com/tenbinlabs/kecyai/`.
- `runtime/`: Dockerized LeRobot + ROS runtime used by the backend.
- `infra/`: Docker Compose files and environment templates (see `infra/compose/`).
- `docs/`: API, architecture, and runbooks.
- `scripts/`: Windows-friendly helpers (`start.ps1`, `start.vbs`, `stop.*`).

## Build, Test, and Development Commands
- Full stack (Docker Compose): `docker compose -f infra/compose/docker-compose.yml up --build`
- Frontend dev server:
  - `cd frontend`
  - `npm install`
  - `npm run dev` (serves at `http://localhost:3000`, proxies `/api/*` to `http://127.0.0.1:8080`)
- One-click Windows start: double-click `scripts/start.vbs` (logs in `scripts/_logs/`).

## Coding Style & Naming Conventions
- Formatting is governed by `.editorconfig`:
  - Default: 2-space indent, LF, trim trailing whitespace.
  - Java/XML/Python: 4-space indent.
  - Markdown: trailing whitespace preserved.
- Frontend styling is primarily vanilla CSS + inline styles (see `frontend/README.md`).
- Use descriptive, domain-focused class and route names (example: `/kecy/platform/:capId`).

## Testing Guidelines
- Backend uses Spring Boot test tooling (`spring-boot-starter-test`) and Reactor test utilities.
  - Run with `mvn test` from `backend/` when adding server logic.
- No dedicated frontend test setup is present; include manual verification steps for UI changes.

## Commit & Pull Request Guidelines
- This repo does not include Git history or a formal commit convention.
  - Use short, imperative commit subjects (example: “Add runtime health check endpoint”).
- PRs should include:
  - Clear summary and scope.
  - Test status (commands run and results).
  - Screenshots or screen recordings for UI changes.

## Security & Configuration Tips
- Autostarting the runtime requires mounting the Docker socket; use only in trusted dev environments.
  - See `docs/guides/zero_terminal_setup.md` for autostart notes and env flags.
