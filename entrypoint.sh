#!/bin/sh

# Decompress DB if only .gz exists (from deploy-db.sh upload)
if [ ! -f /data/kabinett.db ] && [ -f /data/kabinett.db.gz ]; then
  echo "Decompressing database..."
  gunzip -f /data/kabinett.db.gz
  rm -f /data/kabinett.db-shm /data/kabinett.db-wal
  echo "Done! Size: $(du -sh /data/kabinett.db | cut -f1)"
fi

if [ ! -f /data/kabinett.db ]; then
  echo "Database not found at /data/kabinett.db"
  if [ -n "$DB_DOWNLOAD_URL" ]; then
    echo "Downloading database from DB_DOWNLOAD_URL..."
    apt-get update -qq && apt-get install -y -qq wget > /dev/null 2>&1
    wget -q --show-progress -O /data/kabinett.db "$DB_DOWNLOAD_URL"
    echo "Download complete! Size: $(du -sh /data/kabinett.db | cut -f1)"
  else
    echo "No DB_DOWNLOAD_URL set. Using test DB as fallback."
    cp /app/test-kabinett.db /data/kabinett.db
  fi
fi

# Ensure artists table exists (for fast autocomplete)
if command -v sqlite3 > /dev/null 2>&1; then
  HAS_ARTISTS=$(sqlite3 /data/kabinett.db "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='artists';" 2>/dev/null)
  if [ "$HAS_ARTISTS" = "0" ] || [ -z "$HAS_ARTISTS" ]; then
    echo "Creating artists table..."
    sqlite3 /data/kabinett.db "
      CREATE TABLE IF NOT EXISTS artists (name TEXT NOT NULL PRIMARY KEY, artwork_count INTEGER NOT NULL DEFAULT 0);
      INSERT OR REPLACE INTO artists (name, artwork_count)
      SELECT json_extract(value, '\$.name') as name, COUNT(*) as artwork_count
      FROM artworks, json_each(artworks.artists)
      WHERE artists IS NOT NULL AND artists != '[]'
        AND json_extract(value, '\$.name') IS NOT NULL
        AND json_extract(value, '\$.name') != ''
      GROUP BY name;
    "
    echo "Artists table created: $(sqlite3 /data/kabinett.db 'SELECT count(*) FROM artists;') entries"
  fi
fi

# Build FAISS index if not present
if [ -f /data/kabinett.db ] && [ ! -f /data/faiss.index ]; then
  echo "Building FAISS index (this takes a few minutes on first boot)..."
  PYTHONUNBUFFERED=1 python3 /app/packages/data/scripts/build-faiss-index.py \
    --db /data/kabinett.db \
    --out-index /data/faiss.index \
    --out-map /data/faiss-map.json
  echo "FAISS index built!"
fi

# Start FAISS KNN server as a sibling process (not child of this shell)
# Using nohup + disown pattern so it survives the exec below
if [ -f /data/faiss.index ]; then
  echo "Starting FAISS server..."
  PYTHONUNBUFFERED=1 nohup python3 /app/packages/data/scripts/faiss-server.py > /data/faiss-server.log 2>&1 &
  echo "FAISS server starting in background (PID $!), Node will retry connections..."
fi

echo "Starting Kabinett..."
cd /app/apps/web && npx react-router-serve ./build/server/index.js
