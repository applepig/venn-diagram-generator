import { DEFAULT_BG, DEFAULT_OPACITY, DEFAULT_SIZE } from '../engine/defaults';
import { arrOf, shapeDefaults } from '../engine/shapes/index';
import type { Arrangement, CircleCount, TextSlot, VennState } from '../engine/types';
import { PALETTE } from './palette';
import { TEMPLATES, type Template } from './templates/zh-TW';

/** 該組合的 template；row 與 5／6 圈還沒有（M4 只給單圈標籤） */
export function templateFor(arr: Arrangement, n: CircleCount): Template | undefined {
  return arr === 'ring' ? TEMPLATES[n] : undefined;
}

/** template 的 texts 複本；直接回原物件會讓編輯器改到常數 */
export function templateTexts(arr: Arrangement, n: CircleCount): Record<string, TextSlot> {
  const template = templateFor(arr, n);
  if (!template) return {};
  return Object.fromEntries(
    Object.entries(template.texts).map(([key, slot]) => [key, { ...slot }]),
  );
}

/**
 * 「使用者沒編輯過」：texts 深等於目前組合的 template，每格只有 `t`。
 * 顏色、樣式、size、幾何不算編輯，所以不參與判定。
 * 沒有 template 的組合（row、5／6 圈）以「一個字都沒填」為未編輯。
 */
export function isPristine(state: VennState): boolean {
  const template = templateFor(arrOf(state), state.n)?.texts ?? {};
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

/** 環狀排列的空白狀態；row 與 5／6 圈的預設內容是 M4 */
export function defaultState(n: CircleCount = 2): VennState {
  const { radius, overlap } = shapeDefaults('ring', n);
  return {
    v: 1,
    n,
    style: 'translucent',
    opacity: DEFAULT_OPACITY,
    overlap,
    radius,
    colors: PALETTE.slice(0, n),
    bg: DEFAULT_BG,
    size: DEFAULT_SIZE,
    texts: {},
  };
}

/** 該圈數的預設 meme；首頁與 og:image 在沒有 `s` 參數時用 2 圈那組 */
export function sampleState(n: CircleCount = 2): VennState {
  const base = defaultState(n);
  return {
    ...base,
    style: templateFor('ring', n)?.style ?? base.style,
    texts: templateTexts('ring', n),
  };
}
