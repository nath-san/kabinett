#!/bin/bash
# Sync local DB to Fly.io via Cloudflare tunnel
# Requires: fly CLI authenticated, Cloudflare tunnel running, DB_DOWNLOAD_URL set as Fly secret
set -e

APP="kabinett"
MACHINE="08072dec51d478"

echo "$(date): Syncing DB to Fly..."

# Delete old DB on Fly
fly ssh console -a "$APP" -C "rm -f /data/kabinett.db" 2>/dev/null || true

# Restart machine (triggers fresh download via entrypoint.sh)
fly machine restart "$MACHINE" -a "$APP"

echo "$(date): Machine restarting. DB download takes ~2-3 min."
echo "$(date): App will be back once health check passes."
