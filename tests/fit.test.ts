/**
 * 09 AC1～AC8：圖區超界自動內縮（fit）。
 *
 * `radius × overlap` 的任何組合都不該讓圓（含描邊）被畫布切掉；預設幾何則必須一個位元都不動——
 * 後者的硬證據是 `tests/golden/baseline.json`（`tests/baseline.test.ts`），這裡守的是
 * 「變換本身是恆等物件」與「超界組合真的被塞回去」。
 */
import { describe, expect, it } from 'vitest';
import { defaultState } from '../content/state-presets';
import { OVERLAP_MAX, OVERLAP_MIN } from '../engine/defaults';
import { IDENTITY_TRANSFORM, STROKE_INSET, fitTransform } from '../engine/fit';
import { layout, regionExists, slotMasks } from '../engine/layout';
import {
  ARRANGEMENTS,
  circleCountRange,
  circlesFor,
  circlesForState,
  radiusRange,
  shapeDefaults,
} from '../engine/shapes/index';
import { TITLE_BAND_H, circlesForRender, diagramTransform, titleTransform } from '../engine/title';
import type { Arrangement, Circle, CircleCount, VennState } from '../engine/types';
import { fsToPx, pxToFs } from '../ui/fs-field';

/** 浮點合成後的殘差；1e-9 的單位空間誤差在 2000px 畫布上是 2e-6 px */
const EPS = 1e-9;

function boundsOf(circles: Circle[]) {
  return {
    left: Math.min(...circles.map((c) => c.x - c.r)),
    right: Math.max(...circles.map((c) => c.x + c.r)),
    top: Math.min(...circles.map((c) => c.y - c.r)),
    bottom: Math.max(...circles.map((c) => c.y + c.r)),
  };
}

/** 圓組（含描邊）超出畫布的最大量；沒有超界時 ≤ 0 */
function overflowOf(circles: Circle[]): number {
  const box = boundsOf(circles);
  return Math.max(
    STROKE_INSET - box.left,
    box.right - (1 - STROKE_INSET),
    STROKE_INSET - box.top,
    box.bottom - (1 - STROKE_INSET),
  );
}

function shapes(): [Arrangement, CircleCount][] {
  const all: [Arrangement, CircleCount][] = [];
  for (const arr of ARRANGEMENTS) {
    const [min, max] = circleCountRange(arr);
    for (let n = min; n <= max; n++) all.push([arr, n as CircleCount]);
  }
  return all;
}

function stateOf(arr: Arrangement, n: CircleCount, geometry: Partial<VennState> = {}): VennState {
  const defaults = shapeDefaults(arr, n);
  const base: VennState = {
    ...defaultState(n),
    overlap: defaults.overlap,
    radius: defaults.radius,
    ...geometry,
  };
  return arr === 'ring' ? base : { ...base, arr };
}

/** 每個槽都填一段字，用來檢查排版落點 */
function withTexts(state: VennState, text: string): VennState {
  const arr = state.arr ?? 'ring';
  return {
    ...state,
    texts: Object.fromEntries(slotMasks(arr, state.n).map((m) => [String(m), { t: text }])),
  };
}

