import { clientLocale, t, type Locale, type StringKey } from '../content/locale';

/** localStorage 的 key；記住的是使用者用 `?lang=` 選過的語言 */
const STORAGE_KEY = 'venn.lang';

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // 隱私模式下讀 localStorage 會丟例外，語言不是必要功能，靜靜退回下一個來源
    return null;
  }
}

function remember(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // 同上：記不住就只是下次要再帶 ?lang=
  }
}

/**
 * client 的語言：`?lang=` → localStorage → server 寫進 `<html lang>` 的值。
 * 只在載入時算一次：整份介面與 template 都依這個值，中途變動只會讓面板和圖不同語言。
 */
let locale: Locale | null = null;

export function uiLocale(): Locale {
  if (locale !== null) return locale;

  const from_query = new URLSearchParams(location.search).get('lang');
  locale = clientLocale(from_query, readStored(), document.documentElement.lang);
  // 帶過 ?lang= 就記住：分享連結不帶 lang，下次點別人的連結也還是自己的語言
  if (from_query) remember(locale);
  return locale;
}

/** 介面字串（已套用目前語言）；缺 key 由 `t()` 退回 zh-TW 並警告 */
export function ts(key: StringKey): string {
  return t(key, uiLocale());
}
