import { slotMasks } from '../engine/layout';
import { arrOf, shapeDefaults } from '../engine/shapes/index';
import type { Arrangement, CircleCount, VennState } from '../engine/types';
import { DEFAULT_LOCALE, type Locale } from './locale';
import { PALETTE } from './palette';
import { isPristine, templateFor, templateTexts } from './state-presets';

/**
 * 切語言後的新狀態（純函式）。語言不進 state：`texts` 已經存了實際文字，
 * 所以只有沒編輯過的字才換成新語言的 template；使用者改過的字一律不動。
 * 樣式也不動——樣式是使用者可以自己選的，跟語言無關。
 */
export function nextStateForLocale(state: VennState, locale: Locale): VennState {
  if (!isPristine(state)) return state;

  const arr = arrOf(state);
  const texts = templateTexts(arr, state.n, locale);
  if (Object.keys(texts).length === 0) return state;

  return { ...state, texts };
}

/**
 * 切形狀（排列 × 圈數）後的新狀態（純函式，UI 只負責套用）。
 * 幾何一律重設為目標組合的預設值，避免沿用上一個組合的滑桿值把版面弄壞。
 * 沒編輯過就整組換成目標組合的 template；編輯過就只過濾掉目標組合沒有的槽。
 */
export function nextStateForShape(
  state: VennState,
  arr: Arrangement,
  n: CircleCount,
  locale: Locale = DEFAULT_LOCALE,
): VennState {
  const { radius, overlap } = shapeDefaults(arr, n);
  const pristine = isPristine(state);

  const next: VennState = {
    ...state,
    n,
    // PALETTE 有六色，最多的圈數也補得滿，不需要灰色補位
    colors: Array.from({ length: n }, (_, i) => state.colors[i] ?? PALETTE[i]!),
    overlap,
    radius,
    texts: {},
  };
  // ring 不寫進 state：encode 時本來就會省略，留著只會讓兩邊的判斷多一條岔路
  if (arr === 'ring') delete next.arr;
  else next.arr = arr;

  if (pristine) {
    // 每個合法組合都有 template（沒有 meme 的只給單圈標籤）；萬一沒有就沿用目前的樣式
    const template = templateFor(arr, n, locale);
    if (template) next.style = template.style;
    next.texts = templateTexts(arr, n, locale);
    return next;
  }

  const allowed = new Set(slotMasks(arr, n).map(String));
  next.texts = Object.fromEntries(
    Object.entries(state.texts).filter(([mask]) => allowed.has(mask)),
  );
  return next;
}
