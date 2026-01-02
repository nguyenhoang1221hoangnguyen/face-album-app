import os
import json
import base64
import asyncio
import aiohttp
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
from io import BytesIO
from PIL import Image
import insightface
from insightface.app import FaceAnalysis
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import time

# Try to import FAISS for fast vector search
try:
    import faiss
    FAISS_AVAILABLE = True
    print("✅ FAISS available - fast vector search enabled")
except ImportError:
    FAISS_AVAILABLE = False
    print("⚠️ FAISS not available - using numpy search (slower)")

app = Flask(__name__)
CORS(app)

PORT = int(os.environ.get('PORT', 5001))
MAX_WORKERS = int(os.environ.get('MAX_WORKERS', 4))
BATCH_SIZE = int(os.environ.get('BATCH_SIZE', 10))

ENCODINGS_DIR = os.environ.get('ENCODINGS_DIR', os.path.join(os.path.dirname(__file__), '..', 'data', 'encodings'))
STATUS_DIR = os.environ.get('STATUS_DIR', os.path.join(os.path.dirname(__file__), '..', 'data', 'status'))
os.makedirs(ENCODINGS_DIR, exist_ok=True)
os.makedirs(STATUS_DIR, exist_ok=True)

# Initialize InsightFace model
print("Loading InsightFace model...")
face_app = FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])
face_app.prepare(ctx_id=0, det_size=(640, 640))
print("✅ InsightFace model loaded!")

# In-memory cache for encodings and FAISS indexes
encodings_cache = {}
faiss_indexes = {}
cache_lock = threading.Lock()

def get_encoding_path(album_id):
    return os.path.join(ENCODINGS_DIR, f'album_{album_id}.json')

def get_status_path(album_id):
    return os.path.join(STATUS_DIR, f'album_{album_id}.json')

def update_status(album_id, status, processed=0, total=0, faces=0, error=None, current_photo=None):
    """Update encoding status"""
    status_data = {
        'album_id': album_id,
        'status': status,
        'processed_photos': processed,
        'total_photos': total,
        'total_faces': faces,
        'current_photo': current_photo,
        'progress_percent': round((processed / total * 100) if total > 0 else 0, 1),
        'error': error,
        'updated_at': __import__('datetime').datetime.now().isoformat()
    }
    with open(get_status_path(album_id), 'w') as f:
        json.dump(status_data, f)
    return status_data

def load_image_from_bytes(image_bytes):
    """Convert image bytes to numpy array"""
    try:
        img = Image.open(BytesIO(image_bytes))
        img = img.convert('RGB')
        return np.array(img)
    except Exception as e:
        print(f"Error loading image: {e}")
        return None

def load_image_from_base64(base64_string):
    """Decode base64 image to numpy array"""
    try:
        if ',' in base64_string:
            base64_string = base64_string.split(',')[1]
        image_data = base64.b64decode(base64_string)
        return load_image_from_bytes(image_data)
    except Exception as e:
        print(f"Error decoding base64 image: {e}")
        return None

def get_face_embeddings(image):
    """Get all face embeddings from image"""
    faces = face_app.get(image)
    if not faces:
        return []
    return [(face.embedding, face.bbox.tolist()) for face in faces]

def get_largest_face_embedding(image):
    """Get embedding of largest face"""
    faces = face_app.get(image)
    if not faces:
        return None, None
    largest_face = max(faces, key=lambda x: (x.bbox[2] - x.bbox[0]) * (x.bbox[3] - x.bbox[1]))
    return largest_face.embedding, largest_face.bbox.tolist()

def cosine_similarity(emb1, emb2):
    """Calculate cosine similarity"""
    return float(np.dot(emb1, emb2) / (np.linalg.norm(emb1) * np.linalg.norm(emb2)))

