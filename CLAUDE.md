# venn-diagram-generator

文氏圖 meme 產生器：WYSIWYG 單頁編輯器，狀態編進 URL，server 出 PNG 與 og:image。玩具專案，遵循上層 `Dropbox/projects/CLAUDE.md` 玩具模式。

## 架構約束
- SVG 是唯一渲染真相：`shared/` 下的純函式（layout、render-svg、state 編解碼）前後端共用；PNG 只是 SVG 經 `@resvg/resvg-js` 轉檔，不得出現第二套繪圖邏輯。
- 文字量測不依賴 DOM，用字元分類估寬，確保前後端版面一致。
- 圓的位置只由 state 的 n／overlap／radius 推得，不存座標。
- 字型檔隨 repo 走（`assets/fonts/`），不依賴系統字型；Docker image 內亦不安裝字型套件。
- 前端 Vite + vanilla TS，server Hono；部署 Docker → Traefik → Cloudflare Tunnel，hostname `venn.applepig.net`（見 `../cloudflare_deployment.md`）。

## 文件
- `docs/01-mvp/spec.md`：sprint SSOT。`docs/01-mvp/works.md`：工作紀錄。`docs/01-mvp/prototype/venn.mjs`：比例與演算法驗證用的 throwaway 腳本，只作參考。
