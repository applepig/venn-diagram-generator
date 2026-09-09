import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { StateError, encodeBase64Url, validateState } from '../shared/state-codec';
import { decodeState, encodeState } from '../shared/state-codec-node';
import {
  decodeState as decodeStateWeb,
  encodeState as encodeStateWeb,
} from '../shared/state-codec-web';
import { defaultState, sampleState } from '../shared/defaults';
import type { VennState } from '../shared/types';

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

  const invalid: [string, unknown][] = [
    ['null', null],
    ['字串', 'nope'],
    ['缺 v', { ...sampleState(), v: undefined }],
    ['v 不是 1', { ...sampleState(), v: 2 }],
    ['n 不在 2/3/4', { ...sampleState(), n: 5 }],
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
  ];

  for (const [name, input] of invalid) {
    it(`${name} → StateError`, () => {
      expect(() => validateState(input)).toThrow(StateError);
    });
  }

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
