const { getCache, setCache, deleteCache, CACHE_KEYS, CACHE_TTL } = require('./redis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false';

let encodingQueue = null;
let queueAvailable = false;

// Only initialize Bull queue if Redis is enabled
if (REDIS_ENABLED) {
  try {
    const Queue = require('bull');
    encodingQueue = new Queue('face-encoding', REDIS_URL, {
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    });

    // Queue events
    encodingQueue.on('error', (err) => {
      console.error('Queue error:', err.message);
      queueAvailable = false;
    });

    encodingQueue.on('ready', () => {
      console.log('✅ Bull queue ready');
      queueAvailable = true;
    });

    encodingQueue.on('failed', (job, err) => {
      console.error(`Job ${job.id} failed:`, err.message);
      updateEncodingStatus(job.data.albumId, 'error', { error: err.message });
    });

    encodingQueue.on('completed', (job, result) => {
      console.log(`Job ${job.id} completed:`, result);
    });

    encodingQueue.on('progress', (job, progress) => {
      console.log(`Job ${job.id} progress: ${progress}%`);
    });
  } catch (err) {
    console.log('Bull queue not available, encoding will be synchronous');
  }
}

// In-memory status storage when Redis is not available
const memoryStatus = new Map();

// Add job to queue (or run synchronously if queue not available)
async function addEncodingJob(albumId, photos) {
  if (encodingQueue && queueAvailable) {
    const job = await encodingQueue.add(
      { albumId, photos },
      { 
        jobId: `encoding-${albumId}-${Date.now()}`,
        priority: 1
      }
    );
    
    // Update status
    await updateEncodingStatus(albumId, 'queued', {
      total_photos: photos.length,
      processed_photos: 0,
      total_faces: 0,
      job_id: job.id
    });
    
    return job;
  }
  
  // No queue available - status will be managed by direct encoding call
  await updateEncodingStatus(albumId, 'processing', {
    total_photos: photos.length,
    processed_photos: 0,
    total_faces: 0
  });
  
  return null;
}

// Update encoding status
async function updateEncodingStatus(albumId, status, data = {}) {
  const statusData = {
    album_id: albumId,
    status,
    ...data,
    updated_at: new Date().toISOString()
  };
  
  // Try Redis first, fallback to memory
  const cached = await setCache(
    CACHE_KEYS.ENCODING_STATUS(albumId),
    statusData,
    CACHE_TTL.STATUS
  );
  
  if (!cached) {
    memoryStatus.set(albumId, statusData);
  }
  
  return statusData;
}

// Get encoding status
async function getEncodingStatus(albumId) {
  // Try Redis first
  const cached = await getCache(CACHE_KEYS.ENCODING_STATUS(albumId));
  if (cached) return cached;
  
  // Fallback to memory
  const memStatus = memoryStatus.get(albumId);
  if (memStatus) return memStatus;
  
  return {
    album_id: albumId,
    status: 'not_started',
    total_faces: 0
  };
}

// Get queue stats
async function getQueueStats() {
  if (!encodingQueue || !queueAvailable) {
    return { waiting: 0, active: 0, completed: 0, failed: 0, available: false };
  }
  
  try {
    const [waiting, active, completed, failed] = await Promise.all([
      encodingQueue.getWaitingCount(),
      encodingQueue.getActiveCount(),
      encodingQueue.getCompletedCount(),
      encodingQueue.getFailedCount()
    ]);
    
    return { waiting, active, completed, failed, available: true };
  } catch (err) {
    return { waiting: 0, active: 0, completed: 0, failed: 0, available: false };
  }
}

// Clean old jobs
async function cleanQueue() {
  if (!encodingQueue || !queueAvailable) return;
  
  try {
    await encodingQueue.clean(24 * 60 * 60 * 1000, 'completed');
    await encodingQueue.clean(7 * 24 * 60 * 60 * 1000, 'failed');
  } catch (err) {
    console.error('Error cleaning queue:', err.message);
  }
}

module.exports = {
  encodingQueue,
  addEncodingJob,
  updateEncodingStatus,
  getEncodingStatus,
  getQueueStats,
  cleanQueue
};
