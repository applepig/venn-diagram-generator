# venn-diagram-generator

文氏圖 meme 產生器：填字 → 一鍵 PNG，參數編進 URL 可直出圖。玩具專案，遵循上層 `Dropbox/projects/CLAUDE.md` 玩具模式。

## 架構約束
- Nuxt 4 單一 app，`server/api/venn.png.get.ts` 與首頁共用 `shared/venn/` 下的純函式；SVG 是唯一渲染真相，PNG 只是 SVG 經 resvg 轉檔。
- 文字量測不依賴 DOM，用字元分類估寬，確保前後端版面一致。
- 字型檔隨 repo 走（`assets/fonts/`），不依賴系統字型；Docker image 內亦不安裝字型套件。
- 部署：Docker image → Cloudflare Tunnel → Traefik，hostname `venn.applepig.net`（見 `../cloudflare_deployment.md`）。

## 文件
- `docs/01-mvp/spec.md`：sprint SSOT。`docs/01-mvp/works.md`：工作紀錄。
