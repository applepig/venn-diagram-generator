import { STRINGS as STRINGS_EN } from './strings/en';
import { STRINGS as STRINGS_JA } from './strings/ja';
import { STRINGS as STRINGS_ZH } from './strings/zh-TW';

export type Locale = 'zh-TW' | 'en' | 'ja';

export const LOCALES: readonly Locale[] = ['zh-TW', 'en', 'ja'];
export const DEFAULT_LOCALE: Locale = 'zh-TW';

/** 介面字串的 key：以 zh-TW 為準，其餘語言必須補齊同一組 key */
export type StringKey = keyof typeof STRINGS_ZH;

/** 各語言的字串表宣告成 Partial：漏翻的 key 由 `t()` 在 runtime 退回 zh-TW，不讓畫面露出 raw key */
const TABLES: Record<Locale, Partial<Record<StringKey, string>>> = {
  'zh-TW': STRINGS_ZH,
  en: STRINGS_EN,
  ja: STRINGS_JA,
};

export function t(key: StringKey, locale: Locale = DEFAULT_LOCALE): string {
  const value = TABLES[locale]?.[key];
  if (value !== undefined) return value;

  // 漏翻是開發期的缺陷，不是使用者輸入：警告出來，但畫面上退回 zh-TW 的文案
  console.warn(`[i18n] missing string "${key}" for locale "${locale}", falling back to ${DEFAULT_LOCALE}`);
  return TABLES[DEFAULT_LOCALE][key] ?? '';
}

/** 語言下拉的顯示名：一律用該語言自己的說法，選單才看得懂自己要選哪個 */
export const LOCALE_NAMES: Record<Locale, string> = {
  'zh-TW': '中文',
  en: 'English',
  ja: '日本語',
};

/**
 * BCP-47 語言標記 → 支援的語言；不支援或空的輸入回 null，讓呼叫端接著看下一個來源。
 * 每種語言只有一個變體，所以任何 zh-*／en-*／ja-* 都收斂到該語言。
 */
export function normalizeLang(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const tag = value.trim().toLowerCase();
  if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-TW';
  if (tag === 'en' || tag.startsWith('en-')) return 'en';
  if (tag === 'ja' || tag.startsWith('ja-')) return 'ja';
  return null;
}

/** Accept-Language 依 q 值（預設 1）取最高的支援語言；q=0 代表「不要這個語言」 */
function fromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.split(';');
      const q = params
        .map((param) => /^q=([0-9.]+)$/.exec(param.trim())?.[1])
        .find((value) => value !== undefined);
      return { locale: normalizeLang(tag), q: q === undefined ? 1 : Number(q) };
    })
    .filter(
      (item): item is { locale: Locale; q: number } =>
        item.locale !== null && Number.isFinite(item.q) && item.q > 0,
    )
    // 同 q 值時維持出現順序（Array.prototype.sort 是穩定排序）
    .sort((a, b) => b.q - a.q);

  return ranked[0]?.locale ?? null;
}

/** 語言記憶的 cookie 名稱；server 寫、server 讀，client 不再自己存一份 */
export const LOCALE_COOKIE = 'venn.lang';

/** server 的語言：`?lang=` → cookie → `Accept-Language` → zh-TW */
export function serverLocale(
  query_lang: string | null | undefined,
  cookie_lang: string | null | undefined,
  accept_language: string | null | undefined,
): Locale {
  return (
    normalizeLang(query_lang) ??
    normalizeLang(cookie_lang) ??
    fromAcceptLanguage(accept_language) ??
    DEFAULT_LOCALE
  );
}

/**
 * client 的語言：`?lang=` → server 寫進 `<html lang>` 的值。
 * 記憶在 cookie 而不是 localStorage：server 讀得到才不會出現「介面日文、meta 中文」的半翻譯頁。
 */
export function clientLocale(
  query_lang: string | null | undefined,
  html_lang: string | null | undefined,
): Locale {
  return normalizeLang(query_lang) ?? normalizeLang(html_lang) ?? DEFAULT_LOCALE;
}

/** `<html lang>` 與 JSON-LD `inLanguage` 用的標記 */
const HTML_LANGS: Record<Locale, string> = { 'zh-TW': 'zh-Hant', en: 'en', ja: 'ja' };

export function htmlLang(locale: Locale): string {
  return HTML_LANGS[locale];
}

/** `og:locale` 用的 Facebook 底線格式 */
const OG_LOCALES: Record<Locale, string> = { 'zh-TW': 'zh_TW', en: 'en_US', ja: 'ja_JP' };

export function ogLocale(locale: Locale): string {
  return OG_LOCALES[locale];
}
