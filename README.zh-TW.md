# venn-diagram-generator

[English](./README.md) · 線上站：<https://venn.applepig.net>

單頁 WYSIWYG 文氏圖產生器：選 2／3／4 圈（橫排與 5／6 瓣花等額外形狀收在旁邊的下拉選單），加上圖片標題，在畫布上直接點字改字、拖動位置、調字級，一鍵下載社群可貼的 PNG。整份編輯狀態壓進網址的 `s` 參數，所以分享連結就是圖：貼進聊天軟體會透過 `og:image` 直接預覽。無登入、無帳號、server 無狀態。介面支援台灣中文、英文與日文，可從面板的語言下拉切換（記在 `venn.lang` cookie），也認 `?lang=` 與 `Accept-Language`。

## 架構

SVG 是唯一的渲染真相。`engine/render-svg.ts` 的 `renderSvg(state, options)` 是純函式，前端把它的輸出直接塞進 DOM 當即時預覽，server 拿同一份輸出交給 `@resvg/resvg-js` 轉 PNG，所以預覽即所得。文字排版不依賴 DOM 量測，改用字元分類估寬（CJK 1em、其他 0.62em、空白 0.3em），前後端算出來的版面一致。

```
engine/   types、defaults、shapes/（ring 與 row registry）、layout、region-geometry、
          render-svg、state-codec——純幾何、排版與編解碼，沒有任何產品文案
content/  palette、templates/、strings/、locale、state-presets（預設 meme 與介面字串）
ui/       Vite + vanilla TS 編輯器
server/   Hono：靜態檔、GET / 的 og meta 注射、GET /api/png 與 /api/og.png
cli/      `venn` 命令：spec（字母↔mask）、flags（旗標合併）、venn（I/O 外殼）
skills/   plugin（.claude-plugin/）帶的 Claude Code skill
deploy/   Dockerfile、compose.yml、compose.dev.yml、deploy.sh
```

圓的位置一律由 `arr`／`n`／`overlap`／`radius` 推得，不存座標。`ring(n)` 每個圈數帶凍結的角度表，所以舊版分享出去的連結至今輸出位元級不變。

## URL 狀態格式

`?s=` 的內容是 `base64url(deflate-raw(JSON))`。瀏覽器用 `CompressionStream('deflate-raw')`，Node 用 `zlib.deflateRawSync`，同一個格式雙向通吃。解不開或 schema 不合一律回 400。

```jsonc
{
  "v": 1,                     // 狀態版本，必須是 1
  "arr": "row",               // "ring" | "row"；缺席＝ring
  "n": 2,                     // 圈數：ring 2～6、row 3～6
  "title": "我的文氏圖",       // 圖片標題，畫在圖上方的 title band；
                              // 缺席或空字串＝沒有標題（上限同文字槽的 80 字）
  "title_fill": "#e04848",    // 標題字色；缺席＝依背景亮度自動取黑或白。
                              // 沒有 title 時一律不寫進編碼
  "style": "flat",            // translucent | flat | outline
  "opacity": 0.6,             // 0–1，只有 translucent 用得到
  "overlap": 1.2,             // 圓心距 / r，0.6–1.6
  "radius": 0.3,              // 圓半徑，畫布寬比例（ring 0.2–0.35、row 0.1–0.35）
  "colors": ["#2e9be6", "#e6a92e"],  // 長度必須等於 n
  "bg": "#fafafa",
  "size": 1200,               // 400–2000 的整數
  "texts": {                  // key 是成員圓 bitmask 的十進位字串
    "1": { "t": "該做\n的事" },  // circle i = bit i，所以 3 = 圓0∩圓1
    "2": { "t": "想做\n的事" },
    "3": { "t": "拖到\n明天", "fs": 0.09, "dx": 0.01, "dy": -0.02 }
  }
}
```

`fs`（字級，畫布寬比例）、`dx`／`dy`（相對區域框中心的位移）與 `fill`（該區填色 override，只有 `flat` 生效）只在使用者手動調過時才存在；沒有就是自動排版。每個文字槽上限 80 字。

有 `title` 時，畫布頂端 18% 變成 title band，圖區（圓與所有區域文字）等比縮小、水平置中並貼齊底緣，所以輸出仍是正方形、也不會出界；沒有標題的版面一個位元都不動。標題字級自動 fit，支援手動 `\n` 與自動折行；字色預設依背景亮度取黑或白，也可以用 `title_fill` 指定。分享頁有標題時，`og:title` 與 `<title>` 也改用它。

