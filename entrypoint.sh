#!/bin/sh
if [ ! -f /data/kabinett.db ]; then
  echo "WARNING: /data/kabinett.db not found. Waiting for upload..."
  echo "Use 'fly ssh sftp shell' then 'put kabinett.db /data/kabinett.db' to upload."
  # Keep container alive so we can SSH in
  while [ ! -f /data/kabinett.db ]; do
    sleep 5
  done
  echo "Database found! Starting app..."
fi
exec node apps/web/build/server/index.js
