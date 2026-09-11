import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { StateError, encodeBase64Url, validateState } from '../engine/state-codec';
import { decodeState, encodeState } from '../engine/state-codec-node';
import {
  decodeState as decodeStateWeb,
  encodeState as encodeStateWeb,
} from '../engine/state-codec-web';
import { MAX_STATE_PARAM_LEN, MAX_TEXT_LEN } from '../engine/defaults';
import { slotMasks } from '../engine/layout';
import { ARRANGEMENTS, circleCountRange, shapeDefaults } from '../engine/shapes/index';
import { defaultState, sampleState } from '../content/state-presets';
import type { Arrangement, CircleCount, TextSlot, VennState } from '../engine/types';
import { bombParam } from './helpers/state-param';

const rich: VennState = {
  ...defaultState(4),
  style: 'flat',
  opacity: 0.42,
  overlap: 1.33,
  radius: 0.24,
  colors: ['#112233', '#445566', '#778899', '#aabbcc'],
  bg: '#000000',
  size: 1600,
  texts: {
    '1': { t: '便宜' },
    '2': { t: '好吃\n很好吃' },
    '15': { t: '媽媽煮的', fs: 0.033, dx: -0.01, dy: 0.02 },
  },
};

function packJson(value: unknown): string {
  return encodeBase64Url(new Uint8Array(deflateRawSync(Buffer.from(JSON.stringify(value), 'utf8'))));
}

