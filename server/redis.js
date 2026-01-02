const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false';

let redis = null;
let redisAvailable = false;

function getRedis() {
  if (!REDIS_ENABLED) {
    return null;
  }
  
  if (!redis) {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 5000,
      retryStrategy: (times) => {
        if (times > 3) {
          console.log('Redis unavailable, running without cache');
          redisAvailable = false;
          return null;
        }
        return Math.min(times * 100, 1000);
      }
    });

    redis.on('error', (err) => {
      if (redisAvailable) {
        console.error('Redis connection error:', err.message);
        redisAvailable = false;
      }
    });

    redis.on('connect', () => {
      console.log('✅ Redis connected');
      redisAvailable = true;
    });
  }
  return redis;
}

// Cache keys
const CACHE_KEYS = {
  ALBUM_ENCODINGS: (albumId) => `encodings:album:${albumId}`,
  ENCODING_STATUS: (albumId) => `encoding:status:${albumId}`,
  ALBUM_PHOTOS: (albumId) => `photos:album:${albumId}`
};

// TTL in seconds
const CACHE_TTL = {
  ENCODINGS: 24 * 60 * 60,     // 24 hours
  STATUS: 5 * 60,               // 5 minutes
  PHOTOS: 60 * 60               // 1 hour
};

// Cache operations - gracefully handle no Redis
async function getCache(key) {
  if (!REDIS_ENABLED || !redisAvailable) {
    return null;
  }
  try {
    const client = getRedis();
    if (!client) return null;
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    return null;
  }
}

async function setCache(key, value, ttl = 3600) {
  if (!REDIS_ENABLED || !redisAvailable) {
    return false;
  }
  try {
    const client = getRedis();
    if (!client) return false;
    await client.setex(key, ttl, JSON.stringify(value));
    return true;
  } catch (err) {
    return false;
  }
}

async function deleteCache(key) {
  if (!REDIS_ENABLED || !redisAvailable) {
    return false;
  }
  try {
    const client = getRedis();
    if (!client) return false;
    await client.del(key);
    return true;
  } catch (err) {
    return false;
  }
}

async function deleteCachePattern(pattern) {
  if (!REDIS_ENABLED || !redisAvailable) {
    return false;
  }
  try {
    const client = getRedis();
    if (!client) return false;
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(...keys);
    }
    return true;
  } catch (err) {
    return false;
  }
}

// Check Redis connection
async function isRedisConnected() {
  if (!REDIS_ENABLED) {
    return false;
  }
  try {
    const client = getRedis();
    if (!client) return false;
    await client.ping();
    redisAvailable = true;
    return true;
  } catch (err) {
    redisAvailable = false;
    return false;
  }
}

module.exports = {
  getRedis,
  getCache,
  setCache,
  deleteCache,
  deleteCachePattern,
  isRedisConnected,
  CACHE_KEYS,
  CACHE_TTL
};
