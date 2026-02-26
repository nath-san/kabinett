#!/bin/bash
set -euo pipefail

APP="kabinett"
DB_PATH="packages/data/kabinett.db"
GZ_PATH="${DB_PATH}.gz"
REMOTE_PATH="/data/kabinett.db"

echo "🗄️  Deploying database to Fly.io ($APP)"
echo ""

# 1. Check DB exists
if [ ! -f "$DB_PATH" ]; then
  echo "❌ Database not found: $DB_PATH"
  exit 1
fi

DB_SIZE=$(du -h "$DB_PATH" | cut -f1)
echo "📦 Compressing $DB_PATH ($DB_SIZE)..."
gzip -kf "$DB_PATH"
GZ_SIZE=$(du -h "$GZ_PATH" | cut -f1)
echo "   → $GZ_PATH ($GZ_SIZE)"
echo ""

# 2. Upload
echo "⬆️  Uploading to Fly.io..."
fly ssh sftp shell -a "$APP" <<EOF
put $GZ_PATH ${REMOTE_PATH}.gz
EOF
echo "   ✅ Upload complete"
echo ""

# 3. Decompress on Fly
echo "📂 Decompressing on Fly machine..."
fly ssh console -a "$APP" -C "gunzip -f ${REMOTE_PATH}.gz"
echo "   ✅ Decompressed"
echo ""

# 4. Restart app
echo "🔄 Restarting app..."
fly machines restart -a "$APP" --skip-health-checks
echo ""

# 5. Cleanup local gz
rm -f "$GZ_PATH"

echo "✅ Done! Database deployed to $APP"
