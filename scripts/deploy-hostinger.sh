#!/usr/bin/env bash

set -euo pipefail

IMAGE_REPO="${IMAGE_REPO:-dhruvsh/doxsummarize}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
COMMIT_MESSAGE="${COMMIT_MESSAGE:-init}"
FULL_IMAGE="${IMAGE_REPO}:${IMAGE_TAG}"

printf '\n[1/7] Switching branch to main...\n'
git switch main

printf '\n[2/7] Fetching all remotes...\n'
git fetch --all

printf '\n[3/7] Merging origin/main...\n'
git merge origin/main

printf '\n[4/7] Staging changes...\n'
git add .

if git diff --cached --quiet; then
  printf '\nNo staged changes to commit. Skipping commit step.\n'
else
  printf '\nCommitting changes with message: %s\n' "$COMMIT_MESSAGE"
  git commit -m "$COMMIT_MESSAGE"
fi

printf '\n[5/7] Pushing to origin/main...\n'
git push origin main

printf '\n[6/7] Building Docker image (%s) with sudo...\n' "$FULL_IMAGE"
sudo docker build --pull -t "$FULL_IMAGE" .

printf '\n[7/7] Pushing Docker image (%s) with sudo...\n' "$FULL_IMAGE"
sudo docker push "$FULL_IMAGE"

SHA_TAG="$(git rev-parse --short HEAD)"
SHA_IMAGE="${IMAGE_REPO}:${SHA_TAG}"

printf '\nTagging and pushing commit image: %s\n' "$SHA_IMAGE"
sudo docker tag "$FULL_IMAGE" "$SHA_IMAGE"
sudo docker push "$SHA_IMAGE"

printf '\nDeployment pipeline completed successfully.\n'
