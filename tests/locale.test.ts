import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_NAMES,
  clientLocale,
  htmlLang,
  normalizeLang,
  ogLocale,
  serverLocale,
  t,
  type Locale,
  type StringKey,
} from '../content/locale';
import { STRINGS as STRINGS_ZH } from '../content/strings/zh-TW';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AC6 t(key, locale)', () => {
  it('回該語言的字串', () => {
    expect(t('action.downloadPng', 'zh-TW')).toBe('下載 PNG');
    expect(t('action.downloadPng', 'en')).toBe('Download PNG');
  });

  it('省略語言時用 zh-TW', () => {
    expect(t('action.copyLink')).toBe('複製連結');
  });

  it('缺 key 時 console 警告，且不把 raw key 當文案顯示', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const value = t('action.nonexistent' as StringKey, 'en');

    expect(warn).toHaveBeenCalled();
    expect(value).not.toContain('action.nonexistent');
  });

  it('該語言查不到這個 key 時退回 zh-TW 的文案並警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 沒有字串表的語言＝那個語言缺了每一個 key，走的是同一條 fallback 路徑
    const value = t('action.downloadPng', 'fr' as Locale);

    expect(value).toBe(STRINGS_ZH['action.downloadPng']);
    expect(warn).toHaveBeenCalled();
  });

  it('每個語言都補齊 zh-TW 的所有 key，正常路徑不會警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    for (const locale of LOCALES) {
      for (const key of Object.keys(STRINGS_ZH) as StringKey[]) {
        expect(t(key, locale), `${locale} / ${key}`).not.toBe('');
      }
    }

    expect(warn).not.toHaveBeenCalled();
  });

  it('en 的文案不是把中文原樣抄過去', () => {
    for (const key of Object.keys(STRINGS_ZH) as StringKey[]) {
      expect(t(key, 'en'), key).not.toMatch(/[一-鿿]/);
    }
  });
});

/**
 * AC12／AC13：ja 的字串表。內容是自行翻譯的，沒有 spec 字面值可比，
 * 所以斷言的是「真的翻過」這件可觀察的事——不是把 en 表照抄當佔位，
 * 也沒有留下未翻的拉丁字串。
 */
describe('AC12 ja 介面字串', () => {
  /** 假名、漢字與全形標點：日文文案至少要有一個這類字元 */
  const JA_SCRIPT_RE = /[　-〿぀-ヿ一-鿿＀-￯]/;

  it('每個 key 都有 ja 的文案', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    for (const key of Object.keys(STRINGS_ZH) as StringKey[]) {
      expect(t(key, 'ja'), key).not.toBe('');
    }

    expect(warn).not.toHaveBeenCalled();
  });

  it('沒有把英文表照抄當佔位', () => {
    for (const key of Object.keys(STRINGS_ZH) as StringKey[]) {
      expect(t(key, 'ja'), key).not.toBe(t(key, 'en'));
    }
  });

  it('每個 key 的文案都含日文字元，沒有留下未翻的拉丁字串', () => {
    for (const key of Object.keys(STRINGS_ZH) as StringKey[]) {
      expect(t(key, 'ja'), key).toMatch(JA_SCRIPT_RE);
    }
  });

  it('語言下拉的顯示名用各自語言的自稱（AC12）', () => {
    expect(LOCALE_NAMES).toEqual({ 'zh-TW': '中文', en: 'English', ja: '日本語' });
    for (const locale of LOCALES) expect(LOCALE_NAMES[locale], locale).toBeTruthy();
  });
});

describe('AC6 normalizeLang', () => {
  it('認得支援的語言與其地區變體', () => {
    expect(normalizeLang('en')).toBe('en');
    expect(normalizeLang('en-US')).toBe('en');
    expect(normalizeLang('EN-GB')).toBe('en');
    expect(normalizeLang('zh-TW')).toBe('zh-TW');
    expect(normalizeLang('zh-Hant')).toBe('zh-TW');
    expect(normalizeLang('zh')).toBe('zh-TW');
    expect(normalizeLang('ja')).toBe('ja');
    expect(normalizeLang('ja-JP')).toBe('ja');
    expect(normalizeLang('JA')).toBe('ja');
  });

  it('不支援或空的輸入回 null（讓呼叫端接著看下一個來源）', () => {
    for (const value of ['fr', 'de-DE', '', '   ', 'zzz', null, undefined]) {
      expect(normalizeLang(value), String(value)).toBeNull();
    }
  });
});

