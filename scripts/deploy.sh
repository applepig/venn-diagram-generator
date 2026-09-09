#!/usr/bin/env bash
# 把工作目錄同步到正式站主機並重建容器。
# repo 沒有 git remote，也沒有 image registry，所以部署就是 rsync + 在該機 build。
set -euo pipefail

HOST="${VENN_DEPLOY_HOST:-deploy-host}"
DEST="${VENN_DEPLOY_PATH:-/srv/venn}"

cd "$(dirname "$0")/.."

rsync -az --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude 'dist-server' \
  --exclude 'docs' --exclude '*.log' --exclude 'compose.dev.yml' \
  ./ "${HOST}:${DEST}/"

ssh "$HOST" "cd '${DEST}' && sudo docker compose up -d --build"

echo "deployed → https://venn.applepig.net"
