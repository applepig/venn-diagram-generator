import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { mixColors, renderSvg } from '../shared/render-svg';
import { circlesFor, layout, maskAt } from '../shared/layout';
import { EDITOR_PLACEHOLDER, defaultState } from '../shared/defaults';
import type { VennStyle } from '../shared/types';
import { FONT_FILE } from './helpers/font';

const STYLES: VennStyle[] = ['translucent', 'flat', 'outline'];

function threeCircle(style: VennStyle) {
  return {
    ...defaultState(3),
    style,
    texts: {
      '1': { t: '快' },
      '2': { t: '好' },
      '4': { t: '便宜' },
      '3': { t: '要錢' },
      '5': { t: '醜' },
      '6': { t: '要等' },
      '7': { t: '不存在' },
    },
  };
}

/** 唯一能證明「合法 SVG」的方式：讓真的 renderer 吃下去 */
function renderPng(svg: string) {
  return new Resvg(svg, {
    font: { fontFiles: [FONT_FILE], loadSystemFonts: false, defaultFontFamily: 'Noto Sans TC' },
  })
    .render()
    .asPng();
}

describe('renderSvg：AC2 三種 style 都產出合法 SVG', () => {
  for (const style of STYLES) {
    it(`${style} 產出的 SVG 帶正確畫布尺寸且 resvg 渲染得出來`, () => {
      const svg = renderSvg({ ...threeCircle(style), size: 800 });

      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('width="800"');
      expect(svg).toContain('height="800"');
      expect(renderPng(svg).length).toBeGreaterThan(1000);
    });

    it(`${style} 含全部輸入文字`, () => {
      const svg = renderSvg(threeCircle(style));

      for (const text of ['快', '好', '便宜', '要錢', '醜', '要等', '不存在']) {
        expect(svg).toContain(`>${text}<`);
      }
    });
  }
});

describe('renderSvg：flat 平面填色', () => {
  it('相鄰區域的接縫不會透出背景色', () => {
    const size = 800;
    const state = { ...defaultState(4), style: 'flat' as const, size, texts: {} };
    const circles = circlesFor(4, state.radius, state.overlap);
    const pixels = new Resvg(renderSvg(state)).render().pixels;

    // 接縫像素只能是兩側區域色的混合，所以不得亮過「鄰近區域裡最亮的那個色」；
    // 更亮就代表背景（#fafafa）從兩條路徑之間漏了出來
    const sum = (hex: string) =>
      [1, 3, 5].reduce((acc, i) => acc + parseInt(hex.slice(i, i + 2), 16), 0);
    const brightness_of = new Map<number, number>();
    for (let mask = 1; mask < 16; mask++) {
      const members = [0, 1, 2, 3].filter((i) => mask & (1 << i));
      brightness_of.set(mask, sum(mixColors(members.map((i) => state.colors[i]!))));
    }
    brightness_of.set(0, sum(state.bg));
    const AA_TOLERANCE = 3 * 4;

    const EDGE = 2 / size;
    const too_bright: string[] = [];
    let seam_pixels = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const ux = (x + 0.5) / size;
        const uy = (y + 0.5) / size;
        const dist = circles.map((c) => Math.hypot(ux - c.x, uy - c.y));
        const on_edge = circles.map((c, i) => Math.abs(dist[i]! - c.r) < EDGE);
        // 兩條圓周交會的角落有 3 個以上區域參與混色，「接縫只有兩側」的模型不適用
        if (on_edge.filter(Boolean).length !== 1) continue;
        // 聯集外緣本來就該與背景混色；只看「壓在別的圓內部」的接縫
        if (!circles.some((c, i) => !on_edge[i] && dist[i]! < c.r - EDGE)) continue;

        // 沿著它所在圓周的法線往內外各探一點，取得這條接縫兩側的區域＝合法的顏色來源
        let limit = 0;
        circles.forEach((c, i) => {
          if (!on_edge[i]) return;
          const ux_dir = (ux - c.x) / dist[i]!;
          const uy_dir = (uy - c.y) / dist[i]!;
          for (const offset of [-3 / size, 3 / size]) {
            const side = maskAt(
              circles,
              c.x + (c.r + offset) * ux_dir,
              c.y + (c.r + offset) * uy_dir,
            );
            limit = Math.max(limit, brightness_of.get(side)!);
          }
        });
        limit += AA_TOLERANCE;

        seam_pixels++;
        const o = (y * size + x) * 4;
        const brightness = pixels[o]! + pixels[o + 1]! + pixels[o + 2]!;
        if (brightness > limit) too_bright.push(`(${x},${y}) 亮度 ${brightness} > ${limit}`);
      }
    }

    expect(seam_pixels).toBeGreaterThan(500); // 前提：真的掃到接縫，否則本測試無意義
    expect(too_bright.slice(0, 5)).toEqual([]);
  });
});

