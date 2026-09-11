# venn-diagram-generator

文氏圖產生器：WYSIWYG 單頁編輯器，狀態編進 URL，server 出 PNG 與 og:image。小型專案，流程從輕：需求清楚就直接寫 spec、切 task、實作。

## 架構約束
- SVG 是唯一渲染真相：`engine/` 下的純函式（layout、render-svg、state 編解碼）前後端共用；PNG 只是 SVG 經 `@resvg/resvg-js` 轉檔，不得出現第二套繪圖邏輯。
- 文字量測不依賴 DOM，用字元分類估寬，確保前後端版面一致。
- 圓的位置只由 state 的 arr／n／overlap／radius 推得，不存座標。
- 產品內容（template、色票、介面字串）在 `content/`，engine 零產品內容。
- 字型檔隨 repo 走（`assets/fonts/`），不依賴系統字型；Docker image 內亦不安裝字型套件。
- 前端 Vite + vanilla TS，server Hono；部署走 Docker + 反向代理（`deploy/compose.yml`），主機、hostname 與路徑全部由 env 提供，不寫進 repo。
- 單一入口：dev 用 Vite middlewareMode 掛進 Hono，`/`、`/api/png`、`/robots.txt` 全走 server 既有邏輯，SEO／og meta 不得出現第二套注入。開發站（`deploy/compose.dev.yml`）掛原始碼熱更新、不 build image，且刻意不給 `VENN_GTM_ID`，數據才不會混進正式站。

## 文件
- sprint 文件（`docs/`）不進版控（見 `.gitignore`）：spec 與工作紀錄留在本機工作目錄，repo 只放 README 與程式碼。
- 對外說明是 `README.md`（英文）與 `README.zh-TW.md`（中文）：行為或 env 契約有變動時，兩份一起更新。
