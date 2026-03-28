# Production image: Node + Python venv for final_engine.py / unlock_potential.py
# From repo root, after `npm run build`:
#   docker build -t ascend-backend .

FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/requirements.txt ./
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

# server.js serves path.join(__dirname, '..', 'dist') → /dist when __dirname is /app
COPY dist /dist

ENV PYTHON_PATH=/opt/venv/bin/python3
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "server.js"]
