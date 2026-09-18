import { DEFAULT_BG, DEFAULT_OPACITY, DEFAULT_SIZE } from '../engine/defaults';
import { arrOf, shapeDefaults } from '../engine/shapes/index';
import type { Arrangement, CircleCount, TextSlot, VennState } from '../engine/types';
import { DEFAULT_LOCALE, type Locale } from './locale';
import { PALETTE } from './palette';
import { TEMPLATES as TEMPLATES_EN } from './templates/en';
import { TEMPLATES as TEMPLATES_JA } from './templates/ja';
import type { Template } from './templates/types';
import { TEMPLATES as TEMPLATES_ZH } from './templates/zh-TW';

type TemplateTable = Record<Arrangement, Partial<Record<CircleCount, Template>>>;

const TEMPLATES_BY_LOCALE: Record<Locale, TemplateTable> = {
  'zh-TW': TEMPLATES_ZH,
  en: TEMPLATES_EN,
  ja: TEMPLATES_JA,
};

/** 該組合在該語言的 template；每個合法組合都有一組（沒有 meme 的組合只給單圈標籤） */
export function templateFor(
  arr: Arrangement,
  n: CircleCount,
  locale: Locale = DEFAULT_LOCALE,
): Template | undefined {
  return TEMPLATES_BY_LOCALE[locale][arr][n];
}

/** template 的 texts 複本；直接回原物件會讓編輯器改到常數 */
export function templateTexts(
  arr: Arrangement,
  n: CircleCount,
  locale: Locale = DEFAULT_LOCALE,
): Record<string, TextSlot> {
  const template = templateFor(arr, n, locale);
  if (!template) return {};
  return Object.fromEntries(
    Object.entries(template.texts).map(([key, slot]) => [key, { ...slot }]),
  );
}

/**
 * 「使用者還沒寫過字」：每一格都沒有文字，也沒有指定過字級或填色。
 * template 現在只當輸入框的 placeholder，不進 state，所以判定只看 state 自己有沒有內容。
 * 顏色、樣式、size、幾何不算編輯，所以不參與判定。
 */
export function isPristine(state: VennState): boolean {
  return Object.values(state.texts).every(
    (slot) => slot.t.trim() === '' && slot.fs === undefined && slot.fill === undefined,
  );
}

/** 環狀排列的空白狀態（沒有任何文字）；row 的起始狀態由 `nextStateForShape` 產生 */
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

/**
 * 該組合的示範文字（mask → 文字）。輸入框的 placeholder、收合列的灰字提示
 * 與畫布上的幽靈字都從這裡取，三處才不會各講一套。
 */
export function placeholderTexts(
  arr: Arrangement,
  n: CircleCount,
  locale: Locale = DEFAULT_LOCALE,
): Record<string, string> {
  const template = templateFor(arr, n, locale);
  if (!template) return {};
  return Object.fromEntries(Object.entries(template.texts).map(([mask, slot]) => [mask, slot.t]));
}

/**
 * 畫布預覽要畫的幽靈字。只要使用者在任何一格寫了字就整組收掉：
 * 預覽是 WYSIWYG，畫面上多一段不會出現在輸出裡的字就是騙人。
 * 反過來，把字全部刪光又回到空白狀態，提示就再出現。
 */
export function ghostTexts(state: VennState, locale: Locale = DEFAULT_LOCALE): Record<string, string> {
  if (!isPristine(state)) return {};
  return placeholderTexts(arrOf(state), state.n, locale);
}

/**
 * 編輯器的起始狀態：一格字都不填，template 只當輸入框的 placeholder。
 * 樣式仍取 template 的（版型的一部分），使用者一進來就看得到三種樣式之一。
 */
export function initialState(n: CircleCount = 2, locale: Locale = DEFAULT_LOCALE): VennState {
  const base = defaultState(n);
  return { ...base, style: templateFor('ring', n, locale)?.style ?? base.style };
}

/** 該圈數的預設 meme；og:image 在沒有 `s` 參數時用 2 圈那組 */
export function sampleState(n: CircleCount = 2, locale: Locale = DEFAULT_LOCALE): VennState {
  const base = defaultState(n);
  return {
    ...base,
    style: templateFor('ring', n, locale)?.style ?? base.style,
    texts: templateTexts('ring', n, locale),
  };
}
