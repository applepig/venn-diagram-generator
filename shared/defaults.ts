import type { CircleCount, TextSlot, VennState, VennStyle } from './types';

export const PALETTE = ['#2e9be6', '#e6a92e', '#e04848', '#3cb54a'];

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
 * server route 收 `s` 參數的長度上限。最壞的合法 state（13 槽塞滿不重複中文＋fs/dx/dy）
 * 實測編出來 2,200 字元，留 1.8 倍餘裕；壓縮炸彈得靠上萬字元才打得動，這道閘讓它連 decode 都進不去。
 */
export const MAX_STATE_PARAM_LEN = 4000;

export const SIZE_CHOICES = [800, 1200, 1600];

export const EDITOR_PLACEHOLDER = '點此輸入';
/** 細碎區域連 placeholder 都放不下時的退路（見 layout()） */
export const EDITOR_PLACEHOLDER_SHORT = '＋';

/**
 * 每個圈數的預設 meme：文字槽與搭配的樣式，三組各示範一種樣式。
 * 文字裡的 `\n` 是手動換行，避免自動斷成「該做的／事」這種讀不順的行。
 */
export const TEMPLATES: Record<CircleCount, { style: VennStyle; texts: Record<string, TextSlot> }> =
  {
    2: {
      style: 'flat',
      texts: {
        '1': { t: '該做\n的事' },
        '2': { t: '想做\n的事' },
        '3': { t: '拖到\n明天' },
      },
    },
    3: {
      style: 'translucent',
      texts: {
        '1': { t: '要快' },
        '2': { t: '要好' },
        '4': { t: '要便宜' },
        '3': { t: '不便宜' },
        '5': { t: '不會好' },
        '6': { t: '不會快' },
        '7': { t: '想得美' },
      },
    },
    // Adam Grant「把手舉起來」：菱形環狀 DJ→搶匪→媽媽→牧師 對到方陣 0→1→3→2
    4: {
      style: 'outline',
      texts: {
        '1': { t: 'DJ' },
        '2': { t: '銀行\n搶匪' },
        '4': { t: '牧師' },
        '8': { t: '叫小孩\n把毛衣脫下\n的媽媽' },
        '3': { t: '「大家給我\n聽好!」' },
        '5': { t: '「聽懂我在\n說什麼嗎?」' },
        '10': { t: '「別讓我\n說第二次!」' },
        // 原文「不好好聽話會有嚴重的後果」兩行會觸底，縮成這句
        '12': { t: '「不聽話會有\n嚴重的後果」' },
        '15': { t: '把手\n舉起來!!' },
      },
    },
  };

/** template 的 texts 複本；直接回原物件會讓編輯器改到常數 */
function templateTexts(n: CircleCount): Record<string, TextSlot> {
  return Object.fromEntries(
    Object.entries(TEMPLATES[n].texts).map(([key, slot]) => [key, { ...slot }]),
  );
}

/**
 * 「使用者沒編輯過」：texts 深等於目前圈數的 template，每格只有 `t`。
 * 顏色、樣式、size、幾何不算編輯，所以不參與判定。
 */
export function isPristine(state: VennState): boolean {
  const template = TEMPLATES[state.n].texts;
  const keys = Object.keys(state.texts);
  if (keys.length !== Object.keys(template).length) return false;

  for (const key of keys) {
    const slot = state.texts[key]!;
    const expected = template[key];
    if (!expected || slot.t !== expected.t) return false;
    // 調過字級或拖過位置就算編輯過，即使文字沒變
    if (slot.fs !== undefined || slot.dx !== undefined || slot.dy !== undefined) return false;
  }
  return true;
}

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

/** 該圈數的預設 meme；首頁與 og:image 在沒有 `s` 參數時用 2 圈那組 */
export function sampleState(n: CircleCount = 2): VennState {
  return {
    ...defaultState(n),
    style: TEMPLATES[n].style,
    texts: templateTexts(n),
  };
}
