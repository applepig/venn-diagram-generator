import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderAsync } from '@resvg/resvg-js';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { sampleState } from '../content/state-presets';
import { MAX_STATE_PARAM_LEN } from '../engine/defaults';
import { escapeXml, renderSvg } from '../engine/render-svg';
import { StateError } from '../engine/state-codec';
import { decodeState, encodeState } from '../engine/state-codec-node';
import type { VennState } from '../engine/types';
import { OG_HEIGHT, OG_WIDTH, renderOgPng } from './render-og';

export interface AppOptions {
  fontFile: string;
  /** OG 合成底圖；production 指向 Vite dist，dev 指向 ui/public */
  ogBaseFile?: string;
  /** Vite build 產物目錄；沒給就只跑 API（測試用） */
  distDir?: string;
  /** og:image／og:url 用的對外 origin；沒給就照 forwarded 標頭推導 */
  publicOrigin?: string;
  /** GTM container id；沒給就完全不注入，開發站與測試不會送出數據 */
  gtmId?: string;
  /**
   * 圖片右下角浮水印的文字（部署用 VENN_WATERMARK 給，通常是站名）。
   * 沒給就不畫，fork 出去的站不會掛到別人的網址。
   */
  watermark?: string;
  /**
   * 取得要注入 meta 的 index.html。dev 模式用它換成 Vite 轉換過的原始檔，
   * 讓開發站和正式站共用同一份 meta 注入邏輯，不必維護第二套。
   */
  loadIndexHtml?: (url: string) => string | Promise<string>;
}

export const CACHE_FOREVER = 'public, max-age=31536000, immutable';

/**
 * og:image 的 cache 版號。server 不讀它，純粹是 cache-buster：
 * 底圖、版型或 template 文案改動時 bump，逼 CDN 與各社群平台重抓。
 * v2：2 圈 template 改「明天再說」、圖右下角加浮水印。
 * v3：合成時關掉浮水印，底圖已經有品牌名了（正式站目前輸出這版）。
 * v4：改成 build 時預烤靜態檔並加入 dither（開發中，未上線）。
 * v5：v3 與 v4 兩條線合併後的組合（無浮水印＋dither），兩邊都沒產出過，要蓋過 3 與 4。
 */
const OG_IMAGE_VERSION = 5;

/** 同時進行的點陣化上限：resvg 每張圖吃滿一條 worker thread，開太多只會一起變慢 */
const MAX_CONCURRENT_RENDERS = 3;
const RETRY_AFTER_SECONDS = 2;

/**
 * 對外 origin：設了 PUBLIC_ORIGIN 就以它為準，任何 forwarded 標頭都改不動；
 * 沒設才退回標頭推導（本機開發沒有固定 hostname）。
 */
function originOf(c: Context, public_origin?: string): string {
  if (public_origin) return public_origin;
  const url = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? url.host;
  return `${proto}://${host}`;
}

