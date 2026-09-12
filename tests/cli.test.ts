import { describe, expect, it } from 'vitest';
import { type Flags, applyFlags, specFromJson } from '../cli/flags';
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

/** 走完整條 CLI 輸入路徑：`--json` 的底稿 ＋ 旗標 → state */
function stateFromFlags(flags: Flags, json?: unknown): VennState {
  const base = json === undefined ? { sets: [] } : specFromJson(json);
  return specToState(applyFlags(base, flags));
}

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
    '調過的槽：同一格有 fs 與 fill': {
      ...defaultState(4),
      style: 'flat',
      texts: {
        '1': { t: '便宜', fs: 0.09, fill: '#ffffff' },
        '15': { t: '媽媽煮的', fs: 0.033 },
        '3': { t: '別人請客', fill: '#111111' },
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

describe('--json 兩種格式', () => {
  const raw: VennState = {
    ...defaultState(2),
    texts: { '1': { t: '工作' }, '3': { t: '沒睡', fs: 0.07, fill: '#ffffff' } },
  };

  it('原始 VennState 直接吃，per-slot 欄位全部留著', () => {
    expect(stateFromFlags({}, raw)).toEqual(raw);
  });

  it('友善 spec 與等價的原始 state 得到同一份 state', () => {
    const friendly = { sets: ['工作', ''], texts: { AB: { t: '沒睡', fs: 0.07, fill: '#ffffff' } } };
    expect(stateFromFlags({}, friendly)).toEqual(stateFromFlags({}, raw));
  });

  it('兩種鑑別欄位都沒有時報錯，訊息把兩種格式都寫出來', () => {
    let message = '';
    try {
      specFromJson({ n: 2, texts: {} });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('sets');
    expect(message).toContain('"v"');
    expect(message).toContain('neither');
  });

  it('兩種鑑別欄位都有時也報錯，不猜', () => {
    expect(() => specFromJson({ v: 1, sets: ['a', 'b'] })).toThrow(/both/);
  });
});

describe('空文字但有填色的槽（flat 的挖白）', () => {
  const hollow: VennState = {
    ...defaultState(2),
    style: 'flat',
    texts: { '1': { t: '甲' }, '2': { t: '乙' }, '3': { t: '', fill: '#ffffff' } },
  };

  it('raw state 往返後那一格還在，填色沒被吃掉', () => {
    expect(stateFromFlags({}, hollow)).toEqual(hollow);
  });

  it('友善 JSON 往返後那一格還在', () => {
    const friendly = { sets: ['甲', '乙'], texts: { AB: { t: '', fill: '#ffffff' } } };
    expect(stateFromFlags({}, friendly).texts['3']).toEqual({ t: '', fill: '#ffffff' });
  });

  it('改別的標籤之後，空交集仍保有填色', () => {
    const state = stateFromFlags({ set: ['A=便宜'] }, hollow);
    expect(state.texts['1']).toEqual({ t: '便宜' });
    expect(state.texts['3']).toEqual({ t: '', fill: '#ffffff' });
  });

  it('空文字且沒有任何樣式的槽仍然視為不存在', () => {
    const state = specToState({ sets: ['甲', '乙'], texts: { AB: { t: '' } } });
    expect(state.texts).toEqual({ '1': { t: '甲' }, '2': { t: '乙' } });
  });
});

describe('友善 JSON 的 top-level 欄位', () => {
  it('拼錯的 key 報錯並列出合法欄位，不靜默出一張少東西的圖', () => {
    let message = '';
    try {
      specFromJson({ sets: ['甲', '乙'], text: { AB: '交集' } });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('"text"');
    expect(message).toContain('texts');
    expect(message).toContain('sets');
  });

  it('大小寫不同的 key 也算拼錯', () => {
    expect(() => specFromJson({ sets: ['甲', '乙'], Title: 'x' })).toThrow(/unknown field/);
  });

  it('合法欄位全給齊不報錯', () => {
    const spec = specFromJson({
      arr: 'ring',
      sets: ['甲', '乙'],
      texts: { AB: '交集' },
      title: '標題',
      style: 'flat',
      opacity: 0.5,
      overlap: 1.2,
      radius: 0.3,
      colors: ['#112233', '#445566'],
      bg: '#ffffff',
      size: 800,
      titleFill: '#000000',
      titleFs: 0.08,
    });
    expect(specToState(spec).title).toBe('標題');
  });

  it('sets 不是陣列時直接報錯，不靜默當成空陣列', () => {
    expect(() => specFromJson({ sets: '甲乙' })).toThrow(/sets must be an array/);
  });
});

describe('標題的字色與字級旗標', () => {
  it('--title-fill 與 --title-fs 進得了 state', () => {
    const state = stateFromFlags({
      set: ['A=甲', 'B=乙'],
      title: '標題',
      'title-fill': '#ffffff',
      'title-fs': '0.08',
    });
    expect(state.title_fill).toBe('#ffffff');
    expect(state.title_fs).toBe(0.08);
  });

  it('沒有 title 時兩者都不進編碼', () => {
    const state = stateFromFlags({
      set: ['A=甲', 'B=乙'],
      'title-fill': '#ffffff',
      'title-fs': '0.08',
    });
    expect(state).not.toHaveProperty('title_fill');
    expect(state).not.toHaveProperty('title_fs');
  });
});

describe('槽的形狀有問題時的訊息', () => {
  it('null 槽：帶不帶 --fs 都是同一句話，不是 TypeError', () => {
    const json = { sets: ['甲', '乙'], texts: { AB: null } };
    const expected = /text slot "AB" must be a string or an object with t/;
    expect(() => stateFromFlags({}, json)).toThrow(expected);
    expect(() => stateFromFlags({ fs: ['AB=0.1'] }, json)).toThrow(expected);
  });

  it('缺 t 的物件槽同樣兩條路一致', () => {
    const json = { sets: ['甲', '乙'], texts: { AB: { fill: '#ffffff' } } };
    const expected = /text slot "AB" is missing t/;
    expect(() => stateFromFlags({}, json)).toThrow(expected);
    expect(() => stateFromFlags({ fs: ['AB=0.1'] }, json)).toThrow(expected);
  });
});

describe('per-slot 旗標', () => {
  it('--fs 與 --fill 寫進對應的槽', () => {
    const state = stateFromFlags({
      set: ['A=工作', 'B=生活'],
      text: ['AB=沒睡'],
      fs: ['AB=0.09'],
      fill: ['AB=#ffffff'],
    });
    expect(state.texts['3']).toEqual({ t: '沒睡', fs: 0.09, fill: '#ffffff' });
  });

  it('單圈標籤也吃得到 per-slot 旗標', () => {
    const state = stateFromFlags({ set: ['A=工作', 'B=生活'], fs: ['A=0.12'] });
    expect(state.texts['1']).toEqual({ t: '工作', fs: 0.12 });
  });

  it('槽裡沒有文字時報錯，而不是產生一個沒有 t 的槽', () => {
    expect(() => stateFromFlags({ set: ['A=工作', 'B=生活'], fs: ['AB=0.09'] })).toThrow(
      /needs text in slot AB/,
    );
  });

  it('非法槽位的 per-slot 旗標，錯誤訊息與 --text 同一套', () => {
    expect(() =>
      stateFromFlags({ set: ['A=1', 'B=2', 'C=3', 'D=4'], fill: ['AD=#ffffff'] }),
    ).toThrow(/valid slots for ring\(4\)/);
  });
});

describe('旗標疊在 JSON 底稿上', () => {
  const raw: VennState = {
    ...defaultState(2),
    style: 'flat',
    texts: { '1': { t: '工作' }, '3': { t: '沒睡', fs: 0.07, fill: '#ffffff' } },
  };

  it('--text 只換文字，保留該格既有的 fs 與 fill', () => {
    const state = stateFromFlags({ text: ['AB=真的沒睡'] }, raw);
    expect(state.texts['3']).toEqual({ t: '真的沒睡', fs: 0.07, fill: '#ffffff' });
  });

  it('--set 覆蓋單圈標籤，其餘槽不動', () => {
    const state = stateFromFlags({ set: ['A=上班'] }, raw);
    expect(state.texts['1']).toEqual({ t: '上班' });
    expect(state.texts['3']).toEqual(raw.texts['3']);
  });

  it('--text 給空字串只清文字，該格的 fs 與 fill 留著', () => {
    const state = stateFromFlags({ text: ['AB='] }, raw);
    expect(state.texts['3']).toEqual({ t: '', fs: 0.07, fill: '#ffffff' });
  });

  it('沒有樣式的槽清空文字後整格消失', () => {
    const plain: VennState = { ...defaultState(2), texts: { '1': { t: '工作' }, '3': { t: '沒睡' } } };
    expect(stateFromFlags({ text: ['AB='] }, plain).texts).toEqual({ '1': { t: '工作' } });
  });

  it('大小寫與亂序的 key 蓋得掉 JSON 裡的同一格，不會變成兩筆', () => {
    const state = stateFromFlags({ text: ['ba=換掉'] }, raw);
    expect(state.texts['3']).toEqual({ t: '換掉', fs: 0.07, fill: '#ffffff' });
  });
});