describe('AC1 fitTransform', () => {
  it('包圍盒外擴描邊半寬後仍在畫布內時，回的是恆等變換那個物件', () => {
    for (const [arr, n] of shapes()) {
      const { radius, overlap } = shapeDefaults(arr, n);

      expect(fitTransform(circlesFor(arr, n, radius, overlap)), `${arr}(${n})`).toBe(
        IDENTITY_TRANSFORM,
      );
    }
  });

  it('圓剛好貼齊畫布邊緣時不算在內：描邊半寬會被切掉，所以要縮', () => {
    const flush: Circle[] = [{ x: 0.5, y: 0.5, r: 0.5 }];
    const t = fitTransform(flush);
    const box = boundsOf(flush.map((c) => ({ x: c.x * t.scale + t.tx, y: c.y * t.scale + t.ty, r: c.r * t.scale })));

    expect(t).not.toBe(IDENTITY_TRANSFORM);
    expect(box.left).toBeCloseTo(STROKE_INSET, 12);
    expect(box.right).toBeCloseTo(1 - STROKE_INSET, 12);
  });

  it('只縮不放：包圍盒比畫布小、只是整組偏出去時 scale 維持 1', () => {
    const off_canvas: Circle[] = [
      { x: -0.05, y: 0.3, r: 0.2 },
      { x: 0.3, y: 0.3, r: 0.2 },
    ];
    const t = fitTransform(off_canvas);

    expect(t.scale).toBe(1);
    expect(overflowOf(off_canvas.map((c) => ({ ...c, x: c.x + t.tx, y: c.y + t.ty })))).toBeLessThanOrEqual(EPS);
  });

  it('平移只補超出的那一側：沒超界的軸完全不動（不置中）', () => {
    // 垂直方向的包圍盒是 [0.1, 0.5]，在畫布內但偏上；置中會把它推到 [0.3, 0.7]
    const off_left: Circle[] = [
      { x: -0.05, y: 0.3, r: 0.2 },
      { x: 0.3, y: 0.3, r: 0.2 },
    ];
    const t = fitTransform(off_left);

    expect(t.ty).toBe(0);
    expect(t.tx).toBeCloseTo(STROKE_INSET + 0.25, 12);
  });

  it('超界時長邊縮到剛好塞滿可用寬度，超出的那一側貼齊內縮線、另一側留白照舊', () => {
    const circles = circlesFor('ring', 6, 0.35, 1.6);
    const t = fitTransform(circles);
    const fitted = circles.map((c) => ({ x: c.x * t.scale + t.tx, y: c.y * t.scale + t.ty, r: c.r * t.scale }));
    const box = boundsOf(fitted);
    const usable = 1 - 2 * STROKE_INSET;

    expect(t.scale).toBeLessThan(1);
    // ring(6) 的高比寬長：高縮到剛好等於可用高度，上下都貼齊內縮線
    expect(box.bottom - box.top).toBeCloseTo(usable, 12);
    expect(box.top).toBeCloseTo(STROKE_INSET, 12);
    // 寬比可用寬度短，所以只有超出的左側被補回內縮線，右側維持縮放後的位置（沒有被置中）
    expect(box.right - box.left).toBeLessThan(usable);
    expect(box.left).toBeCloseTo(STROKE_INSET, 12);
  });
});

describe('AC2 預設幾何不受 fit 影響', () => {
  it('每個 (arr, n) 的預設 state，總變換就是恆等變換那個物件', () => {
    for (const [arr, n] of shapes()) {
      expect(diagramTransform(stateOf(arr, n)), `${arr}(${n})`).toBe(IDENTITY_TRANSFORM);
    }
  });

  it('預設 state 加上標題時，總變換就是標題變換本身（補償後的內縮量仍判成恆等）', () => {
    for (const [arr, n] of shapes()) {
      const titled = { ...stateOf(arr, n), title: '標題' };

      expect(diagramTransform(titled), `${arr}(${n})`).toEqual(titleTransform(titled));
    }
  });

  it('預設 state 的 circlesForRender 與形狀本身算出來的圓逐位元相同', () => {
    for (const [arr, n] of shapes()) {
      const state = stateOf(arr, n);
      const before = circlesForState(state);
      const after = circlesForRender(state);

      expect(after, `${arr}(${n})`).toHaveLength(before.length);
      for (let i = 0; i < before.length; i++) {
        expect(Object.is(after[i]!.x, before[i]!.x), `${arr}(${n}) circle ${i} x`).toBe(true);
        expect(Object.is(after[i]!.y, before[i]!.y), `${arr}(${n}) circle ${i} y`).toBe(true);
        expect(Object.is(after[i]!.r, before[i]!.r), `${arr}(${n}) circle ${i} r`).toBe(true);
      }
    }
  });
});

describe('AC3 radius × overlap 全範圍都不出界', () => {
  const RADIUS_STEPS = 8;
  const OVERLAP_STEPS = 10;

  it('掃過每個 (arr, n) 的 radius × overlap 取樣，fit 後每顆圓連描邊都在畫布內', () => {
    let checked = 0;
    let shrunk = 0;

    for (const [arr, n] of shapes()) {
      const [r_min, r_max] = radiusRange(arr);
      for (let i = 0; i <= RADIUS_STEPS; i++) {
        const radius = r_min + ((r_max - r_min) * i) / RADIUS_STEPS;
        for (let j = 0; j <= OVERLAP_STEPS; j++) {
          const overlap = OVERLAP_MIN + ((OVERLAP_MAX - OVERLAP_MIN) * j) / OVERLAP_STEPS;
          const state = stateOf(arr, n, { radius, overlap });
          const label = `${arr}(${n}) r=${radius.toFixed(3)} ov=${overlap.toFixed(2)}`;

          expect(overflowOf(circlesForRender(state)), label).toBeLessThanOrEqual(EPS);
          if (overflowOf(circlesForState(state)) > 0) shrunk++;
          checked++;
        }
      }
    }

    expect(checked).toBeGreaterThan(500);
    // 取樣真的掃到超界組合，否則上面那條斷言只是在驗恆等變換
    expect(shrunk).toBeGreaterThan(50);
  });

  const must_fit: [Arrangement, number, number][] = [
    // 正式站的預設案例：ring(6) 的 radius 預設值配 overlap 拉到底就切邊
    ['ring', 0.23, 1.6],
    ['ring', 0.35, 1.6],
    ['row', 0.35, 1.6],
  ];

  for (const [arr, radius, overlap] of must_fit) {
    it(`${arr}(6) r=${radius} ov=${overlap}：原始幾何切邊，fit 後回到畫布內`, () => {
      const state = stateOf(arr, 6, { radius, overlap });

      expect(overflowOf(circlesForState(state))).toBeGreaterThan(0);
      expect(overflowOf(circlesForRender(state))).toBeLessThanOrEqual(EPS);
    });
  }
});

