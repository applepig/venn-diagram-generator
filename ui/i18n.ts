import { clientLocale, t, type Locale, type StringKey } from '../content/locale';
import { searchWithLang, searchWithState } from './share-url';

/**
 * client 的語言：`?lang=` → server 寫進 `<html lang>` 的值。
 * 記憶由 server 的 cookie `venn.lang` 負責（AC14），client 不再自己存一份——
 * 存了 server 也讀不到，兩邊會分歧成「介面一種語言、meta 另一種」的半翻譯頁。
 * 只在載入時算一次：整份介面與 template 都依這個值，中途變動只會讓面板和圖不同語言。
 */
let locale: Locale | null = null;

export function uiLocale(): Locale {
  if (locale !== null) return locale;

  const from_query = new URLSearchParams(location.search).get('lang');
  locale = clientLocale(from_query, document.documentElement.lang);
  return locale;
}

/** 介面字串（已套用目前語言）；缺 key 由 `t()` 退回 zh-TW 並警告 */
export function ts(key: StringKey): string {
  return t(key, uiLocale());
}

/**
 * 切語言：把 `lang` 寫進網址後整頁 reload，server 收到 `?lang=` 順手寫 cookie。
 * 不在 client 再做一套字串注入——`<html lang>`、meta、`data-i18n` 全部由 server 那一套換，
 * reload 是讓兩邊只有一份注入邏輯的代價，也順便把已算好的 template 換成該語言。
 *
 * `encoded` 由呼叫端給目前這份 state 的編碼，不從 `location.search` 讀：
 * `syncUrl()` 是非同步的，網址上的 `s` 可能還是上一筆編輯（AC19）。
 */
export function switchLocale(next: Locale, encoded: string): void {
  if (next === uiLocale()) return;
  const search = encoded ? searchWithState(location.search, encoded) : location.search;
  location.search = searchWithLang(search, next);
}
