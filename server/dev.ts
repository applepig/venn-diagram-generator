import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import type { ViteDevServer } from 'vite';

export interface DevServer {
  /** 掛在 http server 前面：Vite 沒接住的請求才往下交給 Hono */
  middlewares: ViteDevServer['middlewares'];
  /** 讀 ui/index.html 並跑 Vite 轉換（注入 HMR client、解析 /main.ts） */
  loadIndexHtml: (url: string) => Promise<string>;
  close: () => Promise<void>;
}

/**
 * dev 模式的 Vite：middlewareMode 讓前端資源與 HMR 跟 API 共用同一個 port，
 * 所以 /、/api/png、/robots.txt 全部照走 Hono 的既有邏輯，og meta 不必寫第二份。
 * 只在 VENN_DEV=1 時載入，正式 image 的 bundle 不會碰到 vite。
 */
export async function createDevServer(http_server: Server): Promise<DevServer> {
  const { createServer } = await import('vite');
  const vite = await createServer({
    appType: 'custom',
    server: {
      middlewareMode: true,
      // HMR 的 websocket 掛在同一個 http server 上，經 Traefik 就是同 origin 的 wss
      hmr: { server: http_server },
    },
  });

  const index_file = resolve('ui/index.html');

  return {
    middlewares: vite.middlewares,
    async loadIndexHtml(url) {
      return vite.transformIndexHtml(url, await readFile(index_file, 'utf8'));
    },
    close: () => vite.close(),
  };
}