describe('AC4 排版取樣範圍跟著包圍盒走', () => {
  const state = withTexts(stateOf('row', 6, { radius: 0.35, overlap: 1.6 }), '甲');

  it('超界組合的每個槽都排得出來，不會因為重心落在畫布外而消失', () => {
    expect(
      layout(state)
        .map((b) => b.mask)
        .sort((a, b) => a - b),
    ).toEqual([...slotMasks('row', 6)].sort((a, b) => a - b));
  });
});

describe('AC5 fit 與標題變換疊加', () => {
  const titled: VennState = { ...stateOf('ring', 6, { radius: 0.35, overlap: 1.6 }), title: '我的文氏圖' };

  /**
   * 標題變換（08）把圖區貼齊畫布底緣，而描邊寬度是畫布常數、不隨變換縮：
   * fit 在原始空間留一個描邊半寬，經標題 0.82 縮放後只剩 0.00246，底部描邊還是會被切掉。
   * 所以 fit 的內縮量要先除以標題縮放（見 `diagramTransform`），這條測試就是守那個補償。
   */
  it('有標題又超界時兩者都生效：圖區在 band 之下，連描邊都不出界', () => {
    const box = boundsOf(circlesForRender(titled));

    expect(overflowOf(circlesForRender(titled))).toBeLessThanOrEqual(EPS);
    expect(box.bottom + STROKE_INSET).toBeLessThanOrEqual(1 + EPS);
    expect(box.top).toBeGreaterThanOrEqual(TITLE_BAND_H - EPS);
  });

  it('總變換的縮放量是 fit 與標題兩個縮放量的乘積（先 fit 再 title）', () => {
    const title = titleTransform(titled);
    const fit = fitTransform(circlesForState(titled), STROKE_INSET / title.scale);
    const total = diagramTransform(titled);

    expect(fit.scale).toBeLessThan(1);
    expect(title.scale).toBeLessThan(1);
    expect(total.scale).toBeCloseTo(fit.scale * title.scale, 12);
    expect(total.tx).toBeCloseTo(fit.tx * title.scale + title.tx, 12);
    expect(total.ty).toBeCloseTo(fit.ty * title.scale + title.ty, 12);
  });

  it('沒有標題時總變換就是 fit 本身', () => {
    const plain = stateOf('ring', 6, { radius: 0.35, overlap: 1.6 });

    expect(diagramTransform(plain)).toEqual(fitTransform(circlesForState(plain)));
  });
});

/**
 * AC6：拉滑桿時圖區不能跳位。
 *
 * 上界由幾何敏感度推導：包圍盒邊長對 radius 的最大斜率是 row(6) 的 `2 + 5·overlap = 10`
 * （ring 最大約 4.8），對 overlap 的最大斜率是 `(n−1)·r ≤ 1.75`；
 * 乘上滑桿步進 0.001／0.01 得單步邊長變化 ≤ 0.01／0.018。
 * `scale = (1 − 2·inset) / max(w, h)`，而 fit 生效時 `max(w, h) ≥ 1 − 2·inset`，
 * 所以 `|Δscale| ≲ 0.018`；平移是「邊界值 × scale」的差，`|Δt| ≲ |Δ邊界|·scale + |邊界|·|Δscale| ≲ 0.005`。
 * 取 0.04／0.01 當上界（約 2 倍餘裕）。置中版在 ring(5) 跨越臨界點時 ty 會跳 0.09·R ≈ 0.022，
 * 超過平移上界——這條測試就是攔那個跳位的。
 */
