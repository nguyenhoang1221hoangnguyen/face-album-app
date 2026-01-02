const rateLimit = require('express-rate-limit');

// Check if in production
const isProduction = process.env.NODE_ENV === 'production';

// General API rate limiter - higher limits for production
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 500 : 200, // 500 requests per 15 min in production
  message: {
    error: 'Quá nhiều request, vui lòng thử lại sau vài phút'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health'
});

// Strict limiter for authentication
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 login attempts per hour
  message: {
    error: 'Quá nhiều lần thử đăng nhập, vui lòng thử lại sau 1 giờ'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

// Limiter for face search (resource intensive) - per IP
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isProduction ? 30 : 20, // 30 searches per minute in production
  message: {
    error: 'Quá nhiều tìm kiếm, vui lòng thử lại sau 1 phút'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Limiter for album sync (very resource intensive)
const syncLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 syncs per hour
  message: {
    error: 'Quá nhiều lần đồng bộ, vui lòng thử lại sau 1 giờ'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Limiter for password verification
const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 minutes
  message: {
    error: 'Quá nhiều lần thử mật khẩu, vui lòng thử lại sau 15 phút'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

// Limiter for photos endpoint - higher for pagination
const photosLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isProduction ? 120 : 60, // 120 requests per minute in production
  message: {
    error: 'Quá nhiều request, vui lòng chờ 1 phút'
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  apiLimiter,
  authLimiter,
  searchLimiter,
  syncLimiter,
  passwordLimiter,
  photosLimiter
};
