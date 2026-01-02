import os
import json
import base64
import requests
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
from io import BytesIO
from PIL import Image
import insightface
from insightface.app import FaceAnalysis

app = Flask(__name__)
CORS(app)

ENCODINGS_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'encodings')
STATUS_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'status')
os.makedirs(ENCODINGS_DIR, exist_ok=True)
os.makedirs(STATUS_DIR, exist_ok=True)

# Initialize InsightFace model (ArcFace)
print("Loading InsightFace model...")
face_app = FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])
face_app.prepare(ctx_id=0, det_size=(640, 640))
print("InsightFace model loaded!")

def get_encoding_path(album_id):
    return os.path.join(ENCODINGS_DIR, f'album_{album_id}.json')

def get_status_path(album_id):
    return os.path.join(STATUS_DIR, f'album_{album_id}.json')

def update_status(album_id, status, processed=0, total=0, faces=0, error=None):
    """Cập nhật trạng thái encoding"""
    status_data = {
        'album_id': album_id,
        'status': status,
        'processed_photos': processed,
        'total_photos': total,
        'total_faces': faces,
        'error': error,
        'updated_at': __import__('datetime').datetime.now().isoformat()
    }
    with open(get_status_path(album_id), 'w') as f:
        json.dump(status_data, f)
    return status_data

def load_image_from_url(url):
    """Tải ảnh từ URL và convert sang numpy array"""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
        response = requests.get(url, timeout=30, headers=headers, allow_redirects=True)
        response.raise_for_status()
        img = Image.open(BytesIO(response.content))
        img = img.convert('RGB')
        return np.array(img)
    except Exception as e:
        print(f"Error loading image from {url}: {e}")
        return None

def load_image_from_base64(base64_string):
    """Decode base64 image và convert sang numpy array"""
    try:
        if ',' in base64_string:
            base64_string = base64_string.split(',')[1]
        image_data = base64.b64decode(base64_string)
        img = Image.open(BytesIO(image_data))
        img = img.convert('RGB')
        return np.array(img)
    except Exception as e:
        print(f"Error decoding base64 image: {e}")
        return None

def get_face_embedding(image):
    """Lấy face embedding từ ảnh sử dụng InsightFace"""
    faces = face_app.get(image)
    if not faces:
        return None
    # Trả về embedding của khuôn mặt lớn nhất
    largest_face = max(faces, key=lambda x: (x.bbox[2] - x.bbox[0]) * (x.bbox[3] - x.bbox[1]))
    return largest_face.embedding

def get_all_face_embeddings(image):
    """Lấy tất cả face embeddings từ ảnh"""
    faces = face_app.get(image)
    return [face.embedding for face in faces] if faces else []

def cosine_similarity(emb1, emb2):
    """Tính cosine similarity giữa 2 embeddings"""
    return np.dot(emb1, emb2) / (np.linalg.norm(emb1) * np.linalg.norm(emb2))

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'service': 'face-recognition-insightface', 'model': 'buffalo_l (ArcFace)'})

@app.route('/encoding-status/<album_id>', methods=['GET'])
def get_encoding_status(album_id):
    """Lấy trạng thái encoding của album"""
    status_path = get_status_path(album_id)
    if os.path.exists(status_path):
        with open(status_path, 'r') as f:
            return jsonify(json.load(f))
    
    # Kiểm tra xem đã có encoding file chưa
    encoding_path = get_encoding_path(album_id)
    if os.path.exists(encoding_path):
        with open(encoding_path, 'r') as f:
            encodings = json.load(f)
        return jsonify({
            'album_id': album_id,
            'status': 'completed',
            'total_faces': len(encodings),
            'processed_photos': 0,
            'total_photos': 0
        })
    
    return jsonify({
        'album_id': album_id,
        'status': 'not_started',
        'total_faces': 0
    })