def build_faiss_index(embeddings):
    """Build FAISS index for fast similarity search"""
    if not FAISS_AVAILABLE or len(embeddings) == 0:
        return None
    
    dimension = len(embeddings[0])
    index = faiss.IndexFlatIP(dimension)  # Inner product (cosine similarity for normalized vectors)
    
    # Normalize embeddings for cosine similarity
    embeddings_array = np.array(embeddings).astype('float32')
    faiss.normalize_L2(embeddings_array)
    index.add(embeddings_array)
    
    return index

def load_album_encodings(album_id):
    """Load encodings from cache or file"""
    with cache_lock:
        if album_id in encodings_cache:
            return encodings_cache[album_id]
    
    encoding_path = get_encoding_path(album_id)
    if not os.path.exists(encoding_path):
        return None
    
    with open(encoding_path, 'r') as f:
        encodings = json.load(f)
    
    # Build FAISS index
    if FAISS_AVAILABLE and encodings:
        embeddings = [np.array(e['embedding']) for e in encodings]
        index = build_faiss_index(embeddings)
        with cache_lock:
            faiss_indexes[album_id] = index
    
    with cache_lock:
        encodings_cache[album_id] = encodings
    
    return encodings

async def download_image_async(session, url, photo_id, timeout=15):
    """Download image asynchronously"""
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout), headers=headers) as response:
            if response.status == 200:
                image_bytes = await response.read()
                return photo_id, image_bytes, None
            return photo_id, None, f"HTTP {response.status}"
    except Exception as e:
        return photo_id, None, str(e)

async def download_batch_async(photos):
    """Download multiple images concurrently"""
    async with aiohttp.ClientSession() as session:
        tasks = [download_image_async(session, p['url'], p['id']) for p in photos]
        return await asyncio.gather(*tasks)

def process_image_for_encoding(args):
    """Process single image and extract face embeddings"""
    photo_id, image_bytes = args
    if image_bytes is None:
        return photo_id, [], "No image data"
    
    image = load_image_from_bytes(image_bytes)
    if image is None:
        return photo_id, [], "Failed to load image"
    
    try:
        embeddings_with_bbox = get_face_embeddings(image)
        results = []
        for emb, bbox in embeddings_with_bbox:
            results.append({
                'photo_id': photo_id,
                'embedding': emb.tolist(),
                'bbox': bbox
            })
        return photo_id, results, None
    except Exception as e:
        return photo_id, [], str(e)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'service': 'face-recognition-insightface',
        'model': 'buffalo_l (ArcFace)',
        'faiss_enabled': FAISS_AVAILABLE,
        'max_workers': MAX_WORKERS,
        'cached_albums': list(encodings_cache.keys())
    })

@app.route('/encoding-status/<album_id>', methods=['GET'])
def get_encoding_status(album_id):
    """Get encoding status"""
    status_path = get_status_path(album_id)
    if os.path.exists(status_path):
        with open(status_path, 'r') as f:
            return jsonify(json.load(f))
    
    encoding_path = get_encoding_path(album_id)
    if os.path.exists(encoding_path):
        encodings = load_album_encodings(album_id)
        return jsonify({
            'album_id': album_id,
            'status': 'completed',
            'total_faces': len(encodings) if encodings else 0,
            'progress_percent': 100
        })
    
    return jsonify({
        'album_id': album_id,
        'status': 'not_started',
        'total_faces': 0,
        'progress_percent': 0
    })

