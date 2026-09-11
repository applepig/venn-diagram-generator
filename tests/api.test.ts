import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateRawSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { encodeState } from '../shared/state-codec-node';
import { encodeBase64Url } from '../shared/state-codec';
import { MAX_STATE_PARAM_LEN, defaultState, sampleState } from '../shared/defaults';
import type { VennState } from '../shared/types';
import { FONT_FILE } from './helpers/font';
import { bombParam, paramOfLength } from './helpers/state-param';

const OG_BASE_FILE = resolve('web/public/og-base.png');
const app = createApp({ fontFile: FONT_FILE, ogBaseFile: OG_BASE_FILE });

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

/** 解 PNG scanline，讓測試從公開 PNG 像素驗證合成區域。 */
function decodePng(buf: Buffer) {
  const { width, height } = pngSize(buf);
  const color_type = buf[25];
  const channels = color_type === 6 ? 4 : color_type === 2 ? 3 : 0;
  expect(channels).toBeGreaterThan(0);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < buf.length; ) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') chunks.push(buf.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)]!;
    if (filter > 4) throw new Error(`PNG filter ${filter} 不受支援`);
    const current = Buffer.from(raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? current[i - channels]! : 0;
      const up = previous[i]!;
      const upper_left = i >= channels ? previous[i - channels]! : 0;
      if (filter === 1) current[i] = current[i]! + left;
      else if (filter === 2) current[i] = current[i]! + up;
      else if (filter === 3) current[i] = current[i]! + Math.floor((left + up) / 2);
      else if (filter === 4) {
        const estimate = left + up - upper_left;
        const distances = [
          Math.abs(estimate - left),
          Math.abs(estimate - up),
          Math.abs(estimate - upper_left),
        ];
        const nearest =
          distances[0]! <= distances[1]! && distances[0]! <= distances[2]!
            ? left
            : distances[1]! <= distances[2]!
              ? up
              : upper_left;
        current[i] = current[i]! + nearest;
      }
    }
    current.copy(pixels, row * stride);
    previous = current;
  }
  return { width, height, channels, pixels };
}

