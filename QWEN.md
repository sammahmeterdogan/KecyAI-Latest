# KECY AI - Project Context

## Project Overview

**KECY AI** is a mono-repo robotics platform for controlling and training AI-powered robotic arms. It provides a full-stack application for robot calibration, teleoperation, dataset recording, policy training, and inference.

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Vite + React 19, React Router, Three.js (react-three-fiber), Framer Motion, Tailwind CSS |
| **Backend** | Spring Boot 3.2.2, Java 17, Spring WebFlux, Lombok, Docker Java API |
| **Runtime** | Dockerized LeRobot + ROS (Python-based robotics framework) |
| **Infrastructure** | Docker Compose, Cloudflare Quick Tunnel for public sharing |

### Architecture

The project follows a **Clean Architecture** pattern in the backend:

```
backend/src/main/java/com/tenbinlabs/kecyai/
├── KecyBackendApplication.java    # Bootstrap
├── api/                           # REST Controllers (HTTP layer)
├── application/                   # Application services & use cases
├── domain/                        # Business logic & entities
└── infrastructure/                # External integrations (Docker, Runtime API)
```

**Frontend structure:**
```
frontend/src/
├── main.jsx                       # Entry point
├── App.jsx                        # Router configuration
├── pages/                         # Route components (PlatformLayout, Overview, etc.)
├── components/                    # Reusable UI components
├── features/                      # Feature-specific modules
├── lib/                           # Utilities (API clients, helpers)
└── types/                         # TypeScript-like type definitions (JSDoc)
```

### Key Features

- **Platform Pages**: Parts list, assembly, motor settings, calibration, teleoperation, cameras
- **Dataset Recording**: Record robot demonstrations for training
- **Policy Training**: Train AI policies (ACT, SmolVLA, Pi0 models)
- **Inference**: Run trained policies on robot hardware
- **Dynamic Capabilities**: Routes adapt based on robot capabilities from `/api/lerobot/capabilities`

---

## Building and Running

### Full Stack (Docker Compose) - Recommended

```bash
# Start all services (frontend, backend, runtime)
docker compose -f infra/compose/docker-compose.yml up --build

# Access:
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:8080
# - Runtime: http://localhost:8100
```

### Frontend Only (Development)

```bash
cd frontend
npm install
npm run dev
# Access: http://localhost:3000 (proxies /api/* to http://127.0.0.1:8080)
```

### Backend Only (Development)

```bash
cd backend
./mvnw spring-boot:run
# Or: mvn spring-boot:run
# Access: http://localhost:8080
```

### Windows One-Click Scripts

| Action | Script |
|--------|--------|
| Start (no console) | `scripts/start.vbs` |
| Stop (no console) | `scripts/stop.vbs` |
| Start with Cloudflare tunnel | `scripts/start-cloudflare-demo.ps1` |
| Logs location | `scripts/_logs/` |

### Public Demo via Cloudflare

```bash
# Start with Cloudflare Quick Tunnel
docker compose -p kecyai \
  -f infra/compose/docker-compose.yml \
  -f infra/compose/docker-compose.cloudflare.yml up -d --build

# Get public URL
docker logs kecyai-cloudflared
```

---

## API Endpoints

| Endpoint | Controller | Description |
|----------|------------|-------------|
| `GET /api/health` | `HealthController` | Health check |
| `GET /api/lerobot/capabilities` | `LeRobotControllerV2` | List robot capabilities |
| `POST /api/calibration/*` | `CalibrationController` | Calibration operations |
| `POST /api/recording/*` | `RecordingController` | Dataset recording |
| `POST /api/training/*` | `TrainingController` | Policy training |

---

## Development Conventions

### Code Formatting (`.editorconfig`)

| File Type | Indent | Notes |
|-----------|--------|-------|
| Default | 2 spaces | LF, trim trailing whitespace |
| Java, XML | 4 spaces | |
| Python | 4 spaces | |
| Markdown | 2 spaces | Trailing whitespace preserved |
| Makefile | Tabs | |

### Frontend

- **Styling**: Vanilla CSS + inline styles (no CSS-in-JS library)
- **Icons**: Lucide React (`lucide-react`)
- **3D Graphics**: Three.js via `@react-three/fiber` and `@react-three/drei`
- **Animations**: Framer Motion
- **Routing**: React Router v7 with nested routes under `/kecy/platform`
- **Naming**: Descriptive, domain-focused (e.g., `/kecy/platform/:capId`)

### Backend

- **Java Version**: 17
- **Framework**: Spring Boot 3.2.2
- **Dependencies**: Lombok (boilerplate reduction), Docker Java API (runtime control)
- **Testing**: `spring-boot-starter-test`, `reactor-test`

### Testing

```bash
# Backend tests
cd backend
mvn test

# Frontend: No automated test suite; manual verification expected
```

---

## Configuration & Environment

### Key Environment Variables

| Variable | Service | Description |
|----------|---------|-------------|
| `LEROBOT_RUNTIME_BASE_URL` | Backend | URL to LeRobot runtime (default: `http://runtime:8100`) |
| `VITE_API_URL` | Frontend | Backend API URL (default: `http://localhost:8080`) |
| `DEVICE` | Runtime | Compute device (`cpu` or `cuda`) |
| `KECYAI_DATASETS_DIR` | Runtime | Dataset storage path |
| `KECYAI_MODELS_DIR` | Runtime | Model storage path |

### Docker Volumes

- `kecyai-datasets`: Persistent dataset storage
- `kecyai-models`: Persistent model storage

### Security Notes

- Runtime autostart requires Docker socket mounting—use only in trusted environments
- See `docs/guides/zero_terminal_setup.md` for autostart configuration

---

## Documentation Structure

```
docs/
├── api/           # API contracts and endpoint references
├── architecture/  # Architecture decisions, upstream dependencies
├── guides/        # Operator and developer runbooks
├── phases/        # Implementation phase records
└── README.md      # Documentation index
```

---

## Common Tasks

### Add a New API Endpoint

1. Create controller in `backend/src/main/java/com/tenbinlabs/kecyai/api/`
2. Define request/response DTOs in `domain/` or `application/`
3. Implement business logic in `application/` service layer
4. Add integration code in `infrastructure/` if needed
5. Test with `mvn test`

### Add a New Frontend Page

1. Create page component in `frontend/src/pages/`
2. Add route in `frontend/src/App.jsx` under `/kecy/platform`
3. Fetch data from backend via API client in `frontend/src/lib/`
4. Style with vanilla CSS or inline styles

### Debug Runtime Issues

1. Check runtime logs: `docker logs kecyai-runtime`
2. Verify runtime health: `http://localhost:8100/health` (if exposed)
3. Check backend-runtime connectivity: `http://localhost:8080/api/health`

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Frontend can't reach backend | Ensure backend is running on port 8080; check `VITE_API_URL` |
| Runtime fails to start | Verify Docker socket permissions; check `DEVICE` env var |
| Cloudflare tunnel not working | Run `docker logs kecyai-cloudflared` for tunnel URL |
| Build fails on Windows | Use WSL2 or ensure Docker Desktop is running with WSL2 backend |