`radius` 配上大的 `overlap` 會讓圓超出畫布，`ring(5)`／`ring(6)` 與 row 最容易遇到。超界時整個圖區（圓、所有區域文字，以及已經套過的標題變換）以畫布中心為錨點等比縮小並平移回畫布內，還留 0.3% 畫布寬的邊距讓描邊不被切。它只縮不放：本來就在畫布內的幾何輸出一個位元都不變。排版仍在未變換的幾何上算，所以有哪些槽、文字落在哪都不受影響——內縮是最後才疊在標題變換之上的。

每個形狀有哪些文字槽，是從它的預設幾何推出來的（區域有內接框才給槽）：2 圈 3 個、3 圈 7 個、4 圈的 2×2 花瓣 13 個（4 單圈＋4 相鄰雙圈＋4 三重＋中央四重；對角雙圈在預設重疊度下沒有區域，不給槽）。5／6 圈與 row 預設只給單圈標籤。形狀下拉選單只列 row(3)、row(4)、ring(5)、ring(6)；row(5)／row(6) 仍然解得開，舊連結照樣能用，載入到它們時選單會臨時多出目前這一項。

沒帶 `s` 時每個形狀都有一組預設 template（依當前介面語言）。還沒編輯過文字就切形狀或切語言，會整組換掉；改過的字不會被動到。

## API

`GET /api/png?s=<state>` 回 `image/png`，尺寸等於 `state.size`，帶 `Cache-Control: public, max-age=31536000, immutable`（參數即內容，可以永久快取）。缺 `s`、解不開、schema 不合都回 400 JSON `{ "error": "..." }`。API 錯誤訊息固定英文——它是機器介面，不跟介面語言走。

`GET /api/og.png?v=<n>&s=<state>&lang=<zh-TW|en|ja>` 是社群預覽用的 1200 × 630 橫幅：品牌底圖加上文氏圖內容。缺 `s` 時輸出首頁預設範例；`lang` 只從 query 讀（不看 `Accept-Language`），否則固定 URL 會被第一個爬蟲的語言污染。`v` 是合成版型的 cache 版號，底圖或版型改版時 bump。無效 `s` 回 400 JSON 並帶 `Cache-Control: no-store`。

首頁的 og:image 是 build 時預烤的靜態檔（`pnpm build` 產出 `dist/og-default-<hash>.png`）；分享頁的 `og:image` 則指向帶自己 `s` 的 `/api/og.png`。

```bash
# 用 Node 產一個 state，或直接從編輯器複製連結
S=$(pnpm exec tsx -e "
import { encodeState } from './engine/state-codec-node';
import { sampleState } from './content/state-presets';
process.stdout.write(encodeState(sampleState()));")

curl -o venn.png "http://localhost:3000/api/png?s=$S"
curl -o og.png   "http://localhost:3000/api/og.png?v=5&s=$S&lang=zh-TW"
```

## 命令列

```bash
npx -y venn-diagram-generator png --set A=工作 --set B=生活 \
  --text AB=沒有睡眠 -o life.png
```

出圖不連外：字型隨套件走，點陣化由本機的 `@resvg/resvg-js` 做。四個子命令——`url` 印分享連結，`svg` 與 `png` 寫檔，`decode <網址或 s>` 印出既有連結背後的 JSON（加 `--raw` 改印上面那份原始 `VennState`）。`svg` 與 `png` 會印兩行：檔案的絕對路徑與像素尺寸，接著是同一張圖的分享網址。

CLI 不讓人寫 bitmask。圈就是字母（`A` 是第一圈，最多到 `F`），文字槽的名字就是它所屬的圈集合，所以 `AB` 是前兩圈的交集。大小寫與字母順序都不影響，`ba` 等於 `AB`。哪些槽存在取決於排列：四圈環狀時 `A` 與 `D` 根本不相交，所以 `AD` 會被拒絕，而錯誤訊息會把該組合的全部合法槽列出來。

整份 spec 也可以用 JSON 給。要把中文、引號與換行安全地穿過 shell，這是唯一不折騰的做法。`--json` 兩種格式都收，靠哪個 key 在來判別——有 `sets` 是友善格式，有 `v` 是原始 `VennState`，也就是 URL 裡編的那份、`decode --raw` 印的那份。兩個都有或都沒有一律報錯，不猜：

```bash
cat <<'EOF' | npx -y venn-diagram-generator png --json - -o life.png
{
  "sets": ["工作", "生活", "睡眠"],
  "texts": { "AB": "沒有睡眠", "ABC": "都想要" },
  "title": "選三個",
  "style": "flat"
}
EOF
```

