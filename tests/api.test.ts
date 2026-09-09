import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { encodeState } from '../shared/state-codec-node';
import { encodeBase64Url } from '../shared/state-codec';
import { defaultState, sampleState } from '../shared/defaults';
import type { VennState } from '../shared/types';
import { FONT_FILE } from './helpers/font';

const app = createApp({ fontFile: FONT_FILE });

const ORIGIN = 'https://venn.applepig.net';

function get(path: string, headers: Record<string, string> = {}) {
  return app.request(`${ORIGIN}${path}`, { headers });
}

/** 讀 PNG 的 IHDR chunk 拿真實像素尺寸 */
function pngSize(buf: Buffer): { width: number; height: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(buf.subarray(0, 8).equals(signature)).toBe(true);
  expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function packJson(value: unknown): string {
  return encodeBase64Url(new Uint8Array(deflateRawSync(Buffer.from(JSON.stringify(value), 'utf8'))));
}

describe('GET /api/png：AC3 正常出圖', () => {
  it('回 200、image/png，尺寸等於 state.size', async () => {
    const s = encodeState({ ...sampleState(), size: 800 });
    const res = await get(`/api/png?s=${s}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(pngSize(Buffer.from(await res.arrayBuffer()))).toEqual({ width: 800, height: 800 });
  });

  it('size 1600 就真的輸出 1600×1600', async () => {
    const res = await get(`/api/png?s=${encodeState({ ...sampleState(), size: 1600 })}`);

    expect(pngSize(Buffer.from(await res.arrayBuffer()))).toEqual({ width: 1600, height: 1600 });
  });

  it('帶一年期 immutable 快取標頭（參數即內容）', async () => {
    const res = await get(`/api/png?s=${encodeState(sampleState())}`);

    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('3 圈與 4 圈、三種樣式都出得了圖', async () => {
    const cases: VennState[] = [
      { ...defaultState(3), style: 'translucent', size: 400, texts: { '7': { t: '不存在' } } },
      { ...defaultState(3), style: 'flat', size: 400, texts: { '3': { t: '要錢' } } },
      { ...defaultState(4), style: 'outline', size: 400, texts: { '15': { t: '媽媽' } } },
    ];

    for (const state of cases) {
      const res = await get(`/api/png?s=${encodeState(state)}`);
      expect(res.status).toBe(200);
      expect(pngSize(Buffer.from(await res.arrayBuffer())).width).toBe(400);
    }
  });
});

describe('GET /api/png：AC3 壞輸入回 400 JSON', () => {
  const bad: [string, string][] = [
    ['缺少 s', '/api/png'],
    ['s 是空字串', '/api/png?s='],
    ['s 解不開', '/api/png?s=!!!!'],
    ['s 是 base64 但不是 deflate', `/api/png?s=${encodeBase64Url(new Uint8Array([9, 9, 9, 9]))}`],
  ];

  for (const [name, path] of bad) {
    it(`${name} → 400 JSON`, async () => {
      const res = await get(path);

      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toHaveProperty('error');
    });
  }

  const bad_schema: [string, unknown][] = [
    ['size 超過 2000', { ...sampleState(), size: 2400 }],
    ['size 小於 400', { ...sampleState(), size: 100 }],
    ['size 非整數', { ...sampleState(), size: 1000.5 }],
    ['圈數不合法', { ...sampleState(), n: 7 }],
    ['文字超過 80 字', { ...sampleState(), texts: { '1': { t: '字'.repeat(81) } } }],
    ['顏色不是 hex', { ...sampleState(), colors: ['red', 'blue'] }],
  ];

  for (const [name, value] of bad_schema) {
    it(`${name} → 400 JSON`, async () => {
      const res = await get(`/api/png?s=${packJson(value)}`);

      expect(res.status).toBe(400);
      expect(await res.json()).toHaveProperty('error');
    });
  }
});

describe('GET /：AC4 og meta', () => {
  it('帶 s 時 og:image 是指向對應 /api/png 的絕對 URL', async () => {
    const s = encodeState(sampleState());
    const html = await (await get(`/?s=${s}`)).text();

    expect(html).toContain(`<meta property="og:image" content="${ORIGIN}/api/png?s=${s}"`);
    expect(html).toContain('<meta property="og:title"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
  });

  it('沒有 s 時仍給預設範例圖的 og:image', async () => {
    const html = await (await get('/')).text();
    const match = html.match(/<meta property="og:image" content="([^"]+)"/);

    expect(match).not.toBeNull();
    expect(match![1]).toMatch(new RegExp(`^${ORIGIN}/api/png\\?s=[A-Za-z0-9_-]+$`));
  });

  it('og:image 尊重反向代理的 x-forwarded-proto／host', async () => {
    const html = await (
      await get('/', { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'venn.example.com' })
    ).text();

    expect(html).toContain('content="https://venn.example.com/api/png?s=');
  });

  it('og:image 指向的 URL 真的出得了圖', async () => {
    const html = await (await get('/')).text();
    const url = html.match(/<meta property="og:image" content="([^"]+)"/)![1]!;
    const res = await get(new URL(url).pathname + new URL(url).search);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('壞掉的 s 不會讓首頁掛掉，退回預設範例圖', async () => {
    const res = await get('/?s=!!!!');

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('og:image');
  });

  it('og:title 會 escape，惡意文字不能注入標籤', async () => {
    const s = encodeState({
      ...defaultState(2),
      texts: { '1': { t: '"><script>alert(1)</script>' } },
    });
    const html = await (await get(`/?s=${s}`)).text();

    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
