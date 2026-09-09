import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderAsync } from '@resvg/resvg-js';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { sampleState } from '../shared/defaults';
import { escapeXml, renderSvg } from '../shared/render-svg';
import { StateError } from '../shared/state-codec';
import { decodeState, encodeState } from '../shared/state-codec-node';
import type { VennState } from '../shared/types';

export interface AppOptions {
  fontFile: string;
  /** Vite build 產物目錄；沒給就只跑 API（測試用） */
  distDir?: string;
}

const CACHE_FOREVER = 'public, max-age=31536000, immutable';

/** 同時進行的點陣化上限：resvg 每張圖吃滿一條 worker thread，開太多只會一起變慢 */
const MAX_CONCURRENT_RENDERS = 3;
const RETRY_AFTER_SECONDS = 2;

/** 走在 Traefik / Cloudflare Tunnel 後面，絕對 URL 要看 forwarded 標頭 */
function originOf(c: Context): string {
  const url = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? url.host;
  return `${proto}://${host}`;
}

function titleOf(state: VennState): string {
  const labels = Object.entries(state.texts)
    .filter(([mask]) => Number.isInteger(Math.log2(Number(mask))))
    .map(([, slot]) => slot.t.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return labels.length > 0 ? `${labels.join(' × ')}｜文氏圖 meme` : '文氏圖 meme 產生器';
}

/** 點陣化丟到 resvg 的 worker thread，避免大圖把 event loop 卡死（AC 1b） */
async function renderPng(state: VennState, font_file: string): Promise<Uint8Array> {
  const image = await renderAsync(renderSvg(state), {
    fitTo: { mode: 'width', value: state.size },
    font: { fontFiles: [font_file], loadSystemFonts: false, defaultFontFamily: 'Noto Sans TC' },
  });
  return image.asPng();
}

const FALLBACK_HTML = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>文氏圖 meme 產生器</title></head><body><p>前端尚未 build，請先執行 <code>pnpm build</code>。</p></body></html>`;

export function createApp(opts: AppOptions): Hono {
  const app = new Hono();

  let index_html: string | null = null;
  const readIndexHtml = (): string => {
    if (index_html !== null) return index_html;
    if (!opts.distDir) return FALLBACK_HTML;
    try {
      index_html = readFileSync(join(opts.distDir, 'index.html'), 'utf8');
    } catch {
      index_html = FALLBACK_HTML;
    }
    return index_html;
  };

  let in_flight = 0;

  app.get('/api/png', async (c) => {
    const s = c.req.query('s');
    if (!s) return c.json({ error: '缺少狀態參數 s' }, 400);

    let state: VennState;
    try {
      state = decodeState(s);
    } catch (err) {
      const message = err instanceof StateError ? err.message : '狀態參數無效';
      return c.json({ error: message }, 400);
    }

    if (in_flight >= MAX_CONCURRENT_RENDERS) {
      return c.json({ error: '目前渲染忙碌，請稍後再試' }, 503, {
        'retry-after': String(RETRY_AFTER_SECONDS),
      });
    }

    in_flight++;
    let png: Uint8Array;
    try {
      png = await renderPng(state, opts.fontFile);
    } finally {
      in_flight--;
    }

    return c.body(png as unknown as ArrayBuffer, 200, {
      'content-type': 'image/png',
      'cache-control': CACHE_FOREVER,
    });
  });

  app.get('/', (c) => {
    const s = c.req.query('s');
    let state: VennState;
    let param: string;
    try {
      if (!s) throw new StateError('沒有狀態參數');
      state = decodeState(s);
      param = s;
    } catch {
      // 壞掉的分享連結不該讓首頁掛掉，退回預設範例圖
      state = sampleState();
      param = encodeState(state);
    }

    const origin = originOf(c);
    const image_url = `${origin}/api/png?s=${param}`;
    const title = titleOf(state);
    const description = '填字就有的文氏圖 meme 產生器，狀態直接編在網址裡。';
    const meta = [
      `<meta property="og:type" content="website">`,
      `<meta property="og:title" content="${escapeXml(title)}">`,
      `<meta property="og:description" content="${escapeXml(description)}">`,
      `<meta property="og:image" content="${escapeXml(image_url)}">`,
      `<meta property="og:image:width" content="${state.size}">`,
      `<meta property="og:image:height" content="${state.size}">`,
      `<meta property="og:url" content="${escapeXml(`${origin}/?s=${param}`)}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:title" content="${escapeXml(title)}">`,
      `<meta name="twitter:image" content="${escapeXml(image_url)}">`,
      `<meta name="description" content="${escapeXml(description)}">`,
    ].join('');

    const html = readIndexHtml().replace('</head>', `${meta}</head>`);
    return c.html(html, 200, { 'cache-control': 'no-cache' });
  });

  return app;
}
