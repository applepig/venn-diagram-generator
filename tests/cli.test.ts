import { describe, expect, it } from 'vitest';
import {
  SpecError,
  lettersFromMask,
  maskFromLetters,
  specToState,
  stateToSpec,
  validSlotLetters,
} from '../cli/spec';
import { slotMasks } from '../engine/layout';
import { defaultState } from '../content/state-presets';
import type { VennState } from '../engine/types';

describe('字母 ↔ mask', () => {
  it('單一字母對應圈 index 的位元', () => {
    expect(maskFromLetters('A')).toBe(1);
    expect(maskFromLetters('B')).toBe(2);
    expect(maskFromLetters('F')).toBe(32);
  });

  it('多字母是各位元的 OR', () => {
    expect(maskFromLetters('AB')).toBe(3);
    expect(maskFromLetters('ABCD')).toBe(15);
  });

  it('大小寫與字母順序都不影響結果', () => {
    expect(maskFromLetters('ba')).toBe(maskFromLetters('AB'));
    expect(maskFromLetters('cA b')).toBe(maskFromLetters('ABC'));
  });

  it('mask 轉回字母一律照 A..F 的順序', () => {
    expect(lettersFromMask(3)).toBe('AB');
    expect(lettersFromMask(13)).toBe('ACD');
  });

  it('非字母與重複字母各自報錯', () => {
    expect(() => maskFromLetters('AZ')).toThrow(SpecError);
    expect(() => maskFromLetters('AA')).toThrow(/repeats/);
    expect(() => maskFromLetters('')).toThrow(SpecError);
  });
});

describe('非法槽位', () => {
  it('ring(4) 的 AD 報錯，並列出該組合的全部合法槽', () => {
    let message = '';
    try {
      specToState({ sets: ['1', '2', '3', '4'], texts: { AD: 'x' } });
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain('"AD"');
    expect(message).toContain('ring(4)');
    for (const letters of validSlotLetters('ring', 4)) {
      expect(message).toContain(letters);
    }
  });

  it('列出的合法槽就是 slotMasks 推出來的那組，不多不少', () => {
    // 寫死表格會在幾何調整後悄悄失準，所以兩邊都從 slotMasks 推
    expect(validSlotLetters('row', 5)).toEqual(['A', 'B', 'C', 'D', 'E', 'AB', 'BC', 'CD', 'DE']);
    expect(validSlotLetters('ring', 4).length).toBe(slotMasks('ring', 4).length);
  });

  it('字母超出圈數範圍時，同樣當成不存在的槽處理', () => {
    expect(() => specToState({ sets: ['1', '2'], texts: { AC: 'x' } })).toThrow(/does not exist/);
  });
});

describe('state ↔ 友善 spec 的 round-trip', () => {
  const cases: Record<string, VennState> = {
    '兩圈加交集': {
      ...defaultState(2),
      texts: { '1': { t: '工作' }, '2': { t: '生活' }, '3': { t: '沒有睡眠' } },
    },
    '有標題與自訂樣式': {
      ...defaultState(3),
      style: 'flat',
      title: '選三個',
      title_fill: '#ffffff',
      title_fs: 0.08,
      bg: '#14161a',
      size: 1600,
      colors: ['#112233', '#445566', '#778899'],
      texts: { '1': { t: '快' }, '7': { t: '都想要' } },
    },
    '編輯器調過的槽（手動字級與位移）': {
      ...defaultState(4),
      texts: {
        '1': { t: '便宜', fs: 0.09, dx: -0.01 },
        '15': { t: '媽媽煮的', dy: 0.02, fill: '#ffffff' },
      },
    },
    'row 排列': {
      ...defaultState(3),
      arr: 'row' as const,
      overlap: 1.1,
      radius: 0.22,
      texts: { '2': { t: '中間' }, '6': { t: 'BC' } },
    },
    '沒有任何文字': defaultState(5),
  };

  for (const [name, state] of Object.entries(cases)) {
    it(`${name}：state → spec → state 等價`, () => {
      expect(specToState(stateToSpec(state))).toEqual(state);
    });
  }
});

describe('預設值', () => {
  it('只給 sets 時，幾何取該排列的預設而不是 ring 的', () => {
    const row = specToState({ arr: 'row', sets: ['a', 'b', 'c'] });
    const ring = specToState({ sets: ['a', 'b', 'c'] });
    expect(row.arr).toBe('row');
    expect(row.radius).not.toBe(ring.radius);
  });

  it('sets 的空字串代表該圈不給標籤', () => {
    const state = specToState({ sets: ['工作', ''], texts: { AB: '沒睡' } });
    expect(state.texts).toEqual({ '1': { t: '工作' }, '3': { t: '沒睡' } });
  });
});
