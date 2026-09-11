#!/bin/bash
set -e

# venn 開發環境管理工具：三軌（本機／開發站／正式站）的單一入口。
#
#   local  pnpm dev，localhost:3000，不經 Docker——改一行就熱更新，出圖與 SEO 走同一支 server。
#   dev    deploy/compose.dev.yml：掛原始碼跑 tsx watch，由本機 Traefik 以 $VENN_DEV_HOST 對外。
#   prod   deploy/deploy.sh：rsync 到 $VENN_DEPLOY_HOST 再於該機 build，沒有 registry。
#
# 三軌的 hostname 與部署目標一律由 repo 根的 .env 提供，這個檔一個都不寫死：repo 是公開的，
# 而那些值屬於各自的機器（README「Environment variables」與 .env.example 是契約）。
#
# ⚠ 這個檔只在 host 端跑，不進容器：compose.dev.yml 的 command 直接是 tsx watch，
#   沒有「容器內入口」這回事，也就不需要以 /.dockerenv 分流。

# compose 檔在 deploy/，所以 project name 一定要顯式給：docker compose 預設取 compose 檔
# 所在目錄名（＝deploy），而 container_name 是寫死的 venn-dev——兩者對不上時，
# 舊容器會變成「compose 管不到、但佔著名字」的孤兒。
PROJECT="venn-diagram-generator"
SERVICE_DEV="venn-dev"
CONTAINER_DEV="venn-dev"
COMPOSE_DEV="deploy/compose.dev.yml"
# 本機軌的 port：server/index.ts 讀 PORT，預設 3000（README 的本機開發段同一個值）。
LOCAL_PORT="${PORT:-3000}"
# tsx watch ＋ Vite middlewareMode 的冷啟動只要數秒；60s 是給慢碟與首次 optimize 的餘裕。
# 可覆寫只為了讓「逾時 → exit 1 ＋ 印 log 尾巴」那條分支試得起來。
READY_TIMEOUT_S="${VENN_READY_TIMEOUT_S:-60}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

# 警告與錯誤走 stderr：stdout 是給人／給 pipe 讀的正常輸出，診斷混進去會讓 `./dev.sh status | …` 分不開。
log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 一律以 repo 根為 cwd：compose 檔、`..:/app` 的來源與 .env 全是相對路徑，
# 從別的目錄叫 dev.sh 不該解出別的東西。
cd "$HERE"

# repo 根的 .env 是三軌共同的設定來源，deploy.sh 也 source 同一份（README 的 env 契約表）。
# compose 只會自動載入「compose 檔旁邊」的 .env（＝deploy/.env），所以每個 compose 呼叫
# 都要顯式 --env-file；這裡另外 source 一次，是為了 wait_ready 與 status 讀得到 hostname。
if [ -f ".env" ]; then
    set -a
    # shellcheck source=/dev/null
    . ./.env
    set +a
fi

# --env-file 只在 .env 真的存在時才加：指向不存在的檔會讓每個 compose 呼叫都當掉，
# 而 status 這種唯讀命令在沒有 .env 的機器上也該答得出「哪一軌沒設定」。
# 用 if 而不是 `[ -f .env ] && …`：沒有 .env 時後者的非零結束碼會被 set -e 當成失敗。
COMPOSE=(docker compose -p "$PROJECT" -f "$COMPOSE_DEV")
if [ -f ".env" ]; then
    COMPOSE=(docker compose -p "$PROJECT" --env-file .env -f "$COMPOSE_DEV")
fi

# docker 檢查不放在頂層：本機軌（./dev.sh dev、verify）不需要 docker，
# 沒裝 docker 的機器照樣要能跑 pnpm dev。只有真的要碰容器的命令才擋。
require_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        log_error "找不到 docker——開發站是 docker compose 起的（deploy/compose.dev.yml）。"
        log_error "本機開發不需要它：./dev.sh dev 直接跑 pnpm dev。"
        exit 1
    fi
}

