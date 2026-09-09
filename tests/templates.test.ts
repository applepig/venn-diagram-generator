import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OVERLAP,
  DEFAULT_RADIUS,
  MIN_FS,
  SLOT_MASKS,
  TEMPLATES,
  isPristine,
  popCount,
  sampleState,
} from '../shared/defaults';
import { nextStateForCircleCount } from '../shared/circle-count';
import { layout } from '../shared/layout';
import type { CircleCount } from '../shared/types';

/**
 * spec 認可的 template 字面值，不從 TEMPLATES 反查（否則等於拿受測程式自證）。
 * 部分格子刻意帶手動 `\n`，避免自動斷行斷成讀不順的位置。
 */
const TEXTS_2 = {
  '1': { t: '該做\n的事' },
  '2': { t: '想做\n的事' },
  '3': { t: '拖到\n明天' },
};

const TEXTS_3 = {
  '1': { t: '要快' },
  '2': { t: '要好' },
  '4': { t: '要便宜' },
  '3': { t: '不便宜' },
  '5': { t: '不會好' },
  '6': { t: '不會快' },
  '7': { t: '想得美' },
};

const TEXTS_4 = {
  '1': { t: 'DJ' },
  '2': { t: '銀行\n搶匪' },
  '4': { t: '牧師' },
  '8': { t: '叫小孩\n把毛衣脫下\n的媽媽' },
  '3': { t: '「大家\n給我\n聽好!」' },
  '5': { t: '「聽懂我\n在說\n什麼嗎?」' },
  '10': { t: '「別讓\n我說\n第二次!」' },
  '12': { t: '「不好好\n聽話\n會有嚴重\n的後果」' },
  '15': { t: '把手\n舉起來!!' },
};

describe('sampleState', () => {
  it('無參數回 2 圈 template：flat 樣式與「該做／想做／拖到明天」', () => {
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
      const allowed = new Set(SLOT_MASKS[n].map(String));
      for (const key of Object.keys(TEMPLATES[n].texts)) expect(allowed.has(key)).toBe(true);
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
    s.texts['3'] = { t: '拖到\n明天', fs: 0.08 };

    expect(isPristine(s)).toBe(false);
  });

  it('文字沒變但拖動過位置就不是 pristine', () => {
    const s = sampleState(3);
    s.texts['7'] = { t: '想得美', dx: 0.02 };

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

describe('nextStateForCircleCount', () => {
  it('pristine 時 2→3 換成 3 圈 template 與其樣式', () => {
    const next = nextStateForCircleCount(sampleState(2), 3);

    expect(next.n).toBe(3);
    expect(next.style).toBe('translucent');
    expect(next.texts).toEqual(TEXTS_3);
  });

  it('pristine 時 2→4 換成 4 圈 template 與 outline 樣式', () => {
    const next = nextStateForCircleCount(sampleState(2), 4);

    expect(next.style).toBe('outline');
    expect(next.texts).toEqual(TEXTS_4);
  });

  it('切圈數回到該圈數的預設幾何與對應數量的顏色', () => {
    const next = nextStateForCircleCount({ ...sampleState(2), radius: 0.2, overlap: 1.6 }, 4);

    expect(next.radius).toBeCloseTo(DEFAULT_RADIUS[4], 10);
    expect(next.overlap).toBeCloseTo(DEFAULT_OVERLAP[4], 10);
    expect(next.colors).toHaveLength(4);
  });

  it('使用者改過文字時保留使用者的字、不動樣式', () => {
    const dirty = { ...sampleState(2), style: 'flat' as const };
    dirty.texts = { '1': { t: '貓' }, '2': { t: '狗' }, '3': { t: '毛' } };
    const next = nextStateForCircleCount(dirty, 3);

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
    const next = nextStateForCircleCount(dirty, 2);

    expect(Object.keys(next.texts).sort()).toEqual(['1', '2', '3']);
    expect(next.texts['3']).toEqual({ t: '要錢' });
  });

  it('不改動傳入的 state', () => {
    const before = sampleState(2);
    nextStateForCircleCount(before, 4);

    expect(before.n).toBe(2);
    expect(before.texts).toEqual(TEXTS_2);
  });

  it('回傳的 texts 是新物件，改動不會污染 TEMPLATES', () => {
    const next = nextStateForCircleCount(sampleState(2), 4);
    next.texts['15'] = { t: '被改掉' };

    expect(TEMPLATES[4].texts['15']).toEqual({ t: '把手\n舉起來!!' });
  });
});

describe('AC4 三組 template 在預設幾何下都不觸字級下限', () => {
  for (const n of [2, 3, 4] as CircleCount[]) {
    it(`${n} 圈 template 每個有文字的槽字級都高於下限`, () => {
      const blocks = layout(sampleState(n));
      const slots = Object.keys(TEMPLATES[n].texts).map(Number);

      expect(blocks.map((b) => b.mask).sort((a, b) => a - b)).toEqual(
        [...slots].sort((a, b) => a - b),
      );
      for (const block of blocks) expect(block.fs).toBeGreaterThan(MIN_FS);
    });
  }

  it('4 圈中央「把手舉起來!!」的字級不小於任何相鄰雙圈格', () => {
    const blocks = layout(sampleState(4));
    const center = blocks.find((b) => b.mask === 15)!;
    const pairs = blocks.filter((b) => popCount(b.mask) === 2);

    expect(pairs.length).toBeGreaterThan(0);
    for (const block of pairs) expect(center.fs).toBeGreaterThanOrEqual(block.fs);
  });
});
