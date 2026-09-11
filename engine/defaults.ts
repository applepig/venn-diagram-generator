/** 預設半徑與重疊度依「排列 × 圈數」而定，見 engine/shapes/ */

export const DEFAULT_BG = '#fafafa';
export const DEFAULT_OPACITY = 0.6;
export const DEFAULT_SIZE = 1200;

export const LABEL_START_FS = 0.14;
export const INTERSECTION_START_FS = 0.11;
export const MIN_FS = 0.025;
export const LINE_HEIGHT = 1.12;

/** 文字框長寬比：單圈標籤比交集區寬扁一些 */
export const LABEL_ASPECT = 1.5;
export const INTERSECTION_ASPECT = 1.3;

export const SIZE_MIN = 400;
export const SIZE_MAX = 2000;
// 4 圈預設 0.8：下限放寬到 0.6 讓滑桿與 codec 都吃得下低重疊度
export const OVERLAP_MIN = 0.6;
export const OVERLAP_MAX = 1.6;
export const MAX_TEXT_LEN = 80;

/** radius 的合法範圍依排列而定（row 的圓比 ring 小），見 `radiusRange()` */

/**
 * server route 收 `s` 參數的長度上限。最壞的合法 state 是「該組合每一槽都塞滿 80 個不重複的
 * 4-byte code point（U+20000 起的擴充漢字）＋各槽相異的 fs/dx/dy/fill」；槽數隨組合變，
 * 實測最大的是 ring(5) 的 21 槽 6,134 字元（ring(6) 5,307、ring(4) 3,848、row(6) 3,356），
 * 所以留約 1.14 倍餘裕。掃全部 (arr, n) 的實測在 tests/state-codec.test.ts（AC15）。
 * 壓縮炸彈得靠上萬字元才打得動，這道閘讓它連 decode 都進不去。
 */
export const MAX_STATE_PARAM_LEN = 7000;

export const SIZE_CHOICES = [800, 1200, 1600];

/** 各組合的合法文字槽由 `slotMasks(arr, n)` 從預設幾何推出，見 engine/layout.ts */

export function popCount(mask: number): number {
  let n = 0;
  for (let m = mask; m > 0; m >>= 1) n += m & 1;
  return n;
}
