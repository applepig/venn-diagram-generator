import { describe, expect, it } from 'vitest';
import {
  centerShift,
  circlesFor,
  estimateWidth,
  fitText,
  layout,
  regionBox,
  wrapText,
} from '../shared/layout';
import {
  DEFAULT_OVERLAP,
  DEFAULT_RADIUS,
  INTERSECTION_ASPECT,
  INTERSECTION_START_FS,
  LABEL_START_FS,
  LINE_HEIGHT,
  MIN_FS,
  SLOT_MASKS,
  defaultState,
  sampleState,
} from '../shared/defaults';
import type { CircleCount, VennState } from '../shared/types';

function stateWith(n: CircleCount, texts: Record<string, string>): VennState {
  const base = defaultState(n);
  return {
    ...base,
    texts: Object.fromEntries(Object.entries(texts).map(([k, t]) => [k, { t }])),
  };
}

/** 每個槽都填同一段文字，用來壓測所有區域 */
function fillAllSlots(n: CircleCount, text: string): VennState {
  return stateWith(n, Object.fromEntries(SLOT_MASKS[n].map((m) => [String(m), text])));
}

describe('wrapText', () => {
  it('把長 CJK 字串斷成多行，每行估寬不超過上限', () => {
    const fs = 0.05;
    const max_w = 0.2; // 4 個全形字的寬度
    const lines = wrapText('要等到天荒地老海枯石爛', fs, max_w);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(estimateWidth(line, fs)).toBeLessThanOrEqual(max_w);
  });

  it('不把 Latin 單字拆開：「會寫 CSS」的 CSS 保持完整', () => {
    // 寬度只夠兩個全形字，強迫換行
    const lines = wrapText('會寫 CSS', 0.05, 0.11);

    expect(lines.join('|')).toContain('CSS');
    expect(lines.some((l) => /^CS$|^SS$|^C$|^S$/.test(l))).toBe(false);
  });

  it('保留使用者輸入的手動換行', () => {
    expect(wrapText('媽媽\n煮的', 0.05, 1)).toEqual(['媽媽', '煮的']);
  });

  describe('AC6 禁則處理', () => {
    const startsWithForbidden = (line: string) => /^[」!?。，、）]/.test(line);
    const endsWithForbidden = (line: string) => /[「（]$/.test(line);

    it('「」! 不落在行首：「把手舉起來!!」在窄框裡每行都不以禁字開頭', () => {
      // 0.2 ＝ 4 個全形字寬，禁則黏出的「來!!」」（3.24 字寬）放得進去
      const lines = wrapText('「把手舉起來!!」', 0.05, 0.2);

      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) expect(startsWithForbidden(line)).toBe(false);
    });

    it('「 不落在行尾：換行點不會停在開引號後面', () => {
      const lines = wrapText('他說「不要這樣做」', 0.05, 0.16);

      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) expect(endsWithForbidden(line)).toBe(false);
    });

    it('句讀不落在行首：逗號句號跟著前一個字走', () => {
      const lines = wrapText('今天很好，明天更好。', 0.05, 0.16);

      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) expect(startsWithForbidden(line)).toBe(false);
    });

    it('禁則讓位給不溢框：黏合後放不進框寬時照樣斷開，不硬擠', () => {
      // 「來!!」」需要 3.24 字寬，框只有 3.2 字寬：兩條規則衝突時以不溢框為先
      const max_w = 0.16;
      const lines = wrapText('「把手舉起來!!」', 0.05, max_w);

      for (const line of lines) expect(estimateWidth(line, 0.05)).toBeLessThanOrEqual(max_w + 1e-9);
    });

    it('連續標點不會黏成一條超寬的行：。×20 每行仍在框寬內', () => {
      const max_w = 0.16;
      const lines = wrapText('。'.repeat(20), 0.05, max_w);

      for (const line of lines) expect(estimateWidth(line, 0.05)).toBeLessThanOrEqual(max_w + 1e-9);
    });

    it('4 圈 template 的中央文字在預設幾何下每行都合禁則', () => {
      const block = layout(sampleState(4)).find((b) => b.mask === 15)!;

      for (const line of block.lines) {
        expect(startsWithForbidden(line)).toBe(false);
        expect(endsWithForbidden(line)).toBe(false);
      }
    });
  });
});

