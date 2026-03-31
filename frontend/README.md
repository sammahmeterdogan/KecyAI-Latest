# KECY AI — Frontend

Vite + React frontend for the KECY AI platform.

## Development

The frontend expects the Python runtime service on port 8040 by default.

1.  **Install dependencies**:
    ```bash
    npm install
    ```

2.  **Start Dev Server**:
    ```bash
    npm run dev
    ```
    - Access at `http://localhost:3000`.
    - API requests to `/api/*` are proxied to `http://127.0.0.1:8040` unless `VITE_API_BASE_URL` overrides the target.

## Architecture
- **Framework**: React + Vite
- **Styling**: Vanilla CSS + Inline styles (Premium UI system)
- **Icons**: Lucide React
- **Integration**:
    - Dynamically fetches robot capabilities from `/api/lerobot/capabilities`.
    - Dynamic routing via `/kecy/platform/:capId`.
