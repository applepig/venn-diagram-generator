import { describe, expect, it } from 'vitest';
import { searchWithLang, searchWithState, shareUrl } from '../ui/share-url';

describe('AC6 replaceState 的 query：只改 s，其餘參數保留', () => {
  it('帶 lang 的網址換 s 之後 lang 還在', () => {
    const next = searchWithState('?lang=en&s=OLD', 'NEW');

    const params = new URLSearchParams(next);
    expect(params.get('s')).toBe('NEW');
    expect(params.get('lang')).toBe('en');
  });

  it('原本沒有 s 也能加上去，不動其他參數', () => {
    const params = new URLSearchParams(searchWithState('?lang=zh-TW', 'NEW'));

    expect(params.get('s')).toBe('NEW');
    expect(params.get('lang')).toBe('zh-TW');
  });

  it('原本沒有任何參數時只有 s', () => {
    expect(searchWithState('', 'NEW')).toBe('?s=NEW');
    expect(searchWithState('?', 'NEW')).toBe('?s=NEW');
  });

  it('不認得的參數也保留（不主動裁剪別人的 query）', () => {
    const params = new URLSearchParams(searchWithState('?utm_source=x&lang=en', 'NEW'));

    expect(params.get('utm_source')).toBe('x');
    expect(params.get('lang')).toBe('en');
    expect(params.get('s')).toBe('NEW');
  });

  it('base64url 的 s 不會被百分號編碼（換出來的網址要能直接解開）', () => {
    const encoded = 'abcXYZ012_-';

    expect(searchWithState('?lang=en', encoded)).toContain(`s=${encoded}`);
  });
});

/**
 * AC12：語言下拉選完之後要整頁 reload（`<html lang>`、meta、介面字串全走 server 那一套注入），
 * 所以 lang 必須進 URL，而圖的內容在 `s` 裡，一個字都不能丟。
 */
describe('AC12 searchWithLang：把 lang 寫進 URL 且保留 s', () => {
  it('原本沒有 lang 時加上去，s 不動', () => {
    const params = new URLSearchParams(searchWithLang('?s=ABC', 'ja'));

    expect(params.get('lang')).toBe('ja');
    expect(params.get('s')).toBe('ABC');
  });

  it('原本的 lang 被換掉，不是變成兩個 lang', () => {
    const next = searchWithLang('?lang=en&s=ABC', 'ja');
    const params = new URLSearchParams(next);

    expect(params.getAll('lang')).toEqual(['ja']);
    expect(params.get('s')).toBe('ABC');
  });

  it('其他參數原樣保留', () => {
    const params = new URLSearchParams(searchWithLang('?utm_source=x&s=ABC', 'zh-TW'));

    expect(params.get('utm_source')).toBe('x');
    expect(params.get('lang')).toBe('zh-TW');
  });

  it('base64url 的 s 不會被百分號編碼（reload 後還解得開）', () => {
    expect(searchWithLang('?s=abcXYZ012_-', 'en')).toContain('s=abcXYZ012_-');
  });

  it('沒有任何參數時只有 lang', () => {
    expect(searchWithLang('', 'ja')).toBe('?lang=ja');
  });
});

describe('AC6 shareUrl：不帶 lang', () => {
  it('只有 s，收件人用自己的語言看介面', () => {
    expect(shareUrl('https://venn.example.test', 'ABC')).toBe(
      'https://venn.example.test/?s=ABC',
    );
  });

  it('不論目前介面語言，分享連結都不夾帶 lang', () => {
    expect(shareUrl('https://venn.example.test', 'ABC')).not.toContain('lang');
  });
});