usage() {
    cat <<EOF
venn Development Environment Manager

Usage: ./dev.sh <command>
       （檔案同步工具會剝掉執行位，必要時 bash dev.sh <command>）

本機（不經 Docker）：
  dev                  pnpm dev——Hono ＋ Vite middlewareMode，單一 port $LOCAL_PORT
  verify               test → typecheck → build，推上去之前跑一輪

開發站（deploy/compose.dev.yml，掛原始碼熱更新，刻意不給 VENN_GTM_ID）：
  up                   起容器並等到 https://\$VENN_DEV_HOST/ 回 200
  down                 停止並移除容器
  logs                 跟隨容器 log
  restart              down ＋ up（compose restart 不重讀 .env，改了 env 要走這條）

正式站：
  deploy               委派 deploy/deploy.sh：rsync 到 \$VENN_DEPLOY_HOST 後在該機 build
  image                pnpm docker:build——只 build image，不部署

跨軌：
  status               三軌各自的實況（容器狀態 ＋ 對外 HTTP 碼）

三軌的 hostname 與部署目標都從 repo 根的 .env 讀，這個檔不寫死任何一個：

  VENN_DEV_HOST        開發站 hostname（up／logs／status 要它，缺了 compose 也會擋）
  VENN_PUBLIC_HOST     正式站 hostname（status 用來查對外狀態；沒設就跳過那一列）
  VENN_DEPLOY_HOST     正式站 ssh target（deploy 要它，由 deploy.sh 自己擋）
  VENN_DEPLOY_PATH     正式站上的目錄（同上）

改完 .env 要 ./dev.sh restart 才進得了容器——env 只在建立容器時讀一次。

EOF
}

container_running() {
    [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = "true" ]
}

dev_url() {
    echo "https://${VENN_DEV_HOST}"
}

# 回 HTTP 狀態碼，連不上就回 000（curl 自己的慣例值，不另造字串）。
# 開發站走本機 Traefik 的自簽憑證，所以 -k；正式站是真憑證，不給 -k 才驗得出憑證壞掉。
http_code() {
    local url="$1" insecure="${2:-}"
    curl -s ${insecure:+-k} -o /dev/null -m 10 -w '%{http_code}' "$url" 2>/dev/null || echo 000
}

# 三軌各一列，印的是**操作者接下來會拿去打的那條 URL**，不是容器內部的 port。
print_row() {
    case "$1" in
        local)
            local code
            code="$(http_code "http://localhost:${LOCAL_PORT}/")"
            if [ "$code" = "200" ]; then
                log_info "local  http://localhost:${LOCAL_PORT}  200  ← pnpm dev 正在跑"
            else
                log_info "local  http://localhost:${LOCAL_PORT}  ——   沒在跑（./dev.sh dev）"
            fi
            ;;
        dev)
            if [ -z "${VENN_DEV_HOST:-}" ]; then
                log_warn "dev    VENN_DEV_HOST 未設定——開發站那一軌無從查起（見 .env.example）。"
                return
            fi
            local state code
            state="$(docker inspect -f '{{.State.Status}}' "$CONTAINER_DEV" 2>/dev/null || echo absent)"
            code="$(http_code "$(dev_url)/" insecure)"
            # 容器 running 但 HTTP 不是 200 要講明白：tsx watch 是 crash 後就停在那裡的，
            # 容器照樣 Up——只看 docker ps 會把一個 502 的站當成健康的站。
            if [ "$state" = "running" ] && [ "$code" != "200" ]; then
                log_warn "dev    $(dev_url)  $code  容器 running 但沒回 200——看 ./dev.sh logs"
            else
                log_info "dev    $(dev_url)  $code  容器 $state"
            fi
            ;;
        prod)
            if [ -z "${VENN_PUBLIC_HOST:-}" ]; then
                log_info "prod   VENN_PUBLIC_HOST 未設定——跳過（部署目標不寫進 repo）"
                return
            fi
            log_info "prod   https://${VENN_PUBLIC_HOST}  $(http_code "https://${VENN_PUBLIC_HOST}/")  ← ./dev.sh deploy"
            ;;
    esac
}