describe('state codec：round-trip', () => {
  it('Node 編碼後自己解得回一模一樣的 state', () => {
    expect(decodeState(encodeState(rich))).toEqual(rich);
  });

  it('瀏覽器編碼的字串，Node 解得開（前後端同一格式）', async () => {
    expect(decodeState(await encodeStateWeb(rich))).toEqual(rich);
  });

  it('Node 編碼的字串，瀏覽器解得開', async () => {
    expect(await decodeStateWeb(encodeState(rich))).toEqual(rich);
  });

  it('編出來的字串是 URL 安全的（沒有 + / =）', () => {
    expect(encodeState(rich)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('壓縮確實有效：塞滿文字的 state，編碼短於同一份 JSON 直接 base64', () => {
    const full: VennState = {
      ...defaultState(4),
      texts: Object.fromEntries(
        [1, 2, 4, 8, 3, 5, 10, 12, 15].map((m) => [String(m), { t: '要等到天荒地老海枯石爛'.repeat(3) }]),
      ),
    };
    const plain_b64 = encodeBase64Url(new TextEncoder().encode(JSON.stringify(full)));

    expect(encodeState(full).length).toBeLessThan(plain_b64.length);
  });
});

describe('state codec：壞輸入一律拋 StateError', () => {
  const bad_strings: [string, string][] = [
    ['空字串', ''],
    ['不是 base64url', '!!!!not base64!!!!'],
    ['是 base64 但不是 deflate 資料', encodeBase64Url(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))],
  ];

  for (const [name, input] of bad_strings) {
    it(`${name} → StateError`, () => {
      expect(() => decodeState(input)).toThrow(StateError);
    });
  }

  it('deflate 過但不是 JSON → StateError', () => {
    const packed = encodeBase64Url(new Uint8Array(deflateRawSync(Buffer.from('not json', 'utf8'))));

    expect(() => decodeState(packed)).toThrow(StateError);
  });

  it('瀏覽器版遇到壞輸入也拋 StateError', async () => {
    await expect(decodeStateWeb('!!!!')).rejects.toThrow(StateError);
  });
});

describe('validateState：schema 檢查', () => {
  it('接受合法 state 並回傳等值物件', () => {
    expect(validateState(JSON.parse(JSON.stringify(sampleState())))).toEqual(sampleState());
  });

  it('AC5 舊連結的 overlap 1.0～1.6 照常解得開', () => {
    for (const overlap of [1.0, 1.15, 1.2, 1.6]) {
      expect(validateState({ ...sampleState(), overlap }).overlap).toBeCloseTo(overlap, 10);
    }
  });

  it('AC5 舊 4 圈連結只帶九個原有槽也照常解得開', () => {
    const old_slots = [1, 2, 4, 8, 3, 5, 10, 12, 15];
    const s = {
      ...sampleState(4),
      texts: Object.fromEntries(old_slots.map((m) => [String(m), { t: '甲' }])),
    };

    expect(Object.keys(validateState(s).texts).map(Number).sort((a, b) => a - b)).toEqual(
      [...old_slots].sort((a, b) => a - b),
    );
  });

  it('4 圈的三重槽 7、11、13、14 都是合法 key', () => {
    const triples = [7, 11, 13, 14];
    const s = {
      ...sampleState(4),
      texts: Object.fromEntries(triples.map((m) => [String(m), { t: '甲' }])),
    };

    expect(
      Object.keys(validateState(s).texts)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual(triples);
  });

  it('3 圈餵 4 圈才有的槽 11 仍被拒', () => {
    const s = { ...sampleState(3), texts: { '11': { t: '甲' } } };

    expect(() => validateState(s)).toThrow(StateError);
  });

  const invalid: [string, unknown][] = [
    ['null', null],
    ['字串', 'nope'],
    ['缺 v', { ...sampleState(), v: undefined }],
    ['v 不是 1', { ...sampleState(), v: 2 }],
    ['n 超出 2～6', { ...sampleState(), n: 7 }],
    ['style 不認得', { ...sampleState(), style: 'neon' }],
    ['size 太小', { ...sampleState(), size: 399 }],
    ['size 太大', { ...sampleState(), size: 2001 }],
    ['size 非整數', { ...sampleState(), size: 1200.5 }],
    ['opacity 超界', { ...sampleState(), opacity: 1.4 }],
    ['overlap 超界', { ...sampleState(), overlap: 1.9 }],
    ['radius 超界', { ...sampleState(), radius: 0.5 }],
    ['colors 數量與 n 不符', { ...sampleState(), colors: ['#ffffff'] }],
    ['colors 不是 hex', { ...sampleState(), colors: ['red', 'blue'] }],
    ['bg 不是 hex', { ...sampleState(), bg: 'transparent' }],
    ['texts 不是物件', { ...sampleState(), texts: [] }],
    ['texts key 不是這個圈數的槽', { ...sampleState(), texts: { '7': { t: '無效' } } }],
    ['texts value 缺 t', { ...sampleState(), texts: { '1': {} } }],
    ['texts value 的 fs 不是數字', { ...sampleState(), texts: { '1': { t: '甲', fs: 'big' } } }],
    ['AC6 fill 不是 hex', { ...sampleState(), texts: { '1': { t: '甲', fill: 'red' } } }],
    ['AC6 fill 是三碼縮寫', { ...sampleState(), texts: { '1': { t: '甲', fill: '#fff' } } }],
    ['AC6 fill 不是字串', { ...sampleState(), texts: { '1': { t: '甲', fill: 0xffffff } } }],
  ];

  for (const [name, input] of invalid) {
    it(`${name} → StateError`, () => {
      expect(() => validateState(input)).toThrow(StateError);
    });
  }

  it('AC6 合法的 fill 通過驗證並被保留下來', () => {
    const s = { ...sampleState(2), texts: { '3': { t: '挖白', fill: '#FFFFFF' }, '1': { t: '甲' } } };

    const state = validateState(s);

    expect(state.texts['3']).toEqual({ t: '挖白', fill: '#FFFFFF' });
    expect(state.texts['1']!.fill).toBeUndefined();
  });

  it('AC6 帶 fill 的 state 經由 URL round-trip 後 fill 原樣回來', () => {
    const s: VennState = {
      ...defaultState(2),
      style: 'flat',
      texts: { '3': { t: '挖白', fill: '#ffffff' } },
    };

    expect(decodeState(encodeState(s))).toEqual(s);
  });

  it('AC6 不帶 fill 的舊格式解出來不會多出 fill 欄位', () => {
    const state = decodeState(encodeState(sampleState(2)));

    for (const slot of Object.values(state.texts)) expect('fill' in slot).toBe(false);
  });

  it('任一文字超過 80 字 → StateError', () => {
    const s = { ...sampleState(), texts: { '1': { t: '字'.repeat(81) } } };

    expect(() => validateState(s)).toThrow(StateError);
  });

  it('剛好 80 字可以通過', () => {
    const s = { ...sampleState(), texts: { '1': { t: '字'.repeat(80) } } };

    expect(() => validateState(s)).not.toThrow();
  });

  it('80 字以 code point 計算，emoji 不會被算成兩個字', () => {
    const s = { ...sampleState(), texts: { '1': { t: '🎉'.repeat(80) } } };

    expect(() => validateState(s)).not.toThrow();
  });

  describe('XML 1.0 不接受的字元', () => {
    const cases: [string, number][] = [
      ['NUL U+0000', 0x00],
      ['U+0008', 0x08],
      ['垂直定位字元 U+000B', 0x0b],
      ['U+001F', 0x1f],
      ['非字元 U+FFFE', 0xfffe],
      ['非字元 U+FFFF', 0xffff],
    ];

    for (const [name, code] of cases) {
      it(`文字含 ${name} → StateError`, () => {
        const s = { ...sampleState(), texts: { '1': { t: `a${String.fromCharCode(code)}b` } } };

        expect(() => validateState(s)).toThrow(StateError);
      });
    }

    it('落單的 surrogate → StateError', () => {
      const s = { ...sampleState(), texts: { '1': { t: `a${String.fromCharCode(0xd800)}b` } } };

      expect(() => validateState(s)).toThrow(StateError);
    });

    it('成對的 surrogate（emoji）不受影響', () => {
      expect(() => validateState({ ...sampleState(), texts: { '1': { t: '🎉' } } })).not.toThrow();
    });

    it('tab、換行、歸位是合法的，不能被誤擋', () => {
      const s = { ...sampleState(), texts: { '1': { t: 'a\tb\nc\rd' } } };

      expect(() => validateState(s)).not.toThrow();
    });
  });

  it('超長文字經由 URL 進來時也會被擋下（decode 也走同一套驗證）', () => {
    const packed = packJson({ ...sampleState(), texts: { '1': { t: '字'.repeat(81) } } });

    expect(() => decodeState(packed)).toThrow(StateError);
  });
});

describe('arr：排列進 state', () => {
  /** 只有 ASCII 可列印字元＝沒有中文；API 是機器介面，不走 i18n */
  const ASCII_ONLY = /^[\x20-\x7e]+$/;

  /** 六色由測試自帶，不從 PALETTE 反查（否則等於拿受測程式自證） */
  const SIX_COLORS = ['#2e9be6', '#e6a92e', '#e04848', '#3cb54a', '#8b5cf6', '#e05fa0'];

  function rowState(n: 3 | 4 | 5 | 6): VennState {
    const { radius, overlap } = shapeDefaults('row', n);
    return {
      v: 1,
      arr: 'row',
      n,
      style: 'translucent',
      opacity: 0.6,
      overlap,
      radius,
      colors: SIX_COLORS.slice(0, n),
      bg: '#fafafa',
      size: 1200,
      texts: { '1': { t: '甲' } },
    };
  }

  it('AC1 不帶 arr 的舊 state 解出來仍然不帶 arr（編碼字串不變）', () => {
    const encoded = encodeState(sampleState(4));
    const state = decodeState(encoded);

    expect('arr' in state).toBe(false);
    expect(encodeState(state)).toBe(encoded);
  });

  it('AC1 明確帶 arr: ring 與完全不帶 arr 編出同一個字串', () => {
    const plain = sampleState(3);

    expect(encodeState({ ...plain, arr: 'ring' })).toBe(encodeState(plain));
  });

  it('row 的 arr 會保留，round-trip 後原樣回來', () => {
    const state = rowState(4);

    expect(decodeState(encodeState(state))).toEqual(state);
    expect(decodeState(encodeState(state)).v).toBe(1);
  });

  it('ring 2～6 與 row 3～6 都是合法組合', () => {
    for (const n of [2, 3, 4, 5, 6] as CircleCount[]) {
      const state = { ...defaultState(2), n, colors: SIX_COLORS.slice(0, n), texts: {} };
      expect(() => validateState(state), `ring(${n})`).not.toThrow();
    }
    for (const n of [3, 4, 5, 6] as const) {
      expect(() => validateState(rowState(n)), `row(${n})`).not.toThrow();
    }
  });

  it('row(2) 被拒，訊息是英文', () => {
    const state = { ...defaultState(2), arr: 'row' as const };

    expect(() => validateState(state)).toThrow(StateError);
    try {
      validateState(state);
    } catch (err) {
      const message = (err as StateError).message;
      expect(message).toMatch(ASCII_ONLY);
      expect(message).toContain('row');
    }
  });

  it('圈數超出 2～6 被拒，訊息是英文', () => {
    for (const n of [1, 7, 3.5]) {
      const state = { ...defaultState(2), n };
      expect(() => validateState(state), `n=${n}`).toThrow(StateError);
      try {
        validateState(state);
      } catch (err) {
        expect((err as StateError).message, `n=${n}`).toMatch(ASCII_ONLY);
      }
    }
  });

  it('arr 不是 ring／row 就被拒，訊息是英文', () => {
    for (const arr of ['spiral', 1, null]) {
      const state = { ...defaultState(3), arr };
      expect(() => validateState(state), `arr=${String(arr)}`).toThrow(StateError);
      try {
        validateState(state);
      } catch (err) {
        expect((err as StateError).message, `arr=${String(arr)}`).toMatch(ASCII_ONLY);
      }
    }
  });

  it('槽位白名單跟著 (arr, n) 走：ring(4) 有的 15 在 row(4) 被拒', () => {
    const row = { ...rowState(4), texts: { '15': { t: '全部' } } };

    expect(slotMasks('ring', 4)).toContain(15);
    expect(slotMasks('row', 4)).not.toContain(15);
    expect(() => validateState(row)).toThrow(StateError);
  });

  /**
   * AC4：radius 的合法範圍依 arr 查 registry。row 的圓本來就得比 ring 小
   * （一列 6 顆的預設 radius 才 0.119），ring 的範圍不動，舊連結才全部照舊解得開。
   */
  it('AC4 row 吃得下 0.1 的 radius，ring 在 0.2 以下仍被拒', () => {
    expect(() => validateState({ ...rowState(6), radius: 0.1 })).not.toThrow();
    expect(() => validateState({ ...rowState(6), radius: 0.12 })).not.toThrow();
    expect(() => validateState({ ...defaultState(6), colors: SIX_COLORS, radius: 0.12 })).toThrow(
      StateError,
    );
  });

  it('AC4 row 的 radius 低於 0.1 或高於 0.35 仍被拒', () => {
    expect(() => validateState({ ...rowState(6), radius: 0.09 })).toThrow(StateError);
    expect(() => validateState({ ...rowState(6), radius: 0.36 })).toThrow(StateError);
  });

  it('AC4 每個合法組合的預設 state 都通得過驗證', () => {
    for (const n of [2, 3, 4, 5, 6] as CircleCount[]) {
      const { radius, overlap } = shapeDefaults('ring', n);
      const state = {
        ...defaultState(2),
        n,
        radius,
        overlap,
        colors: SIX_COLORS.slice(0, n),
        texts: {},
      };
      expect(() => validateState(state), `ring(${n})`).not.toThrow();
    }
    for (const n of [3, 4, 5, 6] as const) {
      expect(() => validateState(rowState(n)), `row(${n})`).not.toThrow();
    }
  });

  it('AC1 4 圈 overlap 1.6 的舊連結，實際幾何下消失的區域仍是合法槽', () => {
    const state = {
      ...defaultState(4),
      overlap: 1.6,
      texts: Object.fromEntries(
        [7, 11, 13, 14, 15].map((mask) => [String(mask), { t: '甲' }]),
      ),
    };

    expect(() => validateState(state)).not.toThrow();
  });
});

describe('decodeState：解壓輸出上限（AC1）', () => {
  it('解開後 8MB 的壓縮炸彈拋 StateError，不把記憶體配下去', () => {
    expect(() => decodeState(bombParam(8 * 1024 * 1024))).toThrow(StateError);
  });

  it('解開後仍在上限內的 state 照常解得回來', () => {
    const state = decodeState(bombParam(16 * 1024));

    expect(state).toEqual({ ...sampleState(), size: 400 });
  });

  /**
   * AC15：上限要擋得住壓縮炸彈，又不能擋掉任何合法的 state。
   * 最壞案例不只有 ring(4)：槽數隨組合變（ring(5) 21 槽、ring(6) 18 槽），
   * 所以掃過每一個 (arr, n) 取最大值，不是挑一個組合當代表。
   */
  describe('AC15 參數長度上限涵蓋所有合法組合的最壞 state', () => {
    /** 該組合每一槽都塞滿 80 個互不重複的 4-byte 字，加上 fs/dx/dy 與各槽相異的 fill */
    function worstStateFor(arr: Arrangement, n: CircleCount): VennState {
      // U+20000 起的擴充漢字每字 4 bytes，是單一 code point 能佔的最大體積，比 3-byte 中文更壞
      let code_point = 0x20000;
      let fill_seed = 0x123457;
      const texts: Record<string, TextSlot> = {};
      let i = 0;
      for (const mask of slotMasks(arr, n)) {
        const t = Array.from({ length: MAX_TEXT_LEN }, () =>
          String.fromCodePoint(code_point++),
        ).join('');
        // 每槽的 fill 與 fs/dx/dy 都不同，壓縮器沒有重複字串可吃，才是真正的最壞案例
        fill_seed = (fill_seed * 7919) % 0xffffff;
        const fill = `#${fill_seed.toString(16).padStart(6, '0')}`;
        texts[String(mask)] = {
          t,
          fs: Number((0.0251 + i * 0.0013).toFixed(4)),
          dx: Number((-0.0731 + i * 0.0017).toFixed(4)),
          dy: Number((0.0619 - i * 0.0011).toFixed(4)),
          fill,
        };
        i++;
      }
      const { radius, overlap } = shapeDefaults(arr, n);
      const base = defaultState(n);
      return {
        ...base,
        ...(arr === 'ring' ? {} : { arr }),
        radius,
        overlap,
        texts,
      };
    }

    function shapes(): [Arrangement, CircleCount][] {
      const all: [Arrangement, CircleCount][] = [];
      for (const arr of ARRANGEMENTS) {
        const [min, max] = circleCountRange(arr);
        for (let n = min; n <= max; n++) all.push([arr, n as CircleCount]);
      }
      return all;
    }

    const lengths = shapes().map(
      ([arr, n]) => [arr, n, encodeState(worstStateFor(arr, n)).length] as const,
    );
    const worst_len = Math.max(...lengths.map(([, , len]) => len));

    it('每個組合的最壞 state 都編得出、解得回，且在上限內', () => {
      for (const [arr, n] of shapes()) {
        const worst = worstStateFor(arr, n);
        const s = encodeState(worst);

        expect(decodeState(s), `${arr}(${n})`).toEqual(worst);
        expect(s.length, `${arr}(${n})`).toBeLessThan(MAX_STATE_PARAM_LEN);
      }
    });

    it('上限留有餘裕但不放空：最壞值的 1.05～1.3 倍之間', () => {
      const headroom = MAX_STATE_PARAM_LEN / worst_len;

      expect(headroom, `worst=${worst_len} ${JSON.stringify(lengths)}`).toBeGreaterThanOrEqual(1.05);
      expect(headroom, `worst=${worst_len}`).toBeLessThanOrEqual(1.3);
    });
  });
});

/**
 * 07 M5 AC6／ADR：API 是機器介面，不走 i18n。
 * `StateError` 的訊息一律英文固定值，這裡涵蓋每一條產生訊息的路徑。
 */
describe('07 M5 StateError 的訊息一律英文', () => {
  const ASCII_ONLY = /^[\x20-\x7e]+$/;

  function messageOf(run: () => unknown): string {
    try {
      run();
    } catch (err) {
      expect(err).toBeInstanceOf(StateError);
      return (err as StateError).message;
    }
    throw new Error('預期會拋 StateError，但沒有');
  }

  const schema_cases: [string, unknown][] = [
    ['不是物件', 'nope'],
    ['版本不是 1', { ...sampleState(), v: 2 }],
    ['n 不合法', { ...sampleState(), n: 7 }],
    ['arr 不認得', { ...sampleState(), arr: 'spiral' }],
    ['組合不合法', { ...defaultState(2), arr: 'row' }],
    ['style 不認得', { ...sampleState(), style: 'neon' }],
    ['size 超界', { ...sampleState(), size: 2001 }],
    ['size 非整數', { ...sampleState(), size: 1200.5 }],
    ['opacity 超界', { ...sampleState(), opacity: 1.4 }],
    ['overlap 超界', { ...sampleState(), overlap: 1.9 }],
    ['radius 超界', { ...sampleState(), radius: 0.5 }],
    ['colors 數量不符', { ...sampleState(), colors: ['#ffffff'] }],
    ['colors 不是 hex', { ...sampleState(), colors: ['red', 'blue'] }],
    ['bg 不是 hex', { ...sampleState(), bg: 'transparent' }],
    ['texts 不是物件', { ...sampleState(), texts: [] }],
    ['槽位不屬於這個版面', { ...sampleState(), texts: { '7': { t: 'x' } } }],
    ['槽位格式錯誤', { ...sampleState(), texts: { '1': 'x' } }],
    ['槽位缺 t', { ...sampleState(), texts: { '1': {} } }],
    ['文字超長', { ...sampleState(), texts: { '1': { t: '字'.repeat(81) } } }],
    ['文字含控制字元', { ...sampleState(), texts: { '1': { t: `a${String.fromCharCode(0)}b` } } }],
    ['fs 不是數字', { ...sampleState(), texts: { '1': { t: 'x', fs: 'big' } } }],
    ['fs 超界', { ...sampleState(), texts: { '1': { t: 'x', fs: 2 } } }],
    ['dx 超界', { ...sampleState(), texts: { '1': { t: 'x', dx: 2 } } }],
    ['dy 超界', { ...sampleState(), texts: { '1': { t: 'x', dy: -2 } } }],
    ['fill 不是 hex', { ...sampleState(), texts: { '1': { t: 'x', fill: 'red' } } }],
  ];

  for (const [name, input] of schema_cases) {
    it(`validateState：${name}`, () => {
      expect(messageOf(() => validateState(input))).toMatch(ASCII_ONLY);
    });
  }

  const string_cases: [string, string][] = [
    ['不是 base64url', '!!!!'],
    ['base64 但不是 deflate', encodeBase64Url(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))],
    ['deflate 過但不是 JSON', encodeBase64Url(new Uint8Array(deflateRawSync(Buffer.from('not json'))))],
  ];

  for (const [name, input] of string_cases) {
    it(`decodeState：${name}`, () => {
      expect(messageOf(() => decodeState(input))).toMatch(ASCII_ONLY);
    });
  }

  it('壓縮炸彈的訊息也是英文', () => {
    expect(messageOf(() => decodeState(bombParam(8 * 1024 * 1024)))).toMatch(ASCII_ONLY);
  });

  it('瀏覽器版的訊息也是英文', async () => {
    await expect(decodeStateWeb('!!!!')).rejects.toThrow(/^[\x20-\x7e]+$/);
  });
});
