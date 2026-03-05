#!/usr/bin/env bash

set -euo pipefail

IMAGE_REPO="${IMAGE_REPO:-dhruvsh/doxsummarize}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
COMMIT_MESSAGE="${COMMIT_MESSAGE:-init}"
FULL_IMAGE="${IMAGE_REPO}:${IMAGE_TAG}"

if [[ "$IMAGE_REPO" != */* ]]; then
  echo "IMAGE_REPO must include namespace/repo (example: dhruvsh/doxsummarize)"
  exit 1
fi

IMAGE_NAMESPACE="${IMAGE_REPO%%/*}"

if [[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]]; then
  printf '\nSwitching to main branch...\n'
  git switch main
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

DOCKER_USERNAME="$("${DOCKER[@]}" info --format '{{.Username}}' 2>/dev/null || true)"
if [[ -z "$DOCKER_USERNAME" ]]; then
  printf '\nDocker Hub login not detected.\n'
  printf 'Run `%s login` first, then rerun this script.\n' "${DOCKER[*]}"
  exit 1
fi

if [[ "$IMAGE_NAMESPACE" != "$DOCKER_USERNAME" ]]; then
  printf '\nWarning: Docker logged-in user is `%s` but target image namespace is `%s`.\n' "$DOCKER_USERNAME" "$IMAGE_NAMESPACE"
  printf 'Push may fail unless `%s` is an org/repo where `%s` has push permission.\n' "$IMAGE_NAMESPACE" "$DOCKER_USERNAME"
fi

printf '\nBuilding Docker image locally: %s\n' "$FULL_IMAGE"
"${DOCKER[@]}" build --pull -t "$FULL_IMAGE" .

printf '\nPushing Docker image: %s\n' "$FULL_IMAGE"
if ! "${DOCKER[@]}" push "$FULL_IMAGE"; then
  printf '\nDocker push failed for %s.\n' "$FULL_IMAGE"
  printf 'Check Docker login and repository permissions (repo: %s, user: %s).\n' "$IMAGE_REPO" "$DOCKER_USERNAME"
  exit 1
fi

SHA_TAG="$(git rev-parse --short HEAD)"
SHA_IMAGE="${IMAGE_REPO}:${SHA_TAG}"

printf '\nTagging and pushing commit image: %s\n' "$SHA_IMAGE"
"${DOCKER[@]}" tag "$FULL_IMAGE" "$SHA_IMAGE"
if ! "${DOCKER[@]}" push "$SHA_IMAGE"; then
  printf '\nDocker push failed for %s.\n' "$SHA_IMAGE"
  printf 'Check Docker login and repository permissions (repo: %s, user: %s).\n' "$IMAGE_REPO" "$DOCKER_USERNAME"
  exit 1
fi

printf '\nDone.\n'
