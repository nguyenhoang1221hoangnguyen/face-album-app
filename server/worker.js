require('dotenv').config();
const { encodingQueue, updateEncodingStatus } = require('./queue');
const { setCache, deleteCache, CACHE_KEYS, CACHE_TTL } = require('./redis');

const FACE_API_URL = process.env.FACE_API_URL || 'http://localhost:5001';

console.log('🔧 Starting Face Encoding Worker...');

// Process encoding jobs
encodingQueue.process(async (job) => {
  const { albumId, photos } = job.data;
  
  console.log(`📸 Processing album ${albumId} with ${photos.length} photos`);
  
  try {
    // Update status to encoding
    await updateEncodingStatus(albumId, 'encoding', {
      total_photos: photos.length,
      processed_photos: 0,
      total_faces: 0
    });
    
    // Call Python Face API
    const response = await fetch(`${FACE_API_URL}/encode-album`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        album_id: albumId,
        photos: photos.map(p => ({
          id: p.id,
          url: p.thumbnail_url ? p.thumbnail_url.replace('=s220', '=s800') : p.full_url
        }))
      })
    });
    
    if (!response.ok) {
      throw new Error(`Face API error: ${response.status}`);
    }
    
    const result = await response.json();
    
    // Cache the encodings
    if (result.success) {
      // Fetch and cache encodings
      const encodingsResponse = await fetch(`${FACE_API_URL}/get-encodings/${albumId}`);
      if (encodingsResponse.ok) {
        const encodings = await encodingsResponse.json();
        await setCache(
          CACHE_KEYS.ALBUM_ENCODINGS(albumId),
          encodings,
          CACHE_TTL.ENCODINGS
        );
      }
      
      // Update status to completed
      await updateEncodingStatus(albumId, 'completed', {
        total_photos: photos.length,
        processed_photos: result.processed,
        total_faces: result.total_faces
      });
    }
    
    // Update job progress
    await job.progress(100);
    
    return {
      albumId,
      processed: result.processed,
      failed: result.failed,
      total_faces: result.total_faces
    };
    
  } catch (error) {
    console.error(`❌ Error encoding album ${albumId}:`, error.message);
    
    await updateEncodingStatus(albumId, 'error', {
      error: error.message
    });
    
    throw error;
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('👋 Worker shutting down...');
  await encodingQueue.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('👋 Worker shutting down...');
  await encodingQueue.close();
  process.exit(0);
});

console.log('✅ Worker is ready and waiting for jobs');