describe('AC8 fitText 的手動換行是硬換行', () => {
  /** 4 圈預設幾何下 mask 3 的相鄰交集框，是 template 兩行文字的實際容器 */
  function intersectionBox(mask: number) {
    return regionBox(
      circlesFor(4, DEFAULT_RADIUS[4], DEFAULT_OVERLAP[4]),
      mask,
      INTERSECTION_ASPECT,
    )!;
  }

  it('含 \\n 的文字以手動行為準：兩行就是兩行，靠縮字塞進框裡', () => {
    const fitted = fitText('「大家給我\n聽好!」', intersectionBox(3), INTERSECTION_START_FS);

    expect(fitted.lines).toEqual(['「大家給我', '聽好!」']);
    expect(fitted.fs).toBeCloseTo(0.0375, 3);
  });

  it('手動行的最長行與總高都在框內', () => {
    const box = intersectionBox(3);
    const fitted = fitText('「大家給我\n聽好!」', box, INTERSECTION_START_FS);

    expect(Math.max(...fitted.lines.map((l) => estimateWidth(l, fitted.fs)))).toBeLessThanOrEqual(
      box.w + 1e-9,
    );
    expect(fitted.lines.length * fitted.fs * LINE_HEIGHT).toBeLessThanOrEqual(box.h + 1e-9);
  });

  it('縮到下限仍放不下時退回自動折行，維持水平不溢出', () => {
    const box = { cx: 0.5, cy: 0.5, w: 0.05, h: 0.4 };
    const fitted = fitText('「大家給我\n聽好!」', box, INTERSECTION_START_FS);

    expect(fitted.fs).toBeCloseTo(MIN_FS, 10);
    expect(fitted.lines.length).toBeGreaterThan(2);
    for (const line of fitted.lines) {
      expect(estimateWidth(line, fitted.fs)).toBeLessThanOrEqual(box.w + 1e-9);
    }
  });

  it('不含 \\n 的文字照舊自動折行', () => {
    const box = intersectionBox(3);
    const fitted = fitText('要等到天荒地老海枯石爛', box, INTERSECTION_START_FS);

    expect(fitted.lines.length).toBeGreaterThan(1);
    expect(fitted.lines.join('')).toBe('要等到天荒地老海枯石爛');
    for (const line of fitted.lines) {
      expect(estimateWidth(line, fitted.fs)).toBeLessThanOrEqual(box.w + 1e-9);
    }
  });

  // 空行一向不算內容（wrapText 從 01-mvp 起就丟掉空段落），
  // 硬換行沿用同一條：使用者多按的 Enter 不該變成幽靈行、也不該讓字級崩掉
  describe('空行不算手動行', () => {
    const boxes = [
      { name: '寬框', box: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.2 } },
      { name: '窄框', box: { cx: 0.5, cy: 0.5, w: 0.12, h: 0.09 } },
    ];

    for (const { name, box } of boxes) {
      it(`${name}：尾端多按一次 Enter 的排版與不帶尾端 \\n 完全相同`, () => {
        const plain = fitText('大家給我聽好', box, INTERSECTION_START_FS);
        const trailing = fitText('大家給我聽好\n', box, INTERSECTION_START_FS);

        expect(trailing.lines).toEqual(plain.lines);
        expect(trailing.fs).toBeCloseTo(plain.fs, 10);
      });

      it(`${name}：行間空行不產生幽靈行，排版與只有一個 \\n 相同`, () => {
        const single = fitText('「大家\n聽好」', box, INTERSECTION_START_FS);
        const blank = fitText('「大家\n\n聽好」', box, INTERSECTION_START_FS);

        expect(blank.lines).toEqual(single.lines);
        expect(blank.fs).toBeCloseTo(single.fs, 10);
      });

      it(`${name}：只有空白的行也不算手動行`, () => {
        const spaced = fitText('大家\n  \n聽好', box, INTERSECTION_START_FS);

        expect(spaced.lines).toEqual(['大家', '聽好']);
      });
    }

    it('整段只有換行時不輸出任何行', () => {
      const box = { cx: 0.5, cy: 0.5, w: 0.3, h: 0.2 };

      expect(fitText('\n\n', box, INTERSECTION_START_FS).lines).toEqual([]);
    });
  });

  it('手動指定字級的文字含 \\n 時仍逐行輸出', () => {
    const s = { ...defaultState(2), texts: { '3': { t: '拖到\n明天', fs: 0.06 } } };
    const block = layout(s).find((b) => b.mask === 3)!;

    expect(block.fs).toBeCloseTo(0.06, 10);
    expect(block.lines).toEqual(['拖到', '明天']);
  });

  // 手動字級不能縮字，所以硬換行的保證只到「放得下就照使用者的行走」：
  // 放不下時用折行保住水平不溢出（01-mvp AC1）
  describe('手動字級的硬換行', () => {
    const text = '「大家給我\n聽好!」';

    function manualFsBlock(fs: number) {
      const s = { ...defaultState(4), texts: { '3': { t: text, fs } } };
      return layout(s).find((b) => b.mask === 3)!;
    }

    it('每行都放得進框寬時照使用者的行走，不自動折行', () => {
      const block = manualFsBlock(0.03);

      expect(block.lines).toEqual(['「大家給我', '聽好!」']);
      expect(block.fs).toBeCloseTo(0.03, 10);
    });

    it('任一手動行放不進框寬時退回自動折行，每行估寬仍在框內', () => {
      const box = intersectionBox(3);
      const block = manualFsBlock(0.09);

      expect(block.lines.length).toBeGreaterThan(2);
      expect(block.fs).toBeCloseTo(0.09, 10);
      for (const line of block.lines) {
        expect(estimateWidth(line, block.fs)).toBeLessThanOrEqual(box.w + 1e-9);
      }
    });

    // 行尾多打的空白不是內容：拿沒 trim 的寬度去比框寬，會把放得下的手動行拆散
    it('手動行前後的空白不計入框寬，不會因此被拆行', () => {
      // 0.08 下「大家」估寬 0.16 放得進 0.188 的框，但連著前導空白算就是 0.208
      const s = { ...defaultState(4), texts: { '3': { t: '  大家  \n  聽好  ', fs: 0.08 } } };
      const block = layout(s).find((b) => b.mask === 3)!;

      expect(block.lines).toEqual(['大家', '聽好']);
    });

    it('空行不算手動行：尾端多按的 Enter 不產生幽靈行', () => {
      expect(manualFsBlock(0.03).lines).toEqual(
        layout({
          ...defaultState(4),
          texts: { '3': { t: `${text}\n`, fs: 0.03 } },
        }).find((b) => b.mask === 3)!.lines,
      );
    });
  });
});

