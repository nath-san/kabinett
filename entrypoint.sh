#!/bin/sh
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
echo "DB exists: $(ls -la /data/kabinett.db)"
echo "Starting node on port ${PORT:-3000}..."
PORT=${PORT:-3000} node apps/web/build/server/index.js 2>&1
EXIT_CODE=$?
echo "Node exited with code $EXIT_CODE"
echo "Keeping container alive for debugging..."
sleep 3600
