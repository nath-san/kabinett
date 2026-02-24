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
echo "Build contents:"
ls -la apps/web/build/server/ 2>&1 || echo "No server build found!"
echo "Starting node on port ${PORT:-3000}..."
PORT=${PORT:-3000} node apps/web/build/server/index.js 2>&1 &
NODE_PID=$!
echo "Node PID: $NODE_PID"
sleep 5
if kill -0 $NODE_PID 2>/dev/null; then
  echo "Node is running, waiting..."
  wait $NODE_PID
  echo "Node exited with code $?"
else
  echo "Node died within 5 seconds"
fi
echo "Keeping container alive for debugging..."
sleep 3600
