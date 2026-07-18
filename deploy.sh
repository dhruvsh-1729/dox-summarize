#!/usr/bin/env bash
# Redeploy on the server: refresh compose files (if a git checkout), pull the
# latest images, replace the running containers, and prune dangling images.
#
# Usage (from the repo dir on the server):
#   ./deploy.sh
#
# Assumes: images already built & pushed to Docker Hub from your dev machine
# (scripts/build-and-push.sh), and a populated .env sits next to this script.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Keep docker-compose.yml / paddle-ocr-service / etc. in sync with GitHub.
if [ -d .git ]; then
  git pull --ff-only || echo "git pull skipped/failed — continuing with current files."
fi

echo "==> Pulling latest images"
docker compose pull

echo "==> Recreating containers"
docker compose down --remove-orphans 2>/dev/null || true
# The old app container may predate compose (fixed container_name) — clear it.
docker rm -f doxsummarize 2>/dev/null || true
docker compose up -d

echo "==> Pruning dangling images"
docker image prune -f

echo "==> Done. Current state:"
docker compose ps
