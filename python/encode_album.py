#!/usr/bin/env python3
import json
import requests
import os
import sys

ENCODINGS_DIR = '/Users/nguyenhoang/Library/CloudStorage/GoogleDrive-hodamedia@c3hbttt.edu.vn/My Drive/ung-dung/face-app/data/encodings'

def encode_album(album_id):
    response = requests.get(f'http://localhost:3000/api/albums/{album_id}/photos')
    photos = response.json()

    print(f"Total photos in album {album_id}: {len(photos)}")

    valid_photos = [{
        'id': p['id'], 
        'url': p['thumbnail_url'].replace('=s220', '=s800') if p['thumbnail_url'] else p['full_url']
    } for p in photos if p.get('thumbnail_url')]

    print(f"Valid photos with thumbnails: {len(valid_photos)}")

    batch_size = 50
    all_encodings = []

    for i in range(0, len(valid_photos), batch_size):
        batch = valid_photos[i:i+batch_size]
        batch_num = i // batch_size + 1
        print(f"Batch {batch_num}: photos {i+1} to {min(i+batch_size, len(valid_photos))}...", end=" ", flush=True)
        
        try:
            response = requests.post(
                'http://localhost:5001/encode-album',
                json={'album_id': f"{album_id}_batch_{batch_num}", 'photos': batch},
                timeout=600
            )
            result = response.json()
            faces = result.get('total_faces', 0)
            print(f"Faces: {faces}")
            
            batch_file = f"{ENCODINGS_DIR}/album_{album_id}_batch_{batch_num}.json"
            if os.path.exists(batch_file):
                with open(batch_file, 'r') as f:
                    all_encodings.extend(json.load(f))
        except Exception as e:
            print(f"Error: {e}")

    # Save combined
    final_file = f'{ENCODINGS_DIR}/album_{album_id}.json'
    with open(final_file, 'w') as f:
        json.dump(all_encodings, f)

    print(f"\n✅ Done! Total faces encoded: {len(all_encodings)}")
    print(f"Saved to: {final_file}")

if __name__ == '__main__':
    album_id = sys.argv[1] if len(sys.argv) > 1 else 2
    encode_album(album_id)
