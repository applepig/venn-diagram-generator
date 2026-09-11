import type { CircleCount } from './types';

/** prototype 鎖定的預設半徑（畫布寬比例）；4 圈放大到 0.33 才放得下中央的長句 */
export const DEFAULT_RADIUS: Record<CircleCount, number> = { 2: 0.3, 3: 0.29, 4: 0.33 };

/** prototype 鎖定的預設重疊度（圓心距 / r）；4 圈壓到 0.8 把中央四重區撐開 */
export const DEFAULT_OVERLAP: Record<CircleCount, number> = { 2: 1.2, 3: 1.15, 4: 0.8 };

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

/**
 * 各圈數的預設文字槽（成員 bitmask）。
 * 4 圈是 2×2 花瓣排列：4 單圈 ＋ 4 相鄰雙圈 ＋ 4 三重 ＋ 中央四重；
 * 對角雙圈（0+3、1+2）在 overlap ≤ 1 時區域根本不存在，不給槽。
 */
export const SLOT_MASKS: Record<CircleCount, number[]> = {
  2: [1, 2, 3],
  3: [1, 2, 4, 3, 5, 6, 7],
  4: [1, 2, 4, 8, 3, 5, 10, 12, 7, 11, 13, 14, 15],
};

export function popCount(mask: number): number {
  let n = 0;
  for (let m = mask; m > 0; m >>= 1) n += m & 1;
  return n;
}