每個 state 欄位都有對應旗標，沒有哪個欄位只能走 JSON。`--arr`、`--style`、`--title`、`--size`、`--bg`、`--opacity`、`--overlap`、`--radius` 與 `--colors '#aabbcc,#ddeeff'` 對應上面那份 state 的欄位；per-slot 的三個用同一套字母 key：`--fs AB=0.09`、`--fill AB=#ffffff`、`--nudge AB=0.01,-0.02`。`--nudge` 可以只給一半（`AB=,0.02`），沒給的那一邊維持自動置中而不是變成 0。這些旗標一律覆蓋 `--json` 給的底稿；`--set`／`--text` 只換文字，該格既有的字級、位移與填色原樣留著。

分享連結的主機依序取 `--base-url`、`VENN_BASE_URL`、`https://venn.applepig.net`。退出碼：`0` 成功、`1` 參數或 spec 有誤、`2` 點陣化失敗。

`decode` 的往返是等價的，連手動字級、位移與區域填色都留著，所以可以把編輯器的連結貼回來、在 JSON 裡改一格文字，其餘原封不動重出一張。

```bash
npx -y venn-diagram-generator decode 'https://venn.applepig.net/?s=...' > spec.json
npx -y venn-diagram-generator png --json spec.json -o updated.png
```

## Claude Code plugin

這個 repo 同時是一個 Claude Code plugin，讓 Claude 直接產出真的圖，而不是自己猜著手刻 SVG。

```
/plugin marketplace add applepig/venn-diagram-generator
/plugin install venn@venn-diagram-generator
```

Skill 教的就是上面這支 CLI，並且把各排列的合法槽位表整份帶著，也要求 Claude 回報時 PNG 與可編輯的分享網址兩個都給。裝好之後，開口要一張文氏圖就行。

## 本機開發

```bash
pnpm install
pnpm dev          # Hono 3000，Vite 以 middlewareMode 掛在同一個 port（含 HMR）
pnpm test         # Vitest
pnpm typecheck    # tsc --noEmit
pnpm build        # ui → dist/、預烤 OG 圖 → dist/、server → dist-server/
pnpm start        # 跑 build 好的 server，單一 port 3000
```

`assets/fonts/` 放兩個字型：Noto Sans TC Bold 是 SVG 指名的那一個，Noto Sans JP Bold 只負責補 TC 缺的字形（日文漢字，例如「盗」）。前端在 `svg text` 的 CSS `font-family` 列出兩個，server 把兩個檔都交給 resvg 的 `fontFiles`、`defaultFontFamily` 維持 `Noto Sans TC`——寫進 SVG 的 `font-family` 一個字元都沒變，舊分享連結的輸出仍逐位元相同。image 內不安裝任何系統字型。

## Docker

Dockerfile 住在 `deploy/`，但 build context 是 repo 根目錄：

```bash
pnpm docker:build   # docker build -f deploy/Dockerfile -t venn-diagram-generator .
docker run --rm -p 3000:3000 -e VENN_WATERMARK=venn.example.com venn-diagram-generator
```

`deploy/compose.yml` 用這份 Dockerfile build 出正式站容器，掛在反向代理後面（Traefik label、external network `web`，TLS 在上游終止）。裡面所有與站點有關的值都是環境變數，沒給 `VENN_PUBLIC_HOST` 就直接拒絕啟動。`deploy/compose.dev.yml` 不 build image：把原始碼掛進 `node:24-slim` 直接跑 `tsx watch server/index.ts`，改前端走 HMR、改 server 由 tsx 重啟，都不必重 build。

手動跑 compose 時要自帶 `--env-file .env`：compose 只會自動讀 compose 檔旁邊那份（`deploy/.env`），根目錄的它不看——`docker compose --env-file .env -f deploy/compose.yml up -d --build`。

`deploy/deploy.sh` 就是全部的部署流程——沒有 image registry。它把工作目錄 rsync 到遠端主機（跳過 `.env`，主機保留自己那份），再在那台機器上以 `--env-file .env` 跑 `docker compose up -d --build`：

```bash
VENN_DEPLOY_HOST=my-host VENN_DEPLOY_PATH=/srv/apps/venn ./deploy/deploy.sh
```

script 開頭會先 source repo 根目錄的 `.env`，所以這兩個變數可以寫在那裡，不必每次打（`.env` 裡的值會蓋掉指令列先設好的）。

