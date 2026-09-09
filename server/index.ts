import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app';

const PORT = Number(process.env.PORT ?? 3000);
const DIST_DIR = process.env.VENN_DIST ?? 'dist';
const FONT_FILE = process.env.VENN_FONT ?? 'assets/fonts/NotoSansTC-Bold.otf';

const app = createApp({ fontFile: resolve(FONT_FILE), distDir: resolve(DIST_DIR) });

// createApp 已先註冊 /api/png 與 /，這裡只接沒被吃掉的靜態資源
app.use('/*', serveStatic({ root: DIST_DIR }));

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`venn server listening on http://0.0.0.0:${info.port}`);
});
