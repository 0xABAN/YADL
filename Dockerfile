# Railway API — MediaPipe CPU + optional video (ffmpeg)
FROM python:3.12-slim-bookworm

# ffmpeg = video frames; GL stack = MediaPipe landmarker (.so deps)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    libglib2.0-0 \
    libgl1 \
    libgles2 \
    libegl1 \
    libglx-mesa0 \
    libgl1-mesa-dri \
  && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY schema.sql ./
COPY src/backend ./src/backend

RUN uv sync --frozen --no-dev

ENV PYTHONPATH=src
ENV PATH="/app/.venv/bin:$PATH"

# Railway sets PORT
CMD ["sh", "-c", "uvicorn backend.app:app --host 0.0.0.0 --port ${PORT:-8000}"]
