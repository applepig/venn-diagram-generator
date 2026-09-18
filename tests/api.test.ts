import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { decodeState, encodeState } from '../engine/state-codec-node';
import { encodeBase64Url } from '../engine/state-codec';
import { MAX_STATE_PARAM_LEN } from '../engine/defaults';
import { defaultState, sampleState } from '../content/state-presets';
import { slotMasks } from '../engine/layout';
import type { Arrangement, CircleCount, VennState } from '../engine/types';
import { t } from '../content/locale';
import { FONT_FILES } from './helpers/font';
import { decodePng, meanRgb, pngPixel, pngSize } from './helpers/png';
import { bombParam, paramOfLength } from './helpers/state-param';

const OG_BASE_FILE = resolve('ui/public/og-base.png');
const app = createApp({ fontFiles: FONT_FILES, ogBaseFile: OG_BASE_FILE });

const ORIGIN = 'https://venn.applepig.net';

/**
 * server 組出來的 og:image URL（HTML 屬性裡的 `&` 已 escape）。
 * 07 M5：固定 URL 配一年期快取，語言不進 key 就會被第一個爬蟲的語言污染，所以一律帶 lang。
 */
const OG_URL = `${ORIGIN}/api/og.png?v=5&amp;lang=zh-TW`;

function get(path: string, headers: Record<string, string> = {}) {
  return app.request(`${ORIGIN}${path}`, { headers });
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
    const res = await get('/api/og.png?v=5');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(pngSize(Buffer.from(await res.arrayBuffer()))).toEqual({ width: 1200, height: 630 });
  });

  // 兩次 og 合成各約 0.5 秒，但整套是 8 個測試檔平行跑、每個檔都在點陣化，
  // CPU 飽和時會超過預設的 5 秒（合併前的 main 上就會紅）。放寬的是時間預算，不是斷言。
  it('缺少 s 與明確傳入 sampleState 會產生相同內容', async () => {
    const [implicit, explicit] = await Promise.all([
      get('/api/og.png?v=5'),
      get(`/api/og.png?v=5&s=${encodeState(sampleState())}`),
    ]);

    expect(Buffer.from(await implicit.arrayBuffer())).toEqual(Buffer.from(await explicit.arrayBuffer()));
  }, 20000);

  it('兩個內容不同的合法 state 會產生不同 OG PNG', async () => {
    const first = await get(`/api/og.png?v=5&s=${encodeState(sampleState())}`);
    const second = await get(
      `/api/og.png?v=5&s=${encodeState({ ...sampleState(), texts: { '3': { t: '今天就做' } } })}`,
    );

    expect(Buffer.from(await first.arrayBuffer())).not.toEqual(Buffer.from(await second.arrayBuffer()));
  });

  it('3 圈 translucent 合成後仍保留左側品牌底圖', async () => {
    const res = await get(`/api/og.png?v=5&s=${encodeState(sampleState(3))}`);
    const output = decodePng(Buffer.from(await res.arrayBuffer()));
    const base = decodePng(readFileSync(OG_BASE_FILE));

    // dither 讓單顆像素可以差到 ±15，但區域平均只飄 0.1 以內：
    // 底圖被蓋掉或圖表位移才會讓平均真的跑掉（實測把圖表移到左側，差距 2.3）
    const left = { x: 20, y: 20, w: 540, h: 590 };
    const mean_output = meanRgb(output, left);
    const mean_base = meanRgb(base, left);
    for (let ch = 0; ch < 3; ch++) {
      expect(Math.abs(mean_output[ch]! - mean_base[ch]!)).toBeLessThanOrEqual(0.5);
    }
  });

  it('state.bg 不會在右側畫出有硬邊的正方形背景', async () => {
    const state = { ...sampleState(3), bg: '#ff00ff' };
    const res = await get(`/api/og.png?v=5&s=${encodeState(state)}`);
    const output = decodePng(Buffer.from(await res.arrayBuffer()));
    const base = decodePng(readFileSync(OG_BASE_FILE));

    // 圖表左上角落在圓形之外：這塊若被 bg 的正方形蓋住，G 通道會直接掉兩百多
    const corner = { x: 646, y: 69, w: 16, h: 16 };
    const mean_output = meanRgb(output, corner);
    const mean_base = meanRgb(base, corner);
    for (let ch = 0; ch < 3; ch++) {
      expect(Math.abs(mean_output[ch]! - mean_base[ch]!)).toBeLessThanOrEqual(0.5);
    }
  });

  for (const [name, path] of [
    ['s 是空字串', '/api/og.png?v=5&s='],
    ['s 解不開', '/api/og.png?v=5&s=!!!!'],
    ['s 過長', `/api/og.png?v=5&s=${'a'.repeat(MAX_STATE_PARAM_LEN + 1)}`],
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
    const isolated = createApp({ fontFiles: FONT_FILES, ogBaseFile: OG_BASE_FILE });
    const s = encodeState({ ...defaultState(4), style: 'flat', size: 1600 });
    const paths = Array.from({ length: 6 }, (_, i) =>
      i % 2 === 0 ? `/api/png?s=${s}` : `/api/og.png?v=5&s=${s}`,
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

  const bad_shape: [string, unknown][] = [
    ['row(2) 不是合法組合', { ...defaultState(2), arr: 'row' }],
    ['ring(7) 不是合法組合', { ...defaultState(2), n: 7 }],
    ['arr 不認得', { ...defaultState(3), arr: 'spiral' }],
  ];

  for (const [name, value] of bad_shape) {
    it(`${name} → 400，錯誤訊息是英文`, async () => {
      const res = await get(`/api/png?s=${packJson(value)}`);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      // API 是機器介面，不走 i18n：訊息只用 ASCII 可列印字元
      expect(body.error).toMatch(/^[\x20-\x7e]+$/);
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
    const app = createApp({ fontFiles: FONT_FILES });
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
    const app = createApp({ fontFiles: FONT_FILES });
    const res = await app.request(`${ORIGIN}/api/png?s=${heavy(800)}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('渲染結束後名額會釋放：擠爆一輪之後仍出得了圖', async () => {
    const app = createApp({ fontFiles: FONT_FILES });
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

    const image_url = `${OG_URL}&amp;s=${s}`;
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
    const image_url = `${OG_URL}&amp;s=${canonical}`;

    expect(html).toContain(`<meta property="og:image" content="${image_url}"`);
    expect(html).toContain(`<meta name="twitter:image" content="${image_url}"`);
    expect(html).toContain(`<meta property="og:url" content="${ORIGIN}/?s=${noncanonical}"`);
  });

  it('沒有 s 時兩種 image meta 共用不夾帶預設 state 的 OG URL', async () => {
    const html = await (await get('/')).text();

    expect(html).toContain(`<meta property="og:image" content="${OG_URL}"`);
    expect(html).toContain(`<meta name="twitter:image" content="${OG_URL}"`);
    expect(html).not.toContain('&amp;s=');
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

    expect(html).toContain('content="https://venn.example.com/api/og.png?v=5&amp;lang=zh-TW"');
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
      expect(html).toContain(`<meta property="og:image" content="${OG_URL}"`);
      expect(html).toContain(`<meta name="twitter:image" content="${OG_URL}"`);
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
    expect(html).toContain(`content="${OG_URL}"`);
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
    // API 是機器介面，錯誤訊息是英文固定值（07 ADR）
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('too long') });
  });

  it('超過上限的 s → 首頁退回預設範例圖，不把超長參數放進 og:image', async () => {
    const s = paramOfLength(MAX_STATE_PARAM_LEN + 2);
    const res = await get(`/?s=${s}`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain(`content="${OG_URL}"`);
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

  /**
   * AC19：JSON-LD 寫在 `<script>` 裡，`</script>` 一出現瀏覽器就結束這個 script。
   * origin 是從 forwarded 標頭推導的（沒設 PUBLIC_ORIGIN 時），代理層塞得進去。
   */
  it('origin 含 </script> 時 JSON-LD 不提前收尾，也不吐出可執行的 script', async () => {
    const evil = 'evil.test/</script><script>alert(1)</script>';
    const html = await (
      await app.request(`https://venn.example.com/`, { headers: { 'x-forwarded-host': evil } })
    ).text();
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!;

    expect(ld).not.toContain('</script');
    expect(ld).toContain('\\u003c/script');
    expect(html).not.toContain('<script>alert(1)</script>');
    // 內容仍是合法 JSON，爬蟲讀得到（跳脫的是 JSON 字串裡的 `<`，不是把資料弄壞）
    expect(JSON.parse(ld).url).toBe(`https://${evil}/`);
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

  /**
   * llms.txt 是給 agent 照抄的操作說明：端點寫成絕對網址才貼得動，
   * 而 texts 的 key 是 bitmask 這件事沒講就一定寫錯，所以兩者都守住。
   */
  it('llms.txt 用絕對網址教 API，並講明 texts 的 key 是 bitmask', async () => {
    const res = await get('/llms.txt');
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(body).toContain(`${ORIGIN}/api/png`);
    expect(body).toContain('bitmask');
  });

  /**
   * 合法槽表是 llms.txt 最容易寫錯的一段：槽數依「排列 × 圈數」而定，
   * row(3) 的兩端不相鄰（沒有 5 與 7），照 ring(3) 寫成 1-7 的 agent 會直接吃 400。
   * 表由 slotMasks() 現算，這條測試守的是「現算的那份真的整份寫進去了」。
   */
  it('llms.txt 的合法槽表逐排列列出，row(3) 不含 ring(3) 才有的 5 與 7', async () => {
    const body = await (await get('/llms.txt')).text();
    const line_of = (arr: Arrangement, n: CircleCount) =>
      body.match(new RegExp(`^${arr}\\(${n}\\)\\s+(.+)$`, 'm'))![1]!.trim().split(' ');

    for (const [arr, n] of [
      ['ring', 2],
      ['ring', 3],
      ['ring', 4],
      ['row', 3],
      ['row', 6],
    ] as const) {
      expect(line_of(arr, n)).toEqual(slotMasks(arr, n).map(String));
    }
    // row(3) 是 `1 2 4 3 6`：兩端的圓不相鄰，沒有 5（A∩C），也沒有 7（A∩B∩C）
    expect(line_of('row', 3)).not.toContain('5');
    expect(line_of('row', 3)).not.toContain('7');
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
  const GTM_ID = 'GTM-TESTONLY';
  const tagged = createApp({ fontFiles: FONT_FILES, publicOrigin: ORIGIN, gtmId: GTM_ID });

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
  const fixed = createApp({ fontFiles: FONT_FILES, publicOrigin: ORIGIN });

  it('設了 publicOrigin 時，forwarded 標頭改不動輸出的 origin', async () => {
    const html = await (
      await fixed.request('http://localhost/', {
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.example.com' },
      })
    ).text();

    expect(html).not.toContain('evil.example.com');
    expect(html).toContain(`<meta property="og:image" content="${ORIGIN}/api/og.png?v=5`);
    expect(html).toContain(`<meta property="og:url" content="${ORIGIN}/?s=`);
    expect(html).toContain(`<meta name="twitter:image" content="${ORIGIN}/api/og.png?v=5`);
  });
});

describe('GET /：06 AC3/AC5 首頁 og:image 優先用 build 烤好的靜態檔', () => {
  const baked_name = 'og-default-0123456789ab.png';
  const temp_dirs: string[] = [];

  function appWithDist(files: string[]) {
    const dir = mkdtempSync(join(tmpdir(), 'venn-dist-'));
    temp_dirs.push(dir);
    for (const name of files) writeFileSync(join(dir, name), 'x');
    return createApp({ fontFiles: FONT_FILES, ogBaseFile: OG_BASE_FILE, distDir: dir });
  }

  afterAll(() => {
    for (const dir of temp_dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('dist 有烤好的檔案時，og:image 與 twitter:image 指向它的絕對 URL', async () => {
    const baked = appWithDist([baked_name]);
    const html = await (await baked.request(`${ORIGIN}/`)).text();

    expect(html).toContain(`<meta property="og:image" content="${ORIGIN}/${baked_name}">`);
    expect(html).toContain(`<meta name="twitter:image" content="${ORIGIN}/${baked_name}">`);
    expect(html).not.toContain('/api/og.png');
  });

  it('帶 s 的分享頁不受影響，仍指向動態 OG URL', async () => {
    const baked = appWithDist([baked_name]);
    const s = encodeState(sampleState(3));
    const html = await (await baked.request(`${ORIGIN}/?s=${s}`)).text();

    expect(html).toContain(`<meta property="og:image" content="${OG_URL}&amp;s=${s}">`);
    expect(html).not.toContain(baked_name);
  });

  it('dist 存在但沒烤好的檔案時 fallback 回 /api/og.png?v=5，不指向 404 路徑', async () => {
    const baked = appWithDist(['og-base.png', 'favicon.svg']);
    const html = await (await baked.request(`${ORIGIN}/`)).text();

    expect(html).toContain(`<meta property="og:image" content="${OG_URL}">`);
    expect(html).toContain(`<meta name="twitter:image" content="${OG_URL}">`);
    expect(html).not.toContain('og-default-');
  });
});

describe('07 M2 浮水印文字由部署設定決定（VENN_WATERMARK → createApp）', () => {
  const MARK = 'venn.example.test';
  const marked = createApp({ fontFiles: FONT_FILES, ogBaseFile: OG_BASE_FILE, watermark: MARK });
  const BG: [number, number, number] = [250, 250, 250]; // DEFAULT_BG #fafafa
  const SIZE = 800;

  /**
   * 右下角浮水印落點區域裡「不是背景色」的像素數。
   * 這一角底下一定是 bg（圓碰不到），所以非背景色的像素只可能來自浮水印。
   */
  async function cornerInk(target: ReturnType<typeof createApp>): Promise<number> {
    const s = encodeState({ ...defaultState(2), size: SIZE });
    const res = await target.request(`${ORIGIN}/api/png?s=${s}`);
    expect(res.status).toBe(200);
    const png = decodePng(Buffer.from(await res.arrayBuffer()));

    let ink = 0;
    for (let x = Math.round(SIZE * 0.75); x < Math.round(SIZE * 0.99); x++) {
      for (let y = Math.round(SIZE * 0.94); y < Math.round(SIZE * 0.99); y++) {
        const [r, g, b] = pngPixel(png, x, y);
        if (Math.abs(r - BG[0]) > 8 || Math.abs(g - BG[1]) > 8 || Math.abs(b - BG[2]) > 8) ink++;
      }
    }
    return ink;
  }

  it('沒設定 watermark 的部署，/api/png 右下角只有背景色', async () => {
    expect(await cornerInk(app)).toBe(0);
  }, 30_000);

  it('設定了 watermark 的部署，/api/png 右下角畫出浮水印', async () => {
    expect(await cornerInk(marked)).toBeGreaterThan(100);
  }, 30_000);

  it('首頁把浮水印文字交給前端，畫布預覽與下載 SVG 才是同一張圖', async () => {
    const html = await (await marked.request(`${ORIGIN}/`)).text();

    expect(html).toContain(`<meta name="venn:watermark" content="${MARK}">`);
  });

  it('沒設定就不注入，前端也不畫', async () => {
    const html = await (await get('/')).text();

    expect(html).not.toContain('venn:watermark');
  });
});

/**
 * 07 M5 AC6：語言只影響「介面字串」與「pristine 時的預設 template」，不進 state。
 * 這一組從 server 回應斷言 AC6 列的每一個面。
 * 用 `loadIndexHtml` 餵真的 `ui/index.html`（dev 模式走的就是這條路），
 * 才驗得到 index.html 裡的靜態字串有沒有跟著換。
 */
describe('07 M5 i18n：首頁每個語言面都跟著換（AC6）', () => {
  const ui_index = readFileSync(resolve('ui/index.html'), 'utf8');
  const site = createApp({
    fontFiles: FONT_FILES,
    ogBaseFile: OG_BASE_FILE,
    publicOrigin: ORIGIN,
    loadIndexHtml: () => ui_index,
  });

  function home(query = '', headers: Record<string, string> = {}) {
    return site.request(`${ORIGIN}/${query}`, { headers });
  }

  it('預設語言是 zh-TW：html lang、title、og、JSON-LD、index.html 說明都是中文', async () => {
    const html = await (await home()).text();

    expect(html).toContain('<html lang="zh-Hant"');
    expect(html).toContain('<title>文氏圖產生器｜找不到哏圖不會自己做嗎？</title>');
    expect(html).toContain('<meta property="og:locale" content="zh_TW">');
    expect(html).toContain('<meta property="og:site_name" content="文氏圖產生器">');
    expect(html).toContain('預覽 · 點一下放大');
    expect(html).toContain('關閉預覽');
    expect(html).toContain('"inLanguage":"zh-Hant"');
  });

  it('?lang=en 把 html lang、title、description、og、twitter、JSON-LD 全換成英文', async () => {
    const html = await (await home('?lang=en')).text();

    expect(html).toContain('<html lang="en"');
    expect(html).toContain(
      '<title>Venn Diagram Maker | Cannot find the meme? Make it yourself.</title>',
    );
    expect(html).toContain(
      '<meta property="og:title" content="Venn Diagram Maker | Cannot find the meme? Make it yourself.">',
    );
    expect(html).toContain(
      '<meta name="description" content="Fill in the blanks and get a Venn diagram. The whole state lives in the URL.">',
    );
    expect(html).toContain(
      '<meta property="og:description" content="Fill in the blanks and get a Venn diagram. The whole state lives in the URL.">',
    );
    expect(html).toContain('<meta property="og:locale" content="en_US">');
    expect(html).toContain('<meta property="og:site_name" content="Venn Diagram Maker">');
    expect(html).toContain('<meta property="og:image:alt" content="Venn Diagram Maker preview">');
    expect(html).toContain('<meta name="twitter:image:alt" content="Venn Diagram Maker preview">');
  });

  it('?lang=en 的 JSON-LD 三個欄位都是英文', async () => {
    const html = await (await home('?lang=en')).text();
    const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1]!;
    const data = JSON.parse(json) as Record<string, unknown>;

    expect(data.name).toBe('Venn Diagram Maker');
    expect(data.description).toBe(
      'Fill in the blanks and get a Venn diagram. The whole state lives in the URL.',
    );
    expect(data.inLanguage).toBe('en');
  });

  it('?lang=en 時 index.html 的兩條靜態說明也換成英文，頁面上不留中文', async () => {
    const html = await (await home('?lang=en')).text();

    expect(html).toContain('Preview · tap to enlarge');
    expect(html).toContain('Close preview');
    expect(html).not.toContain('預覽 · 點一下放大');
    expect(html).not.toContain('關閉預覽');
    expect(html).not.toContain('文氏圖產生器');
  });

  it('沒有 ?lang= 時看 Accept-Language', async () => {
    const html = await (await home('', { 'accept-language': 'en-US,en;q=0.9' })).text();

    expect(html).toContain('<html lang="en"');
    expect(html).toContain('<meta property="og:site_name" content="Venn Diagram Maker">');
  });

  it('?lang= 勝過 Accept-Language', async () => {
    const html = await (
      await home('?lang=zh-TW', { 'accept-language': 'en-US,en;q=0.9' })
    ).text();

    expect(html).toContain('<html lang="zh-Hant"');
    expect(html).toContain('<meta property="og:site_name" content="文氏圖產生器">');
  });

  it('不支援的語言退回 zh-TW', async () => {
    const html = await (await home('?lang=fr', { 'accept-language': 'fr-FR,de;q=0.8' })).text();

    expect(html).toContain('<html lang="zh-Hant"');
    expect(html).toContain('<meta property="og:site_name" content="文氏圖產生器">');
  });

  it('分享頁的 og:title 用圖上的字配該語言的站名', async () => {
    const s = encodeState(sampleState(2, 'en'));
    const html = await (await home(`?s=${s}&lang=en`)).text();

    expect(html).toContain(
      '<meta property="og:title" content="Things I should do × Things I want to do | Venn Diagram Maker">',
    );
    expect(html).toContain('<html lang="en"');
  });

  it('server 組的 og:image URL 一定帶 lang（固定 URL 配長期快取，語言得進 key）', async () => {
    const zh = await (await home()).text();
    const en = await (await home('?lang=en')).text();

    expect(zh).toContain(`<meta property="og:image" content="${ORIGIN}/api/og.png?v=5&amp;lang=zh-TW">`);
    expect(en).toContain(`<meta property="og:image" content="${ORIGIN}/api/og.png?v=5&amp;lang=en">`);
    expect(en).toContain(`<meta name="twitter:image" content="${ORIGIN}/api/og.png?v=5&amp;lang=en">`);
  });

  it('分享連結的 og:url 與 canonical 不夾帶 lang（收件人用自己的語言看介面）', async () => {
    const s = encodeState(sampleState(2, 'en'));
    const html = await (await home(`?s=${s}&lang=en`)).text();

    expect(html).toContain(`<meta property="og:url" content="${ORIGIN}/?s=${s}">`);
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/?s=${s}">`);
  });
});

/**
 * 07 M7 AC12：ja 也要有 AC6 列的每一個面。
 * 預期值取自 `content/strings/ja.ts`（`t(key, 'ja')`）而不是重抄一份字面值：
 * 這一組測的是「server 有沒有為每個面選到 ja 的字串表」，
 * 文案本身「真的翻過、不是照抄」由 `locale.test.ts` 把關。
 */
describe('07 M7 i18n：ja 首頁每個語言面都跟著換（AC12）', () => {
  const ui_index = readFileSync(resolve('ui/index.html'), 'utf8');
  const site = createApp({
    fontFiles: FONT_FILES,
    ogBaseFile: OG_BASE_FILE,
    publicOrigin: ORIGIN,
    loadIndexHtml: () => ui_index,
  });

  function home(query = '', headers: Record<string, string> = {}) {
    return site.request(`${ORIGIN}/${query}`, { headers });
  }

  it('?lang=ja 把 html lang、title、description、og、twitter 全換成日文', async () => {
    const html = await (await home('?lang=ja')).text();

    expect(html).toContain('<html lang="ja"');
    expect(html).toContain(`<title>${t('site.homeTitle', 'ja')}</title>`);
    expect(html).toContain(`<meta property="og:title" content="${t('site.homeTitle', 'ja')}">`);
    expect(html).toContain(`<meta property="og:site_name" content="${t('site.name', 'ja')}">`);
    expect(html).toContain(
      `<meta name="description" content="${t('site.description', 'ja')}">`,
    );
    expect(html).toContain(
      `<meta property="og:description" content="${t('site.description', 'ja')}">`,
    );
    expect(html).toContain(
      `<meta name="twitter:description" content="${t('site.description', 'ja')}">`,
    );
    expect(html).toContain(`<meta property="og:image:alt" content="${t('site.imageAlt', 'ja')}">`);
    expect(html).toContain(`<meta name="twitter:image:alt" content="${t('site.imageAlt', 'ja')}">`);
  });

  it('?lang=ja 的 og:locale 是 ja_JP', async () => {
    const html = await (await home('?lang=ja')).text();

    expect(html).toContain('<meta property="og:locale" content="ja_JP">');
  });

  it('?lang=ja 的 JSON-LD 三個欄位都是日文，inLanguage 是 ja', async () => {
    const html = await (await home('?lang=ja')).text();
    const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1]!;
    const data = JSON.parse(json) as Record<string, unknown>;

    expect(data.name).toBe(t('site.name', 'ja'));
    expect(data.description).toBe(t('site.description', 'ja'));
    expect(data.inLanguage).toBe('ja');
  });

  it('?lang=ja 時 index.html 的兩條靜態說明也換成日文，頁面上不留中文版本', async () => {
    const html = await (await home('?lang=ja')).text();

    expect(html).toContain(t('peek.hint', 'ja'));
    expect(html).toContain(t('peek.close', 'ja'));
    expect(html).not.toContain('預覽 · 點一下放大');
    expect(html).not.toContain('關閉預覽');
    expect(html).not.toContain('文氏圖產生器');
  });

  it('AC12 Accept-Language: ja 沒帶 ?lang= 也出 ja', async () => {
    for (const header of ['ja', 'ja-JP,ja;q=0.9,en;q=0.8', 'en;q=0.4,ja;q=0.9']) {
      const html = await (await home('', { 'accept-language': header })).text();

      expect(html, header).toContain('<html lang="ja"');
      expect(html, header).toContain(
        `<meta property="og:site_name" content="${t('site.name', 'ja')}">`,
      );
    }
  });

  it('AC12 ?lang=ja 勝過 Accept-Language', async () => {
    const html = await (await home('?lang=ja', { 'accept-language': 'en-US,en;q=0.9' })).text();

    expect(html).toContain('<html lang="ja"');
    expect(html).toContain('<meta property="og:locale" content="ja_JP">');
  });

  it('server 組的 og:image URL 帶 lang=ja', async () => {
    const html = await (await home('?lang=ja')).text();

    expect(html).toContain(
      `<meta property="og:image" content="${ORIGIN}/api/og.png?v=5&amp;lang=ja">`,
    );
  });

  it('ja 分享頁的 og:title 用圖上的字，手動換行接回去不補空白', async () => {
    const s = encodeState(sampleState(2, 'ja'));
    const html = await (await home(`?s=${s}&lang=ja`)).text();
    const title = html.match(/<meta property="og:title" content="([^"]+)"/)![1]!;

    // 假名之間插進一個空白就是壞的（spec ja 表格的 mask 1 是「やるべきこと」）
    expect(title).toContain('やるべきこと');
    expect(title).not.toContain('やるべき こと');
    expect(title).toContain(t('site.name', 'ja'));
  });
});

/**
 * AC16：`String.prototype.replace` 的 replacement 字串裡，`$&`／`$'`／`` $` `` 是替換樣式。
 * 圖上的文字會流進 `<title>` 與 meta，使用者打一個 `$&` 就能把整段 HTML 搬進標題。
 */
describe('AC16 首頁組裝不把使用者文字當 replace 樣式', () => {
  const ui_index = readFileSync(resolve('ui/index.html'), 'utf8');
  const site = createApp({
    fontFiles: FONT_FILES,
    ogBaseFile: OG_BASE_FILE,
    publicOrigin: ORIGIN,
    loadIndexHtml: () => ui_index,
  });

  /** 三種替換樣式各來一個：`$&`＝整段匹配、`` $` ``＝匹配前文、`$'`＝匹配後文 */
  const s = encodeState({
    ...sampleState(2),
    texts: { '1': { t: '$& 前 $` 後' }, '2': { t: "it's $' x" }, '3': { t: '$& 交集' } },
  });

  it('分享頁的 <title> 原樣（跳脫後）含使用者打的 $& 與 $\'，沒有塞進別的 HTML', async () => {
    const html = await (await site.request(`${ORIGIN}/?s=${s}`)).text();
    const title = html.match(/<title>([\s\S]*?)<\/title>/)![1]!;

    expect(title).toContain('$&amp;');
    expect(title).toContain("it&apos;s $&apos; x");
    expect(title).toContain('前 $` 後');
    expect(title).not.toContain('<');
  });

  it('整份 HTML 只有一個 </head>（`$&` 沒把 head 或後文再貼一次）', async () => {
    const html = await (await site.request(`${ORIGIN}/?s=${s}`)).text();

    expect(html.match(/<\/head>/g)).toHaveLength(1);
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/<body>/g)).toHaveLength(1);
  });

  it('og:title 與 twitter:title 也照樣只帶使用者的字', async () => {
    const html = await (await site.request(`${ORIGIN}/?s=${s}`)).text();
    const og_title = html.match(/<meta property="og:title" content="([^"]*)"/)![1]!;

    expect(og_title).toContain('$&amp;');
    expect(og_title).not.toContain('<');
  });
});

/**
 * AC14 語言同源：記憶從 localStorage 搬到 cookie，server 與 client 才會看到同一個語言。
 * 產圖端點刻意不看 cookie——固定 URL 配一年期快取，cookie 進不了 CDN 的 cache key。
 */
describe('AC14 語言記憶走 cookie venn.lang', () => {
  const ui_index = readFileSync(resolve('ui/index.html'), 'utf8');
  const site = createApp({
    fontFiles: FONT_FILES,
    ogBaseFile: OG_BASE_FILE,
    publicOrigin: ORIGIN,
    loadIndexHtml: () => ui_index,
  });

  function home(query = '', headers: Record<string, string> = {}) {
    return site.request(`${ORIGIN}/${query}`, { headers });
  }

  it('?lang=ja 的回應把語言寫進 cookie（一年、Path=/、SameSite=Lax）', async () => {
    const res = await home('?lang=ja');
    const cookie = res.headers.get('set-cookie') ?? '';

    expect(cookie).toContain('venn.lang=ja');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=31536000');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('沒帶 ?lang= 時不寫 cookie（沒有使用者的選擇可記）', async () => {
    const res = await home('', { 'accept-language': 'ja' });

    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('不認得的 ?lang= 不寫 cookie，也不把 fallback 語言記起來', async () => {
    const res = await home('?lang=fr');

    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('之後帶 cookie、無 ?lang=、Accept-Language 是 zh-TW 的首頁仍出 ja', async () => {
    const res = await home('', {
      cookie: 'venn.lang=ja',
      'accept-language': 'zh-TW,zh;q=0.9',
    });
    const html = await res.text();

    expect(html).toContain('<html lang="ja"');
    expect(html).toContain(`<title>${t('site.homeTitle', 'ja')}</title>`);
    expect(html).toContain('<meta property="og:locale" content="ja_JP">');
  });

  it('cookie 混在其他 cookie 之間也讀得到', async () => {
    const html = await (
      await home('', { cookie: '_ga=GA1.1.x; venn.lang=en; other=1' })
    ).text();

    expect(html).toContain('<html lang="en"');
  });

  it('非法的 cookie 值被忽略，退回 Accept-Language', async () => {
    const html = await (
      await home('', { cookie: 'venn.lang=fr', 'accept-language': 'ja' })
    ).text();

    expect(html).toContain('<html lang="ja"');
  });

  it('?lang= 勝過 cookie，並把新選擇寫回 cookie', async () => {
    const res = await home('?lang=en', { cookie: 'venn.lang=ja' });
    const html = await res.text();

    expect(html).toContain('<html lang="en"');
    expect(res.headers.get('set-cookie')).toContain('venn.lang=en');
  });

  it('/api/og.png 帶 cookie 不帶 lang 仍是 zh-TW（cookie 進不了 CDN 的 cache key）', async () => {
    async function hash(headers: Record<string, string> = {}): Promise<string> {
      const res = await get('/api/og.png?v=5', headers);
      expect(res.status).toBe(200);
      return createHash('sha256').update(new Uint8Array(await res.arrayBuffer())).digest('hex');
    }

    const [with_cookie, zh] = await Promise.all([
      hash({ cookie: 'venn.lang=ja' }),
      hash({}),
    ]);

    expect(with_cookie).toBe(zh);
  }, 30_000);

  it('/api/png 不因 cookie 改變輸出，也不寫 cookie', async () => {
    const s = encodeState(sampleState(2));
    const res = await get(`/api/png?s=${s}`, { cookie: 'venn.lang=ja' });

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  }, 30_000);
});

describe('07 M5 產圖端點的語言只從 query lang 讀（AC6）', () => {
  /** 比雜湊而不是比 Buffer：800KB 的 PNG 一旦不相等，deep equal 的 diff 會跑到天荒地老 */
  async function pngHash(path: string, headers: Record<string, string> = {}): Promise<string> {
    const res = await get(path, headers);
    expect(res.status).toBe(200);
    return createHash('sha256').update(new Uint8Array(await res.arrayBuffer())).digest('hex');
  }

  it('缺 s 時 lang=en 渲染英文 template，與明確傳入英文 sampleState 相同', async () => {
    const [implicit, explicit] = await Promise.all([
      pngHash('/api/og.png?v=5&lang=en'),
      pngHash(`/api/og.png?v=5&s=${encodeState(sampleState(2, 'en'))}`),
    ]);

    expect(implicit).toBe(explicit);
  }, 30_000);

  it('缺 s 時 lang=en 與 lang=zh-TW 出來的圖不同（文案真的換了）', async () => {
    const [zh, en] = await Promise.all([
      pngHash('/api/og.png?v=5&lang=zh-TW'),
      pngHash('/api/og.png?v=5&lang=en'),
    ]);

    expect(zh).not.toBe(en);
  }, 30_000);

  it('缺 s 時不看 Accept-Language（固定 URL 配長期快取，不能被第一個爬蟲的語言污染）', async () => {
    const [neutral, english_header] = await Promise.all([
      pngHash('/api/og.png?v=5'),
      pngHash('/api/og.png?v=5', { 'accept-language': 'en-US,en;q=0.9' }),
    ]);

    expect(neutral).toBe(english_header);
  }, 30_000);

  it('不認得的 lang 退回 zh-TW，不是 400', async () => {
    const [fallback, zh] = await Promise.all([
      pngHash('/api/og.png?v=5&lang=fr'),
      pngHash('/api/og.png?v=5&lang=zh-TW'),
    ]);

    expect(fallback).toBe(zh);
  }, 30_000);

  it('AC13 缺 s 時 lang=ja 渲染日文 template，與 zh 的圖不同', async () => {
    const [ja, zh, explicit] = await Promise.all([
      pngHash('/api/og.png?v=5&lang=ja'),
      pngHash('/api/og.png?v=5&lang=zh-TW'),
      pngHash(`/api/og.png?v=5&s=${encodeState(sampleState(2, 'ja'))}`),
    ]);

    expect(ja).toBe(explicit);
    expect(ja).not.toBe(zh);
  }, 30_000);

  it('帶 s 時 lang 不影響輸出（文字已經在 s 裡）', async () => {
    const s = encodeState(sampleState(3));
    const [with_en, without] = await Promise.all([
      pngHash(`/api/og.png?v=5&lang=en&s=${s}`),
      pngHash(`/api/og.png?v=5&s=${s}`),
    ]);

    expect(with_en).toBe(without);
  }, 30_000);
});

describe('07 M5 API 錯誤訊息是英文固定值', () => {
  const bad_paths = [
    '/api/png',
    '/api/png?s=',
    '/api/png?s=!!!!',
    `/api/png?s=${'a'.repeat(MAX_STATE_PARAM_LEN + 1)}`,
    `/api/png?s=${packJson({ ...sampleState(), size: 2400 })}`,
    `/api/png?s=${packJson({ ...sampleState(), texts: { '1': { t: '字'.repeat(81) } } })}`,
    `/api/png?s=${packJson({ ...sampleState(), colors: ['red', 'blue'] })}`,
    `/api/png?s=${packJson({ ...sampleState(), style: 'neon' })}`,
    `/api/png?s=${packJson({ ...sampleState(), bg: 'transparent' })}`,
    `/api/png?s=${packJson({ ...sampleState(), texts: { '7': { t: 'x' } } })}`,
    '/api/og.png?s=!!!!',
    `/api/og.png?s=${'a'.repeat(MAX_STATE_PARAM_LEN + 1)}`,
  ];

  for (const path of bad_paths) {
    it(`${path.slice(0, 40)} 的錯誤訊息只有 ASCII 可列印字元`, async () => {
      const res = await get(path);
      const body = (await res.json()) as { error: string };

      expect(res.status).toBe(400);
      expect(body.error).toMatch(/^[\x20-\x7e]+$/);
    });
  }
});

/**
 * 11 `POST /api/png`：直接收 raw `VennState` JSON，呼叫端不必自己編一次 s。
 * 兩條路共用同一個渲染路徑與同一個 in_flight 計數器，差別只在快取（POST 依定義不可快取）。
 */
describe('11 POST /api/png：收 raw VennState JSON', () => {
  function post(body: BodyInit, headers: Record<string, string> = {}) {
    return app.request(`${ORIGIN}/api/png`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    });
  }

  it('AC1 合法 body 出的 PNG 與同一份 state 走 GET ?s= 的輸出位元相同', async () => {
    const state = { ...sampleState(), size: 400 };
    const [posted, got] = await Promise.all([
      post(JSON.stringify(state)),
      get(`/api/png?s=${encodeState(state)}`),
    ]);

    expect(posted.status).toBe(200);
    expect(posted.headers.get('content-type')).toBe('image/png');
    const posted_png = Buffer.from(await posted.arrayBuffer());
    const got_png = Buffer.from(await got.arrayBuffer());
    // 逐 byte 比對但不用 toEqual：不等時 deep diff 會把整張圖印出來
    expect(posted_png.equals(got_png)).toBe(true);
  }, 30_000);

  it('AC7 回應不可快取', async () => {
    const res = await post(JSON.stringify({ ...sampleState(), size: 400 }));

    expect(res.headers.get('cache-control')).toBe('no-store');
  }, 30_000);

  it('AC2 x-venn-url 是該圖的分享網址，裡面的 s 解得回同一份 state', async () => {
    const state = sampleState(3);
    const res = await post(JSON.stringify({ ...state, size: 400 }));
    const url = new URL(res.headers.get('x-venn-url')!);

    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe('/');
    expect(decodeState(url.searchParams.get('s')!)).toEqual({ ...state, size: 400 });
  }, 30_000);

  it('AC2 x-venn-url 與 og:url 同一套推導：設了 publicOrigin 就改不動', async () => {
    const fixed = createApp({ fontFiles: FONT_FILES, publicOrigin: ORIGIN });
    const res = await fixed.request('http://localhost/api/png', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-host': 'evil.example.com' },
      body: JSON.stringify({ ...sampleState(), size: 400 }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-venn-url')).toMatch(
      new RegExp(`^${ORIGIN.replace(/[.]/g, '\\.')}/\\?s=`),
    );
  }, 30_000);

  it('AC3 body 不是合法 JSON → 400，訊息講的是 JSON 解析', async () => {
    const res = await post('{ 這不是 JSON');

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ error: 'request body is not valid JSON' });
  });

  // 「載不進來」與「載得進來但不是 state」是兩種修法，訊息不能折成同一句
  it('AC3 body 是合法 JSON 但不是物件 → 400，訊息講的是 state 形狀', async () => {
    const res = await post('[]');

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'state must be an object' });
  });

  const bad_state: [string, unknown, string][] = [
    ['n 超出範圍', { ...sampleState(), n: 7 }, 'n must be an integer between 2 and 6'],
    [
      '用了不存在的文字槽',
      { ...sampleState(), texts: { '7': { t: 'x' } } },
      'text slot 7 does not exist in ring(2)',
    ],
    ['size 超過上限', { ...sampleState(), size: 2400 }, 'size must be between 400 and 2000'],
  ];

  for (const [name, value, message] of bad_state) {
    it(`AC3 ${name} → 400，訊息沿用 StateError 的英文固定值`, async () => {
      const res = await post(JSON.stringify(value));

      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toMatchObject({ error: message });
    });
  }

  it('AC6 與 GET 共用同一個渲染上限：擠爆時回 503 帶 retry-after', async () => {
    const isolated = createApp({ fontFiles: FONT_FILES });
    const state = { ...defaultState(4), style: 'flat' as const, size: 1600 };
    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        i % 2 === 0
          ? isolated.request(`${ORIGIN}/api/png?s=${encodeState(state)}`)
          : isolated.request(`${ORIGIN}/api/png`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(state),
            }),
      ),
    );

    expect(responses.some((res) => res.status === 503)).toBe(true);
    for (const res of responses) {
      if (res.status !== 503) continue;
      expect(res.headers.get('retry-after')).toBe('2');
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  }, 30_000);

  it('AC4 body 超過 32KB → 413，不進 parse', async () => {
    const res = await post(JSON.stringify({ ...sampleState(), pad: 'x'.repeat(33 * 1024) }));

    expect(res.status).toBe(413);
  });

  it('AC4 略小於上限的 body 照常出圖（閘門卡在 32KB，不是「大就擋」）', async () => {
    const body = JSON.stringify({ ...sampleState(), size: 400, pad: 'x'.repeat(30 * 1024) });
    // 閘門量的是 bytes，不是字元：sampleState 帶 CJK，兩者不相等
    expect(Buffer.byteLength(body)).toBeLessThan(32 * 1024);
    const res = await post(body);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  }, 30_000);
});
