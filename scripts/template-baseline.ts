// 量三組 template（不帶 fill）的 SVG 雜湊與 /api/png 位元組數，證明既有連結一張都沒被改到。
// 用法：pnpm tsx scripts/template-baseline.ts
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app';
import { sampleState } from '../shared/defaults';
import { renderSvg } from '../shared/render-svg';
import { encodeState } from '../shared/state-codec-node';
import type { CircleCount } from '../shared/types';

const FONT_FILE = fileURLToPath(new URL('../assets/fonts/NotoSansTC-Bold.otf', import.meta.url));
const app = createApp({ fontFile: FONT_FILE });

for (const n of [2, 3, 4] as CircleCount[]) {
  const state = sampleState(n);
  const svg_hash = createHash('sha256').update(renderSvg(state)).digest('hex').slice(0, 16);
  const res = await app.request(`https://venn.applepig.net/api/png?s=${encodeState(state)}`);
  const png_bytes = Buffer.from(await res.arrayBuffer()).byteLength;
  console.log(`n=${n} status=${res.status} svg_sha256=${svg_hash} png_bytes=${png_bytes}`);
}
