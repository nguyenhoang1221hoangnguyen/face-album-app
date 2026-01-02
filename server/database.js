const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    drive_folder_id TEXT NOT NULL,
    drive_link TEXT NOT NULL,
    thumbnail TEXT,
    is_private INTEGER DEFAULT 0,
    password TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER NOT NULL,
    drive_file_id TEXT NOT NULL,
    name TEXT,
    thumbnail_url TEXT,
    full_url TEXT,
    face_descriptors TEXT,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS encoding_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER NOT NULL UNIQUE,
    status TEXT DEFAULT 'pending',
    total_photos INTEGER DEFAULT 0,
    processed_photos INTEGER DEFAULT 0,
    total_faces INTEGER DEFAULT 0,
    started_at DATETIME,
    completed_at DATETIME,
    error TEXT,
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_photos_album ON photos(album_id);
`);

function initAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  
  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (!existing) {
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO admins (username, password) VALUES (?, ?)').run(username, hashedPassword);
    console.log(`Admin account created: ${username}`);
  }
}

module.exports = { db, initAdmin };
