# 📸 Face Album App

> Web app tìm ảnh cá nhân theo khuôn mặt từ Google Drive

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![Python](https://img.shields.io/badge/python-%3E%3D3.9-blue.svg)

## 🎯 Tổng quan

Face Album là ứng dụng web cho phép người dùng tìm ảnh của mình trong album ảnh lớn bằng công nghệ nhận diện khuôn mặt. Phù hợp cho:

- 📷 **Photographers** - Chia sẻ ảnh sự kiện, khách hàng tự tìm ảnh của mình
- 🎉 **Event Organizers** - Tiệc cưới, hội nghị, sự kiện
- 🏫 **Trường học** - Ảnh lễ tốt nghiệp, hoạt động ngoại khóa
- 🏢 **Doanh nghiệp** - Ảnh team building, sự kiện công ty

## ✨ Tính năng

### Người dùng
- 🔍 Tìm ảnh bằng camera hoặc upload ảnh selfie
- 📥 Tải từng ảnh riêng lẻ
- 🔒 Truy cập album riêng tư bằng mật khẩu
- 📱 Giao diện responsive, hoạt động trên mobile

### Quản trị viên
- ➕ Tạo album từ link Google Drive public
- 🔄 Đồng bộ ảnh tự động với progress bar
- 🔐 Thiết lập album public/private
- 📊 Theo dõi trạng thái xử lý face encoding

## 🛠 Công nghệ

| Component | Technology |
|-----------|------------|
| **Backend** | Node.js, Express.js |
| **Face Recognition** | Python, Flask, InsightFace (ArcFace) |
| **Database** | SQLite |
| **Frontend** | Vanilla JavaScript, CSS3 |
| **Authentication** | JWT, bcrypt |

## 📋 Yêu cầu hệ thống

- Node.js >= 18.0.0
- Python >= 3.9
- RAM >= 4GB (cho model InsightFace)
- Disk >= 2GB

## 🚀 Cài đặt

### Cách 1: Docker (Khuyến nghị)

```bash
# Clone repository
git clone https://github.com/your-username/face-album-app.git
cd face-album-app

# Tạo file .env
cp .env.example .env
# Sửa GOOGLE_API_KEY và các config khác

# Chạy với Docker Compose
docker-compose up -d

# Truy cập
# Web: http://localhost:3000
# Admin: http://localhost:3000/admin
```

### Cách 2: Cài đặt thủ công

#### 1. Clone và cài dependencies

```bash
git clone https://github.com/your-username/face-album-app.git
cd face-album-app

# Node.js dependencies
npm install

# Python virtual environment
python3 -m venv venv
source venv/bin/activate  # Linux/Mac
# hoặc: venv\Scripts\activate  # Windows

pip install flask flask-cors pillow numpy requests insightface onnxruntime
```

#### 2. Cấu hình

```bash
cp .env.example .env
```

Sửa file `.env`:

```env
# JWT Secret (đổi thành chuỗi ngẫu nhiên)
JWT_SECRET=your-super-secret-key-change-this

# Tài khoản admin
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password

# Google API Key (BẮT BUỘC)
GOOGLE_API_KEY=your-google-api-key

# Face API URL
FACE_API_URL=http://localhost:5001
```

#### 3. Lấy Google API Key

1. Vào [Google Cloud Console](https://console.cloud.google.com/)
2. Tạo project mới hoặc chọn project có sẵn
3. Bật **Google Drive API**: APIs & Services > Enable APIs
4. Tạo API Key: APIs & Services > Credentials > Create Credentials > API Key
5. Copy API Key vào file `.env`

#### 4. Chạy ứng dụng

```bash
# Sử dụng script (khuyến nghị)
chmod +x start.sh
./start.sh

# Hoặc chạy thủ công
# Terminal 1 - Python Face API:
source venv/bin/activate
python python/face_api.py

# Terminal 2 - Node.js Server:
npm start
```

## 📖 Hướng dẫn sử dụng

### Trang Admin (`/admin`)

1. Đăng nhập với tài khoản admin
2. Click **"Tạo Album"**
3. Nhập tên, mô tả, link Google Drive folder
4. Chọn **"Album riêng tư"** nếu cần bảo mật
5. Click **"Sync"** để đồng bộ ảnh và xử lý face encoding

### Trang User (`/`)

1. Chọn album muốn xem
2. Nhập mật khẩu nếu album riêng tư
3. Chọn cách tìm ảnh:
   - **Quét camera**: Cho phép camera quét mặt
   - **Upload ảnh**: Tải lên ảnh selfie
4. Xem và tải ảnh tìm được

## 📁 Cấu trúc dự án

```
face-album-app/
├── server/
│   ├── server.js           # Express server chính
│   ├── database.js         # SQLite setup & migrations
│   ├── routes/
│   │   ├── auth.js         # Authentication APIs
│   │   └── albums.js       # Album CRUD APIs
│   └── middleware/
│       └── auth.js         # JWT middleware
├── public/
│   ├── index.html          # Trang chủ (user)
│   ├── admin.html          # Trang admin
│   ├── album.html          # Xem album + face search
│   └── css/
│       └── style.css       # Styles
├── python/
│   ├── face_api.py         # Flask API nhận diện khuôn mặt
│   └── encode_album.py     # Script encode album thủ công
├── data/
│   ├── encodings/          # Face embeddings đã encode
│   └── status/             # Trạng thái encoding
├── docker/
│   ├── Dockerfile.node     # Dockerfile cho Node.js
│   └── Dockerfile.python   # Dockerfile cho Python
├── .env.example            # Mẫu cấu hình
├── docker-compose.yml      # Docker Compose config
├── package.json
└── README.md
```

## 🔌 API Reference

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Đăng nhập admin |
| POST | `/api/auth/change-password` | Đổi mật khẩu |

### Albums

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/albums` | Danh sách albums |
| GET | `/api/albums/:id` | Chi tiết album |
| GET | `/api/albums/:id/photos` | Ảnh trong album |
| GET | `/api/albums/:id/encoding-status` | Trạng thái encoding |
| POST | `/api/albums` | Tạo album *(auth)* |
| POST | `/api/albums/:id/sync` | Đồng bộ ảnh *(auth)* |
| POST | `/api/albums/:id/search` | Tìm ảnh theo khuôn mặt |
| POST | `/api/albums/:id/verify-password` | Xác thực mật khẩu album |
| PUT | `/api/albums/:id` | Cập nhật album *(auth)* |
| DELETE | `/api/albums/:id` | Xóa album *(auth)* |

### Face API (Python - Port 5001)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/encoding-status/:album_id` | Trạng thái encoding |
| POST | `/encode-album` | Encode faces cho album |
| POST | `/search` | Tìm ảnh matching |
| POST | `/detect` | Detect faces trong ảnh |

---

## 🗺 Lộ trình phát triển (Roadmap)

### 📍 Phase 1: MVP (Hoàn thành ✅)

- [x] Tạo/quản lý album từ Google Drive
- [x] Nhận diện khuôn mặt với InsightFace
- [x] Tìm ảnh bằng camera/upload
- [x] Album public/private với password
- [x] Download từng ảnh
- [x] Progress bar encoding realtime
- [x] UI responsive

### 📍 Phase 2: Performance & Security (Q1 2026)

- [ ] **Redis cache** - Cache face encodings trong RAM
- [ ] **Bull queue** - Background job cho encoding
- [ ] **Rate limiting** - Chống spam API
- [ ] **Input validation** - Validate với Joi/Zod
- [ ] **Server-side pagination** - Tối ưu load ảnh
- [ ] **Compression** - Gzip/Brotli response

### 📍 Phase 3: Features Enhancement (Q2 2026)

- [ ] **Multi-face search** - Tìm nhiều người cùng lúc
- [ ] **Face grouping** - Gom ảnh theo người
- [ ] **Share link** - Chia sẻ album qua link
- [ ] **Watermark** - Đóng watermark ảnh
- [ ] **Download ZIP** - Tải nhiều ảnh thành ZIP
- [ ] **QR Code** - Tạo QR cho album

### 📍 Phase 4: Scale & Integration (Q3 2026)

- [ ] **PostgreSQL** - Migrate từ SQLite
- [ ] **S3/Cloudflare R2** - Lưu ảnh trên cloud
- [ ] **Multi-storage** - Dropbox, OneDrive support
- [ ] **OAuth** - Google, Facebook login
- [ ] **Webhook** - Notify khi có ảnh mới
- [ ] **API Rate Plans** - Giới hạn theo plan

### 📍 Phase 5: Monetization (Q4 2026)

- [ ] **Payment integration** - Stripe, VNPay
- [ ] **Download có phí** - Tính tiền per download
- [ ] **Subscription plans** - Gói tháng/năm
- [ ] **White-label** - Custom branding
- [ ] **Analytics dashboard** - Thống kê sử dụng
- [ ] **Multi-tenant** - Nhiều photographers

---

## ⚡ Performance Optimization

### Đã áp dụng
- ✅ Lazy loading ảnh
- ✅ Pagination client-side
- ✅ SQLite với index

### Cần cải thiện
```
┌────────────────────────────────────────────────────────┐
│  Priority 1 (High Impact)                              │
│  ├── Redis cache cho encodings                         │
│  ├── Bull queue cho background jobs                    │
│  └── Server-side pagination                            │
│                                                        │
│  Priority 2 (Medium Impact)                            │
│  ├── CDN cho static files                              │
│  ├── Response compression                              │
│  └── Database connection pooling                       │
│                                                        │
│  Priority 3 (Future)                                   │
│  ├── Migrate to PostgreSQL                             │
│  ├── Kubernetes deployment                             │
│  └── Multi-region support                              │
└────────────────────────────────────────────────────────┘
```

---

## 🐛 Known Issues

1. **Google Drive URL expiry** - Thumbnail URLs có thể hết hạn sau 24h
2. **Large albums** - Albums >1000 ảnh có thể encoding chậm
3. **Memory usage** - InsightFace model cần ~2GB RAM

## 🤝 Contributing

1. Fork repository
2. Tạo branch: `git checkout -b feature/amazing-feature`
3. Commit: `git commit -m 'Add amazing feature'`
4. Push: `git push origin feature/amazing-feature`
5. Tạo Pull Request

## 📄 License

MIT License - xem [LICENSE](LICENSE) để biết thêm chi tiết.

## 👨‍💻 Author

**Your Name**
- GitHub: [@your-username](https://github.com/your-username)
- Email: your-email@example.com

---

<p align="center">
  Made with ❤️ in Vietnam
</p>