describe('AC9 括號置中補償 centerShift', () => {
  const fs = 0.04;

  it('行首開引號往左補半格的一半', () => {
    expect(centerShift('「大家給我', fs)).toBeCloseTo(-0.25 * fs, 10);
  });

  it('行尾收引號往右補半格的一半，中間的 ! 不計', () => {
    expect(centerShift('聽好!」', fs)).toBeCloseTo(0.25 * fs, 10);
  });

  it('只有驚嘆號結尾不補償', () => {
    expect(centerShift('舉起來!!', fs)).toBeCloseTo(0, 10);
  });

  it('全形標點與收引號的前後順序都不影響補償量', () => {
    // 使用者打全形標點跟半形一樣常見；標點在括號前或括號後都只是輸入習慣，
    // 看起來偏左的量是一樣的
    expect(centerShift('聽好！」', fs)).toBeCloseTo(0.25 * fs, 10);
    expect(centerShift('聽好」！', fs)).toBeCloseTo(0.25 * fs, 10);
    expect(centerShift('聽好」？', fs)).toBeCloseTo(0.25 * fs, 10);
    expect(centerShift('聽好」：', fs)).toBeCloseTo(0.25 * fs, 10);
    expect(centerShift('聽好」；', fs)).toBeCloseTo(0.25 * fs, 10);
  });

  it('頭尾成對的引號互相抵銷', () => {
    expect(centerShift('「他說」', fs)).toBeCloseTo(0, 10);
  });

  it('沒有標點的行不補償', () => {
    expect(centerShift('把手', fs)).toBeCloseTo(0, 10);
  });

  it('補償量隨字級等比放大', () => {
    expect(centerShift('聽好!」', 2 * fs)).toBeCloseTo(2 * centerShift('聽好!」', fs), 10);
  });
});

describe('circlesFor', () => {
  it('2 圈水平並排、圓心距等於 overlap × r', () => {
    const cs = circlesFor(2, 0.3, 1.2);

    expect(cs).toHaveLength(2);
    expect(cs[0]!.y).toBeCloseTo(cs[1]!.y, 10);
    expect(Math.hypot(cs[1]!.x - cs[0]!.x, cs[1]!.y - cs[0]!.y)).toBeCloseTo(1.2 * 0.3, 10);
  });

  it('3 圈正三角排列：三邊等長', () => {
    const cs = circlesFor(3, 0.29, 1.15);
    const d = (a: number, b: number) => Math.hypot(cs[a]!.x - cs[b]!.x, cs[a]!.y - cs[b]!.y);

    expect(cs).toHaveLength(3);
    expect(d(0, 1)).toBeCloseTo(d(1, 2), 8);
    expect(d(1, 2)).toBeCloseTo(d(0, 2), 8);
  });

  it('4 圈為 2×2 花瓣：四個相鄰邊等長，對角較遠', () => {
    const cs = circlesFor(4, 0.27, 1.15);
    const d = (a: number, b: number) => Math.hypot(cs[a]!.x - cs[b]!.x, cs[a]!.y - cs[b]!.y);

    expect(cs).toHaveLength(4);
    expect(d(0, 1)).toBeCloseTo(d(2, 3), 8); // 上下兩條水平邊
    expect(d(0, 2)).toBeCloseTo(d(1, 3), 8); // 左右兩條垂直邊
    expect(d(0, 3)).toBeGreaterThan(d(0, 1)); // 對角
  });
});