describe('AC6 fitTransform 對 radius／overlap 連續', () => {
  const RADIUS_STEP = 0.001;
  const OVERLAP_STEP = 0.01;
  const MAX_SCALE_DELTA = 0.04;
  const MAX_SHIFT_DELTA = 0.01;

  function assertContinuous(states: VennState[], label: string): void {
    let prev = fitTransform(circlesForState(states[0]!));
    for (let i = 1; i < states.length; i++) {
      const cur = fitTransform(circlesForState(states[i]!));
      const at = `${label} #${i} r=${states[i]!.radius.toFixed(3)} ov=${states[i]!.overlap.toFixed(2)}`;

      expect(Math.abs(cur.scale - prev.scale), `${at} scale`).toBeLessThanOrEqual(MAX_SCALE_DELTA);
      expect(Math.abs(cur.tx - prev.tx), `${at} tx`).toBeLessThanOrEqual(MAX_SHIFT_DELTA);
      expect(Math.abs(cur.ty - prev.ty), `${at} ty`).toBeLessThanOrEqual(MAX_SHIFT_DELTA);
      prev = cur;
    }
  }

  it('沿 radius 滑桿逐格移動，變換不跳位', () => {
    for (const [arr, n] of shapes()) {
      const [r_min, r_max] = radiusRange(arr);
      for (const overlap of [OVERLAP_MIN, 1.0, OVERLAP_MAX]) {
        const states: VennState[] = [];
        for (let r = r_min; r <= r_max + 1e-12; r += RADIUS_STEP) {
          states.push(stateOf(arr, n, { radius: r, overlap }));
        }
        assertContinuous(states, `${arr}(${n}) ov=${overlap}`);
      }
    }
  });

  it('沿 overlap 滑桿逐格移動，變換不跳位', () => {
    for (const [arr, n] of shapes()) {
      const [r_min, r_max] = radiusRange(arr);
      for (const radius of [r_min, (r_min + r_max) / 2, r_max]) {
        const states: VennState[] = [];
        for (let ov = OVERLAP_MIN; ov <= OVERLAP_MAX + 1e-12; ov += OVERLAP_STEP) {
          states.push(stateOf(arr, n, { radius, overlap: ov }));
        }
        assertContinuous(states, `${arr}(${n}) r=${radius}`);
      }
    }
  });
});

/**
 * AC7：面板說「這一區不存在」與圖上真的畫不出這個槽，必須是同一件事。
 * 兩邊都問 `regionExists()`（原始幾何取樣），`ui/toolbar.ts` 也是呼叫它。
 */
describe('AC7 region_exists 與 layout 一致', () => {
  const cases: [string, VennState][] = [
    ['ring(4) 預設', stateOf('ring', 4)],
    // overlap 拉到底時 4 圈有數個區域消失，是「區域不存在」的實際來源
    ['ring(4) ov=1.6', stateOf('ring', 4, { overlap: 1.6 })],
    // 臨界組合：三重區細到接近取樣解析度，改用縮過的幾何取樣就會與 layout() 分家
    ['ring(4) r=0.325 ov=1.4（臨界）', stateOf('ring', 4, { radius: 0.325, overlap: 1.4 })],
    ['ring(6) r=0.23 ov=1.6（超界）', stateOf('ring', 6, { radius: 0.23, overlap: 1.6 })],
    ['row(6) r=0.35 ov=1.6（超界）', stateOf('row', 6, { radius: 0.35, overlap: 1.6 })],
  ];

  for (const [label, base] of cases) {
    it(`${label}：每個槽的 regionExists 與 layout 是否輸出該槽相同`, () => {
      const state = withTexts(base, '甲');
      const rendered = new Set(layout(state).map((b) => b.mask));
      const masks = slotMasks(base.arr ?? 'ring', base.n);

      for (const mask of masks) {
        expect(regionExists(state, mask), `mask ${mask}`).toBe(rendered.has(mask));
      }
      expect(masks.length).toBeGreaterThan(0);
    });
  }
});

/**
 * AC8：面板顯示的字級是「實際畫出來的 px」。超界時圖區被 fit 縮過，
 * 換算不吃這一層的話，按一次＋反而讓畫出來的字變小。
 */
describe('AC8 字級 px 換算吃得到 fit 的縮放', () => {
  const size = 1200;
  const overflowing = withTexts(stateOf('ring', 6, { radius: 0.35, overlap: 1.6, size }), '快');

  it('超界 state 的 diagramTransform 縮放小於 1（面板拿到的就是這個值）', () => {
    expect(diagramTransform(overflowing).scale).toBeLessThan(1);
  });

  it('照面板顯示值加 10px 寫回 state，畫出來的字級就真的大 10px', () => {
    const scale = diagramTransform(overflowing).scale;
    const auto = layout(overflowing).find((block) => block.mask === 1)!;

    const shown_px = fsToPx(auto.fs / scale, size, scale);
    const next = layout({
      ...overflowing,
      texts: { ...overflowing.texts, '1': { t: '快', fs: pxToFs(shown_px + 10, size, scale) } },
    }).find((block) => block.mask === 1)!;

    expect(shown_px).toBe(Math.round(auto.fs * size));
    expect(next.fs * size).toBeCloseTo(shown_px + 10, 0);
  });
});
