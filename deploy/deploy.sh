#!/usr/bin/env bash
# 把工作目錄同步到正式站主機並重建容器。
# repo 沒有 git remote，也沒有 image registry，所以部署就是 rsync + 在該機 build。
set -euo pipefail

# 目標主機與路徑沒有預設值：部署目標屬於各自的環境，不寫進 repo。
missing=()
[[ -n "${VENN_DEPLOY_HOST:-}" ]] || missing+=(VENN_DEPLOY_HOST)
[[ -n "${VENN_DEPLOY_PATH:-}" ]] || missing+=(VENN_DEPLOY_PATH)
if (( ${#missing[@]} > 0 )); then
  echo "deploy.sh: missing required env: ${missing[*]}" >&2
  echo "usage: VENN_DEPLOY_HOST=<ssh-host> VENN_DEPLOY_PATH=<remote-dir> ./deploy/deploy.sh" >&2
  exit 1
fi

HOST="$VENN_DEPLOY_HOST"
DEST="$VENN_DEPLOY_PATH"

cd "$(dirname "$0")/.."

rsync -az --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude 'dist-server' \
  --exclude 'docs' --exclude '*.log' --exclude 'deploy/compose.dev.yml' \
  ./ "${HOST}:${DEST}/"

ssh "$HOST" "cd '${DEST}' && sudo docker compose -f deploy/compose.yml up -d --build"

echo "deployed → ${HOST}:${DEST}"