function titleOf(state: VennState): string {
  const labels = Object.entries(state.texts)
    .filter(([mask]) => Number.isInteger(Math.log2(Number(mask))))
    // 手動換行是排版用的，og:title 是單行文字：換行直接接起來，其餘空白才收成一格
    .map(([, slot]) =>
      slot.t
        .replace(/\s*\n\s*/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
  return labels.length > 0 ? `${labels.join(' × ')}｜${SITE_NAME}` : SITE_NAME;
}

/** 點陣化丟到 resvg 的 worker thread，避免大圖把 event loop 卡死（AC 1b） */
async function renderPng(
  state: VennState,
  font_file: string,
  watermark: string,
): Promise<Uint8Array> {
  const image = await renderAsync(renderSvg(state, { watermark }), {
    fitTo: { mode: 'width', value: state.size },
    font: { fontFiles: [font_file], loadSystemFonts: false, defaultFontFamily: 'Noto Sans TC' },
  });
  return image.asPng();
}

const FALLBACK_HTML = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>文氏圖產生器</title></head><body><p>前端尚未 build，請先執行 <code>pnpm build</code>。</p></body></html>`;

const SITE_NAME = '文氏圖產生器';
const DESCRIPTION = '填字就有的文氏圖產生器，狀態直接編在網址裡。';
/** 首頁的 <title> 與 og:title 都用 OG 底圖上的品牌文案；分享頁才走 titleOf() 顯示圖上的內容 */
const HOME_TITLE = '文氏圖產生器｜找不到哏圖不會自己做嗎？';
const IMAGE_ALT = '文氏圖產生器預覽圖';

/** GTM 的官方 snippet，只有 container id 抽成參數 */
function gtmHead(id: string): string {
  return `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');</script>`;
}

function gtmBody(id: string): string {
  return `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${id}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;
}

/**
 * 首頁的 structured data。只有 / 給，帶 s 的分享頁是 noindex，不需要也不該宣告成獨立作品。
 * 內容全是常數，沒有使用者輸入會進到這個 script。
 */
function jsonLd(origin: string): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: SITE_NAME,
    url: `${origin}/`,
    description: DESCRIPTION,
    applicationCategory: 'DesignApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript',
    inLanguage: 'zh-Hant',
    isAccessibleForFree: true,
  };
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

/**
 * build 後處理烤好的首頁 OG 圖檔名（`og-default-<contenthash>.png`）。
 * 檔名帶 hash，改圖就換 URL，Facebook 那邊自動失效；找不到就退回動態的 /api/og.png。
 * dev 走 middlewareMode 沒有 dist，也是走這條 fallback。
 * 不必處理殘留舊檔：vite 的 emptyOutDir 每次 build 都清空 dist，烤圖跑在它之後。
 */
function findBakedOg(dist_dir?: string): string | null {
  if (!dist_dir) return null;
  try {
    return readdirSync(dist_dir).find((name) => /^og-default-[0-9a-f]+\.png$/.test(name)) ?? null;
  } catch {
    return null;
  }
}

export function createApp(opts: AppOptions): Hono {
  const app = new Hono();
  const og_base = opts.ogBaseFile ? readFileSync(opts.ogBaseFile) : null;
  const baked_og = findBakedOg(opts.distDir);

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

  const no_store = { 'cache-control': 'no-store' };

  app.get('/api/png', async (c) => {
    const s = c.req.query('s');
    if (!s) return c.json({ error: '缺少狀態參數 s' }, 400, no_store);
    // 長度是 HTTP 層的信任邊界：超長的一律不進 decode
    if (s.length > MAX_STATE_PARAM_LEN)
      return c.json({ error: '狀態參數過長' }, 400, no_store);

    let state: VennState;
    try {
      state = decodeState(s);
    } catch (err) {
      const message = err instanceof StateError ? err.message : '狀態參數無效';
      return c.json({ error: message }, 400, no_store);
    }

    if (in_flight >= MAX_CONCURRENT_RENDERS) {
      return c.json({ error: '目前渲染忙碌，請稍後再試' }, 503, {
        'retry-after': String(RETRY_AFTER_SECONDS),
        'cache-control': 'no-store',
      });
    }

    in_flight++;
    let png: Uint8Array;
    try {
      png = await renderPng(state, opts.fontFile, opts.watermark ?? '');
    } finally {
      in_flight--;
    }

    return c.body(png as unknown as ArrayBuffer, 200, {
      'content-type': 'image/png',
      'cache-control': CACHE_FOREVER,
    });
  });

  app.get('/api/og.png', async (c) => {
    const s = c.req.query('s');
    let state: VennState;
    if (s === undefined) {
      state = sampleState();
    } else {
      if (s.length > MAX_STATE_PARAM_LEN)
        return c.json({ error: '狀態參數過長' }, 400, no_store);
      try {
        state = decodeState(s);
      } catch (err) {
        const message = err instanceof StateError ? err.message : '狀態參數無效';
        return c.json({ error: message }, 400, no_store);
      }
    }

    if (!og_base) {
      return c.json({ error: 'OG 底圖未設定' }, 500, no_store);
    }
    if (in_flight >= MAX_CONCURRENT_RENDERS) {
      return c.json({ error: '目前渲染忙碌，請稍後再試' }, 503, {
        'retry-after': String(RETRY_AFTER_SECONDS),
        'cache-control': 'no-store',
      });
    }

    in_flight++;
    let png: Uint8Array;
    try {
      png = await renderOgPng(state, opts.fontFile, og_base);
    } finally {
      in_flight--;
    }

    return c.body(png as unknown as ArrayBuffer, 200, {
      'content-type': 'image/png',
      'cache-control': CACHE_FOREVER,
    });
  });

  app.get('/', async (c) => {
    const s = c.req.query('s');
    let state: VennState;
    let param: string;
    let shared = true;
    try {
      if (!s) throw new StateError('沒有狀態參數');
      if (s.length > MAX_STATE_PARAM_LEN) throw new StateError('狀態參數過長');
      state = decodeState(s);
      param = s;
    } catch {
      // 壞掉的分享連結不該讓首頁掛掉，退回預設範例圖
      state = sampleState();
      param = encodeState(state);
      shared = false;
    }

    const origin = originOf(c, opts.publicOrigin);
    const og_png_url = `${origin}/api/og.png?v=${OG_IMAGE_VERSION}`;
    const default_image_url = baked_og ? `${origin}/${baked_og}` : og_png_url;
    const image_url = shared ? `${og_png_url}&s=${encodeState(state)}` : default_image_url;
    // og:url 一律帶 s，分享出去的卡片點回來就是那張圖；canonical 是給搜尋引擎的，首頁收斂到 /
    const share_url = `${origin}/?s=${param}`;
    const canonical_url = shared ? share_url : `${origin}/`;
    const og_title = shared ? titleOf(state) : HOME_TITLE;
    const meta = [
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="${escapeXml(SITE_NAME)}">`,
      `<meta property="og:locale" content="zh_TW">`,
      `<meta property="og:title" content="${escapeXml(og_title)}">`,
      `<meta property="og:description" content="${escapeXml(DESCRIPTION)}">`,
      `<meta property="og:image" content="${escapeXml(image_url)}">`,
      `<meta property="og:image:type" content="image/png">`,
      `<meta property="og:image:width" content="${OG_WIDTH}">`,
      `<meta property="og:image:height" content="${OG_HEIGHT}">`,
      `<meta property="og:image:alt" content="${escapeXml(IMAGE_ALT)}">`,
      `<meta property="og:url" content="${escapeXml(share_url)}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:title" content="${escapeXml(og_title)}">`,
      `<meta name="twitter:description" content="${escapeXml(DESCRIPTION)}">`,
      `<meta name="twitter:image" content="${escapeXml(image_url)}">`,
      `<meta name="twitter:image:alt" content="${escapeXml(IMAGE_ALT)}">`,
      `<meta name="description" content="${escapeXml(DESCRIPTION)}">`,
      `<link rel="canonical" href="${escapeXml(canonical_url)}">`,
      // 分享連結是使用者產生的無限 URL 空間，索引它們只會稀釋首頁；follow 保留讓爬蟲走回首頁
      shared
        ? `<meta name="robots" content="noindex, follow">`
        : `<meta name="robots" content="index, follow">`,
      shared ? '' : jsonLd(origin),
      // 畫布預覽與「下載 SVG」由前端自己 renderSvg，浮水印文字要跟 /api/png 同一個來源才 WYSIWYG
      opts.watermark ? `<meta name="venn:watermark" content="${escapeXml(opts.watermark)}">` : '',
      opts.gtmId ? gtmHead(opts.gtmId) : '',
    ].join('');

    const title = shared ? og_title : HOME_TITLE;
    const base = opts.loadIndexHtml ? await opts.loadIndexHtml(c.req.url) : readIndexHtml();
    const html = base
      .replace(/<title>[^<]*<\/title>/, `<title>${escapeXml(title)}</title>`)
      .replace('</head>', `${meta}</head>`)
      .replace('<body>', `<body>${opts.gtmId ? gtmBody(opts.gtmId) : ''}`);
    return c.html(html, 200, { 'cache-control': 'no-cache' });
  });

  app.get('/robots.txt', (c) => {
    const origin = originOf(c, opts.publicOrigin);
    // 不 Disallow ?s=：那會連 og 卡片的爬蟲一起擋掉，索引交給頁面自己的 robots meta
    const body = `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
    return c.body(body, 200, { 'content-type': 'text/plain; charset=utf-8' });
  });

  app.get('/sitemap.xml', (c) => {
    const origin = originOf(c, opts.publicOrigin);
    // 只有首頁值得索引，分享頁是 noindex
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escapeXml(`${origin}/`)}</loc><changefreq>monthly</changefreq><priority>1.0</priority></url></urlset>\n`;
    return c.body(body, 200, { 'content-type': 'application/xml; charset=utf-8' });
  });

  return app;
}
