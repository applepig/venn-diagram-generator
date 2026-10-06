#!/usr/bin/env bash
# 把工作目錄同步到正式站主機並重建容器。
# 沒有 image registry：同步工作目錄後，在部署主機 build。
set -euo pipefail

cd "$(dirname "$0")/.."

# repo 根目錄的 .env 是這台開發機的部署設定（VENN_DEPLOY_HOST／PATH 寫在這裡就不用每次打）。
# 用 if 而不是 `[[ -f .env ]] && ...`：沒有 .env 時後者的非零結束碼會被 set -e 當成失敗。
# .env 裡的值會蓋掉指令列先設好的同名變數，要臨時改目標就直接改 .env 或註解掉那一行。
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

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

# 主機的 .env 是這個部署的唯一設定來源，少一把 key 不會讓 compose 失敗，
# 只會讓浮水印或 GTM 靜默消失——而 og:image 帶一年期快取，錯了要等一年才過期。
# 所以先檢查再動手：值可以是空的（空＝刻意不要），key 一定要在。
printf -v remote_check 'bash -s -- %q' "$DEST"
missing_keys="$(ssh "$HOST" "$remote_check" <<'REMOTE'
env_file="$1/.env"
if [[ ! -f "$env_file" ]]; then
  echo "(no such file: ${env_file})"
  exit 0
fi
for key in VENN_PUBLIC_HOST VENN_GTM_ID VENN_WATERMARK; do
  grep -qE "^[[:space:]]*${key}=" "$env_file" || echo "$key"
done
REMOTE
)"

if [[ -n "$missing_keys" ]]; then
  echo "deploy.sh: ${HOST}:${DEST}/.env is missing required keys:" >&2
  echo "$missing_keys" | sed 's/^/  /' >&2
  echo "create ${DEST}/.env on the host with these keys (see .env.example in this repo); empty values are fine." >&2
  exit 1
fi

# .env*（含 .env.example）與 .token 屬於各自的機器：--delete 會掃掉主機上那份，一定要排除
rsync -az --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude 'dist-server' \
  --exclude 'docs' --exclude '*.log' --exclude 'deploy/compose.dev.yml' \
  --exclude '.env' --exclude '.env.*' --exclude '.token' \
  ./ "${HOST}:${DEST}/"

# compose 的 project name 一定要顯式給（同 dev.sh）：預設取 compose 檔所在目錄名＝`deploy`，
# 那個名字在同一台主機上會被每個「compose 檔放在 deploy/」的專案共用，而 container_name 是寫死的
# venn-diagram-generator——名字撞上別人的 project，就會變成「compose 管不到卻佔著名字」的孤兒容器。
PROJECT="venn"
REVISION="$(git rev-parse HEAD)"
if [[ -n "$(git status --porcelain)" ]]; then REVISION="${REVISION}-dirty"; fi

# .env 留在主機上（rsync 不碰）：hostname、GTM id、浮水印屬於該部署，不進 repo。
# --env-file 相對於 cwd，所以這裡指的是 ${DEST}/.env，不是 deploy/.env。
printf -v remote_deploy 'bash -s -- %q %q %q' "$DEST" "$PROJECT" "$REVISION"
ssh "$HOST" "$remote_deploy" <<'REMOTE'
set -euo pipefail
cd "$1"
export VENN_REVISION="$3"
# sudo normally removes exported variables; pass the non-secret build revision explicitly.
compose=(sudo env "VENN_REVISION=$3" docker compose -p "$2" --env-file .env -f deploy/compose.yml)
"${compose[@]}" up -d --build
# up -d 不等於已 ready；先確認 app，再確認真正公開的 HTTPS routing。
for attempt in 1 2 3 4 5; do
  if "${compose[@]}" exec -T venn node dist-server/smoke-check.mjs http://localhost:3000 "$3"; then
    break
  fi
  if [[ "$attempt" == 5 ]]; then exit 1; fi
  sleep 2
done
"${compose[@]}" exec -T venn sh -c 'node dist-server/smoke-check.mjs "$PUBLIC_ORIGIN" "$VENN_REVISION"'
REMOTE

echo "deployed → ${HOST}:${DEST}"
