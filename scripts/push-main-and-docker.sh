#!/usr/bin/env bash

set -euo pipefail

IMAGE_REPO="${IMAGE_REPO:-dhruvsh/doxsummarize}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
COMMIT_MESSAGE="${COMMIT_MESSAGE:-init}"
FULL_IMAGE="${IMAGE_REPO}:${IMAGE_TAG}"

if [[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]]; then
  printf '\nSwitching to main branch...\n'
  git stash
fi

printf '\nSyncing local main with origin/main...\n'
git fetch origin main
git merge origin/main

printf '\nStaging changes...\n'
git add -A

if git diff --cached --quiet; then
  printf '\nNo staged changes to commit.\n'
else
  printf '\nCommitting changes with message: %s\n' "$COMMIT_MESSAGE"
  git commit -m "$COMMIT_MESSAGE"
fi

printf '\nPushing main to origin...\n'
git push origin main

if [[ "${USE_SUDO_DOCKER:-0}" == "1" ]]; then
  DOCKER=(sudo docker)
else
  DOCKER=(docker)
fi

printf '\nBuilding Docker image locally: %s\n' "$FULL_IMAGE"
"${DOCKER[@]}" build --pull -t "$FULL_IMAGE" .

printf '\nPushing Docker image: %s\n' "$FULL_IMAGE"
"${DOCKER[@]}" push "$FULL_IMAGE"

SHA_TAG="$(git rev-parse --short HEAD)"
SHA_IMAGE="${IMAGE_REPO}:${SHA_TAG}"

printf '\nTagging and pushing commit image: %s\n' "$SHA_IMAGE"
"${DOCKER[@]}" tag "$FULL_IMAGE" "$SHA_IMAGE"
"${DOCKER[@]}" push "$SHA_IMAGE"

printf '\nDone.\n'
