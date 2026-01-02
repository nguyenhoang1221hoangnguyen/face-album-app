require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const { initAdmin } = require('./database');
const { apiLimiter } = require('./middleware/rateLimiter');
const { isRedisConnected } = require('./redis');

const authRoutes = require('./routes/auth');
const albumRoutes = require('./routes/albums');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy when behind reverse proxy (Coolify, nginx, etc.)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for inline scripts
  crossOriginEmbedderPolicy: false
}));

// Compression
app.use(compression());

// CORS
app.use(cors());

// Body parser with limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// Rate limiting for API routes
app.use('/api', apiLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/albums', albumRoutes);

// Health check endpoint
app.get('/health', async (req, res) => {
  const redisOk = await isRedisConnected();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      redis: redisOk ? 'connected' : 'disconnected'
    }
  });
});

// Page routes
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/album/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/album.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Lỗi server'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Không tìm thấy trang' });
});

// Initialize
initAdmin();

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📁 Admin panel: http://localhost:${PORT}/admin`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
});
