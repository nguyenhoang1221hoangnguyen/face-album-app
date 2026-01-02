const rateLimit = require('express-rate-limit');

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 requests per windowMs (tăng từ 100)
  message: {
    error: 'Quá nhiều request, vui lòng thử lại sau 15 phút'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health' // Skip health check
});

// Strict limiter for authentication
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 login attempts per hour
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
  max: 20, // 20 searches per minute (tăng từ 10)
  message: {
    error: 'Quá nhiều tìm kiếm, vui lòng thử lại sau 1 phút'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Limiter for album sync (very resource intensive)
const syncLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 syncs per hour
  message: {
    error: 'Quá nhiều lần đồng bộ, vui lòng thử lại sau 1 giờ'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Limiter for password verification
const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  message: {
    error: 'Quá nhiều lần thử mật khẩu, vui lòng thử lại sau 15 phút'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

// Limiter for photos endpoint (prevent abuse)
const photosLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
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
