import { describe, expect, it } from 'vitest';
import { sampleState } from '../content/state-presets';
import { popCount } from '../engine/defaults';
import { layout, slotMasks } from '../engine/layout';
import {
  ARRANGEMENTS,
  circleCountRange,
  circlesFor,
  isShape,
  shapeDefaults,
} from '../engine/shapes/index';
import { ringRadius } from '../engine/shapes/ring';
import type { Arrangement, Circle, CircleCount, VennState } from '../engine/types';

/**
 * AC2：重構前 `engine/defaults.ts` 的 `SLOT_MASKS` 字面值，凍在測試裡當比對基準。
 * 順序也是規格（popCount 遞增、同 popCount 依 mask 遞增）：UI 槽列表照這個順序排。
 */
const LEGACY_SLOT_MASKS: Record<number, number[]> = {
  2: [1, 2, 3],
  3: [1, 2, 4, 3, 5, 6, 7],
  4: [1, 2, 4, 8, 3, 5, 10, 12, 7, 11, 13, 14, 15],
};

/**
 * AC3：重構前 `circlesFor()` 的 switch 原樣搬進測試當 oracle。
 * 這份程式碼是既有分享連結的圓心與半徑的唯一真相，不得跟著實作一起改。
 */
function legacyCirclesFor(n: 2 | 3 | 4, radius: number, overlap: number): Circle[] {
  const cx = 0.5;
  const cy = 0.5;
  const r = radius;
  const d = overlap * r;

  if (n === 2) {
    return [
      { x: cx - d / 2, y: cy, r },
      { x: cx + d / 2, y: cy, r },
    ];
  }

  if (n === 3) {
    const ring = d / Math.sqrt(3);
    const gy = cy + ring * 0.25;
    return [-90, 150, 30].map((deg) => {
      const a = (deg * Math.PI) / 180;
      return { x: cx + ring * Math.cos(a), y: gy + ring * Math.sin(a), r };
    });
  }

  const h = d / 2;
  return [
    { x: cx - h, y: cy - h, r },
    { x: cx + h, y: cy - h, r },
    { x: cx - h, y: cy + h, r },
    { x: cx + h, y: cy + h, r },
  ];
}

/** 預設幾何、golden 用過的值、滑桿兩端：AC3 要在整個輸入域上成立，不只在預設值 */
const GEOMETRIES: [number, number][] = [
  [0.3, 1.2],
  [0.29, 1.15],
  [0.33, 0.8],
  [0.33, 0.6],
  [0.33, 1.6],
  [0.2, 0.6],
  [0.35, 1.6],
  [0.24, 1.33],
  [0.27, 1.0],
];

function centroid(circles: Circle[]): { x: number; y: number } {
  return {
    x: circles.reduce((sum, c) => sum + c.x, 0) / circles.length,
    y: circles.reduce((sum, c) => sum + c.y, 0) / circles.length,
  };
}

function minCenterDistance(circles: Circle[]): number {
  let min = Infinity;
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      min = Math.min(min, Math.hypot(circles[i]!.x - circles[j]!.x, circles[i]!.y - circles[j]!.y));
    }
  }
  return min;
}

describe('AC3 ring 的圓心與半徑與重構前一致', () => {
  for (const n of [2, 3, 4] as const) {
    it(`ring(${n}) 每個 index 的圓心與半徑與舊 switch 差 < 1e-12`, () => {
      for (const [radius, overlap] of GEOMETRIES) {
        const got = circlesFor('ring', n, radius, overlap);
        const want = legacyCirclesFor(n, radius, overlap);

        expect(got).toHaveLength(want.length);
        got.forEach((circle, i) => {
          const label = `n=${n} r=${radius} o=${overlap} i=${i}`;
          expect(Math.abs(circle.x - want[i]!.x), `${label} x`).toBeLessThan(1e-12);
          expect(Math.abs(circle.y - want[i]!.y), `${label} y`).toBeLessThan(1e-12);
          expect(Math.abs(circle.r - want[i]!.r), `${label} r`).toBeLessThan(1e-12);
        });
      }
    });
  }

  it('4 圈維持方陣順序（0 左上、1 右上、2 左下、3 右下），顏色不會整組錯位', () => {
    const [tl, tr, bl, br] = circlesFor('ring', 4, 0.33, 0.8);

    expect(tl!.x).toBeLessThan(tr!.x);
    expect(bl!.x).toBeLessThan(br!.x);
    expect(tl!.y).toBeLessThan(bl!.y);
    expect(tr!.y).toBeLessThan(br!.y);
  });

  it('3 圈維持 index 1 在左下、index 2 在右下', () => {
    const [top, left, right] = circlesFor('ring', 3, 0.29, 1.15);

    expect(top!.y).toBeLessThan(left!.y);
    expect(left!.x).toBeLessThan(top!.x);
    expect(right!.x).toBeGreaterThan(top!.x);
    expect(left!.y).toBeCloseTo(right!.y, 12);
  });
});

