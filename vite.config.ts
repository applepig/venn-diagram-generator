import { defineConfig } from 'vite';

// dev 走 server/dev.ts 的 middlewareMode，Host 檢查要放行開發站的 hostname
const dev_host = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).hostname : '';

export default defineConfig({
  root: 'web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    // 字型放在 repo 的 assets/，在 Vite root 之外
    fs: { allow: ['..'] },
    allowedHosts: dev_host ? [dev_host] : [],
  },
});
