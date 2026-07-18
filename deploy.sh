#!/usr/bin/env bash
# Run this ON THE SERVER after `ssh`-ing in, from the repo folder:
#
#   ./deploy.sh
#
# Refreshes compose files, pulls the latest images from Docker Hub, recreates the
# containers (app + PaddleOCR), waits for health, and prunes old images.
# Assumes a populated .env sits next to this script.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f .env ]; then
  echo "ERROR: no .env found in $(pwd). Create it (see .env.example) before deploying." >&2
  exit 1
fi

# Keep docker-compose.yml / paddle-ocr-service / etc. in sync with GitHub.
if [ -d .git ]; then
  echo "==> Syncing files from git"
  git pull --ff-only || echo "   (git pull skipped/failed — continuing with current files.)"
fi

echo "==> Pulling latest images"
docker compose pull

echo "==> Recreating containers"
docker compose down --remove-orphans 2>/dev/null || true
# The old app container may predate compose (fixed container_name) — clear it.
docker rm -f doxsummarize 2>/dev/null || true
docker compose up -d

echo "==> Waiting for PaddleOCR to become healthy (up to ~90s)…"
status="unknown"
for _ in $(seq 1 30); do
  status="$(docker inspect -f '{{.State.Health.Status}}' paddle-ocr 2>/dev/null || echo unknown)"
  [ "$status" = "healthy" ] && break
  sleep 3
done
echo "   paddle-ocr health: $status"

echo "==> Pruning dangling images"
docker image prune -f

echo
echo "==> Done. Live at https://doc.aryanculture.org"
docker compose ps
