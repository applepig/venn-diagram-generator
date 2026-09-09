import { describe, expect, it } from 'vitest';
import { circlesFor, estimateWidth, layout, regionBox, wrapText } from '../shared/layout';
import {
  INTERSECTION_START_FS,
  LABEL_START_FS,
  LINE_HEIGHT,
  MIN_FS,
  SLOT_MASKS,
  defaultState,
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

  it('字級觸底時仍保證水平不溢出：超寬單字會被硬斷', () => {
    for (const n of [2, 3, 4] as CircleCount[]) {
      for (const block of layout(fillAllSlots(n, 'Supercalifragilisticexpialidocious'))) {
        const longest = Math.max(...block.lines.map((l) => estimateWidth(l, block.fs)));
        expect(longest).toBeLessThanOrEqual(block.box.w + 1e-9);
      }
    }
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

  it('字級不會低於下限', () => {
    for (const block of layout(fillAllSlots(4, '一二三四五六七八九十一二三四五六七八九十'))) {
      expect(block.fs).toBeGreaterThanOrEqual(MIN_FS);
    }
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

  it('空槽預設不輸出，editor 模式才給 placeholder', () => {
    const s = stateWith(3, { '1': '快' });

    expect(layout(s).map((b) => b.mask)).toEqual([1]);
    const editor_masks = layout(s, { editor: true }).map((b) => b.mask);
    expect(editor_masks).toContain(2);
    expect(layout(s, { editor: true }).find((b) => b.mask === 2)!.placeholder).toBe(true);
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
