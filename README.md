# venn-diagram-generator

單頁 WYSIWYG 文氏圖 meme 產生器：選 2／3／4 圈，在畫布上直接點字改字、拖動位置、調字級，一鍵下載社群可貼的 PNG。整份編輯狀態壓進網址的 `s` 參數，所以分享連結就是圖：貼進聊天軟體會透過 `og:image` 直接預覽。無登入、無浮水印、server 無狀態。

![編輯器](docs/01-mvp/samples/editor.png)

## 架構

SVG 是唯一的渲染真相。`shared/render-svg.ts` 的 `renderSvg(state)` 是純函式，前端把它的輸出直接塞進 DOM 當即時預覽，server 拿同一份輸出交給 `@resvg/resvg-js` 轉 PNG，所以預覽即所得。文字排版不依賴 DOM 量測，改用字元分類估寬（CJK 1em、其他 0.62em、空白 0.3em），前後端算出來的版面一致。

```
shared/   types、defaults、layout、render-svg、state-codec（前後端都只 import 這裡）
web/      Vite + vanilla TS 編輯器
server/   Hono：靜態檔、GET / 的 og meta 注射、GET /api/png
```

## URL 狀態格式

`?s=` 的內容是 `base64url(deflate-raw(JSON))`。瀏覽器用 `CompressionStream('deflate-raw')`，Node 用 `zlib.deflateRawSync`，同一個格式雙向通吃。解不開或 schema 不合一律回 400。

```jsonc
{
  "v": 1,                     // 狀態版本，必須是 1
  "n": 2,                     // 圈數：2 | 3 | 4
  "style": "translucent",     // translucent | flat | outline
  "opacity": 0.6,             // 0–1，只有 translucent 用得到
  "overlap": 1.2,             // 圓心距 / r，1.0–1.6
  "radius": 0.3,              // 圓半徑，畫布寬比例，0.2–0.35
  "colors": ["#2e9be6", "#e6a92e"],  // 長度必須等於 n
  "bg": "#fafafa",
  "size": 1200,               // 400–2000 的整數
  "texts": {                  // key 是成員圓 bitmask 的十進位字串
    "1": { "t": "工程師" },   //   circle i = bit i，所以 1=圓0、2=圓1、3=圓0∩圓1
    "2": { "t": "設計師" },
    "3": { "t": "會寫 CSS", "fs": 0.09, "dx": 0.01, "dy": -0.02 }
  }
}
```

`fs`（字級，畫布寬比例）、`dx`／`dy`（相對區域框中心的位移，畫布寬比例）只在使用者手動調過時才存在；沒有就是自動排版。每個文字槽上限 80 字。

各圈數的預設文字槽：2 圈給 3 個、3 圈給 7 個、4 圈是 2×2 花瓣所以給 9 個（4 單圈＋4 相鄰雙圈＋中央四重），對角雙圈與三重交集區域太細碎，不給槽。

## API

`GET /api/png?s=<state>` 回 `image/png`，尺寸等於 `state.size`，帶 `Cache-Control: public, max-age=31536000, immutable`（參數即內容，可以永久快取）。缺 `s`、解不開、schema 不合都回 400 JSON `{ "error": "..." }`。

```bash
# 先在瀏覽器編好圖，複製連結拿到 s，或用 Node 產一個
S=$(pnpm exec tsx -e "
import { encodeState } from './shared/state-codec-node';
import { sampleState } from './shared/defaults';
process.stdout.write(encodeState(sampleState()));")

curl -o venn.png "http://localhost:3000/api/png?s=$S"
```

## 本機開發

```bash
pnpm install
pnpm dev          # Vite 5173（會把 /api 轉給 3000）＋ Hono 3000
pnpm test         # Vitest
pnpm typecheck    # tsc --noEmit
pnpm build        # web → dist/，server → dist-server/
pnpm start        # 跑 build 好的 server，單一 port 3000
```

字型 Noto Sans TC Bold（OFL）放在 `assets/fonts/`，前端 `@font-face` 與 resvg 的 `fontFiles` 指同一個檔，image 內不安裝任何系統字型。

## Docker

```bash
docker build -t venn-diagram-generator .
docker run --rm -p 3000:3000 venn-diagram-generator
```

兩份 compose 共用同一個 Dockerfile 與 external network `web`，只差 Traefik 路由：

| 站 | 網址 | compose | entrypoint |
|---|---|---|---|
| 開發站 | `https://venn.dev.example` | `compose.dev.yml` | `websecure` + `tls`（本機 Traefik 的 `*.dev.example` wildcard 憑證） |
| 正式站 | `https://venn.applepig.net` | `compose.yml` | `web`（TLS 在 Cloudflare 終止） |

開發站跑在本機（`toybox`，REDACTED-IP），DNS 由 LAN 的 `*.dev.example` 泛解析負責：

```bash
docker compose -f compose.dev.yml up -d --build
```

正式站跑在 deploy-host（Oracle aarch64），架構是 Cloudflare Tunnel → Traefik → container，兩個 infra 容器都不 publish port，host 的 80/443 留給既有的 apache：

```
/srv/infra/compose.yml   traefik + cloudflared（共用 network web）
/srv/venn/          本 repo 的同步副本，用 compose.yml 起 container
```

更新正式站：

```bash
./scripts/deploy.sh          # rsync 到 deploy-host 後 docker compose up -d --build
```

## 注意事項

- 「複製圖片」用 `ClipboardItem`，需要 secure context（HTTPS 或 localhost）。不支援時會提示改用「下載 PNG」。
- 每個區域能容納的字數受限於該區域的內接矩形。4 圈中央的四重交集特別小，超過約 4 個全形字就會在最小字級（畫布 2.5%）下超出框線。想塞長句請改用單圈或雙圈的槽。
