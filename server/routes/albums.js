const express = require('express');
const { google } = require('googleapis');
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const authMiddleware = require('../middleware/auth');
const { searchLimiter, syncLimiter, passwordLimiter, photosLimiter } = require('../middleware/rateLimiter');
const { validate, createAlbumSchema, updateAlbumSchema, verifyPasswordSchema, searchSchema } = require('../middleware/validator');
const { getCache, setCache, deleteCache, CACHE_KEYS, CACHE_TTL } = require('../redis');
const { addEncodingJob, getEncodingStatus } = require('../queue');

const router = express.Router();

const FACE_API_URL = process.env.FACE_API_URL || 'http://localhost:5001';
const USE_QUEUE = process.env.USE_QUEUE === 'true';

function extractFolderId(driveLink) {
  const patterns = [
    /\/folders\/([a-zA-Z0-9_-]+)/,
    /id=([a-zA-Z0-9_-]+)/,
    /^([a-zA-Z0-9_-]+)$/
  ];
  
  for (const pattern of patterns) {
    const match = driveLink.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function fetchDrivePhotos(folderId, apiKey, includeSubfolders = true) {
  const drive = google.drive({ version: 'v3', auth: apiKey });
  let allPhotos = [];
  
  async function fetchFromFolder(currentFolderId, folderName = 'root') {
    console.log(`Fetching photos from folder: ${folderName} (${currentFolderId})`);
    
    let pageToken = null;
    let folderPhotos = [];
    
    // Fetch all pages of photos
    do {
      const photosResponse = await drive.files.list({
        q: `'${currentFolderId}' in parents and mimeType contains 'image/' and trashed = false`,
        fields: 'nextPageToken, files(id, name, thumbnailLink, webContentLink)',
        pageSize: 1000,
        pageToken: pageToken,
        key: apiKey
      });

      const photos = photosResponse.data.files.map(file => ({
        drive_file_id: file.id,
        name: file.name,
        thumbnail_url: file.thumbnailLink,
        full_url: `https://drive.google.com/uc?export=view&id=${file.id}`,
        folder: folderName
      }));
      
      folderPhotos = folderPhotos.concat(photos);
      pageToken = photosResponse.data.nextPageToken;
      
      console.log(`  Fetched ${photos.length} photos (total: ${folderPhotos.length})`);
    } while (pageToken);
    
    console.log(`  Found ${folderPhotos.length} photos in ${folderName}`);
    allPhotos = allPhotos.concat(folderPhotos);

    if (includeSubfolders) {
      let subfolderToken = null;
      
      do {
        const foldersResponse = await drive.files.list({
          q: `'${currentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'nextPageToken, files(id, name)',
          pageSize: 100,
          pageToken: subfolderToken,
          key: apiKey
        });

        const subfolders = foldersResponse.data.files;
        console.log(`  Found ${subfolders.length} subfolders in ${folderName}`);

        for (const subfolder of subfolders) {
          await fetchFromFolder(subfolder.id, subfolder.name);
        }
        
        subfolderToken = foldersResponse.data.nextPageToken;
      } while (subfolderToken);
    }
  }

  await fetchFromFolder(folderId);
  console.log(`Total photos found: ${allPhotos.length}`);
  
  return allPhotos;
}

async function encodeFacesForAlbum(albumId, photos) {
  if (USE_QUEUE) {
    // Use Bull queue for background processing
    const job = await addEncodingJob(albumId, photos);
    console.log(`Added encoding job ${job.id} for album ${albumId}`);
    return { queued: true, job_id: job.id };
  }
  
  // Direct call to Face API with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes timeout for encoding
  
  try {
    console.log(`Starting face encoding for album ${albumId} with ${photos.length} photos...`);
    const response = await fetch(`${FACE_API_URL}/encode-album`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        album_id: albumId,
        photos: photos.map(p => ({ 
          id: p.id, 
          url: p.thumbnail_url ? p.thumbnail_url.replace('=s220', '=s800') : p.full_url 
        }))
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const result = await response.json();
    console.log(`Face encoding completed for album ${albumId}:`, result);
    
    // Invalidate cache
    await deleteCache(CACHE_KEYS.ALBUM_ENCODINGS(albumId));
    
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.error('Face encoding timeout for album:', albumId);
      return { error: 'Encoding timeout' };
    }
    console.error('Error encoding faces:', err.message);
    return { error: err.message };
  }
}

// Incremental encoding - chỉ encode ảnh mới và merge với encodings cũ
async function encodeNewPhotos(albumId, newPhotos) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes timeout
  
  try {
    console.log(`Starting incremental encoding for album ${albumId} with ${newPhotos.length} new photos...`);
    
    const response = await fetch(`${FACE_API_URL}/encode-incremental`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        album_id: albumId,
        photos: newPhotos.map(p => ({ 
          id: p.id, 
          url: p.thumbnail_url ? p.thumbnail_url.replace('=s220', '=s800') : p.full_url 
        }))
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    const result = await response.json();
    console.log(`Incremental encoding completed for album ${albumId}:`, result);
    
    // Clear cache to reload with new encodings
    await deleteCache(CACHE_KEYS.ALBUM_ENCODINGS(albumId));
    
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.error('Incremental encoding timeout for album:', albumId);
      return { error: 'Encoding timeout' };
    }
    console.error('Error in incremental encoding:', err.message);
    // Fallback to full encoding if incremental fails
    return encodeFacesForAlbum(albumId, newPhotos);
  }
}

// Xóa encodings của các ảnh đã bị xóa
async function removePhotoEncodings(albumId, photoIds) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout
  
  try {
    const response = await fetch(`${FACE_API_URL}/remove-photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        album_id: albumId,
        photo_ids: photoIds
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    const result = await response.json();
    console.log(`Removed encodings for ${photoIds.length} photos:`, result);
    
    await deleteCache(CACHE_KEYS.ALBUM_ENCODINGS(albumId));
    
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.error('Remove encodings timeout for album:', albumId);
      return { error: 'Remove encodings timeout' };
    }
    console.error('Error removing photo encodings:', err.message);
    return { error: err.message };
  }
}

// GET all albums
router.get('/', async (req, res) => {
  const albums = db.prepare(`
    SELECT a.*, COUNT(p.id) as photo_count 
    FROM albums a 
    LEFT JOIN photos p ON a.id = p.album_id 
    GROUP BY a.id 
    ORDER BY a.created_at DESC
  `).all();
  res.json(albums);
});

// GET single album
router.get('/:id', (req, res) => {
  const album = db.prepare('SELECT id, name, description, drive_folder_id, drive_link, thumbnail, is_private, created_at, updated_at FROM albums WHERE id = ?').get(req.params.id);
  if (!album) {
    return res.status(404).json({ error: 'Album không tồn tại' });
  }
  res.json(album);
});

// POST verify album password
router.post('/:id/verify-password', passwordLimiter, validate(verifyPasswordSchema), (req, res) => {
  const { password } = req.body;
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  
  if (!album) {
    return res.status(404).json({ error: 'Album không tồn tại' });
  }

  if (!album.is_private) {
    return res.json({ success: true });
  }

  const validPassword = bcrypt.compareSync(password, album.password);
  if (!validPassword) {
    return res.status(401).json({ error: 'Mật khẩu không đúng' });
  }

  res.json({ success: true });
});

// GET photos in album with pagination
router.get('/:id/photos', photosLimiter, async (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!album) {
    return res.status(404).json({ error: 'Album không tồn tại' });
  }

  // Check password for private albums
  if (album.is_private) {
    const password = req.headers['x-album-password'];
    if (!password || !bcrypt.compareSync(password, album.password)) {
      return res.status(401).json({ error: 'Cần mật khẩu để xem album này' });
    }
  }

  // Pagination params
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 100));
  const offset = (page - 1) * limit;

  // Get total count
  const totalResult = db.prepare('SELECT COUNT(*) as total FROM photos WHERE album_id = ?').get(req.params.id);
  const total = totalResult.total;
  const totalPages = Math.ceil(total / limit);

  // Get paginated photos
  const photos = db.prepare('SELECT * FROM photos WHERE album_id = ? ORDER BY id LIMIT ? OFFSET ?')
    .all(req.params.id, limit, offset);

  res.json({
    photos,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages
    }
  });
});

// GET encoding status
router.get('/:id/encoding-status', async (req, res) => {
  try {
    // Check queue status first
    if (USE_QUEUE) {
      const status = await getEncodingStatus(req.params.id);
      if (status.status !== 'not_started') {
        return res.json(status);
      }
    }
    
    // Fall back to Face API
    const response = await fetch(`${FACE_API_URL}/encoding-status/${req.params.id}`);
    const status = await response.json();
    res.json(status);
  } catch (err) {
    res.json({ status: 'unknown', error: 'Face API không khả dụng' });
  }
});

// POST create album
router.post('/', authMiddleware, validate(createAlbumSchema), async (req, res) => {
  const { name, description, drive_link, is_private, password } = req.body;

  const folderId = extractFolderId(drive_link);
  if (!folderId) {
    return res.status(400).json({ error: 'Link Google Drive không hợp lệ' });
  }

  try {
    const hashedPassword = is_private ? bcrypt.hashSync(password, 10) : null;
    
    const result = db.prepare(`
      INSERT INTO albums (name, description, drive_folder_id, drive_link, is_private, password) 
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, description || '', folderId, drive_link, is_private ? 1 : 0, hashedPassword);

    const albumId = result.lastInsertRowid;

    if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY !== 'your-google-api-key') {
      try {
        const photos = await fetchDrivePhotos(folderId, process.env.GOOGLE_API_KEY);
        
        // Batch insert photos (100 at a time)
        const BATCH_SIZE = 100;
        const insertedPhotos = [];

        const insertManyPhotos = db.transaction((photoBatch, albumIdParam) => {
          const insertPhoto = db.prepare(`
            INSERT INTO photos (album_id, drive_file_id, name, thumbnail_url, full_url) 
            VALUES (?, ?, ?, ?, ?)
          `);
          
          for (const photo of photoBatch) {
            const result = insertPhoto.run(albumIdParam, photo.drive_file_id, photo.name, photo.thumbnail_url, photo.full_url);
            insertedPhotos.push({ id: result.lastInsertRowid, full_url: photo.full_url, thumbnail_url: photo.thumbnail_url });
          }
        });

        // Process in batches
        for (let i = 0; i < photos.length; i += BATCH_SIZE) {
          const batch = photos.slice(i, i + BATCH_SIZE);
          insertManyPhotos(batch, albumId);
          console.log(`Inserted batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(photos.length/BATCH_SIZE)}`);
        }

        if (photos.length > 0) {
          db.prepare('UPDATE albums SET thumbnail = ? WHERE id = ?')
            .run(photos[0].thumbnail_url, albumId);
        }

        // Invalidate photos cache
        await deleteCache(CACHE_KEYS.ALBUM_PHOTOS(albumId));

        // Start face encoding
        encodeFacesForAlbum(albumId, insertedPhotos).then(result => {
          console.log('Face encoding result:', result);
        });
      } catch (err) {
        console.error('Error fetching Drive photos:', err.message);
      }
    }

    const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(albumId);
    res.status(201).json(album);
  } catch (err) {
    console.error('Error creating album:', err);
    res.status(500).json({ error: 'Lỗi tạo album' });
  }
});

// POST sync album (incremental - chỉ thêm ảnh mới, xóa ảnh đã bị xóa khỏi Drive)
router.post('/:id/sync', authMiddleware, syncLimiter, async (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!album) {
    return res.status(404).json({ error: 'Album không tồn tại' });
  }

  if (!process.env.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY === 'your-google-api-key') {
    return res.status(400).json({ error: 'Chưa cấu hình Google API Key' });
  }

  const forceFullSync = req.body.force === true;

  try {
    // Lấy danh sách ảnh từ Google Drive
    const drivePhotos = await fetchDrivePhotos(album.drive_folder_id, process.env.GOOGLE_API_KEY);
    const driveFileIds = new Set(drivePhotos.map(p => p.drive_file_id));
    
    // Lấy danh sách ảnh hiện có trong DB
    const existingPhotos = db.prepare('SELECT id, drive_file_id FROM photos WHERE album_id = ?').all(album.id);
    const existingFileIds = new Set(existingPhotos.map(p => p.drive_file_id));
    
    let added = 0;
    let removed = 0;
    const newPhotos = [];

    if (forceFullSync) {
      // Full sync: xóa hết và tải lại
      db.prepare('DELETE FROM photos WHERE album_id = ?').run(album.id);
      removed = existingPhotos.length;
      
      const insertPhoto = db.prepare(`
        INSERT INTO photos (album_id, drive_file_id, name, thumbnail_url, full_url) 
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const photo of drivePhotos) {
        const result = insertPhoto.run(album.id, photo.drive_file_id, photo.name, photo.thumbnail_url, photo.full_url);
        newPhotos.push({ id: result.lastInsertRowid, full_url: photo.full_url, thumbnail_url: photo.thumbnail_url });
        added++;
      }
    } else {
      // Incremental sync
      // 1. Xóa ảnh không còn trên Drive
      const photosToDelete = existingPhotos.filter(p => !driveFileIds.has(p.drive_file_id));
      if (photosToDelete.length > 0) {
        const deleteIds = photosToDelete.map(p => p.id);
        const placeholders = deleteIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM photos WHERE id IN (${placeholders})`).run(...deleteIds);
        removed = photosToDelete.length;
        console.log(`Removed ${removed} photos that no longer exist on Drive`);
        
        // Xóa encodings của các ảnh đã bị xóa
        removePhotoEncodings(album.id, deleteIds).catch(err => {
          console.error('Error removing photo encodings:', err);
        });
      }

      // 2. Thêm ảnh mới từ Drive
      const photosToAdd = drivePhotos.filter(p => !existingFileIds.has(p.drive_file_id));
      
      if (photosToAdd.length > 0) {
        const insertPhoto = db.prepare(`
          INSERT INTO photos (album_id, drive_file_id, name, thumbnail_url, full_url) 
          VALUES (?, ?, ?, ?, ?)
        `);

        for (const photo of photosToAdd) {
          const result = insertPhoto.run(album.id, photo.drive_file_id, photo.name, photo.thumbnail_url, photo.full_url);
          newPhotos.push({ id: result.lastInsertRowid, full_url: photo.full_url, thumbnail_url: photo.thumbnail_url });
          added++;
        }
        console.log(`Added ${added} new photos from Drive`);
      }
    }

    // Cập nhật thumbnail nếu có ảnh mới
    if (drivePhotos.length > 0) {
      db.prepare('UPDATE albums SET thumbnail = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(drivePhotos[0].thumbnail_url, album.id);
    }

    // Invalidate cache
    await deleteCache(CACHE_KEYS.ALBUM_PHOTOS(album.id));

    // Chỉ encode face cho ảnh mới (nếu có)
    if (newPhotos.length > 0) {
      // Gọi incremental encoding
      encodeNewPhotos(album.id, newPhotos).then(result => {
        console.log(`Album ${album.id} incremental encoding:`, result);
      }).catch(err => {
        console.error(`Album ${album.id} encoding error:`, err);
      });
    }

    const totalPhotos = db.prepare('SELECT COUNT(*) as count FROM photos WHERE album_id = ?').get(album.id).count;
    
    let message = '';
    if (added > 0 && removed > 0) {
      message = `Đã thêm ${added} ảnh mới, xóa ${removed} ảnh cũ. `;
    } else if (added > 0) {
      message = `Đã thêm ${added} ảnh mới. `;
    } else if (removed > 0) {
      message = `Đã xóa ${removed} ảnh không còn tồn tại. `;
    } else {
      message = 'Album đã được cập nhật. Không có thay đổi. ';
    }
    
    if (newPhotos.length > 0) {
      message += 'Đang xử lý nhận diện khuôn mặt cho ảnh mới...';
    }

    res.json({ 
      message,
      total_photos: totalPhotos,
      added,
      removed,
      unchanged: totalPhotos - added
    });
  } catch (err) {
    console.error('Error syncing:', err);
    res.status(500).json({ error: 'Lỗi đồng bộ: ' + err.message });
  }
});

// POST search faces
router.post('/:id/search', searchLimiter, validate(searchSchema), async (req, res) => {
  const { image, threshold } = req.body;
  const albumId = req.params.id;

  // Thêm timeout cho fetch
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

  try {
    const response = await fetch(`${FACE_API_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        album_id: albumId,
        image: image,
        threshold: threshold || 0.4
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const result = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(result);
    }

    if (result.matched_photo_ids && result.matched_photo_ids.length > 0) {
      const placeholders = result.matched_photo_ids.map(() => '?').join(',');
      const photos = db.prepare(`SELECT * FROM photos WHERE id IN (${placeholders})`).all(...result.matched_photo_ids);
      return res.json({ 
        photos, 
        total: photos.length,
        face_bboxes: result.face_bboxes || [],
        search_time_ms: result.search_time_ms,
        search_method: result.search_method,
        max_similarity: result.max_similarity
      });
    }

    res.json({ photos: [], total: 0, face_bboxes: result.face_bboxes || [] });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Timeout: Face API không phản hồi' });
    }
    console.error('Error searching faces:', err);
    res.status(500).json({ error: 'Lỗi tìm kiếm: Face Recognition API không khả dụng' });
  }
});

