#!/usr/bin/env bash
# One-command release: build both images, push them to Docker Hub, then SSH into
# the server and redeploy. Run from inside the dox-summarize folder:
#
#   ./ship.sh
#
# Configure the server target once (either edit the defaults below, or export
# these before running):
#   SERVER_SSH   ssh target, e.g. root@srv1426430  or  root@1.2.3.4
#   REMOTE_DIR   path to the repo on the server (default: dox-summarize)
#   DOCKER_USER  Docker Hub namespace (default: dhruvsh)
#   TAG          image tag (default: latest)
#   PLATFORM     set to linux/amd64 if your laptop arch differs from the server
#
# Prerequisites (one-time):
#   - `docker login` on this machine
#   - server already bootstrapped once: repo cloned, .env filled in, and the
#     placeholder deploy.sh replaced (see README / earlier setup steps)
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SERVER_SSH="${SERVER_SSH:-root@srv1426430}"   # <-- EDIT if your SSH target differs
REMOTE_DIR="${REMOTE_DIR:-dox-summarize}"
DOCKER_USER="${DOCKER_USER:-dhruvsh}"
TAG="${TAG:-latest}"

echo "==> [1/2] Building + pushing images to Docker Hub"
DOCKER_USER="$DOCKER_USER" TAG="$TAG" PLATFORM="${PLATFORM:-}" bash scripts/build-and-push.sh

echo "==> [2/2] Redeploying on $SERVER_SSH (dir: $REMOTE_DIR)"
ssh "$SERVER_SSH" "cd '$REMOTE_DIR' && (git pull --ff-only || true) && chmod +x deploy.sh && ./deploy.sh"

echo
echo "==> Shipped. Live at https://doc.aryanculture.org"
