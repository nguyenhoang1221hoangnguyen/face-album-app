# Single-stage build to avoid library compatibility issues
FROM python:3.11-slim

WORKDIR /app

# Install Node.js, build tools and system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gnupg \
    build-essential \
    g++ \
    python3-dev \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    wget \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY python/requirements.txt ./python/
RUN pip install --no-cache-dir -r python/requirements.txt

# Copy and install Node.js dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application code
COPY server/ ./server/
COPY public/ ./public/
COPY python/ ./python/

# Create data directories
RUN mkdir -p ./data/encodings ./data/status

# Pre-download InsightFace model to avoid runtime download issues
RUN python -c "from insightface.app import FaceAnalysis; app = FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider']); app.prepare(ctx_id=0, det_size=(640, 640)); print('Model downloaded successfully')" || echo "Model will be downloaded on first run"

# Environment
ENV NODE_ENV=production
ENV FACE_API_PORT=5001
ENV WEB_PORT=3000
ENV FACE_API_URL=http://127.0.0.1:5001
ENV REDIS_ENABLED=false

# Expose ports
EXPOSE 3000 5001

# Create startup script with auto-restart
RUN printf '#!/bin/bash\n\
\n\
# Function to start Face API\n\
start_face_api() {\n\
    echo "Starting Face Recognition API on port 5001..."\n\
    PORT=5001 python python/face_api.py &\n\
    PYTHON_PID=$!\n\
    echo "Face API started with PID: $PYTHON_PID"\n\
}\n\
\n\
# Function to start Node server\n\
start_node() {\n\
    echo "Starting Web Server on port 3000..."\n\
    PORT=3000 node server/server.js &\n\
    NODE_PID=$!\n\
    echo "Node server started with PID: $NODE_PID"\n\
}\n\
\n\
# Start services\n\
start_face_api\n\
sleep 10\n\
start_node\n\
\n\
# Monitor and restart if needed\n\
while true; do\n\
    sleep 30\n\
    \n\
    # Check if Face API is running\n\
    if ! kill -0 $PYTHON_PID 2>/dev/null; then\n\
        echo "Face API crashed, restarting..."\n\
        start_face_api\n\
        sleep 5\n\
    fi\n\
    \n\
    # Check if Node is running\n\
    if ! kill -0 $NODE_PID 2>/dev/null; then\n\
        echo "Node server crashed, restarting..."\n\
        start_node\n\
    fi\n\
done\n\
' > /app/start.sh && chmod +x /app/start.sh

CMD ["/bin/bash", "/app/start.sh"]
