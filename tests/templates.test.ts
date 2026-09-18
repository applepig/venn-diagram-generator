import { describe, expect, it } from 'vitest';
import { MIN_FS, popCount } from '../engine/defaults';
import { LOCALES, type Locale } from '../content/locale';
import { nextStateForShape } from '../content/next-state';
import { PALETTE } from '../content/palette';
import {
  defaultState,
  ghostTexts,
  initialState,
  isPristine,
  sampleState,
  templateFor,
  templateTexts,
} from '../content/state-presets';
import { TEMPLATES } from '../content/templates/zh-TW';
import { layout, slotMasks } from '../engine/layout';
import { ARRANGEMENTS, circleCountRange, shapeDefaults } from '../engine/shapes/index';
import type { Arrangement, CircleCount } from '../engine/types';

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
      for (const key of Object.keys(TEMPLATES.ring[n]!.texts)) expect(allowed.has(key)).toBe(true);
    }
  });
});

describe('initialState', () => {
  it('編輯器起手式一格字都不填，只帶該圈數 template 的樣式', () => {
    expect(initialState().texts).toEqual({});
    expect(initialState().n).toBe(2);
    expect(initialState().style).toBe('flat');
    expect(initialState(3).style).toBe('translucent');
    expect(initialState(4).style).toBe('outline');
  });

  it('各語言的起始狀態都是空的（template 只當 placeholder）', () => {
    for (const locale of LOCALES) {
      for (const n of [2, 3, 4] as CircleCount[]) {
        expect(initialState(n, locale).texts, `${locale} ring(${n})`).toEqual({});
      }
    }
  });
});

describe('ghostTexts：預覽的幽靈字', () => {
  it('還沒寫字時給整組示範文字', () => {
    expect(ghostTexts(initialState(2))).toEqual({
      '1': '該做\n的事',
      '2': '想做\n的事',
      '3': '明天\n再說',
    });
  });

  it('任何一格寫了字就整組收掉（預覽必須等於匯出）', () => {
    const state = { ...initialState(2), texts: { '1': { t: '貓派' } } };

    expect(ghostTexts(state)).toEqual({});
  });

  it('把字全刪光又回到空白狀態，提示再出現', () => {
    const typed = { ...initialState(2), texts: { '1': { t: '貓派' } } };
    const cleared = { ...typed, texts: {} };

    expect(ghostTexts(cleared)).not.toEqual({});
  });

  it('只改過顏色或幾何不算寫字，提示仍在', () => {
    const state = { ...initialState(2), bg: '#ffffff', radius: 0.2 };

    expect(Object.keys(ghostTexts(state))).toHaveLength(3);
  });

  it('只打了圖片標題也算寫過字（標題會進輸出，示範字不會）', () => {
    expect(ghostTexts({ ...initialState(2), title: '我的圖' })).toEqual({});
    // 空白標題不算，等同沒打
    expect(Object.keys(ghostTexts({ ...initialState(2), title: '  ' }))).toHaveLength(3);
  });

  it('跟著呼叫端的語言走', () => {
    expect(ghostTexts(initialState(2, 'en'), 'en')['3']).toBe('Tomorrow');
  });
});

