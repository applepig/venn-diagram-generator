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
export const RADIUS_MIN = 0.2;
export const RADIUS_MAX = 0.35;
export const MAX_TEXT_LEN = 80;

/**
 * server route 收 `s` 參數的長度上限。最壞的合法 state 是 13 槽各塞滿 80 個不重複的 4-byte code point
 * （U+20000 起的擴充漢字）＋fs/dx/dy＋每槽不同的 fill，實測編出來 3,639 字元（不帶 fill 是 3,466），
 * 只留 1.10 倍餘裕；同樣條件換成 3-byte 中文是 3,266。
 * 壓縮炸彈得靠上萬字元才打得動，這道閘讓它連 decode 都進不去。
 */
export const MAX_STATE_PARAM_LEN = 4000;

export const SIZE_CHOICES = [800, 1200, 1600];

/** 各組合的合法文字槽由 `slotMasks(arr, n)` 從預設幾何推出，見 engine/layout.ts */

export function popCount(mask: number): number {
  let n = 0;
  for (let m = mask; m > 0; m >>= 1) n += m & 1;
  return n;
}
