import type { Circle, TextBlock } from './types';

/** 單位空間的相似變換：先等比縮放，再平移 */
export interface DiagramTransform {
  scale: number;
  tx: number;
  ty: number;
}

/** 唯一的恆等變換物件：呼叫端用 `=== IDENTITY_TRANSFORM` 判斷「什麼都不用做」，輸出因此逐位元不變 */
export const IDENTITY_TRANSFORM: DiagramTransform = { scale: 1, tx: 0, ty: 0 };

/**
 * 描邊半寬的下限（畫布寬比例）：outline 樣式的預設描邊是 `size * 0.006`，一半落在圓外。
 * 圓心 ± r 剛好貼齊畫布時那半條線會被切掉，所以包圍盒要外擴這個量再判斷有沒有超界。
 */
export const STROKE_INSET = 0.003;

/**
 * 實際要外擴的量：框線半寬，但不低於 `STROKE_INSET`（15 AC5）。
 *
 * 下限不設成 0 是為了相容：沒有框線的舊連結若改成 0 內縮，超界的圖（例如 overlap 上限）
 * 會重新算出不同的縮放與平移，畫面因此位移——那是已經發出去的連結，不該動。
 * 粗框線則靠半寬把餘裕撐開，radius 拉到上限也不會被畫布邊緣切掉。
 */
export function strokeInset(stroke_w: number): number {
  return Math.max(STROKE_INSET, stroke_w / 2);
}

/** 判定「在畫布內」的容差：浮點合成後 1e-16 級的殘差不該讓預設幾何被判成超界 */
const EPS = 1e-12;

export function transformCircle(c: Circle, t: DiagramTransform): Circle {
  return { x: c.x * t.scale + t.tx, y: c.y * t.scale + t.ty, r: c.r * t.scale };
}

/**
 * 把預設空間排好的文字區塊搬到同一個變換上。
 * 排版本身仍在預設空間算（取樣密度與槽表不受標題與 fit 影響），只有結果跟著圖區縮放，
 * 所以有無標題、有無 fit 的版面都是嚴格的等比關係。
 */
export function transformBlock(block: TextBlock, t: DiagramTransform): TextBlock {
  if (t === IDENTITY_TRANSFORM) return block;
  return {
    ...block,
    box: {
      cx: block.box.cx * t.scale + t.tx,
      cy: block.box.cy * t.scale + t.ty,
      w: block.box.w * t.scale,
      h: block.box.h * t.scale,
    },
    cx: block.cx * t.scale + t.tx,
    cy: block.cy * t.scale + t.ty,
    fs: block.fs * t.scale,
  };
}

/** 先套 inner 再套 outer 的合成變換；任一邊是恆等就直接回另一邊（同一個物件，不製造浮點殘差） */
export function composeTransform(
  inner: DiagramTransform,
  outer: DiagramTransform,
): DiagramTransform {
  if (inner === IDENTITY_TRANSFORM) return outer;
  if (outer === IDENTITY_TRANSFORM) return inner;
  return {
    scale: inner.scale * outer.scale,
    tx: inner.tx * outer.scale + outer.tx,
    ty: inner.ty * outer.scale + outer.ty,
  };
}

/**
 * 一維上的平移量：以畫布中心為基準縮放（`x' = 0.5 + scale·(x − 0.5)`，平移量 `(1 − scale) / 2`），
 * 再對仍超出的那一側取最小必要平移——也就是把中心錨點的平移量夾進「兩側都不出界」的區間。
 * 沒超界的那一軸因此留在原位，不會漂向原點。
 *
 * 夾的順序是先 `hi` 側後 `lo` 側：長邊縮完剛好等於可用邊長，區間的兩個端點只差浮點殘差
 * （1e-17 級），這時以 `lo` 側（左／上緣貼齊內縮線）優先，落點與 09 既有輸出逐位元相同
 * （golden overlap-max）。
 */
function axisShift(lo: number, hi: number, scale: number, inset: number): number {
  const flush_lo = inset - lo * scale;
  const flush_hi = 1 - inset - hi * scale;

  let shift = (1 - scale) / 2;
  if (shift > flush_hi) shift = flush_hi;
  if (shift < flush_lo) shift = flush_lo;
  return shift;
}

/**
 * 圓組（含描邊）塞回畫布的變換（09 AC1）：包圍盒外擴 `inset` 後仍在畫布內就是恆等變換，
 * 超界時以畫布中心 (0.5, 0.5) 為基準等比縮到塞得下，再補最小平移。
 *
 * `inset` 預設是描邊半寬。呼叫端後面還要再套一層縮放時（標題），要傳「除以那層縮放」的值：
 * 描邊寬度是畫布常數、不隨變換縮，先多留一點，經過那層縮放後才剛好剩下描邊半寬。
 *
 * 只縮不放：預設幾何因此逐位元不變（AC2），而且「圓比畫布小但整組偏出去」時放大只會讓
 * 版面跟著 radius 跳動，平移回來就夠了。
 * 平移只補超出的那一側、不把包圍盒置中：ring(5) 的包圍盒上下不對稱，
 * 置中會在跨越臨界點時整組跳位（AC6）。
 */
export function fitTransform(circles: Circle[], inset = STROKE_INSET): DiagramTransform {
  if (circles.length === 0) return IDENTITY_TRANSFORM;

  const left = Math.min(...circles.map((c) => c.x - c.r));
  const right = Math.max(...circles.map((c) => c.x + c.r));
  const top = Math.min(...circles.map((c) => c.y - c.r));
  const bottom = Math.max(...circles.map((c) => c.y + c.r));
  const inside =
    left - inset >= -EPS &&
    right + inset <= 1 + EPS &&
    top - inset >= -EPS &&
    bottom + inset <= 1 + EPS;
  if (inside) return IDENTITY_TRANSFORM;

  // 圓的包圍盒要塞進的是內縮後的可用範圍 [inset, 1 − inset]
  const scale = Math.min(1, (1 - 2 * inset) / Math.max(right - left, bottom - top));

  return {
    scale,
    tx: axisShift(left, right, scale, inset),
    ty: axisShift(top, bottom, scale, inset),
  };
}
