import { describe, expect, it } from 'vitest';
import { searchWithState, shareUrl } from '../ui/share-url';

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
