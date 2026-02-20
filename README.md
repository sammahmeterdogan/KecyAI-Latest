# ğŸ¤– KECY AI

> **Web-Based Open Source Robotics Education Platform**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Java](https://img.shields.io/badge/Java-17-orange.svg)](https://openjdk.java.net/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg)](https://docs.docker.com/compose/)

---

## ğŸš€ Quick Start

### Option 1: One-Click Start (Windows)

<div align="center">

| Start Full Stack | Stop Full Stack |
|-----------------|-----------------|
| [ğŸ“¦ Start](scripts/start.vbs) | [â¹ï¸ Stop](scripts/stop.vbs) |

*Double-click the links above (no console window)*

</div>

### Option 2: Docker Compose (All Platforms)

```bash
docker compose -f infra/compose/docker-compose.yml up --build
```

âœ… **Frontend:** http://localhost:3000  
âœ… **Backend API:** http://localhost:8080  
âœ… **Runtime:** http://localhost:8100

---

## ğŸ“‹ Prerequisites

Before you begin, ensure you have the following installed:

| Tool | Version | Download |
|------|---------|----------|
| **Node.js** | 20+ | [Download](https://nodejs.org/) |
| **Java** | 17+ | [Download](https://adoptium.net/) |
| **Docker Desktop** | Latest | [Download](https://www.docker.com/products/docker-desktop/) |
| **Git** | Latest | [Download](https://git-scm.com/) |

### Verify Installation

```bash
node --version    # Should show v20.x.x
java --version    # Should show 17.x.x
docker --version  # Should show Docker 24+
```

---

## ğŸ—ï¸ Project Structure

```
kecy-ai/
â”œâ”€â”€ frontend/          # Vite + React UI (platform pages, 3D visuals)
â”œâ”€â”€ backend/           # Spring Boot Java 17 backend
â”œâ”€â”€ runtime/           # Dockerized LeRobot + ROS runtime
â”œâ”€â”€ infra/             # Docker Compose files, environment templates
â”œâ”€â”€ docs/              # API docs, architecture, guides
â”œâ”€â”€ scripts/           # Windows helpers (start/stop scripts)
â””â”€â”€ README.md          # You are here
```

---

## ğŸ› ï¸ Development Setup

### Full Stack (Recommended for Beginners)

```bash
# Clone the repository
git clone <repository-url>
cd kecy-ai

# Start everything with one command
docker compose -f infra/compose/docker-compose.yml up --build
```

Then open **http://localhost:3000** in your browser.

---

### Frontend Only Development

```bash
cd frontend
npm install
npm run dev
```

> âš ï¸ **Note:** Requires backend running on port 8080

---

### Backend Only Development

```bash
cd backend
./mvnw spring-boot:run
```

> âš ï¸ **Note:** Requires runtime container running

---

## ğŸŒ Public Demo (Cloudflare Tunnel)

Share your local instance publicly with a `trycloudflare.com` URL:

```bash
# Start with Cloudflare tunnel
docker compose -p kecyai \
  -f infra/compose/docker-compose.yml \
  -f infra/compose/docker-compose.cloudflare.yml up -d --build

# Get your public URL
docker logs kecyai-cloudflared
```

**Windows users:** Run [`scripts/start-cloudflare-demo.ps1`](scripts/start-cloudflare-demo.ps1)

---

## ğŸ“– Documentation

| Section | Description |
|---------|-------------|
| [ğŸ“š Docs Overview](docs/README.md) | Main documentation index |
| [ğŸ”Œ API Reference](docs/api/) | REST API endpoints |
| [ğŸ›ï¸ Architecture](docs/architecture/) | System design & decisions |
| [ğŸ“– Guides](docs/guides/) | Developer & operator runbooks |
| [ğŸ“… Phases](docs/phases/) | Implementation roadmap |

---

## ğŸ¯ Key Features

| Feature | Description |
|---------|-------------|
| **ğŸ® Teleoperation** | Real-time robot control via web interface |
| **ğŸ“¹ Camera Feeds** | Multi-camera streaming support |
| **ğŸ“Š Dataset Recording** | Record demonstrations for training |
| **ğŸ§  Policy Training** | Train AI policies (ACT, SmolVLA, Pi0) |
| **ğŸ”§ Calibration** | Robot calibration workflows |
| **âš™ï¸ Hardware Admin** | Configure serial ports, robot types |

---

## ğŸ§ª Testing

### Backend Tests

```bash
cd backend
mvn test
```

### Frontend

Manual verification via browser (no automated test suite configured).

---

## ğŸ”§ Configuration

### Environment Variables

| Variable | Service | Default | Description |
|----------|---------|---------|-------------|
| `LEROBOT_RUNTIME_BASE_URL` | Backend | `http://runtime:8100` | Runtime service URL |
| `VITE_API_URL` | Frontend | `http://localhost:8080` | Backend API URL |
| `DEVICE` | Runtime | `cpu` | Compute device (`cpu` or `cuda`) |

### Docker Volumes

| Volume | Purpose |
|--------|---------|
| `kecyai-datasets` | Persistent dataset storage |
| `kecyai-models` | Persistent model storage |

---

## âš ï¸ Security Notes

- **Docker Socket Mounting:** Required for runtime autostartâ€”use only in trusted development environments
- **Cloudflare Tunnel:** Exposes your local instance publiclyâ€”use with caution
- **Hardware Access:** Serial port access requires appropriate system permissions

See [`docs/guides/zero_terminal_setup.md`](docs/guides/zero_terminal_setup.md) for autostart configuration.

---

## ğŸ¤ Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit changes (`git commit -m 'Add my feature'`)
4. Push to branch (`git push origin feature/my-feature`)
5. Open a Pull Request

### Commit Convention

Use short, imperative subjects:
- âœ… `Add runtime health check endpoint`
- âœ… `Fix calibration timeout issue`
- âœ… `Update sidebar navigation styles`

---

## ğŸ“¸ Screenshots

### Platform Dashboard
![Dashboard](docs/assets/dashboard.png)

### Teleoperation Interface
![Teleop](docs/assets/teleop.png)

### Policy Training
![Training](docs/assets/training.png)

---

## ğŸ“„ License

This project is licensed under the MIT Licenseâ€”see the [LICENSE](LICENSE) file for details.

---

## ğŸ™ Acknowledgments

- **[LeRobot](https://github.com/huggingface/lerobot)** â€” Hugging Face's robotics framework
- **[Spring Boot](https://spring.io/projects/spring-boot)** â€” Backend framework
- **[React](https://react.dev/)** â€” Frontend framework
- **[Three.js](https://threejs.org/)** â€” 3D graphics library

---

## ğŸ“¬ Contact

| Resource | Link |
|----------|------|
| Website | [kecyai.local](https://kecyai.local/) |
| Documentation | [docs/](docs/README.md) |
| Issues | [GitHub Issues](../../issues) |

---

<div align="center">

**Made with â¤ï¸ by Tenbin Labs**

[â¬† Back to Top](#-kecy-ai)

</div>
