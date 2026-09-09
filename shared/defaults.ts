import type { CircleCount, VennState } from './types';

export const PALETTE = ['#2e9be6', '#e6a92e', '#e04848', '#3cb54a'];

/** prototype 鎖定的預設半徑（畫布寬比例） */
export const DEFAULT_RADIUS: Record<CircleCount, number> = { 2: 0.3, 3: 0.29, 4: 0.27 };

/** prototype 鎖定的預設重疊度（圓心距 / r） */
export const DEFAULT_OVERLAP: Record<CircleCount, number> = { 2: 1.2, 3: 1.15, 4: 1.15 };

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
export const OVERLAP_MIN = 1.0;
export const OVERLAP_MAX = 1.6;
export const RADIUS_MIN = 0.2;
export const RADIUS_MAX = 0.35;
export const MAX_TEXT_LEN = 80;

export const SIZE_CHOICES = [800, 1200, 1600];

export const EDITOR_PLACEHOLDER = '點此輸入';

/**
 * 各圈數的預設文字槽（成員 bitmask）。
 * 4 圈是 2×2 花瓣排列，只給 4 單圈 ＋ 4 相鄰雙圈 ＋ 中央四重；
 * 對角雙圈（0+3、1+2）與三重交集的區域太細碎，不給槽。
 */
export const SLOT_MASKS: Record<CircleCount, number[]> = {
  2: [1, 2, 3],
  3: [1, 2, 4, 3, 5, 6, 7],
  4: [1, 2, 4, 8, 3, 5, 10, 12, 15],
};

export function popCount(mask: number): number {
  let n = 0;
  for (let m = mask; m > 0; m >>= 1) n += m & 1;
  return n;
}

export function defaultState(n: CircleCount = 2): VennState {
  return {
    v: 1,
    n,
    style: 'translucent',
    opacity: DEFAULT_OPACITY,
    overlap: DEFAULT_OVERLAP[n],
    radius: DEFAULT_RADIUS[n],
    colors: PALETTE.slice(0, n),
    bg: DEFAULT_BG,
    size: DEFAULT_SIZE,
    texts: {},
  };
}

/** 首頁與 og:image 在沒有 `s` 參數時用的範例圖 */
export function sampleState(): VennState {
  return {
    ...defaultState(2),
    texts: {
      '1': { t: '工程師' },
      '2': { t: '設計師' },
      '3': { t: '會寫 CSS' },
    },
  };
}
