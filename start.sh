#!/bin/bash

# Script khởi động cả 2 server

cd "$(dirname "$0")"

echo "🚀 Starting Face Album App..."

# Kill existing processes
pkill -f "node server/server.js" 2>/dev/null
pkill -f "python.*face_api.py" 2>/dev/null

sleep 1

# Start Python Face Recognition API
echo "🔍 Starting Face Recognition API (Python)..."
source venv/bin/activate
python python/face_api.py &
PYTHON_PID=$!

sleep 2

# Start Node.js Server
echo "🌐 Starting Web Server (Node.js)..."
npm start &
NODE_PID=$!

echo ""
echo "✅ Both servers are running!"
echo ""
echo "📍 Web App:    http://localhost:3000"
echo "📍 Admin:      http://localhost:3000/admin"
echo "📍 Face API:   http://localhost:5001"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for Ctrl+C
trap "kill $PYTHON_PID $NODE_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
