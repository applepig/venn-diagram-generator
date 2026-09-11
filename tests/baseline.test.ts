/**
 * AC1：既有分享連結的輸出必須位元級不變。
 *
 * golden（`tests/golden/baseline.json`）在 M0 用重構前的程式產出，之後任何 milestone 都不得修改：
 * 這裡紅了就是實作把輸出改掉了，改 golden 等於假造完成。要重產只有「行為已由使用者確認要變」一種情況。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { renderSvg } from '../engine/render-svg';
import { decodeState } from '../engine/state-codec-node';
import type { VennState } from '../engine/types';
import { FONT_FILE } from './helpers/font';

interface GoldenCase {
  id: string;
  ac: 'a' | 'b' | 'c';
  label: string;
  s: string;
  svg_sha256: string;
  png_sha256: string;
  og_png_sha256: string;
}

interface Golden {
  slot_masks_4: number[];
  palette: string[];
  cases: GoldenCase[];
}

const golden: Golden = JSON.parse(
  readFileSync(resolve('tests/golden/baseline.json'), 'utf8'),
) as Golden;

/** 正式站 `VENN_WATERMARK` 的值：golden 是帶這個浮水印凍的，SVG 與 /api/png 都要照同一個參數走 */
const WATERMARK = 'venn.applepig.net';

const app = createApp({
  fontFile: FONT_FILE,
  ogBaseFile: resolve('ui/public/og-base.png'),
  watermark: WATERMARK,
});
const ORIGIN = 'https://venn.applepig.net';

/** 點陣化一張 1200px 的圖約 0.3 秒，一個 case 兩張，預設 5 秒太緊 */
const RENDER_TIMEOUT = 30_000;

function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** 與 server 的 `/api/png` 同參數：浮水印文字由呼叫端傳入，golden 就是照這個參數凍的 */
function svgOf(state: VennState): string {
  return renderSvg(state, { watermark: WATERMARK });
}

async function pngSha256(path: string): Promise<string> {
  const res = await app.request(`${ORIGIN}${path}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/png');
  return sha256(new Uint8Array(await res.arrayBuffer()));
}

function statesByAc(ac: GoldenCase['ac']): VennState[] {
  return golden.cases.filter((c) => c.ac === ac).map((c) => decodeState(c.s));
}

describe('AC1 golden：重構前後的輸出逐位元相同', () => {
  for (const item of golden.cases) {
    it(
      `${item.id}（${item.label}）的 SVG、/api/png、/api/og.png 雜湊與 golden 相同`,
      async () => {
        const state = decodeState(item.s);

        expect(sha256(svgOf(state))).toBe(item.svg_sha256);
        expect(await pngSha256(`/api/png?s=${item.s}`)).toBe(item.png_sha256);
        expect(await pngSha256(`/api/og.png?s=${item.s}`)).toBe(item.og_png_sha256);
      },
      RENDER_TIMEOUT,
    );
  }
});

/**
 * golden 自身要覆蓋 AC1 列的每一項。刪 case 或把 case 改簡單也能讓上面那組全綠，
 * 這組就是那條路的閘門。
 */
describe('AC1 golden 的覆蓋範圍', () => {
  it('(a) 三組 zh template 各一個 case，圈數 2／3／4', () => {
    expect(statesByAc('a').map((s) => s.n)).toEqual([2, 3, 4]);
    for (const state of statesByAc('a')) {
      expect(Object.keys(state.texts).length).toBeGreaterThan(0);
    }
  });

  it('(b) 4 圈 13 槽全填（含 7、11、13、14）、帶 fs／dx／dy／fill、自訂 colors、三種 style 各一', () => {
    const states = statesByAc('b');
    expect(states.map((s) => s.style).sort()).toEqual(['flat', 'outline', 'translucent']);

    for (const state of states) {
      expect(state.n).toBe(4);
      expect(Object.keys(state.texts).map(Number).sort((a, b) => a - b)).toEqual(
        [...golden.slot_masks_4].sort((a, b) => a - b),
      );
      for (const mask of [7, 11, 13, 14]) {
        expect(state.texts[String(mask)]?.t).toBeTruthy();
      }

      const slots = Object.values(state.texts);
      expect(slots.some((slot) => slot.fs !== undefined)).toBe(true);
      expect(slots.some((slot) => slot.dx !== undefined)).toBe(true);
      expect(slots.some((slot) => slot.dy !== undefined)).toBe(true);
      expect(slots.some((slot) => slot.fill !== undefined)).toBe(true);

      expect(state.colors).not.toEqual(golden.palette.slice(0, 4));
    }
  });

  it('(c) 4 圈 overlap 0.6 與 1.6 各一個 case', () => {
    const states = statesByAc('c');
    expect(states.map((s) => s.n)).toEqual([4, 4]);
    expect(states.map((s) => s.overlap).sort()).toEqual([0.6, 1.6]);
  });

  it('(d) 每個 case 都記了三個 sha256，且沒有重複的 case id', () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(8);
    for (const item of golden.cases) {
      for (const hash of [item.svg_sha256, item.png_sha256, item.og_png_sha256]) {
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      }
    }
    expect(new Set(golden.cases.map((c) => c.id)).size).toBe(golden.cases.length);
  });
});
