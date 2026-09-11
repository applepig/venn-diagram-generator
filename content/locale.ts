import { STRINGS as STRINGS_EN } from './strings/en';
import { STRINGS as STRINGS_ZH } from './strings/zh-TW';

export type Locale = 'zh-TW' | 'en';

export const LOCALES: readonly Locale[] = ['zh-TW', 'en'];
export const DEFAULT_LOCALE: Locale = 'zh-TW';

/** 介面字串的 key：以 zh-TW 為準，其餘語言必須補齊同一組 key */
export type StringKey = keyof typeof STRINGS_ZH;

/** 各語言的字串表宣告成 Partial：漏翻的 key 由 `t()` 在 runtime 退回 zh-TW，不讓畫面露出 raw key */
const TABLES: Record<Locale, Partial<Record<StringKey, string>>> = {
  'zh-TW': STRINGS_ZH,
  en: STRINGS_EN,
};

export function t(key: StringKey, locale: Locale = DEFAULT_LOCALE): string {
  const value = TABLES[locale]?.[key];
  if (value !== undefined) return value;

  // 漏翻是開發期的缺陷，不是使用者輸入：警告出來，但畫面上退回 zh-TW 的文案
  console.warn(`[i18n] missing string "${key}" for locale "${locale}", falling back to ${DEFAULT_LOCALE}`);
  return TABLES[DEFAULT_LOCALE][key] ?? '';
}

/**
 * BCP-47 語言標記 → 支援的語言；不支援或空的輸入回 null，讓呼叫端接著看下一個來源。
 * 只有兩種語言，所以任何 zh-* 都收斂到 zh-TW。
 */
export function normalizeLang(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const tag = value.trim().toLowerCase();
  if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-TW';
  if (tag === 'en' || tag.startsWith('en-')) return 'en';
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

/** server 的語言：`?lang=` → `Accept-Language` → zh-TW（server 讀不到 localStorage） */
export function serverLocale(
  query_lang: string | null | undefined,
  accept_language: string | null | undefined,
): Locale {
  return normalizeLang(query_lang) ?? fromAcceptLanguage(accept_language) ?? DEFAULT_LOCALE;
}

/** client 的語言：`?lang=` → localStorage → server 寫進 `<html lang>` 的值 */
export function clientLocale(
  query_lang: string | null | undefined,
  stored: string | null | undefined,
  html_lang: string | null | undefined,
): Locale {
  return (
    normalizeLang(query_lang) ?? normalizeLang(stored) ?? normalizeLang(html_lang) ?? DEFAULT_LOCALE
  );
}

/** `<html lang>` 與 JSON-LD `inLanguage` 用的標記 */
export function htmlLang(locale: Locale): string {
  return locale === 'zh-TW' ? 'zh-Hant' : 'en';
}

/** `og:locale` 用的 Facebook 底線格式 */
export function ogLocale(locale: Locale): string {
  return locale === 'zh-TW' ? 'zh_TW' : 'en_US';
}