@app.route('/encode-album', methods=['POST'])
def encode_album():
    """Encode album with parallel processing"""
    data = request.json
    album_id = data.get('album_id')
    photos = data.get('photos', [])
    
    if not album_id or not photos:
        return jsonify({'error': 'Missing album_id or photos'}), 400
    
    print(f"🚀 Encoding album {album_id} with {len(photos)} photos (workers: {MAX_WORKERS})...")
    start_time = time.time()
    
    all_encodings = []
    processed = 0
    failed = 0
    
    update_status(album_id, 'encoding', 0, len(photos), 0)
    
    # Process in batches
    for batch_start in range(0, len(photos), BATCH_SIZE):
        batch = photos[batch_start:batch_start + BATCH_SIZE]
        batch_num = batch_start // BATCH_SIZE + 1
        total_batches = (len(photos) + BATCH_SIZE - 1) // BATCH_SIZE
        
        print(f"  Batch {batch_num}/{total_batches}: Downloading {len(batch)} images...")
        
        # Download batch asynchronously
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        download_results = loop.run_until_complete(download_batch_async(batch))
        loop.close()
        
        # Prepare for parallel encoding
        images_to_process = []
        for photo_id, image_bytes, error in download_results:
            if error:
                failed += 1
            else:
                images_to_process.append((photo_id, image_bytes))
        
        # Process images in parallel using ThreadPool
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = [executor.submit(process_image_for_encoding, args) for args in images_to_process]
            
            for future in as_completed(futures):
                photo_id, results, error = future.result()
                if error:
                    failed += 1
                elif results:
                    all_encodings.extend(results)
                    processed += 1
                else:
                    failed += 1
        
        # Update status
        current_processed = batch_start + len(batch)
        update_status(
            album_id, 'encoding', 
            current_processed, len(photos), 
            len(all_encodings),
            current_photo=f"Batch {batch_num}/{total_batches}"
        )
        
        print(f"  Batch {batch_num} done: {len(all_encodings)} faces found")
    
    # Save encodings
    encoding_path = get_encoding_path(album_id)
    with open(encoding_path, 'w') as f:
        json.dump(all_encodings, f)
    
    # Update cache
    with cache_lock:
        encodings_cache[album_id] = all_encodings
        if FAISS_AVAILABLE and all_encodings:
            embeddings = [np.array(e['embedding']) for e in all_encodings]
            faiss_indexes[album_id] = build_faiss_index(embeddings)
    
    # Final status
    elapsed = time.time() - start_time
    update_status(album_id, 'completed', len(photos), len(photos), len(all_encodings))
    
    print(f"✅ Album {album_id} complete: {processed} photos, {len(all_encodings)} faces in {elapsed:.1f}s")
    
    return jsonify({
        'success': True,
        'album_id': album_id,
        'processed': processed,
        'failed': failed,
        'total_faces': len(all_encodings),
        'elapsed_seconds': round(elapsed, 1)
    })

@app.route('/encode-incremental', methods=['POST'])
def encode_incremental():
    """Encode only new photos and merge with existing encodings"""
    data = request.json
    album_id = data.get('album_id')
    photos = data.get('photos', [])
    
    if not album_id or not photos:
        return jsonify({'error': 'Missing album_id or photos'}), 400
    
    print(f"🔄 Incremental encoding for album {album_id}: {len(photos)} new photos...")
    start_time = time.time()
    
    # Load existing encodings
    existing_encodings = load_album_encodings(album_id) or []
    existing_photo_ids = set(e['photo_id'] for e in existing_encodings)
    
    new_encodings = []
    processed = 0
    failed = 0
    
    # Process new photos in batches
    for batch_start in range(0, len(photos), BATCH_SIZE):
        batch = photos[batch_start:batch_start + BATCH_SIZE]
        
        # Download batch asynchronously
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        download_results = loop.run_until_complete(download_batch_async(batch))
        loop.close()
        
        # Prepare for parallel encoding
        images_to_process = []
        for photo_id, image_bytes, error in download_results:
            if error:
                failed += 1
            else:
                images_to_process.append((photo_id, image_bytes))
        
        # Process images in parallel
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = [executor.submit(process_image_for_encoding, args) for args in images_to_process]
            
            for future in as_completed(futures):
                photo_id, results, error = future.result()
                if error:
                    failed += 1
                elif results:
                    new_encodings.extend(results)
                    processed += 1
                else:
                    failed += 1
    
    # Merge with existing encodings
    all_encodings = existing_encodings + new_encodings
    
    # Save merged encodings
    encoding_path = get_encoding_path(album_id)
    with open(encoding_path, 'w') as f:
        json.dump(all_encodings, f)
    
    # Update cache and FAISS index
    with cache_lock:
        encodings_cache[album_id] = all_encodings
        if FAISS_AVAILABLE and all_encodings:
            embeddings = [np.array(e['embedding']) for e in all_encodings]
            faiss_indexes[album_id] = build_faiss_index(embeddings)
    
    elapsed = time.time() - start_time
    print(f"✅ Incremental encoding complete: +{len(new_encodings)} faces, total: {len(all_encodings)} in {elapsed:.1f}s")
    
    return jsonify({
        'success': True,
        'album_id': album_id,
        'new_photos_processed': processed,
        'new_faces_added': len(new_encodings),
        'total_faces': len(all_encodings),
        'failed': failed,
        'elapsed_seconds': round(elapsed, 1)
    })

