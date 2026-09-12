import { DEFAULT_BG, DEFAULT_OPACITY, DEFAULT_SIZE } from '../engine/defaults';
import { arrOf, shapeDefaults } from '../engine/shapes/index';
import type { Arrangement, CircleCount, TextSlot, VennState } from '../engine/types';
import { DEFAULT_LOCALE, LOCALES, type Locale } from './locale';
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
 * 「使用者沒編輯過」：texts 深等於目前組合在**任一**支援語言的 template，每格只有 `t`。
 * 語言不進 state，所以切語言前得認得另一個語言的 template 也是「原樣」，
 * 否則從英文介面切回中文時會把 template 當成使用者的字留著。
 * 顏色、樣式、size、幾何不算編輯，所以不參與判定。
 */
export function isPristine(state: VennState): boolean {
  return LOCALES.some((locale) => matchesTemplate(state, locale));
}

function matchesTemplate(state: VennState, locale: Locale): boolean {
  const template = templateFor(arrOf(state), state.n, locale)?.texts ?? {};
  const keys = Object.keys(state.texts);
  if (keys.length !== Object.keys(template).length) return false;

  for (const key of keys) {
    const slot = state.texts[key]!;
    const expected = template[key];
    if (!expected || slot.t !== expected.t) return false;
    // 調過字級或指定過填色就算編輯過，即使文字沒變
    if (slot.fs !== undefined) return false;
    if (slot.fill !== undefined) return false;
  }
  return true;
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

/** 該圈數的預設 meme；首頁與 og:image 在沒有 `s` 參數時用 2 圈那組 */
export function sampleState(n: CircleCount = 2, locale: Locale = DEFAULT_LOCALE): VennState {
  const base = defaultState(n);
  return {
    ...base,
    style: templateFor('ring', n, locale)?.style ?? base.style,
    texts: templateTexts('ring', n, locale),
  };
}
