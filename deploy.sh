#!/usr/bin/env bash
# The commit is built into the backend and frontend so feedback can be matched to code.
export GIT_COMMIT="$(git rev-parse --short HEAD)"
docker compose down --remove-orphans && docker compose up --build -d