@app.route('/encode-album', methods=['POST'])
def encode_album():
    """Pre-process album: tạo face embeddings cho tất cả ảnh trong album"""
    data = request.json
    album_id = data.get('album_id')
    photos = data.get('photos', [])
    
    if not album_id or not photos:
        return jsonify({'error': 'Missing album_id or photos'}), 400
    
    encodings = []
    processed = 0
    failed = 0
    
    print(f"Encoding album {album_id} with {len(photos)} photos...")
    
    # Initialize status
    update_status(album_id, 'encoding', 0, len(photos), 0)
    
    for i, photo in enumerate(photos):
        photo_id = photo.get('id')
        url = photo.get('url')
        
        if not url:
            failed += 1
            update_status(album_id, 'encoding', i + 1, len(photos), len(encodings))
            continue
            
        image = load_image_from_url(url)
        if image is None:
            failed += 1
            update_status(album_id, 'encoding', i + 1, len(photos), len(encodings))
            continue
        
        try:
            embeddings = get_all_face_embeddings(image)
            
            for emb in embeddings:
                encodings.append({
                    'photo_id': photo_id,
                    'embedding': emb.tolist()
                })
            
            if embeddings:
                processed += 1
            else:
                failed += 1
                
            # Update status every photo
            update_status(album_id, 'encoding', i + 1, len(photos), len(encodings))
                
            if (i + 1) % 10 == 0:
                print(f"  Progress: {i + 1}/{len(photos)} photos, {len(encodings)} faces found")
                
        except Exception as e:
            print(f"Error encoding photo {photo_id}: {e}")
            failed += 1
            update_status(album_id, 'encoding', i + 1, len(photos), len(encodings))
    
    # Save encodings
    encoding_path = get_encoding_path(album_id)
    with open(encoding_path, 'w') as f:
        json.dump(encodings, f)
    
    # Update final status
    update_status(album_id, 'completed', len(photos), len(photos), len(encodings))
    
    print(f"Album {album_id} encoding complete: {processed} processed, {failed} failed, {len(encodings)} faces")
    
    return jsonify({
        'success': True,
        'album_id': album_id,
        'processed': processed,
        'failed': failed,
        'total_faces': len(encodings)
    })

@app.route('/search', methods=['POST'])
def search_faces():
    """Tìm ảnh có mặt người dùng trong album"""
    data = request.json
    album_id = data.get('album_id')
    image_base64 = data.get('image')
    threshold = data.get('threshold', 0.4)  # Cosine similarity threshold (higher = stricter)
    
    if not album_id or not image_base64:
        return jsonify({'error': 'Missing album_id or image'}), 400
    
    encoding_path = get_encoding_path(album_id)
    if not os.path.exists(encoding_path):
        return jsonify({'error': 'Album chưa được xử lý. Vui lòng sync album trước.'}), 400
    
    with open(encoding_path, 'r') as f:
        album_encodings = json.load(f)
    
    if not album_encodings:
        return jsonify({'error': 'Album không có ảnh nào có khuôn mặt'}), 400
    
    # Load user image
    user_image = load_image_from_base64(image_base64)
    if user_image is None:
        return jsonify({'error': 'Không thể đọc ảnh'}), 400
    
    # Get user face embedding
    try:
        user_embedding = get_face_embedding(user_image)
        if user_embedding is None:
            return jsonify({'error': 'Không tìm thấy khuôn mặt trong ảnh'}), 400
        
        print(f"User face detected, searching in {len(album_encodings)} face encodings...")
    except Exception as e:
        return jsonify({'error': f'Lỗi nhận diện: {str(e)}'}), 500
    
    # Search for matches
    matched_photo_ids = set()
    max_similarity = 0.0
    
    for item in album_encodings:
        photo_id = item['photo_id']
        embedding = np.array(item['embedding'])
        
        similarity = cosine_similarity(user_embedding, embedding)
        max_similarity = max(max_similarity, similarity)
        
        if similarity > threshold:
            matched_photo_ids.add(photo_id)
    
    print(f"Search result: {len(matched_photo_ids)} matches, max_similarity: {max_similarity:.3f}, threshold: {threshold}")
    
    return jsonify({
        'success': True,
        'matched_photo_ids': list(matched_photo_ids),
        'total_matches': len(matched_photo_ids),
        'max_similarity': round(float(max_similarity), 3)
    })

@app.route('/detect', methods=['POST'])
def detect_face():
    """Kiểm tra xem ảnh có khuôn mặt không"""
    data = request.json
    image_base64 = data.get('image')
    
    if not image_base64:
        return jsonify({'error': 'Missing image'}), 400
    
    image = load_image_from_base64(image_base64)
    if image is None:
        return jsonify({'error': 'Không thể đọc ảnh'}), 400
    
    try:
        faces = face_app.get(image)
        return jsonify({
            'success': True,
            'face_count': len(faces),
            'has_face': len(faces) > 0
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("🔍 Face Recognition API (InsightFace/ArcFace) starting...")
    print("📍 Endpoints:")
    print("   POST /encode-album - Pre-process album faces")
    print("   POST /search - Search for matching faces")
    print("   POST /detect - Detect faces in image")
    app.run(host='0.0.0.0', port=5001, debug=False)
