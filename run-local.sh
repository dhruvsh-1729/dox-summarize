#!/usr/bin/env bash
# Build BOTH images on this machine and run the whole stack locally with docker
# compose (app + PaddleOCR). No Docker Hub needed. Test at http://localhost:3000.
#
# Usage (from the dox-summarize folder):
#   ./run-local.sh
#
# Requires: Docker + Docker Compose, and a populated .env in this folder.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DOCKER_USER="${DOCKER_USER:-dhruvsh}"
TAG="${TAG:-latest}"
APP_REPO="${APP_REPO:-$DOCKER_USER/doxsummarize}"
OCR_REPO="${OCR_REPO:-$DOCKER_USER/paddle-ocr-service}"

if [ ! -f .env ]; then
  echo "ERROR: no .env found in $(pwd). Copy .env.example to .env and fill it in first." >&2
  exit 1
fi

echo "==> Building app image: $APP_REPO:$TAG"
docker build -t "$APP_REPO:$TAG" .

echo "==> Building PaddleOCR image: $OCR_REPO:$TAG"
docker build -t "$OCR_REPO:$TAG" paddle-ocr-service

echo "==> Starting the stack locally (docker compose up -d)"
# Uses the locally-built images (same tags); does not pull from Docker Hub.
docker compose up -d

echo
echo "==> Up. App:  http://localhost:3000   (PaddleOCR is internal only)"
echo "    Logs:     docker compose logs -f app"
echo "    Stop:     docker compose down"
docker compose ps