describe('ring(n)：環半徑 R = overlap·r / (2·sin(π/n))', () => {
  for (const n of [2, 3, 4, 5, 6] as CircleCount[]) {
    it(`ring(${n}) 每顆圓都落在半徑 R 的環上，相鄰圓心距等於 overlap·r`, () => {
      const radius = 0.24;
      const overlap = 1.1;
      const circles = circlesFor('ring', n, radius, overlap);
      const center = centroid(circles);
      const expected_r = ringRadius(n, radius, overlap);

      expect(circles).toHaveLength(n);
      for (const c of circles) {
        expect(Math.hypot(c.x - center.x, c.y - center.y)).toBeCloseTo(expected_r, 12);
        expect(c.r).toBe(radius);
      }
      expect(minCenterDistance(circles)).toBeCloseTo(overlap * radius, 12);
    });
  }

  it('5 圈與 6 圈從 −90° 起順時針：index 0 在最上方', () => {
    for (const n of [5, 6] as CircleCount[]) {
      const circles = circlesFor('ring', n, 0.24, 1.1);
      const top = Math.min(...circles.map((c) => c.y));

      expect(circles[0]!.y, `n=${n}`).toBeCloseTo(top, 12);
      expect(circles[0]!.x, `n=${n}`).toBeCloseTo(0.5, 12);
      // 順時針（y 往下為正）：下一顆在右邊
      expect(circles[1]!.x, `n=${n}`).toBeGreaterThan(circles[0]!.x);
    }
  });
});

describe('row(n)：水平一列，index 由左到右', () => {
  for (const n of [3, 4, 5, 6] as CircleCount[]) {
    it(`row(${n}) 圓心等距排在 y=0.5 上、整列以畫布中線為中心`, () => {
      const radius = 0.2;
      const overlap = 0.9;
      const circles = circlesFor('row', n, radius, overlap);

      expect(circles).toHaveLength(n);
      for (const c of circles) {
        expect(c.y).toBe(0.5);
        expect(c.r).toBe(radius);
      }
      for (let i = 1; i < n; i++) {
        expect(circles[i]!.x - circles[i - 1]!.x).toBeCloseTo(overlap * radius, 12);
      }
      expect(centroid(circles).x).toBeCloseTo(0.5, 12);
    });
  }
});

