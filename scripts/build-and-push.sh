#!/usr/bin/env bash
# Build and push BOTH images (Next.js app + PaddleOCR service) to Docker Hub.
#
# Usage:
#   docker login
#   DOCKER_USER=dhruvsh bash scripts/build-and-push.sh
#
# Optional env:
#   DOCKER_USER   Docker Hub username / namespace (default: dhruvsh)
#   TAG           image tag (default: latest)
#   PLATFORM      target platform, e.g. linux/amd64 (default: host platform)
#   APP_REPO      app image repo   (default: $DOCKER_USER/doxsummarize)
#   OCR_REPO      paddle image repo (default: $DOCKER_USER/paddle-ocr-service)
set -euo pipefail

DOCKER_USER="${DOCKER_USER:-dhruvsh}"
TAG="${TAG:-latest}"
APP_REPO="${APP_REPO:-$DOCKER_USER/doxsummarize}"
OCR_REPO="${OCR_REPO:-$DOCKER_USER/paddle-ocr-service}"

# If your server CPU arch differs from your laptop (e.g. Apple Silicon -> amd64
# server), set PLATFORM=linux/amd64 so the images actually run on the server.
PLATFORM_ARGS=()
if [[ -n "${PLATFORM:-}" ]]; then
  PLATFORM_ARGS=(--platform "$PLATFORM")
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Building app image: $APP_REPO:$TAG"
docker build "${PLATFORM_ARGS[@]}" -t "$APP_REPO:$TAG" "$ROOT_DIR"

echo "==> Building PaddleOCR image: $OCR_REPO:$TAG"
docker build "${PLATFORM_ARGS[@]}" -t "$OCR_REPO:$TAG" "$ROOT_DIR/paddle-ocr-service"

echo "==> Pushing $APP_REPO:$TAG"
docker push "$APP_REPO:$TAG"

echo "==> Pushing $OCR_REPO:$TAG"
docker push "$OCR_REPO:$TAG"

echo "==> Done. Pushed:"
echo "    $APP_REPO:$TAG"
echo "    $OCR_REPO:$TAG"
