const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let redis = null;

function getRedis() {
  if (!redis) {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      lazyConnect: true
    });

    redis.on('error', (err) => {
      console.error('Redis connection error:', err.message);
    });

    redis.on('connect', () => {
      console.log('✅ Redis connected');
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

// Cache operations
async function getCache(key) {
  try {
    const client = getRedis();
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error('Redis get error:', err.message);
    return null;
  }
}

async function setCache(key, value, ttl = 3600) {
  try {
    const client = getRedis();
    await client.setex(key, ttl, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error('Redis set error:', err.message);
    return false;
  }
}

async function deleteCache(key) {
  try {
    const client = getRedis();
    await client.del(key);
    return true;
  } catch (err) {
    console.error('Redis delete error:', err.message);
    return false;
  }
}

async function deleteCachePattern(pattern) {
  try {
    const client = getRedis();
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(...keys);
    }
    return true;
  } catch (err) {
    console.error('Redis delete pattern error:', err.message);
    return false;
  }
}

// Check Redis connection
async function isRedisConnected() {
  try {
    const client = getRedis();
    await client.ping();
    return true;
  } catch (err) {
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
