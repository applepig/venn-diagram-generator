import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { SLOT_MASKS } from '../engine/defaults';
import { circlesFor, maskAt } from '../engine/layout';
import { regionPaths } from '../engine/region-geometry';
import type { Circle } from '../engine/types';

/**
 * 判準：把每個區域塗成一個可辨識的純色後，畫布上任一點的像素顏色
 * 必須等於「該點座標用 maskAt 算出來的區域」的顏色。
 * 顏色不對＝區域歸屬錯；背景色出現在圓內＝有縫隙或漏區域。
 */
const SIZE = 400;
const BG = '#ffffff';
const MASK_COLORS = [
  BG,
  '#ff0000',
  '#00ff00',
  '#0000ff',
  '#ffff00',
  '#ff00ff',
  '#00ffff',
  '#800000',
  '#008000',
  '#000080',
  '#808000',
  '#800080',
  '#008080',
  '#404040',
  '#c0c0c0',
  '#101010',
];

function svgOf(circles: Circle[], size: number, reverse: boolean): string {
  const entries = [...regionPaths(circles, size).entries()];
  if (reverse) entries.reverse();
  const body = entries
    .map(([mask, d]) => `<path d="${d}" fill="${MASK_COLORS[mask]}" fill-rule="evenodd"/>`)
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="100%" height="100%" fill="${BG}"/>${body}</svg>`
  );
}

function pixelReader(svg: string, size: number): (px: number, py: number) => string {
  const px_buf = new Resvg(svg).render().pixels;
  return (x, y) => {
    const o = (y * size + x) * 4;
    return `#${[0, 1, 2].map((k) => px_buf[o + k]!.toString(16).padStart(2, '0')).join('')}`;
  };
}

/**
 * 掃過整張畫布比對顏色；正反兩種繪製順序都掃，
 * 這樣「A 區域畫太大蓋到 B」不會因為 B 後畫蓋回去而被漏掉。
 */
function scan(circles: Circle[], size = SIZE) {
  const readers = [false, true].map((reverse) => pixelReader(svgOf(circles, size, reverse), size));
  const seen = new Set<number>();
  const wrong: string[] = [];
  const STEP = 4;
  // 邊界 2px 內是抗鋸齒漸層，不列入純色比對
  const EDGE_SKIP = 2 / size;

  for (let y = 2; y < size; y += STEP) {
    for (let x = 2; x < size; x += STEP) {
      const ux = (x + 0.5) / size;
      const uy = (y + 0.5) / size;
      if (circles.some((c) => Math.abs(Math.hypot(ux - c.x, uy - c.y) - c.r) < EDGE_SKIP)) continue;

      const mask = maskAt(circles, ux, uy);
      seen.add(mask);
      for (const read of readers) {
        const got = read(x, y);
        if (got !== MASK_COLORS[mask]) {
          wrong.push(`(${x},${y}) mask=${mask} 期望 ${MASK_COLORS[mask]} 實得 ${got}`);
        }
      }
    }
  }
  return { wrong: wrong.slice(0, 5), seen: [...seen].sort((a, b) => a - b) };
}

describe('regionPaths：區域邊界由弧段串成', () => {
  it('2 圈預設幾何：3 個區域各自填對顏色，彼此之間沒有縫隙', () => {
    const { wrong, seen } = scan(circlesFor(2, 0.3, 1.2));

    expect(wrong).toEqual([]);
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it('3 圈預設幾何：7 個區域全部存在且填對顏色', () => {
    const { wrong, seen } = scan(circlesFor(3, 0.29, 1.15));

    expect(wrong).toEqual([]);
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('4 圈預設幾何：spec 的 9 個文字槽區域都填得出來', () => {
    const circles = circlesFor(4, 0.27, 1.15);
    const { wrong, seen } = scan(circles);
    const paths = regionPaths(circles, SIZE);

    expect(wrong).toEqual([]);
    for (const mask of SLOT_MASKS[4]) expect(paths.has(mask)).toBe(true);
    expect(seen).toContain(15);
  });

  it('4 圈 overlap 拉到 1.6：對角兩圈不再相交，仍不出現縫隙', () => {
    // 對角圓心距 = 1.6r × √2 > 2r，這組幾何裡「有些圓對沒有交點」
    const { wrong } = scan(circlesFor(4, 0.27, 1.6));

    expect(wrong).toEqual([]);
  });

  it('overlap 縮到 1.0 讓區域極度重疊時仍填得正確', () => {
    const { wrong } = scan(circlesFor(3, 0.29, 1.0));

    expect(wrong).toEqual([]);
  });
});

describe('regionPaths：沒有交點的圓', () => {
  it('完全分離的兩圈：各自一塊，交集區不輸出路徑', () => {
    const circles: Circle[] = [
      { x: 0.25, y: 0.5, r: 0.15 },
      { x: 0.75, y: 0.5, r: 0.15 },
    ];
    const { wrong, seen } = scan(circles);

    expect(wrong).toEqual([]);
    expect(seen).toEqual([0, 1, 2]);
    expect(regionPaths(circles, SIZE).has(3)).toBe(false);
  });

  it('一圈完全包在另一圈裡：外圈是環狀區域，內圈是交集區', () => {
    const circles: Circle[] = [
      { x: 0.5, y: 0.5, r: 0.35 },
      { x: 0.58, y: 0.5, r: 0.12 },
    ];
    const { wrong, seen } = scan(circles);
    const paths = regionPaths(circles, SIZE);

    expect(wrong).toEqual([]);
    // 只屬於小圈的區域不存在
    expect(seen).toEqual([0, 1, 3]);
    expect(paths.has(2)).toBe(false);
    expect(paths.has(1)).toBe(true);
    expect(paths.has(3)).toBe(true);
  });

  it('三圈全部分離：三塊互不相連的單圈區域', () => {
    const circles: Circle[] = [
      { x: 0.2, y: 0.25, r: 0.12 },
      { x: 0.75, y: 0.25, r: 0.12 },
      { x: 0.5, y: 0.75, r: 0.12 },
    ];
    const { wrong, seen } = scan(circles);

    expect(wrong).toEqual([]);
    expect(seen).toEqual([0, 1, 2, 4]);
  });
});

describe('regionPaths：輸出形式', () => {
  it('每個區域是單一 path，只用弧段指令，不用 clipPath', () => {
    const paths = regionPaths(circlesFor(3, 0.29, 1.15), 1200);

    for (const d of paths.values()) {
      expect(d.startsWith('M')).toBe(true);
      expect(d.endsWith('Z')).toBe(true);
      expect(d).toMatch(/A/);
      // 只准 M / A / Z，出現 L、C 之類代表不是純弧段路徑
      expect(d.replace(/[-0-9.\s]/g, '')).toMatch(/^[MAZ]+$/);
    }
  });

  it('路徑座標隨 size 等比放大', () => {
    const circles = circlesFor(2, 0.3, 1.2);
    const numbers = (d: string) => d.match(/-?[\d.]+/g)!.map(Number);
    const small = numbers(regionPaths(circles, 400).get(3)!);
    const big = numbers(regionPaths(circles, 800).get(3)!);

    expect(big).toHaveLength(small.length);
    // 弧段指令裡的 flag（0/1）不縮放，只比對明顯是座標的大數字
    for (let i = 0; i < small.length; i++) {
      if (small[i]! > 2) expect(big[i]!).toBeCloseTo(small[i]! * 2, 1);
    }
  });
});
