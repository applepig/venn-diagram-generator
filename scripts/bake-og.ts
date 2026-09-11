// build 後處理：把首頁（無 s）的 OG 圖烤成帶 content hash 的靜態檔，
// 讓社群爬蟲抓到的是 Cloudflare 一定快取得到的檔案，而不是每次都打 /api/og.png。
// 用法：pnpm tsx scripts/bake-og.ts（pnpm build 會在 build:ui 之後自動跑）
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderOgPng } from '../server/render-og';
import { sampleState } from '../engine/defaults';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FONT_FILE = resolve(ROOT, 'assets/fonts/NotoSansTC-Bold.otf');
const OG_BASE_FILE = resolve(ROOT, 'ui/public/og-base.png');
const DIST_DIR = resolve(ROOT, process.env.VENN_DIST ?? 'dist');

// sampleState() 就是首頁沒有 s 時渲染的那份 state，跟 server 走同一個來源
const png = await renderOgPng(sampleState(), FONT_FILE, readFileSync(OG_BASE_FILE));
const hash = createHash('sha256').update(png).digest('hex').slice(0, 12);
const out_file = resolve(DIST_DIR, `og-default-${hash}.png`);

writeFileSync(out_file, png);
console.log(`baked ${out_file} (${png.byteLength} bytes)`);
