# Multi-stage build for Face Album App
# Stage 1: Build Node.js app
FROM node:18-alpine AS node-builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

# Stage 2: Python Face API
FROM python:3.11-slim AS python-base

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    wget \
    && rm -rf /var/lib/apt/lists/*

COPY python/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY python/ ./python/
COPY data/ ./data/ 2>/dev/null || mkdir -p ./data

# Stage 3: Final image with both Node.js and Python
FROM python:3.11-slim

WORKDIR /app

# Install Node.js
RUN apt-get update && apt-get install -y \
    curl \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    wget \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy Python dependencies
COPY --from=python-base /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=python-base /usr/local/bin /usr/local/bin

# Copy Node.js app
COPY --from=node-builder /app/node_modules ./node_modules
COPY --from=node-builder /app/package*.json ./
COPY --from=node-builder /app/server ./server
COPY --from=node-builder /app/public ./public

# Copy Python app
COPY python/ ./python/

# Create data directories
RUN mkdir -p ./data/encodings ./data/status

# Environment
ENV NODE_ENV=production
ENV PORT=3000
ENV FACE_API_URL=http://localhost:5001

# Expose ports
EXPOSE 3000 5001

# Create startup script
RUN echo '#!/bin/bash\n\
python python/face_api.py &\n\
sleep 5\n\
node server/server.js\n\
' > /app/start.sh && chmod +x /app/start.sh

CMD ["/bin/bash", "/app/start.sh"]
