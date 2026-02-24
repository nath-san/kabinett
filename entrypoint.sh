#!/bin/sh
if [ ! -f /data/kabinett.db ]; then
  echo "Database not found at /data/kabinett.db"
  if [ -n "$DB_DOWNLOAD_URL" ]; then
    echo "Downloading database from DB_DOWNLOAD_URL..."
    apt-get update -qq && apt-get install -y -qq wget > /dev/null 2>&1
    wget -q --show-progress -O /data/kabinett.db "$DB_DOWNLOAD_URL"
    echo "Download complete! Size: $(du -sh /data/kabinett.db | cut -f1)"
  else
    echo "Set DB_DOWNLOAD_URL secret to auto-download, or upload manually."
    echo "Waiting..."
    while [ ! -f /data/kabinett.db ]; do sleep 5; done
  fi
fi
echo "DB exists: $(ls -la /data/kabinett.db)"
echo "Starting node..."
node apps/web/build/server/index.js 2>&1 || {
  echo "Node exited with code $?"
  echo "Keeping container alive for debugging..."
  sleep 3600
}