@app.route('/remove-photos', methods=['POST'])
def remove_photos_from_encodings():
    """Remove encodings for deleted photos"""
    data = request.json
    album_id = data.get('album_id')
    photo_ids_to_remove = set(data.get('photo_ids', []))
    
    if not album_id or not photo_ids_to_remove:
        return jsonify({'error': 'Missing album_id or photo_ids'}), 400
    
    # Load existing encodings
    existing_encodings = load_album_encodings(album_id) or []
    
    # Filter out removed photos
    filtered_encodings = [e for e in existing_encodings if e['photo_id'] not in photo_ids_to_remove]
    removed_count = len(existing_encodings) - len(filtered_encodings)
    
    # Save filtered encodings
    encoding_path = get_encoding_path(album_id)
    with open(encoding_path, 'w') as f:
        json.dump(filtered_encodings, f)
    
    # Update cache
    with cache_lock:
        encodings_cache[album_id] = filtered_encodings
        if FAISS_AVAILABLE and filtered_encodings:
            embeddings = [np.array(e['embedding']) for e in filtered_encodings]
            faiss_indexes[album_id] = build_faiss_index(embeddings)
        elif album_id in faiss_indexes:
            del faiss_indexes[album_id]
    
    print(f"🗑️ Removed {removed_count} face encodings for {len(photo_ids_to_remove)} photos")
    
    return jsonify({
        'success': True,
        'removed_encodings': removed_count,
        'remaining_faces': len(filtered_encodings)
    })

@app.route('/search', methods=['POST'])
def search_faces():
    """Search for matching faces with adjustable threshold"""
    data = request.json
    album_id = data.get('album_id')
    image_base64 = data.get('image')
    threshold = float(data.get('threshold', 0.4))
    search_all_faces = data.get('search_all_faces', False)
    
    if not album_id or not image_base64:
        return jsonify({'error': 'Missing album_id or image'}), 400
    
    # Load encodings
    album_encodings = load_album_encodings(album_id)
    if not album_encodings:
        return jsonify({'error': 'Album chưa được xử lý. Vui lòng sync album trước.'}), 400
    
    # Load user image
    user_image = load_image_from_base64(image_base64)
    if user_image is None:
        return jsonify({'error': 'Không thể đọc ảnh'}), 400
    
    # Get face embedding(s) from user image
    try:
        if search_all_faces:
            user_faces = get_face_embeddings(user_image)
            if not user_faces:
                return jsonify({'error': 'Không tìm thấy khuôn mặt trong ảnh'}), 400
            user_embeddings = [emb for emb, bbox in user_faces]
            face_bboxes = [bbox for emb, bbox in user_faces]
        else:
            user_embedding, bbox = get_largest_face_embedding(user_image)
            if user_embedding is None:
                return jsonify({'error': 'Không tìm thấy khuôn mặt trong ảnh'}), 400
            user_embeddings = [user_embedding]
            face_bboxes = [bbox] if bbox else []
        
        print(f"🔍 Searching {len(user_embeddings)} face(s) in {len(album_encodings)} encodings...")
    except Exception as e:
        return jsonify({'error': f'Lỗi nhận diện: {str(e)}'}), 500
    
    matched_photo_ids = set()
    match_details = []
    max_similarity = 0.0
    
    start_time = time.time()
    
    # Use FAISS for fast search if available
    if FAISS_AVAILABLE and album_id in faiss_indexes:
        index = faiss_indexes[album_id]
        
        for user_emb in user_embeddings:
            # Normalize query vector
            query = np.array([user_emb]).astype('float32')
            faiss.normalize_L2(query)
            
            # Search top-k matches
            k = min(100, len(album_encodings))
            similarities, indices = index.search(query, k)
            
            for sim, idx in zip(similarities[0], indices[0]):
                if sim > threshold:
                    photo_id = album_encodings[idx]['photo_id']
                    matched_photo_ids.add(photo_id)
                    match_details.append({
                        'photo_id': photo_id,
                        'similarity': round(float(sim), 3)
                    })
                max_similarity = max(max_similarity, sim)
    else:
        # Fallback to numpy search
        for user_emb in user_embeddings:
            for item in album_encodings:
                photo_id = item['photo_id']
                embedding = np.array(item['embedding'])
                
                similarity = cosine_similarity(user_emb, embedding)
                max_similarity = max(max_similarity, similarity)
                
                if similarity > threshold:
                    matched_photo_ids.add(photo_id)
                    match_details.append({
                        'photo_id': photo_id,
                        'similarity': round(similarity, 3)
                    })
    
    elapsed = time.time() - start_time
    print(f"✅ Search complete: {len(matched_photo_ids)} matches, max_sim: {max_similarity:.3f}, time: {elapsed:.3f}s")
    
    return jsonify({
        'success': True,
        'matched_photo_ids': list(matched_photo_ids),
        'total_matches': len(matched_photo_ids),
        'max_similarity': round(float(max_similarity), 3),
        'threshold_used': threshold,
        'faces_detected': len(user_embeddings),
        'face_bboxes': face_bboxes,
        'search_time_ms': round(elapsed * 1000, 1),
        'search_method': 'faiss' if (FAISS_AVAILABLE and album_id in faiss_indexes) else 'numpy'
    })