describe('renderSvg：XML escape', () => {
  it('`<` 與 `&` 被 escape，不會破壞文件，resvg 仍渲染得出來', () => {
    const s = defaultState(2);
    s.texts = { '1': { t: 'a < b' }, '2': { t: 'R&D' }, '3': { t: '</svg>' } };
    const svg = renderSvg(s);

    expect(svg).toContain('a &lt; b');
    expect(svg).toContain('R&amp;D');
    expect(svg).not.toContain('>a < b<');
    // 若 escape 失敗，這段會提前關掉 svg 元素、後面的內容變成殘缺 XML
    expect(svg.match(/<\/svg>/g)).toHaveLength(1);
    expect(renderPng(svg).length).toBeGreaterThan(1000);
  });

  it('雙引號與單引號不會破壞屬性', () => {
    const s = defaultState(2);
    s.texts = { '3': { t: `he said "hi" it's fine` } };
    const svg = renderSvg(s);

    expect(renderPng(svg).length).toBeGreaterThan(1000);
  });
});

describe('renderSvg：AC9 括號置中補償', () => {
  const size = 1200;

  function textXs(svg: string, mask: number): number[] {
    const group = svg.match(new RegExp(`<g data-region="${mask}"[^>]*>(.*?)</g>`))![1]!;
    return [...group.matchAll(/<text x="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
  }

  it('行首「與行尾」的行各往反方向挪半格的一半', () => {
    const state = { ...defaultState(2), size, texts: { '3': { t: '「大家給我\n聽好!」' } } };
    const block = layout(state).find((b) => b.mask === 3)!;
    const xs = textXs(renderSvg(state), 3);

    expect(block.lines).toEqual(['「大家給我', '聽好!」']);
    expect(xs).toHaveLength(2);
    expect(xs[0]!).toBeCloseTo((block.cx - 0.25 * block.fs) * size, 6);
    expect(xs[1]!).toBeCloseTo((block.cx + 0.25 * block.fs) * size, 6);
    expect(xs[1]! - xs[0]!).toBeCloseTo(0.5 * block.fs * size, 6);
  });

  it('不帶括號的文字每行都停在區域中心，不被挪動', () => {
    const state = { ...defaultState(2), size, texts: { '3': { t: '把手\n舉起來!!' } } };
    const block = layout(state).find((b) => b.mask === 3)!;
    const xs = textXs(renderSvg(state), 3);

    expect(xs).toHaveLength(2);
    for (const x of xs) expect(x).toBeCloseTo(block.cx * size, 6);
  });
});

describe('renderSvg：編輯器模式', () => {
  it('每個文字槽帶 data-region，供編輯器點選定位', () => {
    const svg = renderSvg(threeCircle('flat'), { editor: true });

    for (const mask of [1, 2, 4, 3, 5, 6, 7]) {
      expect(svg).toContain(`data-region="${mask}"`);
    }
  });

  it('空槽：輸出模式不畫，編輯器模式顯示 placeholder', () => {
    const s = defaultState(2);
    s.texts = { '1': { t: '工程師' } };

    // placeholder 可能被換行拆開，所以比對去掉標籤後的純文字
    const textOf = (svg: string) => svg.replace(/<[^>]*>/g, '');

    const output = renderSvg(s);
    expect(output).not.toContain('data-placeholder');
    expect(textOf(output)).not.toContain(EDITOR_PLACEHOLDER.slice(0, 2));
    expect(output).not.toContain('data-region="2"');

    const editor = renderSvg(s, { editor: true });
    expect(editor).toContain('data-placeholder="1"');
    expect(textOf(editor)).toContain(EDITOR_PLACEHOLDER.slice(0, 2));
    expect(editor).toContain('data-region="2"');
  });
});

describe('renderSvg：style 差異', () => {
  it('translucent 用 fill-opacity 疊圓，outline 用黑框無填色', () => {
    const translucent = renderSvg({ ...defaultState(2), style: 'translucent', opacity: 0.6 });
    const outline = renderSvg({ ...defaultState(2), style: 'outline' });

    expect(translucent).toContain('fill-opacity="0.6"');
    expect(outline).toContain('fill="none"');
    expect(outline).not.toContain('fill-opacity="0.6"');
  });

  it('opacity 改變會反映在輸出上', () => {
    const a = renderSvg({ ...defaultState(2), style: 'translucent', opacity: 0.3 });

    expect(a).toContain('fill-opacity="0.3"');
  });

  it('背景色沿用 state.bg', () => {
    expect(renderSvg({ ...defaultState(2), bg: '#123456' })).toContain('#123456');
  });

  it('每圈顏色沿用 state.colors', () => {
    const svg = renderSvg({ ...defaultState(3), colors: ['#111111', '#222222', '#333333'] });

    for (const c of ['#111111', '#222222', '#333333']) expect(svg).toContain(c);
  });
});
