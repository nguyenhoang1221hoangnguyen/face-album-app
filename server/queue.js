const Queue = require('bull');
const { getCache, setCache, deleteCache, CACHE_KEYS, CACHE_TTL } = require('./redis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Create queues
const encodingQueue = new Queue('face-encoding', REDIS_URL, {
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

// Add job to queue
async function addEncodingJob(albumId, photos) {
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

// Update encoding status in Redis
async function updateEncodingStatus(albumId, status, data = {}) {
  const statusData = {
    album_id: albumId,
    status,
    ...data,
    updated_at: new Date().toISOString()
  };
  
  await setCache(
    CACHE_KEYS.ENCODING_STATUS(albumId),
    statusData,
    CACHE_TTL.STATUS
  );
  
  return statusData;
}

// Get encoding status
async function getEncodingStatus(albumId) {
  const cached = await getCache(CACHE_KEYS.ENCODING_STATUS(albumId));
  if (cached) return cached;
  
  return {
    album_id: albumId,
    status: 'not_started',
    total_faces: 0
  };
}

// Get queue stats
async function getQueueStats() {
  const [waiting, active, completed, failed] = await Promise.all([
    encodingQueue.getWaitingCount(),
    encodingQueue.getActiveCount(),
    encodingQueue.getCompletedCount(),
    encodingQueue.getFailedCount()
  ]);
  
  return { waiting, active, completed, failed };
}

// Clean old jobs
async function cleanQueue() {
  await encodingQueue.clean(24 * 60 * 60 * 1000, 'completed');
  await encodingQueue.clean(7 * 24 * 60 * 60 * 1000, 'failed');
}

module.exports = {
  encodingQueue,
  addEncodingJob,
  updateEncodingStatus,
  getEncodingStatus,
  getQueueStats,
  cleanQueue
};
