/**
 * 08 AC1：額外形狀選單列出哪些組合。
 * DOM 的開合行為留給瀏覽器實測，這裡守的是「選單上有什麼、按鈕該不該亮」這條純邏輯。
 */
import { describe, expect, it } from 'vitest';
import { LOCALES, t } from '../content/locale';
import { isExtraShape, shapeIcon, shapeMenuItems } from '../ui/shape-menu';
import { isShape } from '../engine/shapes/index';

describe('AC1 額外形狀選單的項目', () => {
  it('經典組合（ring 2／3／4）下只列四個額外形狀', () => {
    for (const n of [2, 3, 4] as const) {
      expect(shapeMenuItems('ring', n).map((item) => `${item.arr}${item.n}`)).toEqual([
        'row3',
        'row4',
        'ring5',
        'ring6',
      ]);
    }
  });

  it('目前就在某個額外形狀時不重複列它', () => {
    expect(shapeMenuItems('row', 3).map((item) => `${item.arr}${item.n}`)).toEqual([
      'row3',
      'row4',
      'ring5',
      'ring6',
    ]);
  });

  it('載入 UI 沒列出的組合時臨時插入一項，排在最後', () => {
    for (const n of [5, 6] as const) {
      const items = shapeMenuItems('row', n);

      expect(items).toHaveLength(5);
      expect(items[4]).toMatchObject({ arr: 'row', n });
    }
  });

  it('每一項都是合法組合', () => {
    for (const item of [...shapeMenuItems('ring', 2), ...shapeMenuItems('row', 6)]) {
      expect(isShape(item.arr, item.n), `${item.arr}(${item.n})`).toBe(true);
    }
  });

  it('每一項的標籤在三種語言都有文案', () => {
    for (const item of shapeMenuItems('row', 5).concat(shapeMenuItems('row', 6))) {
      for (const locale of LOCALES) {
        expect(t(item.key, locale), `${item.key} / ${locale}`).not.toBe('');
      }
    }
  });
});

/** 選到額外形狀後按鈕上換成示意圖，圖要真的是那個組合、且畫得進 icon 畫布 */
describe('額外形狀的示意圖', () => {
  const cases = [
    ['row', 3],
    ['row', 4],
    ['ring', 5],
    ['ring', 6],
  ] as const;

  it('圓的數量就是該組合的圈數', () => {
    for (const [arr, n] of cases) {
      expect(shapeIcon(arr, n).match(/<circle /g) ?? [], `${arr}(${n})`).toHaveLength(n);
    }
  });

  it('每顆圓連描邊都落在 40×22 的 icon 畫布內', () => {
    const STROKE = 1.6 / 2;
    for (const [arr, n] of cases) {
      const circles = [...shapeIcon(arr, n).matchAll(/cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)];

      for (const [, cx, cy, r] of circles) {
        const [x, y, radius] = [Number(cx), Number(cy), Number(r) + STROKE];

        expect(x - radius, `${arr}(${n})`).toBeGreaterThanOrEqual(0);
        expect(x + radius, `${arr}(${n})`).toBeLessThanOrEqual(40);
        expect(y - radius, `${arr}(${n})`).toBeGreaterThanOrEqual(0);
        expect(y + radius, `${arr}(${n})`).toBeLessThanOrEqual(22);
      }
    }
  });
});

describe('AC1 圈數 icon 與選單按鈕互斥', () => {
  it('ring 2／3／4 不算額外形狀（按鈕不亮）', () => {
    for (const n of [2, 3, 4] as const) expect(isExtraShape('ring', n)).toBe(false);
  });

  it('選單裡的組合與 row(5)／row(6) 都算額外形狀（按鈕亮）', () => {
    for (const [arr, n] of [
      ['row', 3],
      ['row', 4],
      ['ring', 5],
      ['ring', 6],
      ['row', 5],
      ['row', 6],
    ] as const) {
      expect(isExtraShape(arr, n), `${arr}(${n})`).toBe(true);
    }
  });
});