describe('形狀 registry：合法組合', () => {
  it('ring 吃 2～6 圈、row 吃 3～6 圈', () => {
    expect(circleCountRange('ring')).toEqual([2, 6]);
    expect(circleCountRange('row')).toEqual([3, 6]);
    for (const n of [2, 3, 4, 5, 6]) expect(isShape('ring', n), `ring ${n}`).toBe(true);
    for (const n of [3, 4, 5, 6]) expect(isShape('row', n), `row ${n}`).toBe(true);
  });

  it('ring(1)、ring(7)、row(2) 都不是合法組合', () => {
    expect(isShape('ring', 1)).toBe(false);
    expect(isShape('ring', 7)).toBe(false);
    expect(isShape('row', 2)).toBe(false);
    expect(isShape('ring', 3.5)).toBe(false);
  });

  it('ring 2／3／4 的預設幾何維持既有值', () => {
    expect(shapeDefaults('ring', 2)).toEqual({ radius: 0.3, overlap: 1.2 });
    expect(shapeDefaults('ring', 3)).toEqual({ radius: 0.29, overlap: 1.15 });
    expect(shapeDefaults('ring', 4)).toEqual({ radius: 0.33, overlap: 0.8 });
  });

  it('每個合法組合的預設幾何都在 codec 允許的範圍內，圓不超出畫布', () => {
    for (const arr of ARRANGEMENTS) {
      const [min_n, max_n] = circleCountRange(arr);
      for (let n = min_n; n <= max_n; n++) {
        const { radius, overlap } = shapeDefaults(arr, n as CircleCount);
        const label = `${arr}(${n})`;

        expect(radius, `${label} radius`).toBeGreaterThanOrEqual(0.2);
        expect(radius, `${label} radius`).toBeLessThanOrEqual(0.35);
        expect(overlap, `${label} overlap`).toBeGreaterThanOrEqual(0.6);
        expect(overlap, `${label} overlap`).toBeLessThanOrEqual(1.6);

        for (const c of circlesFor(arr, n as CircleCount, radius, overlap)) {
          expect(c.x - c.r, `${label} 左`).toBeGreaterThanOrEqual(-1e-12);
          expect(c.x + c.r, `${label} 右`).toBeLessThanOrEqual(1 + 1e-12);
          expect(c.y - c.r, `${label} 上`).toBeGreaterThanOrEqual(-1e-12);
          expect(c.y + c.r, `${label} 下`).toBeLessThanOrEqual(1 + 1e-12);
        }
      }
    }
  });
});

describe('AC2 slotMasks：從預設幾何推出的常數', () => {
  for (const n of [2, 3, 4] as CircleCount[]) {
    it(`slotMasks('ring', ${n}) 與重構前的 SLOT_MASKS 逐項相等（含順序）`, () => {
      expect(slotMasks('ring', n)).toEqual(LEGACY_SLOT_MASKS[n]);
    });
  }

  it('白名單不吃 state 幾何：4 圈 overlap 1.6 下消失的區域仍在槽表裡', () => {
    const base = sampleState(4);
    const state: VennState = {
      ...base,
      overlap: 1.6,
      texts: Object.fromEntries(LEGACY_SLOT_MASKS[4]!.map((mask) => [String(mask), { t: '甲' }])),
    };
    const rendered = new Set(layout(state).map((block) => block.mask));

    // 這個幾何下四重區真的不存在（否則下一句的斷言證明不了「不吃 state 幾何」）
    expect(rendered.has(15)).toBe(false);
    expect(slotMasks('ring', 4)).toContain(15);
  });

  /**
   * AC4 對新組合只要求「各能產出非空槽表」。
   * row 的中間圈在預設重疊度下沒有專屬區域（左右鄰圓把它夾掉，剩下的上下兩片薄月牙
   * 重心落在鄰圓內，`regionBox` 放不下框），所以只對首尾兩圈斷言單圈槽——
   * 要讓中間圈也有標籤，得把 row 的 radius 下限放寬到 0.2 以下，那是 M4 的預設幾何決策。
   */
  it('每個合法組合都推得出非空槽表，首尾兩圈與交集都有槽', () => {
    for (const arr of ARRANGEMENTS as Arrangement[]) {
      const [min_n, max_n] = circleCountRange(arr);
      for (let n = min_n; n <= max_n; n++) {
        const masks = slotMasks(arr, n as CircleCount);
        const label = `${arr}(${n})`;

        expect(masks.length, label).toBeGreaterThan(n);
        expect(masks, `${label} 第一圈`).toContain(1);
        expect(masks, `${label} 最後一圈`).toContain(1 << (n - 1));
        expect(
          masks.some((mask) => popCount(mask) > 1),
          `${label} 交集槽`,
        ).toBe(true);
        if (arr === 'ring') {
          for (let i = 0; i < n; i++) expect(masks, `${label} 第 ${i} 圈`).toContain(1 << i);
        }
      }
    }
  }, 30_000);
});