# 守門全部在 up 之前：起了容器再發現 env 缺一半，那個容器已經帶著錯的 PUBLIC_ORIGIN 在服務了，
# 而 og:image 帶長期快取——錯的 origin 會被別人的 CDN 記住。
check_dev_env() {
    if [ ! -f ".env" ]; then
        log_error ".env 不存在，但 compose 要靠它取得 hostname（cp .env.example .env 再填）。"
        log_error "開發站至少需要 VENN_DEV_HOST；VENN_WATERMARK 留空＝不畫浮水印。"
        exit 1
    fi

    if [ -z "${VENN_DEV_HOST:-}" ]; then
        log_error ".env 沒有 VENN_DEV_HOST——開發站的 PUBLIC_ORIGIN 與 Traefik Host() 都由它來。"
        log_error "填一個本機 Traefik 認得的 hostname，例如 VENN_DEV_HOST=venn.dev.example。"
        exit 1
    fi

    # GTM 只在這裡提醒、不擋：compose.dev.yml 根本不把 VENN_GTM_ID 傳進容器，
    # 所以 .env 裡有值也混不進正式站數據——但操作者常以為有，講清楚比較省事。
    if [ -n "${VENN_GTM_ID:-}" ]; then
        log_info "註：.env 有 VENN_GTM_ID，但開發站刻意不注入 GTM（compose.dev.yml 不傳這個值）。"
    fi
}

# `web` 是反向代理那邊管的 external network，不是這個 project 起的。
# 它不在時 compose up 會失敗——那正是要的：靜默另開一個同名 network 會讓 Traefik 永遠路由不到。
# 這裡提早擋，只為了把 docker 的訊息換成「該去哪裡開」。
check_web_network() {
    if ! docker network inspect web >/dev/null 2>&1; then
        log_error "找不到 external network 'web'——開發站要掛在反向代理的那個 network 上。"
        log_error "先把 Traefik（或你的代理）起起來，它會建立 web；或 docker network create web。"
        exit 1
    fi
}

# 容器名 venn-dev 是寫死的，但 project name 取決於 compose 怎麼被叫起來。
# M1 把 compose 檔搬進 deploy/ 之後，不帶 -p 的呼叫會解出 project=deploy，於是同一個容器名
# 會分屬兩個 project：舊容器照樣 Up、compose 卻管不到它（down 無效、up 撞名）。
# 這個檢查把那種孤兒當場講出來，而不是讓操作者對著一個 502 的站猜。
check_orphan_container() {
    local owner
    owner="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$CONTAINER_DEV" 2>/dev/null || echo "")"
    if [ -n "$owner" ] && [ "$owner" != "$PROJECT" ]; then
        log_warn "容器 $CONTAINER_DEV 目前屬於 project '$owner'，不是 '$PROJECT'——這支腳本管不到它。"
        log_warn "它多半是舊版 compose 檔（搬進 deploy/ 之前）留下的；接下來的 up 會重建它。"
        log_warn "要先手動清掉：docker rm -f $CONTAINER_DEV"
    fi
}

# host 端輪詢，問的是**瀏覽器實際會打的那條路**（Traefik ＋ DNS ＋ 自簽憑證全在上面），
# 不是容器內部的 3000：exit 0 要能保證「站現在打得開」，而不只是「容器 Up」。
# 這個專案剛好踩過反例——tsx watch 在重構期間 crash 後容器照樣 Up，站 502 了一天才被發現。
wait_ready() {
    local url deadline code
    url="$(dev_url)/"
    deadline=$(( SECONDS + READY_TIMEOUT_S ))

    log_info "等開發站就緒（$url，最多 ${READY_TIMEOUT_S}s）..."
    while [ "$SECONDS" -lt "$deadline" ]; do
        code="$(http_code "$url" insecure)"
        if [ "$code" = "200" ]; then
            log_info "開發站就緒：$url"
            return 0
        fi
        sleep 2
    done

    log_error "開發站在 ${READY_TIMEOUT_S}s 內沒有在 $url 回 200（最後一次是 $code）。以下是最後 40 行 log："
    "${COMPOSE[@]}" logs --tail 40 "$SERVICE_DEV" >&2 || true
    return 1
}