主機端的前置條件：ssh 使用者要能免密碼跑 Docker（在 `docker` group 裡，或有免密 sudo），而且 `${VENN_DEPLOY_PATH}/.env` 必須先存在。script 會先檢查那份檔案有沒有宣告 `VENN_PUBLIC_HOST`、`VENN_GTM_ID`、`VENN_WATERMARK`（值可以是空的，key 不能少），缺了就印出缺哪幾把並 exit 1，不會先動主機——浮水印靜默消失會被烤進一年期快取的 `og:image`。

## 環境變數

把 `.env.example` 複製成 repo 根目錄的 `.env` 再填——部署主機上 compose 讀的就是這份。**server** 的行為沒有任何指向他人環境的內建預設值：沒有 hostname、沒有分析 id、沒有浮水印。唯一的例外是 CLI 的分享連結，連結總得指向某個站，所以它退回本專案的公開站（見下方的 `VENN_BASE_URL`）。

| 變數 | 用在 | 必填 | 意義 |
|---|---|---|---|
| `VENN_PUBLIC_HOST` | `deploy/compose.yml` | **是** | 你自己站台的對外 hostname，會變成 `PUBLIC_ORIGIN` 與 Traefik 的 `Host()` 規則；沒給 compose 直接報錯。 |
| `VENN_WATERMARK` | server | 否 | 圖片右下角的浮水印文字。沒設或空字串就不畫。 |
| `VENN_GTM_ID` | server | 否 | Google Tag Manager 容器 id。沒設就完全不注入 GTM——不是你自己的容器就別填。 |
| `PUBLIC_ORIGIN` | server、build | 否 | `og:image`／`og:url` 的絕對 origin。沒設就退回看 request header；`deploy/compose.yml` 會從 `VENN_PUBLIC_HOST` 推出來。 |
| `PORT` | server | 否 | 監聽的 port，預設 3000。 |
| `VENN_BASE_URL` | `venn` CLI | 否 | CLI 印在分享連結裡的 origin。`--base-url` 優先；沒設就退回 `https://venn.applepig.net`。Fork 之後改成你自己的站。 |
| `VENN_DEPLOY_HOST` | `deploy/deploy.sh` | **是** | 部署目標主機的 ssh host。缺少時 script 印出缺哪個變數並 exit 1。 |
| `VENN_DEPLOY_PATH` | `deploy/deploy.sh` | **是** | 要 rsync 進去的遠端目錄。 |
| `VENN_DEV_HOST` | `deploy/compose.dev.yml` | **是** | 掛原始碼的開發站 hostname；沒給 compose 直接拒絕啟動。 |
| `VENN_DIST` | server、build | 否 | 內部用，正式站不要設。build 產物目錄，預設 `dist`。 |
| `VENN_FONT` | server | 否 | 內部用，正式站不要設。resvg 載入的字型檔（逗號分隔），預設 `assets/fonts/NotoSansTC-Bold.otf,assets/fonts/NotoSansJP-Bold.otf`；第一個是 SVG 指名的字型，其餘只補缺字。 |
| `VENN_DEV` | server | 否 | 內部用，正式站不要設。設成 `1` 會改跑 Vite middlewareMode，而不是吐 `dist/`。 |

## Fork 需要自換的東西

視覺品牌不是通用素材，自架前請換掉：

- **`ui/public/og-base.png`**：1200 × 630 的社群底圖，上面是原專案的品牌文案。換成你自己的圖（同尺寸），再跑 `pnpm build` 重烤 `dist/og-default-<hash>.png`。
- **`VENN_WATERMARK`**：改成你自己的網址，或留空不畫浮水印。
- **`VENN_GTM_ID`**：填你自己的容器 id，或留空完全不載分析。絕不要沿用別人的。
- **`VENN_PUBLIC_HOST`**／**`VENN_DEV_HOST`**：你自己的 hostname。沒有預設值可以忘記改。
- **`VENN_BASE_URL`** 與 `package.json` 的 `homepage`：兩個都不改的話，CLI 的分享連結會指回原專案的站。

## 注意事項

- 「複製圖片」用 `ClipboardItem`，需要 secure context（HTTPS 或 localhost）。不支援時會提示改用「下載 PNG」。
- 每個區域能容納的字數受限於該區域的內接矩形。4 圈中央的四重交集特別小，超過約 4 個全形字就會在最小字級（畫布 2.5%）下超出框線。想塞長句請改用單圈或雙圈的槽。

## 授權

程式碼採 MIT，見 [LICENSE](./LICENSE)。

隨 repo 附的字型 Noto Sans TC Bold 與 Noto Sans JP Bold 採 SIL Open Font License，條文在 [`assets/fonts/OFL.txt`](./assets/fonts/OFL.txt)（一份涵蓋兩個字型），與字型檔一起散布。