// PUT update album
router.put('/:id', authMiddleware, validate(updateAlbumSchema), async (req, res) => {
  const { name, description, is_private, password } = req.body;
  
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!album) {
    return res.status(404).json({ error: 'Album không tồn tại' });
  }

  if (is_private && !password && !album.password) {
    return res.status(400).json({ error: 'Album riêng tư cần có mật khẩu' });
  }

  let hashedPassword = album.password;
  if (password) {
    hashedPassword = bcrypt.hashSync(password, 10);
  }
  if (!is_private) {
    hashedPassword = null;
  }

  db.prepare('UPDATE albums SET name = ?, description = ?, is_private = ?, password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(name, description, is_private ? 1 : 0, hashedPassword, req.params.id);
  
  const updatedAlbum = db.prepare('SELECT id, name, description, drive_folder_id, drive_link, thumbnail, is_private, created_at, updated_at FROM albums WHERE id = ?').get(req.params.id);
  res.json(updatedAlbum);
});

// DELETE album
router.delete('/:id', authMiddleware, async (req, res) => {
  // Invalidate cache
  await deleteCache(CACHE_KEYS.ALBUM_PHOTOS(req.params.id));
  await deleteCache(CACHE_KEYS.ALBUM_ENCODINGS(req.params.id));
  
  db.prepare('DELETE FROM albums WHERE id = ?').run(req.params.id);
  res.json({ message: 'Đã xóa album' });
});

module.exports = router;