# 本機軌：不經 Docker，直接把 port 讓給 pnpm dev。exec 換掉自己，Ctrl+C 的語意才是原本那個。
cmd_dev() {
    log_info "本機開發：http://localhost:${LOCAL_PORT}（Ctrl+C 結束）"
    exec pnpm dev
}

# 推之前跑一輪：順序照失敗成本由低到高，set -e 讓任一步紅就中止。
cmd_verify() {
    log_info "verify：test → typecheck → build"
    pnpm test
    pnpm typecheck
    pnpm build
    log_info "verify 全綠。"
}

cmd_up() {
    require_docker
    # 守門全部在 up 之前：起了容器再發現 env 不對，那個容器已經帶著錯的 PUBLIC_ORIGIN 在服務了。
    check_dev_env
    check_web_network
    check_orphan_container

    if container_running "$CONTAINER_DEV"; then
        # 不重複 up（compose up -d 本身 idempotent），但**照樣輪詢**：容器 running 只是必要條件，
        # crash 後停住的 tsx watch 與「還在首次編譯」都符合它。exit 0 要代表站打得開。
        # 健康時第一輪就回，成本近零。
        log_info "already running：$CONTAINER_DEV——不重複 up，只確認站上真的回 200。"
        if ! wait_ready; then
            # 刻意不自己 down／重建：容器是活的，而「活著但不服務」通常是程式碼壞了，
            # 重建只會把證據沖掉。下一步交給操作者。
            log_error "容器活著但站起不來。修好程式碼後跑 ./dev.sh restart 重建容器。"
            exit 1
        fi
        print_row dev
        return 0
    fi

    log_info "啟動開發站：$SERVICE_DEV（$(dev_url)）"
    "${COMPOSE[@]}" up -d "$SERVICE_DEV"

    wait_ready || exit 1

    echo ""
    print_row dev
    log_info "log:     ./dev.sh logs"
}

cmd_down() {
    require_docker
    log_info "停止並移除開發站容器..."
    "${COMPOSE[@]}" down
    log_info "已停止。"
}

# compose restart 不重讀 env（env 只在建立容器時讀一次），所以這裡走 down ＋ up 的完整路徑，
# 順便重跑一次守門——改 .env 之後要生效的正是這條。
cmd_restart() {
    cmd_down
    cmd_up
}

cmd_logs() {
    require_docker
    log_info "跟隨開發站 log（Ctrl+C 離開）..."
    "${COMPOSE[@]}" logs -f
}

# 正式站的部署邏輯全在 deploy.sh（env 守門、遠端 .env 檢查、rsync 排除清單都在那裡），
# 這裡只轉呼叫，不重寫一份——兩份會分岔，而分岔的那一份會在正式站上被發現。
cmd_deploy() {
    log_info "部署正式站：deploy/deploy.sh"
    exec ./deploy/deploy.sh
}

cmd_image() {
    require_docker
    log_info "build image（不部署）：pnpm docker:build"
    pnpm docker:build
}

cmd_status() {
    if command -v docker >/dev/null 2>&1; then
        "${COMPOSE[@]}" ps 2>/dev/null || true
        echo ""
        check_orphan_container
    fi
    print_row local
    print_row dev
    print_row prod
}

# 不認得的 command 走 stderr ＋ exit 1，不是印 usage 卻回 0：後者會讓「以為容器已重建、
# 實際上一個 docker 指令都沒下」變成回報成功的無聲 no-op——env 只在建立容器時讀一次，
# 那種誤判會撐很久。
case "${1:-}" in
    dev)     cmd_dev ;;
    verify)  cmd_verify ;;
    up)      cmd_up ;;
    down)    cmd_down ;;
    restart) cmd_restart ;;
    logs)    cmd_logs ;;
    deploy)  cmd_deploy ;;
    image)   cmd_image ;;
    status)  cmd_status ;;
    "" | help | -h | --help) usage ;;
    *)
        log_error "不認得的命令 '$1'。"
        usage >&2
        exit 1
        ;;
esac
