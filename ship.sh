#!/usr/bin/env bash
# Build BOTH images and push them to Docker Hub. Run on your laptop, from inside
# the dox-summarize folder:
#
#   ./ship.sh
#
# Then SSH into your server and run ./deploy.sh there to go live.
#
# Options (export before running):
#   DOCKER_USER  Docker Hub namespace (default: dhruvsh)
#   TAG          image tag (default: latest)
#   PLATFORM     set to linux/amd64 if your laptop arch differs from the server
#
# Prerequisite: `docker login` on this machine.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DOCKER_USER="${DOCKER_USER:-dhruvsh}"
TAG="${TAG:-latest}"

echo "==> Building + pushing images to Docker Hub"
DOCKER_USER="$DOCKER_USER" TAG="$TAG" PLATFORM="${PLATFORM:-}" bash scripts/build-and-push.sh

echo
echo "==> Pushed. Next: ssh into the server, then run  ./deploy.sh"
