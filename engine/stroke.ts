/**
 * 圓框線的解析：state 上的 `stroke_w`／`stroke` 缺席時要拿到什麼值。
 * codec（決定哪些值不進編碼）、renderSvg、fit 的內縮量與面板都問這裡，四邊才不會各自訂預設。
 */
import type { VennState, VennStyle } from './types';

/** 框線寬度上限（畫布寬比例）：1200px 畫布上是 36px，再粗就不是框線而是色塊了 */
export const STROKE_W_MAX = 0.03;

/**
 * 各樣式的框線預設寬度。outline 的圓本來就只有框線，0.006 是它既有的寬度；
 * flat 與 translucent 預設不畫框——沒帶這兩個欄位的舊連結因此輸出逐位元不變。
 */
const STROKE_W_DEFAULTS: Record<VennStyle, number> = {
  translucent: 0,
  flat: 0,
  outline: 0.006,
};

export const DEFAULT_STROKE_COLOR = '#000000';

export function defaultStrokeW(style: VennStyle): number {
  return STROKE_W_DEFAULTS[style];
}

/** 實際的框線寬度（畫布寬比例）；0 代表不畫框線 */
export function strokeOf(state: VennState): number {
  return state.stroke_w ?? defaultStrokeW(state.style);
}

/** 實際的框線顏色 */
export function strokeColorOf(state: VennState): string {
  return state.stroke ?? DEFAULT_STROKE_COLOR;
}