@app.route('/detect', methods=['POST'])
def detect_face():
    """Detect faces in image and return bounding boxes"""
    data = request.json
    image_base64 = data.get('image')
    
    if not image_base64:
        return jsonify({'error': 'Missing image'}), 400
    
    image = load_image_from_base64(image_base64)
    if image is None:
        return jsonify({'error': 'Không thể đọc ảnh'}), 400
    
    try:
        faces = face_app.get(image)
        face_data = []
        for face in faces:
            bbox = face.bbox.tolist()
            face_data.append({
                'bbox': bbox,
                'confidence': float(face.det_score),
                'area': (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
            })
        
        # Sort by area (largest first)
        face_data.sort(key=lambda x: x['area'], reverse=True)
        
        return jsonify({
            'success': True,
            'face_count': len(faces),
            'has_face': len(faces) > 0,
            'faces': face_data,
            'image_size': {'width': image.shape[1], 'height': image.shape[0]}
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/clear-cache/<album_id>', methods=['DELETE'])
def clear_cache(album_id):
    """Clear cached encodings for an album"""
    with cache_lock:
        if album_id in encodings_cache:
            del encodings_cache[album_id]
        if album_id in faiss_indexes:
            del faiss_indexes[album_id]
    return jsonify({'success': True, 'message': f'Cache cleared for album {album_id}'})

if __name__ == '__main__':
    print("🔍 Face Recognition API (InsightFace/ArcFace) starting...")
    print(f"📍 Port: {PORT}")
    print(f"⚡ Max Workers: {MAX_WORKERS}")
    print(f"📦 Batch Size: {BATCH_SIZE}")
    print(f"🚀 FAISS: {'Enabled' if FAISS_AVAILABLE else 'Disabled'}")
    print("📍 Endpoints:")
    print("   POST /encode-album - Encode album faces (parallel)")
    print("   POST /search - Search for matching faces (FAISS accelerated)")
    print("   POST /detect - Detect faces with bounding boxes")
    print("   GET  /encoding-status/<album_id> - Get encoding progress")
    print("   DELETE /clear-cache/<album_id> - Clear album cache")
    app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)