describe('regionBox', () => {
  it('區域不存在時回傳 null：兩圓完全分離就沒有交集區', () => {
    const cs = circlesFor(2, 0.2, 1.6);
    const separated = [
      { ...cs[0]!, x: 0.1 },
      { ...cs[1]!, x: 0.9 },
    ];

    expect(regionBox(separated, 0b11, 1.3)).toBeNull();
  });

  it('文字框中心落在該區域內', () => {
    const cs = circlesFor(3, 0.29, 1.15);
    const box = regionBox(cs, 0b111, 1.3);

    expect(box).not.toBeNull();
    const inside = cs.map((c) => Math.hypot(box!.cx - c.x, box!.cy - c.y) <= c.r);
    expect(inside).toEqual([true, true, true]);
  });

  it('文字框四角都仍在該區域內（不溢出到鄰區）', () => {
    const cs = circlesFor(3, 0.29, 1.15);
    const box = regionBox(cs, 0b011, 1.3)!;
    const mask_at = (x: number, y: number) =>
      cs.reduce((m, c, i) => (Math.hypot(x - c.x, y - c.y) <= c.r ? m | (1 << i) : m), 0);

    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        expect(mask_at(box.cx + (sx * box.w) / 2, box.cy + (sy * box.h) / 2)).toBe(0b011);
  });
});