describe('AC6 server 的語言 precedence：?lang= → Accept-Language → zh-TW', () => {
  it('?lang= 優先於 Accept-Language', () => {
    expect(serverLocale('en', 'zh-TW,zh;q=0.9')).toBe('en');
    expect(serverLocale('zh-TW', 'en-US,en;q=0.9')).toBe('zh-TW');
  });

  it('沒有 ?lang= 時看 Accept-Language', () => {
    expect(serverLocale(null, 'en-US,en;q=0.9')).toBe('en');
    expect(serverLocale(null, 'zh-TW,zh;q=0.9,en;q=0.8')).toBe('zh-TW');
    expect(serverLocale(null, 'ja,en;q=0.8')).toBe('ja');
    expect(serverLocale(null, 'ja-JP,ja;q=0.9,en;q=0.8')).toBe('ja');
  });

  it('AC12 ?lang=ja 與 Accept-Language: ja 都收斂到 ja', () => {
    expect(serverLocale('ja', 'en-US,en;q=0.9')).toBe('ja');
    expect(serverLocale('ja-JP', null)).toBe('ja');
    expect(serverLocale(null, 'ja;q=0.8,en;q=0.5')).toBe('ja');
  });

  it('Accept-Language 依 q 值取最高的支援語言，不是依出現順序', () => {
    expect(serverLocale(null, 'zh-TW;q=0.4,en;q=0.9')).toBe('en');
    expect(serverLocale(null, 'en;q=0.3,zh-TW;q=0.8')).toBe('zh-TW');
  });

  it('跳過不支援的語言與 q=0', () => {
    expect(serverLocale(null, 'fr-FR,fr;q=0.9,en;q=0.5')).toBe('en');
    expect(serverLocale(null, 'en;q=0,zh-TW;q=0.5')).toBe('zh-TW');
  });

  it('兩個來源都沒有可用語言時回 zh-TW', () => {
    expect(serverLocale(null, null)).toBe(DEFAULT_LOCALE);
    expect(serverLocale('fr', 'fr-FR,de;q=0.8')).toBe(DEFAULT_LOCALE);
    expect(serverLocale('', '')).toBe(DEFAULT_LOCALE);
  });
});

describe('AC6 client 的語言 precedence：?lang= → localStorage → <html lang>', () => {
  it('?lang= 勝過 localStorage 與 <html lang>', () => {
    expect(clientLocale('en', 'zh-TW', 'zh-Hant')).toBe('en');
    expect(clientLocale('zh-TW', 'en', 'en')).toBe('zh-TW');
  });

  it('沒有 ?lang= 時看 localStorage', () => {
    expect(clientLocale(null, 'en', 'zh-Hant')).toBe('en');
    expect(clientLocale(null, 'zh-TW', 'en')).toBe('zh-TW');
  });

  it('前兩者都沒有時看 server 寫進 <html lang> 的值', () => {
    expect(clientLocale(null, null, 'en')).toBe('en');
    expect(clientLocale(null, null, 'zh-Hant')).toBe('zh-TW');
  });

  it('三個來源都不可用時回 zh-TW', () => {
    expect(clientLocale(null, null, null)).toBe(DEFAULT_LOCALE);
    expect(clientLocale('fr', 'de', 'ko')).toBe(DEFAULT_LOCALE);
  });

  it('不看 Accept-Language（client 沒有這個來源）也不看 navigator，壞掉的 localStorage 值被忽略', () => {
    expect(clientLocale(null, 'not-a-lang', 'en')).toBe('en');
  });
});

describe('AC6 語言標記', () => {
  it('<html lang> 與 JSON-LD inLanguage 用 BCP-47 標記', () => {
    expect(htmlLang('zh-TW')).toBe('zh-Hant');
    expect(htmlLang('en')).toBe('en');
    expect(htmlLang('ja')).toBe('ja');
  });

  it('og:locale 用 Facebook 的底線格式', () => {
    expect(ogLocale('zh-TW')).toBe('zh_TW');
    expect(ogLocale('en')).toBe('en_US');
    expect(ogLocale('ja')).toBe('ja_JP');
  });
});
