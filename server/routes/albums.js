const express = require('express');
const { google } = require('googleapis');
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const authMiddleware = require('../middleware/auth');
const { searchLimiter, syncLimiter, passwordLimiter } = require('../middleware/rateLimiter');
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
    
    const photosResponse = await drive.files.list({
      q: `'${currentFolderId}' in parents and mimeType contains 'image/'`,
      fields: 'files(id, name, thumbnailLink, webContentLink)',
      pageSize: 1000,
      key: apiKey
    });

    const photos = photosResponse.data.files.map(file => ({
      drive_file_id: file.id,
      name: file.name,
      thumbnail_url: file.thumbnailLink,
      full_url: `https://drive.google.com/uc?export=view&id=${file.id}`,
      folder: folderName
    }));
    
    console.log(`  Found ${photos.length} photos in ${folderName}`);
    allPhotos = allPhotos.concat(photos);

    if (includeSubfolders) {
      const foldersResponse = await drive.files.list({
        q: `'${currentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder'`,
        fields: 'files(id, name)',
        pageSize: 100,
        key: apiKey
      });

      const subfolders = foldersResponse.data.files;
      console.log(`  Found ${subfolders.length} subfolders in ${folderName}`);

      for (const subfolder of subfolders) {
        await fetchFromFolder(subfolder.id, subfolder.name);
      }
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
  
  // Direct call to Face API
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
      })
    });
    const result = await response.json();
    console.log(`Face encoding completed for album ${albumId}:`, result);
    
    // Invalidate cache
    await deleteCache(CACHE_KEYS.ALBUM_ENCODINGS(albumId));
    
    return result;
  } catch (err) {
    console.error('Error encoding faces:', err.message);
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

// GET photos in album
router.get('/:id/photos', async (req, res) => {
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

  // Try cache first
  const cacheKey = CACHE_KEYS.ALBUM_PHOTOS(req.params.id);
  const cached = await getCache(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  const photos = db.prepare('SELECT * FROM photos WHERE album_id = ?').all(req.params.id);
  
  // Cache for 1 hour
  await setCache(cacheKey, photos, CACHE_TTL.PHOTOS);
  
  res.json(photos);
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
        
        const insertPhoto = db.prepare(`
          INSERT INTO photos (album_id, drive_file_id, name, thumbnail_url, full_url) 
          VALUES (?, ?, ?, ?, ?)
        `);

        const insertedPhotos = [];
        for (const photo of photos) {
          const photoResult = insertPhoto.run(albumId, photo.drive_file_id, photo.name, photo.thumbnail_url, photo.full_url);
          insertedPhotos.push({ id: photoResult.lastInsertRowid, full_url: photo.full_url, thumbnail_url: photo.thumbnail_url });
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

// POST sync album
router.post('/:id/sync', authMiddleware, syncLimiter, async (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!album) {
    return res.status(404).json({ error: 'Album không tồn tại' });
  }

  if (!process.env.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY === 'your-google-api-key') {
    return res.status(400).json({ error: 'Chưa cấu hình Google API Key' });
  }

  try {
    db.prepare('DELETE FROM photos WHERE album_id = ?').run(album.id);

    const photos = await fetchDrivePhotos(album.drive_folder_id, process.env.GOOGLE_API_KEY);
    
    const insertPhoto = db.prepare(`
      INSERT INTO photos (album_id, drive_file_id, name, thumbnail_url, full_url) 
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertedPhotos = [];
    for (const photo of photos) {
      const photoResult = insertPhoto.run(album.id, photo.drive_file_id, photo.name, photo.thumbnail_url, photo.full_url);
      insertedPhotos.push({ id: photoResult.lastInsertRowid, full_url: photo.full_url, thumbnail_url: photo.thumbnail_url });
    }

    if (photos.length > 0) {
      db.prepare('UPDATE albums SET thumbnail = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(photos[0].thumbnail_url, album.id);
    }

    // Invalidate cache
    await deleteCache(CACHE_KEYS.ALBUM_PHOTOS(album.id));
    await deleteCache(CACHE_KEYS.ALBUM_ENCODINGS(album.id));

    // Start face encoding (async)
    encodeFacesForAlbum(album.id, insertedPhotos).then(result => {
      console.log(`Album ${album.id} face encoding:`, result);
    }).catch(err => {
      console.error(`Album ${album.id} face encoding error:`, err);
    });
    
    res.json({ 
      message: `Đã đồng bộ ${photos.length} ảnh. Đang xử lý nhận diện khuôn mặt...`,
      photo_count: photos.length
    });
  } catch (err) {
    console.error('Error syncing:', err);
    res.status(500).json({ error: 'Lỗi đồng bộ: ' + err.message });
  }
});

// POST search faces
router.post('/:id/search', searchLimiter, validate(searchSchema), async (req, res) => {
  const { image } = req.body;
  const albumId = req.params.id;

  try {
    const response = await fetch(`${FACE_API_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        album_id: albumId,
        image: image,
        tolerance: 0.5
      })
    });

    const result = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(result);
    }

    if (result.matched_photo_ids && result.matched_photo_ids.length > 0) {
      const placeholders = result.matched_photo_ids.map(() => '?').join(',');
      const photos = db.prepare(`SELECT * FROM photos WHERE id IN (${placeholders})`).all(...result.matched_photo_ids);
      return res.json({ photos, total: photos.length });
    }

    res.json({ photos: [], total: 0 });
  } catch (err) {
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
