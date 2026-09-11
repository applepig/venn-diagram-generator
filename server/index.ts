import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { getRequestListener, serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { CACHE_FOREVER, createApp } from './app';
import type { DevServer } from './dev';

const PORT = Number(process.env.PORT ?? 3000);
const DIST_DIR = process.env.VENN_DIST ?? 'dist';
const FONT_FILE = process.env.VENN_FONT ?? 'assets/fonts/NotoSansTC-Bold.otf';

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || undefined;
// 只有正式站的 compose 會給：開發站與本機跑起來不該把數據送進 GTM
const GTM_ID = process.env.VENN_GTM_ID || undefined;
// 圖片右下角的浮水印文字（站名）；沒設就不畫，fork 出去的站不會掛到別人的網址
const WATERMARK = process.env.VENN_WATERMARK || undefined;
const DEV = process.env.VENN_DEV === '1';

async function main(): Promise<void> {
  if (!DEV) {
    const app = createApp({
      fontFile: resolve(FONT_FILE),
      ogBaseFile: resolve(DIST_DIR, 'og-base.png'),
      distDir: resolve(DIST_DIR),
      publicOrigin: PUBLIC_ORIGIN,
      gtmId: GTM_ID,
      watermark: WATERMARK,
    });
    // createApp 已先註冊 /api/png 與 /，這裡只接沒被吃掉的靜態資源
    app.use(
      '/*',
      serveStatic({
        root: DIST_DIR,
        // 烤好的 OG 圖檔名帶 content hash，改圖就換 URL，無限期快取是安全的。
        // Vite 的 hashed assets 同樣適用，但那是既有狀況，不在本次範圍。
        onFound: (path, c) => {
          if (/\/og-default-[0-9a-f]+\.png$/.test(path)) c.header('cache-control', CACHE_FOREVER);
        },
      }),
    );

    serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
      console.log(`venn server listening on http://0.0.0.0:${info.port}`);
    });
    return;
  }

  // dev：先開 http server 讓 Vite 的 HMR websocket 掛上去，再把兩層接起來
  const http_server = createServer();
  const { createDevServer } = await import('./dev');
  let dev: DevServer;
  try {
    dev = await createDevServer(http_server);
  } catch (err) {
    http_server.close();
    throw err;
  }

  const app = createApp({
    fontFile: resolve(FONT_FILE),
    ogBaseFile: resolve('ui/public/og-base.png'),
    publicOrigin: PUBLIC_ORIGIN,
    gtmId: GTM_ID,
    watermark: WATERMARK,
    loadIndexHtml: dev.loadIndexHtml,
  });

  const hono = getRequestListener(app.fetch);
  // Vite 先接前端資源與 HMR，沒接住的（/、/api/png、/robots.txt…）才落到 Hono
  http_server.on('request', (req, res) => {
    dev.middlewares(req, res, () => hono(req, res));
  });

  http_server.listen(PORT, '0.0.0.0', () => {
    console.log(`venn dev server listening on http://0.0.0.0:${PORT}`);
  });
}

void main();
