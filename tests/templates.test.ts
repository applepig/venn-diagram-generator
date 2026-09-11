import { describe, expect, it } from 'vitest';
import { MIN_FS, popCount } from '../engine/defaults';
import { nextStateForShape } from '../content/next-state';
import { isPristine, sampleState } from '../content/state-presets';
import { TEMPLATES } from '../content/templates/zh-TW';
import { layout, slotMasks } from '../engine/layout';
import { shapeDefaults } from '../engine/shapes/index';
import type { CircleCount } from '../engine/types';

/**
 * spec 認可的 template 字面值，不從 TEMPLATES 反查（否則等於拿受測程式自證）。
 * 部分格子刻意帶手動 `\n`，避免自動斷行斷成讀不順的位置。
 */
const TEXTS_2 = {
  '1': { t: '該做\n的事' },
  '2': { t: '想做\n的事' },
  '3': { t: '明天\n再說' },
};

const TEXTS_3 = {
  '1': { t: '要快' },
  '2': { t: '要好' },
  '4': { t: '要便宜' },
  '3': { t: '貴' },
  '5': { t: '醜' },
  '6': { t: '慢' },
  '7': { t: '不可能' },
};

const TEXTS_4 = {
  '1': { t: 'DJ' },
  '2': { t: '銀行\n搶匪' },
  '4': { t: '牧師' },
  '8': { t: '叫小孩\n把毛衣脫下\n的媽媽' },
  '3': { t: '「大家給我\n聽好!」' },
  '5': { t: '「聽懂我在\n說什麼嗎?」' },
  '10': { t: '「別讓我\n說第二次!」' },
  '12': { t: '「不聽話會有\n嚴重的後果」' },
  '15': { t: '把手\n舉起來!!' },
};

describe('sampleState', () => {
  it('無參數回 2 圈 template：flat 樣式與「該做／想做／明天再說」', () => {
    const s = sampleState();

    expect(s.n).toBe(2);
    expect(s.style).toBe('flat');
    expect(s.texts).toEqual(TEXTS_2);
  });

  it('帶圈數時套用該圈數的 template 與樣式', () => {
    expect(sampleState(3).style).toBe('translucent');
    expect(sampleState(3).texts).toEqual(TEXTS_3);
    expect(sampleState(4).style).toBe('outline');
    expect(sampleState(4).texts).toEqual(TEXTS_4);
  });

  it('每次回新的 texts 物件，改動不會污染 TEMPLATES', () => {
    const s = sampleState(4);
    s.texts['15'] = { t: '被改掉' };

    expect(sampleState(4).texts['15']).toEqual({ t: '把手\n舉起來!!' });
  });

  it('template 的槽都在該圈數的合法槽位內', () => {
    for (const n of [2, 3, 4] as CircleCount[]) {
      const allowed = new Set(slotMasks('ring', n).map(String));
      for (const key of Object.keys(TEMPLATES[n]!.texts)) expect(allowed.has(key)).toBe(true);
    }
  });
});

describe('isPristine', () => {
  it('template 原樣是 pristine', () => {
    for (const n of [2, 3, 4] as CircleCount[]) expect(isPristine(sampleState(n))).toBe(true);
  });

  it('改過任一格文字就不是 pristine', () => {
    const s = sampleState(2);
    s.texts['3'] = { t: '拖到下週' };

    expect(isPristine(s)).toBe(false);
  });

  it('文字沒變但調過字級就不是 pristine', () => {
    const s = sampleState(2);
    s.texts['3'] = { t: '明天\n再說', fs: 0.08 };

    expect(isPristine(s)).toBe(false);
  });

  it('文字沒變但拖動過位置就不是 pristine', () => {
    const s = sampleState(3);
    s.texts['7'] = { t: '不可能', dx: 0.02 };

    expect(isPristine(s)).toBe(false);
  });

  it('AC10 文字沒變但指定過區域填色就不是 pristine', () => {
    const s = sampleState(2);
    s.texts['3'] = { t: '明天\n再說', fill: '#ffffff' };

    expect(isPristine(s)).toBe(false);
  });

  it('少一格或多一格都不是 pristine', () => {
    const fewer = sampleState(2);
    delete fewer.texts['3'];
    expect(isPristine(fewer)).toBe(false);

    const more = sampleState(4);
    more.texts['7'] = { t: '甲乙' };
    expect(isPristine(more)).toBe(false);
  });

  it('只改顏色、樣式、size 或幾何仍是 pristine', () => {
    const s = sampleState(2);

    expect(
      isPristine({
        ...s,
        colors: ['#000000', '#ffffff'],
        style: 'outline',
        size: 800,
        radius: 0.2,
        overlap: 1.6,
        opacity: 1,
        bg: '#ffffff',
      }),
    ).toBe(true);
  });
});