function pngPixel(
  image: ReturnType<typeof decodePng>,
  x: number,
  y: number,
): [number, number, number, number] {
  const offset = (y * image.width + x) * image.channels;
  return [
    image.pixels[offset]!,
    image.pixels[offset + 1]!,
    image.pixels[offset + 2]!,
    image.channels === 4 ? image.pixels[offset + 3]! : 255,
  ];
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

describe('GET /api/og.png：固定橫式 OG 合成', () => {
  it('缺少 s 時回預設內容的 1200×630 PNG 與長期快取標頭', async () => {
    const res = await get('/api/og.png?v=2');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(pngSize(Buffer.from(await res.arrayBuffer()))).toEqual({ width: 1200, height: 630 });
  });

  it('缺少 s 與明確傳入 sampleState 會產生相同內容', async () => {
    const [implicit, explicit] = await Promise.all([
      get('/api/og.png?v=2'),
      get(`/api/og.png?v=2&s=${encodeState(sampleState())}`),
    ]);

    expect(Buffer.from(await implicit.arrayBuffer())).toEqual(Buffer.from(await explicit.arrayBuffer()));
  });

  it('兩個內容不同的合法 state 會產生不同 OG PNG', async () => {
    const first = await get(`/api/og.png?v=2&s=${encodeState(sampleState())}`);
    const second = await get(
      `/api/og.png?v=2&s=${encodeState({ ...sampleState(), texts: { '3': { t: '今天就做' } } })}`,
    );

    expect(Buffer.from(await first.arrayBuffer())).not.toEqual(Buffer.from(await second.arrayBuffer()));
  });

  it('3 圈 translucent 合成後仍保留左側品牌底圖', async () => {
    const res = await get(`/api/og.png?v=2&s=${encodeState(sampleState(3))}`);
    const output = decodePng(Buffer.from(await res.arrayBuffer()));
    const base = decodePng(readFileSync(OG_BASE_FILE));

    for (let y = 20; y < 630; y += 20) {
      for (let x = 20; x < 560; x += 20) {
        expect(pngPixel(output, x, y)).toEqual(pngPixel(base, x, y));
      }
    }
  });

  it('state.bg 不會在右側畫出有硬邊的正方形背景', async () => {
    const state = { ...sampleState(3), bg: '#ff00ff' };
    const res = await get(`/api/og.png?v=2&s=${encodeState(state)}`);
    const output = decodePng(Buffer.from(await res.arrayBuffer()));
    const base = decodePng(readFileSync(OG_BASE_FILE));

    expect(pngPixel(output, 650, 72)).toEqual(pngPixel(base, 650, 72));
  });

  for (const [name, path] of [
    ['s 是空字串', '/api/og.png?v=2&s='],
    ['s 解不開', '/api/og.png?v=2&s=!!!!'],
    ['s 過長', `/api/og.png?v=2&s=${'a'.repeat(MAX_STATE_PARAM_LEN + 1)}`],
  ] as const) {
    it(`${name} → 400 JSON 且不快取`, async () => {
      const res = await get(path);

      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toHaveProperty('error');
    });
  }

  it('與 /api/png 共用合計 3 張的渲染上限', async () => {
    const isolated = createApp({ fontFile: FONT_FILE, ogBaseFile: OG_BASE_FILE });
    const s = encodeState({ ...defaultState(4), style: 'flat', size: 1600 });
    const paths = Array.from({ length: 6 }, (_, i) =>
      i % 2 === 0 ? `/api/png?s=${s}` : `/api/og.png?v=2&s=${s}`,
    );
    const responses = await Promise.all(paths.map((path) => isolated.request(`${ORIGIN}${path}`)));

    expect(responses.some((res) => res.status === 503)).toBe(true);
    for (const res of responses) {
      if (res.status !== 503) continue;
      expect(res.headers.get('retry-after')).toBe('2');
      expect(res.headers.get('cache-control')).toBe('no-store');
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

describe('GET /api/png：AC1b 非同步渲染與並行上限', () => {
  /** 最重的一張：4 圈 flat，用來確保渲染真的耗時，測試才有意義 */
  function heavy(size: number): string {
    return encodeState({
      ...defaultState(4),
      style: 'flat',
      size,
      texts: { '1': { t: '快' }, '15': { t: '全都要' } },
    });
  }

  it('渲染走非同步，不把 event loop 卡住', async () => {
    let ticks = 0;
    const timer = setInterval(() => {
      ticks++;
    }, 5);
    const started = performance.now();
    const res = await get(`/api/png?s=${heavy(2000)}`);
    const elapsed = performance.now() - started;
    clearInterval(timer);

    expect(res.status).toBe(200);
    // 前提：這張圖夠重（同步渲染會整段卡住 event loop），否則本測試無意義
    expect(elapsed).toBeGreaterThan(30);
    expect(ticks).toBeGreaterThan(2);
  });

  it('同時 6 個請求：超過上限的回 503 JSON 帶 Retry-After，其餘正常回 200', async () => {
    const app = createApp({ fontFile: FONT_FILE });
    const s = heavy(1200);
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => app.request(`${ORIGIN}/api/png?s=${s}`)),
    );
    const statuses = responses.map((r) => r.status);

    expect(statuses.filter((s) => s === 503).length).toBeGreaterThanOrEqual(1);
    expect(new Set(statuses).size).toBeLessThanOrEqual(2);
    expect(statuses.every((s) => s === 200 || s === 503)).toBe(true);

    for (const res of responses) {
      if (res.status === 503) {
        expect(res.headers.get('retry-after')).toBe('2');
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(res.headers.get('content-type')).toContain('application/json');
        expect(await res.json()).toHaveProperty('error');
      } else {
        expect(res.headers.get('content-type')).toBe('image/png');
      }
    }
  });

  it('單發請求不會被並行上限擋下', async () => {
    const app = createApp({ fontFile: FONT_FILE });
    const res = await app.request(`${ORIGIN}/api/png?s=${heavy(800)}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('渲染結束後名額會釋放：擠爆一輪之後仍出得了圖', async () => {
    const app = createApp({ fontFile: FONT_FILE });
    const s = heavy(800);
    await Promise.all(Array.from({ length: 6 }, () => app.request(`${ORIGIN}/api/png?s=${s}`)));

    const after = await app.request(`${ORIGIN}/api/png?s=${s}`);
    expect(after.status).toBe(200);
  });
});

describe('GET /：AC4 og meta', () => {
  it('帶有效 s 時 og:image 與 twitter:image 指向對應的版本化 OG URL', async () => {
    const s = encodeState(sampleState());
    const html = await (await get(`/?s=${s}`)).text();

    const image_url = `${ORIGIN}/api/og.png?v=2&amp;s=${s}`;
    expect(html).toContain(`<meta property="og:image" content="${image_url}"`);
    expect(html).toContain(`<meta name="twitter:image" content="${image_url}"`);
    expect(html).toContain('<meta property="og:title"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
  });

  it('有效但非 canonical 的 s 會在 image meta 收斂成 canonical state', async () => {
    const state = sampleState();
    const canonical = encodeState(state);
    const noncanonical = encodeBase64Url(
      new Uint8Array(deflateRawSync(Buffer.from(JSON.stringify(state), 'utf8'), { level: 0 })),
    );
    expect(noncanonical).not.toBe(canonical);

    const html = await (await get(`/?s=${noncanonical}`)).text();
    const image_url = `${ORIGIN}/api/og.png?v=2&amp;s=${canonical}`;

    expect(html).toContain(`<meta property="og:image" content="${image_url}"`);
    expect(html).toContain(`<meta name="twitter:image" content="${image_url}"`);
    expect(html).toContain(`<meta property="og:url" content="${ORIGIN}/?s=${noncanonical}"`);
  });

  it('沒有 s 時兩種 image meta 共用不夾帶預設 state 的 OG URL', async () => {
    const html = await (await get('/')).text();

    expect(html).toContain(`<meta property="og:image" content="${ORIGIN}/api/og.png?v=2"`);
    expect(html).toContain(`<meta name="twitter:image" content="${ORIGIN}/api/og.png?v=2"`);
    expect(html).not.toContain('/api/og.png?v=2&amp;s=');
  });

  it('OG image meta 尺寸固定宣告 1200×630', async () => {
    const html = await (await get('/')).text();

    expect(html).toContain('<meta property="og:image:width" content="1200">');
    expect(html).toContain('<meta property="og:image:height" content="630">');
  });

  it('沒有 s 時 <title>、og:title、twitter:title 都用品牌文案，不用範例圖上的字', async () => {
    const html = await (await get('/')).text();
    const brand = '文氏圖產生器｜找不到哏圖不會自己做嗎？';

    expect(html).toContain(`<title>${brand}</title>`);
    expect(html).toContain(`<meta property="og:title" content="${brand}">`);
    expect(html).toContain(`<meta name="twitter:title" content="${brand}">`);
    expect(html).not.toContain('該做的事 × 想做的事');
  });

  it('帶 s 時 og:title 用圖上的單圈標籤，手動換行不留空白', async () => {
    const html = await (await get(`/?s=${encodeState(sampleState())}`)).text();
    const title = html.match(/<meta property="og:title" content="([^"]+)"/)![1]!;

    expect(title).toBe('該做的事 × 想做的事｜文氏圖產生器');
    expect(html).toContain(`<title>${title}</title>`);
  });

  it('og:image 尊重反向代理的 x-forwarded-proto／host', async () => {
    const html = await (
      await get('/', { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'venn.example.com' })
    ).text();

    expect(html).toContain('content="https://venn.example.com/api/og.png?v=2"');
  });

  it('og:image 指向的 URL 真的出得了圖', async () => {
    const html = await (await get('/')).text();
    const url = html.match(/<meta property="og:image" content="([^"]+)"/)![1]!.replace(/&amp;/g, '&');
    const res = await get(new URL(url).pathname + new URL(url).search);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(pngSize(Buffer.from(await res.arrayBuffer()))).toEqual({ width: 1200, height: 630 });
  });

  for (const [name, path] of [
    ['解不開', '/?s=!!!!'],
    ['空字串', '/?s='],
    ['過長', `/?s=${'a'.repeat(MAX_STATE_PARAM_LEN + 1)}`],
  ] as const) {
    it(`${name}的 s 不會讓首頁掛掉，退回預設 OG URL`, async () => {
      const res = await get(path);
      const html = await res.text();

      expect(res.status).toBe(200);
      expect(html).toContain(`<meta property="og:image" content="${ORIGIN}/api/og.png?v=2"`);
      expect(html).toContain(`<meta name="twitter:image" content="${ORIGIN}/api/og.png?v=2"`);
    });
  }

  it('og:title 會 escape，惡意文字不能注入標籤', async () => {
    const s = encodeState({
      ...defaultState(2),
      texts: { '1': { t: '"><script>alert(1)</script>' } },
    });
    const html = await (await get(`/?s=${s}`)).text();

    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

describe('非 XML 字元不得穿透到渲染層', () => {
  // XML 1.0 不接受這些字元，但 JSON 能以 \u 逃逸序列把它們載運進來
  const NUL = String.fromCharCode(0x00);
  const VERTICAL_TAB = String.fromCharCode(0x0b);
  const NONCHAR = String.fromCharCode(0xfffe);

  const badTextUrl = (ch: string) =>
    `/api/png?s=${packJson({ ...sampleState(), texts: { '1': { t: `a${ch}b` } } })}`;

  for (const [name, ch] of [
    ['NUL U+0000', NUL],
    ['垂直定位字元 U+000B', VERTICAL_TAB],
    ['非字元 U+FFFE', NONCHAR],
  ] as const) {
    it(`文字含 ${name} → /api/png 回 400 JSON，不是 500`, async () => {
      const res = await get(badTextUrl(ch));

      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toHaveProperty('error');
    });
  }

  it('文字含 NUL → 首頁仍回 200，且 HTML 不含裸 NUL', async () => {
    const res = await get(
      `/?s=${packJson({ ...sampleState(), texts: { '1': { t: `工程${NUL}師` } } })}`,
    );
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).not.toContain(NUL);
    expect(html).toContain('og:image');
  });

  it('合法的 tab／換行／歸位不受影響，照樣出圖', async () => {
    const s = encodeState({
      ...defaultState(2),
      size: 400,
      texts: { '3': { t: '會寫\tCSS\r\n也會設計' } },
    });
    const res = await get(`/api/png?s=${s}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });
});

describe('AC1 壓縮炸彈：s 短、解開很大', () => {
  // 2MB 的空白壓完只剩約 2,700 字元，過得了長度閘，只有解壓上限攔得住
  const bomb = bombParam(2 * 1024 * 1024);

  it('前提：這顆炸彈短到長度閘擋不住，擋下它的只能是解壓上限', () => {
    expect(bomb.length).toBeLessThan(MAX_STATE_PARAM_LEN);
  });

  it('/api/png 回 400 JSON', async () => {
    const res = await get(`/api/png?s=${bomb}`);

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toHaveProperty('error');
  });

  it('首頁不掛掉，退回預設範例圖', async () => {
    const res = await get(`/?s=${bomb}`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain(`content="${ORIGIN}/api/og.png?v=2"`);
  });
});

describe('AC2 s 參數長度閘', () => {
  it('長度剛好等於上限的合法 s 照常出圖', async () => {
    const s = paramOfLength(MAX_STATE_PARAM_LEN);
    const res = await get(`/api/png?s=${s}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('超過上限的合法 s → /api/png 回 400，錯誤講的是長度而不是解碼失敗', async () => {
    const s = paramOfLength(MAX_STATE_PARAM_LEN + 2);
    const res = await get(`/api/png?s=${s}`);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('過長') });
  });

  it('超過上限的 s → 首頁退回預設範例圖，不把超長參數放進 og:image', async () => {
    const s = paramOfLength(MAX_STATE_PARAM_LEN + 2);
    const res = await get(`/?s=${s}`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain(`content="${ORIGIN}/api/og.png?v=2"`);
    expect(html).not.toContain(s);
  });
});

describe('AC13 SEO：canonical、robots、structured data', () => {
  it('首頁 canonical 收斂到 /，可索引，並帶 WebApplication 的 JSON-LD', async () => {
    const html = await (await get('/')).text();

    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/">`);
    expect(html).toContain('<meta name="robots" content="index, follow">');
    expect(html).toContain('"@type":"WebApplication"');
    expect(html).toContain(`<title>文氏圖產生器｜找不到哏圖不會自己做嗎？</title>`);
  });

  it('分享頁 canonical 指自己、noindex，且不宣告成獨立作品', async () => {
    const s = encodeState(sampleState());
    const html = await (await get(`/?s=${s}`)).text();

    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/?s=${s}">`);
    expect(html).toContain('<meta name="robots" content="noindex, follow">');
    expect(html).not.toContain('application/ld+json');
  });

  it('分享頁的 <title> 換成圖上的內容，不留 build 時的預設值', async () => {
    const s = encodeState(sampleState());
    const html = await (await get(`/?s=${s}`)).text();

    expect(html).toContain('<title>該做的事 × 想做的事｜文氏圖產生器</title>');
  });

  it('壞掉的 s 不會被當成值得索引的頁面', async () => {
    const html = await (await get('/?s=!!!!')).text();

    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/">`);
  });

  it('og 補齊 site_name、locale、image:alt 與 twitter:description', async () => {
    const html = await (await get('/')).text();

    expect(html).toContain('<meta property="og:site_name" content="文氏圖產生器">');
    expect(html).toContain('<meta property="og:locale" content="zh_TW">');
    expect(html).toContain('<meta property="og:image:type" content="image/png">');
    expect(html).toContain('<meta property="og:image:alt"');
    expect(html).toContain('<meta name="twitter:description"');
  });

  it('robots.txt 指向絕對網址的 sitemap，且不擋 ?s=（會連 og 爬蟲一起擋掉）', async () => {
    const res = await get('/robots.txt');
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(body).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    expect(body).not.toContain('Disallow');
  });

  it('sitemap.xml 只收首頁', async () => {
    const res = await get('/sitemap.xml');
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    expect(body).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(body.match(/<loc>/g)).toHaveLength(1);
  });
});

describe('AC13 GTM 只在給了 container id 時注入', () => {
  const GTM_ID = 'GTM-KTZKC8CH';
  const tagged = createApp({ fontFile: FONT_FILE, publicOrigin: ORIGIN, gtmId: GTM_ID });

  it('沒給 id 的部署（開發站、測試）完全不載入 GTM', async () => {
    const html = await (await get('/')).text();

    expect(html).not.toContain('googletagmanager');
  });

  it('給了 id 時 head 有 gtm.js、body 開頭有 noscript iframe', async () => {
    const html = await (await tagged.request(`${ORIGIN}/`)).text();

    expect(html).toContain(`'${GTM_ID}'`);
    expect(html).toContain('https://www.googletagmanager.com/gtm.js?id=');
    expect(html).toContain(`<body><noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}"`);
  });
});

describe('AC3 og origin 由 publicOrigin 決定', () => {
  const fixed = createApp({ fontFile: FONT_FILE, publicOrigin: ORIGIN });

  it('設了 publicOrigin 時，forwarded 標頭改不動輸出的 origin', async () => {
    const html = await (
      await fixed.request('http://localhost/', {
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.example.com' },
      })
    ).text();

    expect(html).not.toContain('evil.example.com');
    expect(html).toContain(`<meta property="og:image" content="${ORIGIN}/api/og.png?v=2`);
    expect(html).toContain(`<meta property="og:url" content="${ORIGIN}/?s=`);
    expect(html).toContain(`<meta name="twitter:image" content="${ORIGIN}/api/og.png?v=2`);
  });
});
