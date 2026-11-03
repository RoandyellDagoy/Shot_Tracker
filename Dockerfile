# ==============================================================================
# Stage 1: Build the React + TypeScript + MediaPipe Frontend
# ==============================================================================
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

# Install dependencies first (cached layer)
COPY frontend/package*.json ./
RUN npm ci

# Copy frontend source and build production bundle (/app/frontend/dist)
COPY frontend/ ./
RUN npm run build

# ==============================================================================
# Stage 2: Python FastAPI Production Server (Serves API + Built React SPA)
# ==============================================================================
FROM python:3.10-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    DB_PATH=/data/shots.db

WORKDIR /app

# Create /data directory for persistent SQLite volume mounting
RUN mkdir -p /data

# Install Python backend dependencies
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy Python backend code
COPY backend/ ./backend/

# Copy compiled frontend static assets from Stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

EXPOSE 8000

# Start FastAPI with Uvicorn (uses $PORT injected by Railway / Render / Cloud Run)
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

