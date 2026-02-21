# KECY AI — LeRobot Runtime
# Builds from vendored upstream at runtime/upstream/lerobot/
# Based on upstream docker/Dockerfile.user (Apache-2.0)
#
# Build context: runtime/
# docker build -f docker/Dockerfile -t kecyai-lerobot-runtime .

ARG PYTHON_VERSION=3.10
FROM python:${PYTHON_VERSION}-slim-bookworm

# ── System deps (from upstream) ──
ENV DEBIAN_FRONTEND=noninteractive \
    MUJOCO_GL=egl \
    PATH=/lerobot/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential git curl libglib2.0-0 libegl1-mesa-dev ffmpeg \
    libusb-1.0-0-dev speech-dispatcher libgeos-dev portaudio19-dev \
    cmake pkg-config ninja-build \
    && curl -LsSf https://astral.sh/uv/install.sh | sh \
    && mv /root/.local/bin/uv /usr/local/bin/uv \
    && useradd --create-home --shell /bin/bash --uid 1000 kecyai \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# ── Application dir ──
WORKDIR /lerobot
RUN chown -R kecyai:kecyai /lerobot

USER kecyai

ENV HOME=/home/kecyai \
    HF_HOME=/home/kecyai/.cache/huggingface \
    HF_LEROBOT_HOME=/home/kecyai/.cache/huggingface/lerobot \
    TORCH_HOME=/home/kecyai/.cache/torch

# ── Python venv ──
RUN uv venv

# ── Install LeRobot from vendored upstream ──
COPY --chown=kecyai:kecyai upstream/lerobot/ .

# Web teleop minimum
RUN uv pip install --no-cache ".[so101,feetech]" || \
    uv pip install --no-cache ".[feetech]" || \
    uv pip install --no-cache .
    
RUN uv pip install --no-cache pyserial

# ── KECY runtime API server ──
COPY --chown=kecyai:kecyai app/ /kecyai-app/

# Ensure server.py can import teleop package from /kecyai-app/
ENV PYTHONPATH="/kecyai-app:${PYTHONPATH}"

EXPOSE 8100

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8100/health || exit 1

CMD ["python", "/kecyai-app/server.py"]