describe('nextStateForShape', () => {
  it('pristine 時 2→3 換成 3 圈 template 與其樣式', () => {
    const next = nextStateForShape(sampleState(2), 'ring', 3);

    expect(next.n).toBe(3);
    expect(next.style).toBe('translucent');
    expect(next.texts).toEqual(TEXTS_3);
  });

  it('pristine 時 2→4 換成 4 圈 template 與 outline 樣式', () => {
    const next = nextStateForShape(sampleState(2), 'ring', 4);

    expect(next.style).toBe('outline');
    expect(next.texts).toEqual(TEXTS_4);
  });

  it('切形狀回到目標組合的預設幾何與對應數量的顏色', () => {
    const next = nextStateForShape({ ...sampleState(2), radius: 0.2, overlap: 1.6 }, 'ring', 4);

    expect(next.radius).toBeCloseTo(shapeDefaults('ring', 4).radius, 10);
    expect(next.overlap).toBeCloseTo(shapeDefaults('ring', 4).overlap, 10);
    expect(next.colors).toHaveLength(4);
  });

  it('切成 row 時用 row 的預設幾何，並把 arr 寫進 state', () => {
    const next = nextStateForShape(sampleState(4), 'row', 4);

    expect(next.arr).toBe('row');
    expect(next.n).toBe(4);
    expect(next.radius).toBeCloseTo(shapeDefaults('row', 4).radius, 10);
    expect(next.overlap).toBeCloseTo(shapeDefaults('row', 4).overlap, 10);
  });

  it('AC1 切回 ring 時 state 不留 arr 欄位（編碼字串才不變）', () => {
    const row = nextStateForShape(sampleState(4), 'row', 4);
    const back = nextStateForShape(row, 'ring', 4);

    expect('arr' in back).toBe(false);
  });

  it('使用者改過文字時保留使用者的字、不動樣式', () => {
    const dirty = { ...sampleState(2), style: 'flat' as const };
    dirty.texts = { '1': { t: '貓' }, '2': { t: '狗' }, '3': { t: '毛' } };
    const next = nextStateForShape(dirty, 'ring', 3);

    expect(next.style).toBe('flat');
    expect(next.texts).toEqual({ '1': { t: '貓' }, '2': { t: '狗' }, '3': { t: '毛' } });
  });

  it('使用者改過文字時只過濾掉新圈數沒有的槽', () => {
    const dirty = sampleState(3);
    dirty.texts = {
      '1': { t: '快' },
      '2': { t: '好' },
      '4': { t: '便宜' },
      '3': { t: '要錢' },
      '7': { t: '不存在' },
    };
    const next = nextStateForShape(dirty, 'ring', 2);

    expect(Object.keys(next.texts).sort()).toEqual(['1', '2', '3']);
    expect(next.texts['3']).toEqual({ t: '要錢' });
  });

  it('切排列時按目標組合的槽表過濾使用者的字', () => {
    const dirty = sampleState(4);
    dirty.texts = { '1': { t: '甲' }, '3': { t: '甲乙' }, '15': { t: '全部' } };
    const next = nextStateForShape(dirty, 'row', 4);

    // row(4) 沒有四重區，那一格得丟掉，否則 encode 出來的連結自己解不開
    expect(slotMasks('row', 4)).not.toContain(15);
    expect(Object.keys(next.texts).sort()).toEqual(['1', '3']);
  });

  it('不改動傳入的 state', () => {
    const before = sampleState(2);
    nextStateForShape(before, 'ring', 4);

    expect(before.n).toBe(2);
    expect(before.texts).toEqual(TEXTS_2);
  });

  it('回傳的 texts 是新物件，改動不會污染 TEMPLATES', () => {
    const next = nextStateForShape(sampleState(2), 'ring', 4);
    next.texts['15'] = { t: '被改掉' };

    expect(TEMPLATES[4]!.texts['15']).toEqual({ t: '把手\n舉起來!!' });
  });

  it('沒有 template 的組合（row、5／6 圈）從空白槽開始，樣式不動', () => {
    const next = nextStateForShape(sampleState(2), 'row', 3);

    expect(next.texts).toEqual({});
    expect(next.style).toBe('flat');
  });
});

describe('AC4 三組 template 在預設幾何下都不觸字級下限', () => {
  for (const n of [2, 3, 4] as CircleCount[]) {
    it(`${n} 圈 template 每個有文字的槽字級都高於下限`, () => {
      const blocks = layout(sampleState(n));
      const slots = Object.keys(TEMPLATES[n]!.texts).map(Number);

      expect(blocks.map((b) => b.mask).sort((a, b) => a - b)).toEqual(
        [...slots].sort((a, b) => a - b),
      );
      for (const block of blocks) expect(block.fs).toBeGreaterThan(MIN_FS);
    });
  }

  // 字級是 0.95 步進收斂出來的離散值，釘死每一格等於把收斂方式當規格；
  // AC10 要的是「兩行、看得清、中央最大」這三件事
  it('AC10 4 圈四個相鄰交集都排成兩行且字級不觸底，中央不小於相鄰交集', () => {
    const blocks = layout(sampleState(4));
    const adjacent = [3, 5, 10, 12];

    for (const mask of adjacent) {
      const block = blocks.find((b) => b.mask === mask)!;
      expect(block.lines, `mask ${mask}`).toHaveLength(2);
      expect(block.fs, `mask ${mask}`).toBeGreaterThan(MIN_FS);
    }
    const center = blocks.find((b) => b.mask === 15)!;
    const max_adjacent = Math.max(...adjacent.map((m) => blocks.find((b) => b.mask === m)!.fs));

    expect(center.fs).toBeGreaterThanOrEqual(max_adjacent);
  });

  it('4 圈中央「把手舉起來!!」的字級不小於任何相鄰雙圈格', () => {
    const blocks = layout(sampleState(4));
    const center = blocks.find((b) => b.mask === 15)!;
    const pairs = blocks.filter((b) => popCount(b.mask) === 2);

    expect(pairs.length).toBeGreaterThan(0);
    for (const block of pairs) expect(center.fs).toBeGreaterThanOrEqual(block.fs);
  });
});
