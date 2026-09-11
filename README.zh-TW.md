# venn-diagram-generator

[English](./README.md) · 線上站：<https://venn.applepig.net>

單頁 WYSIWYG 文氏圖產生器：選排列（環狀或一列）與 2～6 圈，在畫布上直接點字改字、拖動位置、調字級，一鍵下載社群可貼的 PNG。整份編輯狀態壓進網址的 `s` 參數，所以分享連結就是圖：貼進聊天軟體會透過 `og:image` 直接預覽。無登入、無帳號、server 無狀態。介面支援台灣中文與英文。

## 架構

SVG 是唯一的渲染真相。`engine/render-svg.ts` 的 `renderSvg(state, options)` 是純函式，前端把它的輸出直接塞進 DOM 當即時預覽，server 拿同一份輸出交給 `@resvg/resvg-js` 轉 PNG，所以預覽即所得。文字排版不依賴 DOM 量測，改用字元分類估寬（CJK 1em、其他 0.62em、空白 0.3em），前後端算出來的版面一致。

```
engine/   types、defaults、shapes/（ring 與 row registry）、layout、region-geometry、
          render-svg、state-codec——純幾何、排版與編解碼，沒有任何產品文案
content/  palette、templates/、strings/、locale、state-presets（預設 meme 與介面字串）
ui/       Vite + vanilla TS 編輯器
server/   Hono：靜態檔、GET / 的 og meta 注射、GET /api/png 與 /api/og.png
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

每個形狀有哪些文字槽，是從它的預設幾何推出來的（區域有內接框才給槽）：2 圈 3 個、3 圈 7 個、4 圈的 2×2 花瓣 13 個（4 單圈＋4 相鄰雙圈＋4 三重＋中央四重；對角雙圈在預設重疊度下沒有區域，不給槽）。5／6 圈與 row 預設只給單圈標籤。

沒帶 `s` 時每個形狀都有一組預設 template（依當前介面語言）。還沒編輯過文字就切形狀或切語言，會整組換掉；改過的字不會被動到。

## API

`GET /api/png?s=<state>` 回 `image/png`，尺寸等於 `state.size`，帶 `Cache-Control: public, max-age=31536000, immutable`（參數即內容，可以永久快取）。缺 `s`、解不開、schema 不合都回 400 JSON `{ "error": "..." }`。API 錯誤訊息固定英文——它是機器介面，不跟介面語言走。

`GET /api/og.png?v=<n>&s=<state>&lang=<zh-TW|en>` 是社群預覽用的 1200 × 630 橫幅：品牌底圖加上文氏圖內容。缺 `s` 時輸出首頁預設範例；`lang` 只從 query 讀（不看 `Accept-Language`），否則固定 URL 會被第一個爬蟲的語言污染。`v` 是合成版型的 cache 版號，底圖或版型改版時 bump。無效 `s` 回 400 JSON 並帶 `Cache-Control: no-store`。

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

## 本機開發

```bash
pnpm install
pnpm dev          # Hono 3000，Vite 以 middlewareMode 掛在同一個 port（含 HMR）
pnpm test         # Vitest
pnpm typecheck    # tsc --noEmit
pnpm build        # ui → dist/、預烤 OG 圖 → dist/、server → dist-server/
pnpm start        # 跑 build 好的 server，單一 port 3000
```

字型 Noto Sans TC Bold（OFL）放在 `assets/fonts/`，前端 `@font-face` 與 resvg 的 `fontFiles` 指同一個檔，image 內不安裝任何系統字型。

## Docker

Dockerfile 住在 `deploy/`，但 build context 是 repo 根目錄：

```bash
pnpm docker:build   # docker build -f deploy/Dockerfile -t venn-diagram-generator .
docker run --rm -p 3000:3000 -e VENN_WATERMARK=venn.example.com venn-diagram-generator
```

`deploy/compose.yml` 用這份 Dockerfile build 出正式站容器，掛在反向代理後面（Traefik label、external network `web`，TLS 在上游終止）。`deploy/compose.dev.yml` 不 build image：把原始碼掛進 `node:24-slim` 直接跑 `tsx watch server/index.ts`，改前端走 HMR、改 server 由 tsx 重啟，都不必重 build。

`deploy/deploy.sh` 就是全部的部署流程——沒有 image registry。它把工作目錄 rsync 到遠端主機，再在那台機器上 `docker compose up -d --build`：

```bash
VENN_DEPLOY_HOST=my-host VENN_DEPLOY_PATH=/srv/apps/venn ./deploy/deploy.sh
```

## 環境變數

把 `.env.example` 複製成 `.env` 再填。以下所有項目都沒有指向他人環境的內建預設值。

| 變數 | 用在 | 必填 | 意義 |
|---|---|---|---|
| `VENN_WATERMARK` | server | 否 | 圖片右下角的浮水印文字。沒設或空字串就不畫。 |
| `VENN_GTM_ID` | server | 否 | Google Tag Manager 容器 id。開發站刻意不給，數據才不會混進正式站。 |
| `PUBLIC_ORIGIN` | server、build | 否 | `og:image`／`og:url` 的絕對 origin。沒設就退回看 request header。 |
| `PORT` | server | 否 | 監聽的 port，預設 3000。 |
| `VENN_DEPLOY_HOST` | `deploy/deploy.sh` | **是** | 部署目標主機的 ssh host。缺少時 script 印出缺哪個變數並 exit 1。 |
| `VENN_DEPLOY_PATH` | `deploy/deploy.sh` | **是** | 要 rsync 進去的遠端目錄。 |
| `VENN_DEV_HOST` | `deploy/compose.dev.yml` | **是** | 掛原始碼的開發站 hostname；沒給 compose 直接拒絕啟動。 |

## Fork 需要自換的東西

視覺品牌不是通用素材，自架前請換掉：

- **`ui/public/og-base.png`**：1200 × 630 的社群底圖，上面是原專案的品牌文案。換成你自己的圖（同尺寸），再跑 `pnpm build` 重烤 `dist/og-default-<hash>.png`。
- **`VENN_WATERMARK`**：改成你自己的網址，或留空不畫浮水印。
- `PUBLIC_ORIGIN` 與 `deploy/compose.yml`／`VENN_DEV_HOST` 裡的 hostname。

## 注意事項

- 「複製圖片」用 `ClipboardItem`，需要 secure context（HTTPS 或 localhost）。不支援時會提示改用「下載 PNG」。
- 每個區域能容納的字數受限於該區域的內接矩形。4 圈中央的四重交集特別小，超過約 4 個全形字就會在最小字級（畫布 2.5%）下超出框線。想塞長句請改用單圈或雙圈的槽。

## 授權

程式碼採 MIT，見 [LICENSE](./LICENSE)。

隨 repo 附的字型 Noto Sans TC Bold 採 SIL Open Font License，條文在 [`assets/fonts/OFL.txt`](./assets/fonts/OFL.txt)，與字型檔一起散布。
