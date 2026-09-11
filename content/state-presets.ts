import {
  DEFAULT_BG,
  DEFAULT_OPACITY,
  DEFAULT_OVERLAP,
  DEFAULT_RADIUS,
  DEFAULT_SIZE,
} from '../engine/defaults';
import type { CircleCount, TextSlot, VennState } from '../engine/types';
import { PALETTE } from './palette';
import { TEMPLATES } from './templates/zh-TW';

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
    // 調過字級、拖過位置或指定過填色就算編輯過，即使文字沒變
    if (slot.fs !== undefined || slot.dx !== undefined || slot.dy !== undefined) return false;
    if (slot.fill !== undefined) return false;
  }
  return true;
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
