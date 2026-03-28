# Production image: Node + Python venv for final_engine.py / unlock_potential.py
# From repo root:
#   docker build -t ascend-backend .

# --- STAGE 1: Build the React Frontend ---
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /app/frontend
# Copy root package files to install frontend deps
COPY package*.json ./
RUN npm ci
# Copy the rest of the frontend source (including src, public, vite config)
COPY . ./
# This creates /app/frontend/dist
RUN npm run build

# --- STAGE 2: Build the Final Backend Image ---
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/requirements.txt ./
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

# Copy the built 'dist' folder from Stage 1 into the final image
COPY --from=frontend-build /app/frontend/dist /dist

ENV PYTHON_PATH=/opt/venv/bin/python3
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "server.js"]