describe('isPristine', () => {
  it('空白狀態是 pristine', () => {
    for (const n of [2, 3, 4] as CircleCount[]) expect(isPristine(initialState(n))).toBe(true);
  });

  it('寫過任一格文字就不是 pristine', () => {
    const s = initialState(2);
    s.texts['3'] = { t: '拖到下週' };

    expect(isPristine(s)).toBe(false);
  });

  it('只有空白字的幽靈槽仍算 pristine', () => {
    const s = initialState(2);
    s.texts['3'] = { t: '' };

    expect(isPristine(s)).toBe(true);
  });

  it('沒有文字但調過字級就不是 pristine', () => {
    const s = initialState(2);
    s.texts['3'] = { t: '', fs: 0.08 };

    expect(isPristine(s)).toBe(false);
  });

  it('AC10 沒有文字但指定過區域填色就不是 pristine', () => {
    const s = initialState(2);
    s.texts['3'] = { t: '', fill: '#ffffff' };

    expect(isPristine(s)).toBe(false);
  });

  it('只改顏色、樣式、size 或幾何仍是 pristine', () => {
    const s = initialState(2);

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
  it('pristine 時 2→3 換成 3 圈的樣式，文字仍全空', () => {
    const next = nextStateForShape(initialState(2), 'ring', 3);

    expect(next.n).toBe(3);
    expect(next.style).toBe('translucent');
    expect(next.texts).toEqual({});
  });

  it('pristine 時 2→4 換成 outline 樣式，不塞任何 template 文字', () => {
    const next = nextStateForShape(initialState(2), 'ring', 4);

    expect(next.style).toBe('outline');
    expect(next.texts).toEqual({});
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

    expect(TEMPLATES.ring[4]!.texts['15']).toEqual({ t: '把手\n舉起來!!' });
  });

  it('AC4 切到 row(3) 時仍不塞文字，單圈標籤留給 placeholder', () => {
    const next = nextStateForShape(initialState(2), 'row', 3);

    expect(next.texts).toEqual({});
    expect(templateTexts('row', 3)).toEqual({ '1': { t: '甲' }, '2': { t: '乙' }, '4': { t: '丙' } });
  });

  it('AC4 切到 6 圈時顏色補滿六色，沒有灰色補位', () => {
    const next = nextStateForShape(sampleState(2), 'ring', 6);

    expect(next.colors).toHaveLength(6);
    expect(next.colors).not.toContain('#888888');
    // 前兩色沿用原本的圈色，其餘從 PALETTE 補
    expect(next.colors.slice(2)).toEqual(PALETTE.slice(2, 6));
  });
});

/**
 * AC4：ring(5)／ring(6)／row(3～6) 只給單圈標籤，交集留空（spec 非目標排除了這些組合的 meme 文案）。
 * 標籤字面值取自 spec ADR 的「zh 甲乙丙丁戊己」，不從 TEMPLATES 反查。
 */
describe('AC4 單圈標籤 template', () => {
  const LABELS = ['甲', '乙', '丙', '丁', '戊', '己'];
  const LABEL_ONLY: [Arrangement, CircleCount][] = [
    ['ring', 5],
    ['ring', 6],
    ['row', 3],
    ['row', 4],
    ['row', 5],
    ['row', 6],
  ];

  for (const [arr, n] of LABEL_ONLY) {
    it(`${arr}(${n}) 每個圈有一個標籤、交集全空`, () => {
      const texts = templateTexts(arr, n);
      const expected = Object.fromEntries(
        Array.from({ length: n }, (_, i) => [String(1 << i), { t: LABELS[i]! }]),
      );

      expect(texts).toEqual(expected);
    });
  }

  it('每個組合的 template 槽都在該組合的合法槽表內', () => {
    for (const arr of ARRANGEMENTS) {
      const [min_n, max_n] = circleCountRange(arr);
      for (let n = min_n; n <= max_n; n++) {
        const allowed = new Set(slotMasks(arr, n as CircleCount).map(String));
        for (const key of Object.keys(templateTexts(arr, n as CircleCount))) {
          expect(allowed.has(key), `${arr}(${n}) 槽 ${key}`).toBe(true);
        }
      }
    }
  }, 30_000);

  it('空白狀態切到這些組合仍是 pristine，樣式跟著 template 換', () => {
    for (const [arr, n] of LABEL_ONLY) {
      const state = nextStateForShape(initialState(2), arr, n);

      expect(isPristine(state), `${arr}(${n})`).toBe(true);
      expect(state.style, `${arr}(${n})`).toBe(templateFor(arr, n)!.style);
    }
  });
});

describe('AC4 PALETTE 六色', () => {
  it('六圈各有自己的顏色，沒有重複也沒有灰色補位', () => {
    expect(PALETTE).toHaveLength(6);
    expect(new Set(PALETTE).size).toBe(6);
    expect(PALETTE).not.toContain('#888888');
    for (const color of PALETTE) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('defaultState(6) 的六個圈色就是 PALETTE', () => {
    expect(defaultState(6).colors).toEqual(PALETTE);
  });
});

describe('AC4 三組 template 在預設幾何下都不觸字級下限', () => {
  for (const n of [2, 3, 4] as CircleCount[]) {
    it(`${n} 圈 template 每個有文字的槽字級都高於下限`, () => {
      const blocks = layout(sampleState(n));
      const slots = Object.keys(TEMPLATES.ring[n]!.texts).map(Number);

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

/**
 * AC6／AC7 的 en template。字面值取自 spec 的表格，不從 TEMPLATES_EN 反查。
 * spec 明說「換行位置 developer 可調，判準是 AC7 的不觸底」，所以這裡比對的是
 * 收掉換行後的文案內容；換行位置由 AC7 的字級測試把關。
 */
const EN_TEXTS_2 = {
  '1': { t: 'Things I should do' },
  '2': { t: 'Things I want to do' },
  '3': { t: 'Tomorrow' },
};

const EN_TEXTS_3 = {
  '1': { t: 'Fast' },
  '2': { t: 'Good' },
  '4': { t: 'Cheap' },
  '3': { t: 'Not cheap' },
  '5': { t: 'Not good' },
  '6': { t: 'Not fast' },
  '7': { t: 'Dream on' },
};

/**
 * 4 圈：spec 表格的原句在預設幾何下有四格觸到 `MIN_FS`（英文比中文寬約 1.8 倍，
 * 4 圈的區域又最窄），AC7 過不了。以下四格照 spec 的語氣縮短，偏離處逐條註明：
 * '4' Priest → The priest（避開 `Pries|t` 這種單字硬斷）、
 * '8' …take off the sweater → …take it off、
 * '5' …what I'm saying? → …me?、
 * '12' consequences → trouble。
 */
const EN_TEXTS_4 = {
  '1': { t: 'DJ' },
  '2': { t: 'Bank robber' },
  '4': { t: 'The priest' },
  '8': { t: 'Mom telling her kid to take it off' },
  '3': { t: 'Everybody listen up!' },
  '5': { t: 'Do you understand me?' },
  '10': { t: "Don't make me say it twice!" },
  '12': { t: 'There will be trouble' },
  '15': { t: 'Put your hands up!!' },
};

/** 手動換行只是排版，文案內容以收掉換行後的字串為準 */
function flatten(texts: Record<string, { t: string }>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(texts).map(([mask, slot]) => [mask, slot.t.replace(/\s+/g, ' ').trim()]),
  );
}

function flattenExpected(texts: Record<string, { t: string }>): Record<string, string> {
  return Object.fromEntries(Object.entries(texts).map(([mask, slot]) => [mask, slot.t]));
}

describe('AC6 en template', () => {
  const cases: [CircleCount, Record<string, { t: string }>][] = [
    [2, EN_TEXTS_2],
    [3, EN_TEXTS_3],
    [4, EN_TEXTS_4],
  ];

  for (const [n, expected] of cases) {
    it(`ring(${n}) 的英文文案與 spec 表格相同`, () => {
      expect(flatten(templateTexts('ring', n, 'en'))).toEqual(flattenExpected(expected));
    });
  }

  it('en 與 zh 的樣式相同（樣式是版型決定，不隨語言變）', () => {
    for (const n of [2, 3, 4] as CircleCount[]) {
      expect(templateFor('ring', n, 'en')?.style).toBe(templateFor('ring', n, 'zh-TW')?.style);
    }
  });

  it('en 的槽位與 zh 完全對應（同一個版面，只是換文案）', () => {
    for (const n of [2, 3, 4] as CircleCount[]) {
      expect(Object.keys(templateTexts('ring', n, 'en')).sort()).toEqual(
        Object.keys(templateTexts('ring', n, 'zh-TW')).sort(),
      );
    }
  });

  it('ring(5)／ring(6)／row(3～6) 的英文只給 A～F 單圈標籤，交集留空', () => {
    const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
    const label_only: [Arrangement, CircleCount][] = [
      ['ring', 5],
      ['ring', 6],
      ['row', 3],
      ['row', 4],
      ['row', 5],
      ['row', 6],
    ];

    for (const [arr, n] of label_only) {
      const expected = Object.fromEntries(
        Array.from({ length: n }, (_, i) => [String(1 << i), { t: labels[i]! }]),
      );
      expect(templateTexts(arr, n, 'en'), `${arr}(${n})`).toEqual(expected);
    }
  });

  it('每個語言的每個合法組合都有 template，槽位都在該組合的合法槽表內', () => {
    for (const locale of LOCALES) {
      for (const arr of ARRANGEMENTS) {
        const [min_n, max_n] = circleCountRange(arr);
        for (let n = min_n; n <= max_n; n++) {
          const texts = templateTexts(arr, n as CircleCount, locale);
          expect(Object.keys(texts).length, `${locale} ${arr}(${n})`).toBeGreaterThan(0);
          const allowed = new Set(slotMasks(arr, n as CircleCount).map(String));
          for (const key of Object.keys(texts)) {
            expect(allowed.has(key), `${locale} ${arr}(${n}) 槽 ${key}`).toBe(true);
          }
        }
      }
    }
  }, 30_000);

  it('sampleState 帶語言時套用該語言的 template', () => {
    expect(flatten(sampleState(2, 'en').texts)).toEqual(flattenExpected(EN_TEXTS_2));
    expect(sampleState(2, 'en').style).toBe('flat');
    expect(sampleState(2).texts).toEqual(TEMPLATES.ring[2]!.texts);
  });
});

describe('AC6 切語言後的 placeholder', () => {
  it('同一個槽在不同語言拿到不同的示範字（UI 的 placeholder 來源）', () => {
    expect(flatten(templateTexts('ring', 2, 'en'))['3']).toBe('Tomorrow');
    expect(templateTexts('ring', 2, 'zh-TW')['3']).toEqual({ t: '明天\n再說' });
  });

  it('切形狀時樣式跟著 template 換，但不因語言而異', () => {
    const en = nextStateForShape(initialState(2, 'en'), 'ring', 3, 'en');
    const zh = nextStateForShape(initialState(2), 'ring', 3);

    expect(en.texts).toEqual({});
    expect(en.style).toBe(zh.style);
  });
});

/**
 * AC13 的 ja template。字面值取自 spec 的表格，不從 TEMPLATES_JA 反查。
 * spec 明說「換行 developer 可調，判準與 en 相同」，所以比對的是收掉換行後的內容；
 * 日文不用空白分詞，手動換行接回去不補空白，normalizer 直接去掉所有空白。
 */
const JA_TEXTS_2 = {
  '1': 'やるべきこと',
  '2': 'やりたいこと',
  '3': '明日やる',
};

const JA_TEXTS_3 = {
  '1': '早い',
  '2': 'うまい',
  '4': '安い',
  '3': '安くない',
  '5': 'うまくない',
  '6': '早くない',
  '7': '夢のまた夢',
};

const JA_TEXTS_4 = {
  '1': 'DJ',
  '2': '銀行強盗',
  '4': '牧師',
  '8': 'セーターを脱がせたい母',
  '3': '「みんな聞け!」',
  '5': '「言ってる意味わかる?」',
  '10': '「二度も言わせるな!」',
  '12': '「ひどい目に遭うぞ」',
  '15': '手を上げろ!!',
};

/** 手動換行只是排版；日文沒有詞間空白，所以內容以去掉全部空白後的字串為準 */
function strip(texts: Record<string, { t: string }>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(texts).map(([mask, slot]) => [mask, slot.t.replace(/\s+/g, '')]),
  );
}

describe('AC13 ja template', () => {
  const cases: [CircleCount, Record<string, string>][] = [
    [2, JA_TEXTS_2],
    [3, JA_TEXTS_3],
    [4, JA_TEXTS_4],
  ];

  for (const [n, expected] of cases) {
    it(`ring(${n}) 的日文文案與 spec 表格相同`, () => {
      expect(strip(templateTexts('ring', n, 'ja'))).toEqual(expected);
    });
  }

  it('ja 與 zh 的樣式相同（樣式是版型決定，不隨語言變）', () => {
    for (const n of [2, 3, 4] as CircleCount[]) {
      expect(templateFor('ring', n, 'ja')?.style).toBe(templateFor('ring', n, 'zh-TW')?.style);
    }
  });

  it('ja 的槽位與 zh 完全對應（同一個版面，只是換文案）', () => {
    for (const n of [2, 3, 4] as CircleCount[]) {
      expect(Object.keys(templateTexts('ring', n, 'ja')).sort()).toEqual(
        Object.keys(templateTexts('ring', n, 'zh-TW')).sort(),
      );
    }
  });

  it('ring(5)／ring(6)／row(3～6) 的日文沿用 A～F 單圈標籤，交集留空', () => {
    const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
    const label_only: [Arrangement, CircleCount][] = [
      ['ring', 5],
      ['ring', 6],
      ['row', 3],
      ['row', 4],
      ['row', 5],
      ['row', 6],
    ];

    for (const [arr, n] of label_only) {
      const expected = Object.fromEntries(
        Array.from({ length: n }, (_, i) => [String(1 << i), { t: labels[i]! }]),
      );
      expect(templateTexts(arr, n, 'ja'), `${arr}(${n})`).toEqual(expected);
    }
  });

  it('sampleState 帶 ja 時套用日文 template（og:image 用的那張）', () => {
    for (const n of [2, 3, 4] as CircleCount[]) {
      const state = sampleState(n, 'ja');

      expect(strip(state.texts), `ring(${n})`).toEqual(cases.find(([c]) => c === n)![1]);
    }
  });
});

describe('AC13 zh／en／ja 九組 template 在各自預設幾何下每格都不觸字級下限', () => {
  for (const locale of ['zh-TW', 'en', 'ja'] as Locale[]) {
    for (const n of [2, 3, 4] as CircleCount[]) {
      it(`${locale} ring(${n}) 每格都排得進去且字級高於下限`, () => {
        const state = sampleState(n, locale);
        const blocks = layout(state);
        const slots = Object.keys(state.texts).map(Number);

        // 空 template 也能讓下面的斷言全過：先確認這一組真的有文案
        expect(slots.length).toBeGreaterThan(0);
        // 每個有文字的槽都要真的排出一個 block，否則「不觸底」是因為沒排到
        expect(blocks.map((b) => b.mask).sort((a, b) => a - b)).toEqual(
          [...slots].sort((a, b) => a - b),
        );
        for (const block of blocks) {
          expect(block.fs, `${locale} ring(${n}) mask ${block.mask}`).toBeGreaterThan(MIN_FS);
        }
      });
    }
  }
});
