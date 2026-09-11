import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderOgPng } from '../server/render-og';
import { sampleState } from '../content/state-presets';
import { FONT_FILES } from './helpers/font';
import { decodePng, meanRgb, pngPixel } from './helpers/png';

const OG_BASE = readFileSync(resolve('ui/public/og-base.png'));

describe('renderOgPng：AC1 dither', () => {
  it('逐像素與關掉 dither 的輸出不同，但全圖平均 RGB 每通道差 ≤ 1', async () => {
    const state = sampleState();
    const [dithered, plain] = await Promise.all([
      renderOgPng(state, FONT_FILES, OG_BASE),
      renderOgPng(state, FONT_FILES, OG_BASE, { dither: false }),
    ]);

    const a = decodePng(Buffer.from(dithered));
    const b = decodePng(Buffer.from(plain));
    expect(a.width).toBe(b.width);
    expect(a.pixels.equals(b.pixels)).toBe(false);

    // 雜訊要鋪滿整張圖，只動到幾顆像素也會通過上一條。
    // 上限不是 1：overlay 對接近純白／純黑是恆等運算，而底圖本來就有將近一半這種像素，
    // 加上 opacity 0.25 下不少差值會被四捨五入吃掉（實測變動 28%，單點最大差 15）。
    let differing = 0;
    for (let p = 0; p < a.width * a.height; p++) {
      const o = p * a.channels;
      if (
        a.pixels[o] !== b.pixels[o] ||
        a.pixels[o + 1] !== b.pixels[o + 1] ||
        a.pixels[o + 2] !== b.pixels[o + 2]
      )
        differing++;
    }
    expect(differing / (a.width * a.height)).toBeGreaterThan(0.2);

    // DC 中性：是抖動，不是提亮或降對比
    const mean_a = meanRgb(a);
    const mean_b = meanRgb(b);
    for (let ch = 0; ch < 3; ch++) {
      expect(Math.abs(mean_a[ch]! - mean_b[ch]!)).toBeLessThanOrEqual(1);
    }
  });

  it('同一個 state 連跑兩次輸出完全相同（固定 seed，build 才有決定性）', async () => {
    const state = sampleState();
    const [first, second] = await Promise.all([
      renderOgPng(state, FONT_FILES, OG_BASE),
      renderOgPng(state, FONT_FILES, OG_BASE),
    ]);

    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });
});

describe('renderOgPng：合成時關掉正方形畫布的浮水印', () => {
  it('圖表區右下與底圖逐像素相同，底圖品牌名不會被重複', async () => {
    // 關掉 dither 才能逐像素比對：dither 是鋪滿全圖的雜訊，與浮水印有沒有關掉正交
    const output = decodePng(
      Buffer.from(await renderOgPng(sampleState(), FONT_FILES, OG_BASE, { dither: false })),
    );
    const base = decodePng(OG_BASE);

    // 浮水印若沒關掉會落在圖表區右下：x 645+494*0.972≈1125 往左約 90px、基線 y≈548
    for (let x = 1040; x <= 1124; x += 6) {
      for (let y = 538; y <= 550; y += 3) {
        expect(pngPixel(output, x, y)).toEqual(pngPixel(base, x, y));
      }
    }
  });
});
