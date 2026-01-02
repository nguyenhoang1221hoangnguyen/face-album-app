# 🚀 Hướng dẫn Deploy Face Album App

## Mục lục
- [Deploy với Coolify](#deploy-với-coolify)
- [Deploy với Docker Compose](#deploy-với-docker-compose)
- [Deploy thủ công](#deploy-thủ-công)
- [Environment Variables](#environment-variables)
- [Lấy Google API Key](#lấy-google-api-key)
- [Troubleshooting](#troubleshooting)

---

## Deploy với Coolify

[Coolify](https://coolify.io/) là nền tảng self-hosted PaaS giúp deploy ứng dụng dễ dàng như Heroku/Vercel.

### Yêu cầu Server
- **CPU**: 2+ cores
- **RAM**: 4GB+ (Face Recognition cần nhiều RAM)
- **Storage**: 30GB+
- **OS**: Ubuntu 20.04/22.04/24.04 LTS

### Bước 1: Cài đặt Coolify

SSH vào server và chạy:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```

Sau khi cài xong, truy cập `http://your-server-ip:8000` để tạo tài khoản admin.

### Bước 2: Thêm Server

1. Vào **Servers** → **Add Server**
2. Chọn **localhost** (nếu deploy trên cùng server với Coolify)
3. Hoặc thêm server remote qua SSH

### Bước 3: Tạo Project

1. **Projects** → **Add Project**
2. Đặt tên: `Face Album App`

### Bước 4: Deploy từ Git Repository

1. Vào Project vừa tạo → **Add Resource**
2. Chọn **Docker Compose**
3. Chọn **Git Repository** → **Public Repository**
4. Nhập URL: `https://github.com/nguyenhoang1221hoangnguyen/face-album-app`
5. Branch: `main`

### Bước 5: Thiết lập Environment Variables

Trong phần **Environment Variables**, thêm:

```env
JWT_SECRET=thay-bang-chuoi-ngau-nhien-dai-32-ky-tu-tro-len
ADMIN_USERNAME=admin
ADMIN_PASSWORD=mat-khau-manh-cua-ban
GOOGLE_API_KEY=AIzaSy-your-google-api-key
NODE_ENV=production
PORT=3000
```

### Bước 6: Deploy

1. Click **Deploy**
2. Đợi build hoàn tất (lần đầu có thể mất 5-10 phút do tải InsightFace model)
3. Truy cập URL được Coolify cung cấp

### Bước 7: Cấu hình Domain (Tùy chọn)

1. Vào **Settings** của ứng dụng
2. Thêm domain: `face-app.yourdomain.com`
3. Coolify tự động cấp SSL qua Let's Encrypt

---

## Deploy với Docker Compose

### Yêu cầu
- Docker Engine 20.10+
- Docker Compose v2+
- 4GB RAM+

### Bước 1: Clone repository

```bash
git clone https://github.com/nguyenhoang1221hoangnguyen/face-album-app.git
cd face-album-app
```

### Bước 2: Tạo file .env

```bash
cp .env.example .env
```

Chỉnh sửa file `.env`:

```env
JWT_SECRET=your-random-secret-key-at-least-32-characters
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-strong-password
GOOGLE_API_KEY=AIzaSy-your-google-api-key
NODE_ENV=production
```

### Bước 3: Build và chạy

```bash
docker compose up -d --build
```

### Bước 4: Kiểm tra

```bash
# Xem logs
docker compose logs -f

# Kiểm tra health
curl http://localhost:3000/health
```

Truy cập:
- **Web App**: http://localhost:3000
- **Admin Panel**: http://localhost:3000/admin

### Dừng ứng dụng

```bash
docker compose down
```

### Xóa dữ liệu và build lại

```bash
docker compose down -v
docker compose up -d --build
```

---

## Deploy thủ công

### Yêu cầu
- Node.js 18+
- Python 3.9+
- Redis (tùy chọn)

### Bước 1: Clone và cài đặt

```bash
git clone https://github.com/nguyenhoang1221hoangnguyen/face-album-app.git
cd face-album-app

# Cài Node.js dependencies
npm install

# Tạo Python virtual environment
python3 -m venv venv
source venv/bin/activate

# Cài Python dependencies
pip install -r python/requirements.txt
```

### Bước 2: Cấu hình

```bash
cp .env.example .env
# Chỉnh sửa .env với các giá trị phù hợp
```

### Bước 3: Chạy

**Terminal 1 - Python Face API:**
```bash
source venv/bin/activate
python python/face_api.py
```

**Terminal 2 - Node.js Server:**
```bash
npm start
```

### Sử dụng PM2 (Production)

```bash
# Cài PM2
npm install -g pm2

# Chạy Python API
pm2 start python/face_api.py --interpreter python3 --name face-api

# Chạy Node.js
pm2 start server/server.js --name face-web

# Lưu và tự động khởi động
pm2 save
pm2 startup
```

---

## Environment Variables

| Biến | Bắt buộc | Mặc định | Mô tả |
|------|----------|----------|-------|
| `JWT_SECRET` | ✅ | - | Chuỗi ngẫu nhiên để mã hóa JWT token (32+ ký tự) |
| `ADMIN_USERNAME` | ✅ | `admin` | Tên đăng nhập admin panel |
| `ADMIN_PASSWORD` | ✅ | - | Mật khẩu admin panel |
| `GOOGLE_API_KEY` | ✅ | - | API Key từ Google Cloud Console |
| `PORT` | ❌ | `3000` | Port cho web server |
| `NODE_ENV` | ❌ | `development` | Môi trường (`production` khi deploy) |
| `FACE_API_URL` | ❌ | `http://localhost:5001` | URL của Python Face API |
| `REDIS_URL` | ❌ | `redis://localhost:6379` | URL Redis server |
| `USE_QUEUE` | ❌ | `false` | Bật background queue processing |

### Biến cho Docker Compose

Khi dùng Docker Compose, các biến sau được tự động thiết lập:
- `FACE_API_URL=http://face-api:5001`
- `REDIS_URL=redis://redis:6379`

---

## Lấy Google API Key

### Bước 1: Tạo Google Cloud Project

1. Truy cập [Google Cloud Console](https://console.cloud.google.com/)
2. Click **Select a project** → **New Project**
3. Đặt tên project → **Create**

### Bước 2: Bật Google Drive API

1. Vào **APIs & Services** → **Library**
2. Tìm **Google Drive API**
3. Click **Enable**

### Bước 3: Tạo API Key

1. Vào **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **API Key**
3. Copy API Key

### Bước 4: Giới hạn API Key (Khuyến nghị)

1. Click vào API Key vừa tạo
2. Trong **API restrictions**, chọn **Restrict key**
3. Chọn **Google Drive API**
4. **Save**

### Lưu ý quan trọng

⚠️ **Google Drive folder phải được chia sẻ công khai** (Anyone with the link can view) để ứng dụng có thể truy cập.

---

## Troubleshooting

### Lỗi: "Face Recognition API không khả dụng"

**Nguyên nhân**: Python Face API chưa chạy hoặc chưa sẵn sàng.

**Giải pháp**:
```bash
# Kiểm tra logs Python API
docker compose logs face-api

# Hoặc nếu chạy thủ công
python python/face_api.py
```

Lần đầu chạy, InsightFace sẽ tải model (~300MB), có thể mất vài phút.

### Lỗi: "Album không có ảnh"

**Nguyên nhân**: Google Drive folder không public hoặc API Key sai.

**Giải pháp**:
1. Kiểm tra folder đã được share "Anyone with the link"
2. Kiểm tra Google API Key trong `.env`
3. Kiểm tra Google Drive API đã được bật

### Lỗi: "Không tìm thấy khuôn mặt"

**Nguyên nhân**: Ảnh upload không có khuôn mặt rõ ràng.

**Giải pháp**:
- Dùng ảnh có khuôn mặt rõ ràng, không bị che
- Ánh sáng đủ, không quá tối
- Khuôn mặt chiếm ít nhất 10% diện tích ảnh

### Lỗi: Out of Memory

**Nguyên nhân**: Server không đủ RAM cho Face Recognition.

**Giải pháp**:
```yaml
# Trong docker-compose.yml, giảm memory limit
deploy:
  resources:
    limits:
      memory: 2G
    reservations:
      memory: 1G
```

Hoặc nâng cấp server lên 4GB+ RAM.

### Lỗi: Thumbnail không hiển thị

**Nguyên nhân**: Google Drive thumbnail URL hết hạn.

**Giải pháp**: Đã được fix trong code mới - sử dụng `drive_file_id` thay vì `thumbnail_url`.

---

## Liên hệ hỗ trợ

Nếu gặp vấn đề, vui lòng tạo Issue trên GitHub:
https://github.com/nguyenhoang1221hoangnguyen/face-album-app/issues

---

## License

MIT License - Xem file [LICENSE](LICENSE) để biết thêm chi tiết.