describe('layout：AC1 不溢框', () => {
  /** prototype 已驗證過的範例狀態，是版面的視覺對照組 */
  const reference_states: Record<string, VennState> = {
    '2 圈 工程師／設計師': stateWith(2, { '1': '工程師', '2': '設計師', '3': '會寫 CSS' }),
    '3 圈 快好便宜': stateWith(3, {
      '1': '快',
      '2': '好',
      '4': '便宜',
      '3': '要錢',
      '5': '醜',
      '6': '要等',
      '7': '不存在',
    }),
    '3 圈 快好便宜（長句）': stateWith(3, {
      '1': '快',
      '2': '好',
      '4': '便宜',
      '3': '要花很多錢',
      '5': '醜到不行',
      '6': '要等到天荒地老',
      '7': '不存在',
    }),
    '4 圈 找餐廳': stateWith(4, {
      '1': '便宜',
      '2': '好吃',
      '4': '份量大',
      '8': '離家近',
      '3': '排隊',
      '5': '難吃',
      '10': '貴',
      '12': '學餐',
      // 三重交集區只放得下短字，見 02 spec
      '7': '好貴',
      '11': '好遠',
      '13': '難吃',
      '14': '不飽',
      '15': '媽媽煮的',
    }),
  };

  for (const [name, state] of Object.entries(reference_states)) {
    it(`${name}：每個槽都輸出且文字不溢出框`, () => {
      const blocks = layout(state);

      // 這幾組參數下每個槽的區域都存在，避免空陣列讓下面的迴圈空轉通過
      expect(blocks.map((b) => b.mask).sort((a, b) => a - b)).toEqual(
        [...SLOT_MASKS[state.n]].sort((a, b) => a - b),
      );
      for (const block of blocks) {
        const longest = Math.max(...block.lines.map((l) => estimateWidth(l, block.fs)));
        expect(longest).toBeLessThanOrEqual(block.box.w + 1e-9);
        expect(block.lines.length * block.fs * LINE_HEIGHT).toBeLessThanOrEqual(block.box.h + 1e-9);
      }
    });
  }

  it('只要縮字有成功收斂（字級高於下限），就一定不溢框', () => {
    const texts = ['快', '會寫 CSS', '要等到天荒地老', 'Design Systems', '不存在的東西'];
    let checked = 0;

    for (const n of [2, 3, 4] as CircleCount[]) {
      for (const text of texts) {
        for (const block of layout(fillAllSlots(n, text))) {
          if (block.fs <= MIN_FS) continue; // 觸底的行為另行規範，見下方測試
          const longest = Math.max(...block.lines.map((l) => estimateWidth(l, block.fs)));
          expect(longest).toBeLessThanOrEqual(block.box.w + 1e-9);
          expect(block.lines.length * block.fs * LINE_HEIGHT).toBeLessThanOrEqual(
            block.box.h + 1e-9,
          );
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('字級觸底時仍保證水平不溢出：超寬單字與禁則黏合都會被斷開', () => {
    const texts = [
      'Supercalifragilisticexpialidocious',
      '他說「我不去」，我說「好」。',
      '。'.repeat(20),
      '「把手舉起來!!」',
    ];
    let checked = 0;

    for (const n of [2, 3, 4] as CircleCount[]) {
      for (const text of texts) {
        for (const block of layout(fillAllSlots(n, text))) {
          const longest = Math.max(...block.lines.map((l) => estimateWidth(l, block.fs)));
          expect(longest, `n=${n} mask=${block.mask} text=${text}`).toBeLessThanOrEqual(
            block.box.w + 1e-9,
          );
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('超長文字先換行再縮字：字級變小、行數變多，仍不溢框', () => {
    const short = layout(stateWith(3, { '3': '要錢' })).find((b) => b.mask === 3)!;
    const long = layout(stateWith(3, { '3': '要花很多很多很多的錢才買得到' })).find(
      (b) => b.mask === 3,
    )!;

    expect(long.fs).toBeLessThan(short.fs);
    expect(long.lines.length).toBeGreaterThan(short.lines.length);
    expect(long.lines.length * long.fs * LINE_HEIGHT).toBeLessThanOrEqual(long.box.h + 1e-9);
  });

  it('文字長到每個槽都塞不下時，字級停在畫布 2.5%，不會再往下縮', () => {
    const blocks = layout(fillAllSlots(4, '字'.repeat(80)));

    expect(blocks).not.toHaveLength(0);
    for (const block of blocks) expect(block.fs).toBeCloseTo(0.025, 10);
  });
});

describe('layout：AC1 字級與槽的存在性', () => {
  it('交集起始字級大於單圈標籤起始字級的 0.5 倍', () => {
    expect(INTERSECTION_START_FS).toBeGreaterThan(LABEL_START_FS * 0.5);
  });

  it('交集框存在時字級不低於下限', () => {
    const blocks = layout(fillAllSlots(4, '要花很多很多很多的錢才買得到這個東西'));
    const intersections = blocks.filter((b) => b.kind === 'intersection');

    expect(intersections.length).toBeGreaterThan(0);
    for (const block of intersections) expect(block.fs).toBeGreaterThanOrEqual(MIN_FS);
  });

  it('overlap 拉到最大使 4 圈中央區消失時，該槽不輸出', () => {
    // 2×2 花瓣的中央四重區在 overlap > √2 時消失（圓心到畫布中心的距離超過 r）
    const s: VennState = { ...fillAllSlots(4, '甲'), overlap: 1.6 };
    const masks = layout(s).map((b) => b.mask);

    expect(masks).toContain(1);
    expect(masks).not.toContain(15);
  });

  it('空槽不輸出任何區塊', () => {
    const s = stateWith(3, { '1': '快' });

    expect(layout(s).map((b) => b.mask)).toEqual([1]);
  });

  it('AC7 三重槽放 2 個全形字不觸字級下限', () => {
    const s = { ...sampleState(4), texts: { '7': { t: '甲乙' }, '14': { t: '甲乙' } } };

    for (const block of layout(s)) expect(block.fs).toBeGreaterThan(MIN_FS);
  });

  it('手動 fs 與 dx/dy 會被採用，不被自動排版覆寫', () => {
    const s = defaultState(2);
    s.texts = { '3': { t: '交集', fs: 0.09, dx: 0.05, dy: -0.02 } };
    const block = layout(s).find((b) => b.mask === 3)!;

    expect(block.fs).toBeCloseTo(0.09, 10);
    expect(block.cx).toBeCloseTo(block.box.cx + 0.05, 10);
    expect(block.cy).toBeCloseTo(block.box.cy - 0.02, 10);
  });

  it('排版與畫布尺寸無關：size 改變不影響單位空間結果', () => {
    const small = layout({ ...fillAllSlots(3, '要等到天荒地老'), size: 800 });
    const large = layout({ ...fillAllSlots(3, '要等到天荒地老'), size: 1600 });

    expect(small.map((b) => [b.mask, b.fs, b.lines])).toEqual(
      large.map((b) => [b.mask, b.fs, b.lines]),
    );
  });
});
