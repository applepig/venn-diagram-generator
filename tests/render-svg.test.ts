import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { mixColors, regionColor, relativeLuminance, renderSvg } from '../engine/render-svg';
import { circlesFor, layout, maskAt } from '../engine/layout';
import { PALETTE, defaultState } from '../engine/defaults';
import type { VennStyle } from '../engine/types';
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

describe('renderSvg：AC5 點選定位用的 data-region', () => {
  it('有文字的槽都帶 data-region，供面板點選定位', () => {
    const svg = renderSvg(threeCircle('flat'));

    for (const mask of [1, 2, 4, 3, 5, 6, 7]) {
      expect(svg).toContain(`data-region="${mask}"`);
    }
  });

  it('空槽不畫也不出 data-region，只能從左欄列表進入', () => {
    const s = defaultState(2);
    s.texts = { '1': { t: '工程師' } };

    const svg = renderSvg(s);
    expect(svg).toContain('data-region="1"');
    expect(svg).not.toContain('data-region="2"');
    expect(svg).not.toContain('data-region="3"');
  });
});

describe('renderSvg：AC6 區域填色 override', () => {
  function twoCircle(style: VennStyle, fill?: string) {
    return {
      ...defaultState(2),
      style,
      texts: { '1': { t: '甲' }, '2': { t: '乙' }, '3': { t: '交集', ...(fill ? { fill } : {}) } },
    };
  }

  it('flat：該區改用 override 色，原本的自動混色不再出現', () => {
    const svg = renderSvg(twoCircle('flat', '#123456'));

    expect(svg).toContain('fill="#123456"');
    expect(svg).not.toContain(mixColors([PALETTE[0]!, PALETTE[1]!]));
  });

  it('flat：沒帶 fill 的區域仍是自動混色', () => {
    const svg = renderSvg(twoCircle('flat'));

    expect(svg).toContain(`fill="${mixColors([PALETTE[0]!, PALETTE[1]!])}"`);
  });

  it('translucent 與 outline 忽略 fill', () => {
    expect(renderSvg(twoCircle('translucent', '#123456'))).not.toContain('#123456');
    expect(renderSvg(twoCircle('outline', '#123456'))).not.toContain('#123456');
  });

  it('AC7 flat 有 override 時每個圓補一圈黑描邊，寬度是畫布的 0.4%', () => {
    const svg = renderSvg({ ...twoCircle('flat', '#ffffff'), size: 1000 });
    const rings = [...svg.matchAll(/<circle [^>]*fill="none"[^>]*>/g)].map((m) => m[0]);

    expect(rings).toHaveLength(2);
    for (const ring of rings) {
      expect(ring).toContain('stroke="#000000"');
      expect(ring).toContain('stroke-width="4"');
    }
    expect(renderPng(svg).length).toBeGreaterThan(1000); // 補上的輪廓沒有破壞 SVG
  });

  it('AC7 沒有 override 的 flat 圖不畫圓輪廓', () => {
    expect(renderSvg(twoCircle('flat'))).not.toContain('fill="none"');
  });

  it('AC7 translucent 即使帶 fill 也不畫圓輪廓', () => {
    expect(renderSvg(twoCircle('translucent', '#ffffff'))).not.toContain('fill="none"');
  });
});

describe('renderSvg：AC8 flat 的字色依區域亮度取黑白', () => {
  function groupTag(svg: string, mask: number): string {
    return svg.match(new RegExp(`<g data-region="${mask}"[^>]*>`))![0]!;
  }

  function flatWithFill(fill: string) {
    return { ...defaultState(2), style: 'flat' as const, texts: { '3': { t: '交集', fill } } };
  }

  it('淺色區（#ffffff，亮度 1.0）用黑字且不加光暈', () => {
    const tag = groupTag(renderSvg(flatWithFill('#ffffff')), 3);

    expect(tag).toContain('fill="#000000"');
    expect(tag).not.toContain('filter="url(#glow)"');
  });

  it('深色區（#e6a92e，亮度 0.454）維持白字＋黑光暈', () => {
    const tag = groupTag(renderSvg(flatWithFill('#e6a92e')), 3);

    expect(tag).toContain('fill="#ffffff"');
    expect(tag).toContain('filter="url(#glow)"');
  });

  it('沒有 override 的 flat 區（自動混色）維持白字＋黑光暈', () => {
    const state = { ...defaultState(2), style: 'flat' as const, texts: { '3': { t: '交集' } } };

    expect(groupTag(renderSvg(state), 3)).toContain('filter="url(#glow)"');
  });

  it('translucent 帶淺色 fill 時字色不變（fill 不生效）', () => {
    const state = {
      ...defaultState(2),
      style: 'translucent' as const,
      texts: { '3': { t: '交集', fill: '#ffffff' } },
    };
    const tag = groupTag(renderSvg(state), 3);

    expect(tag).toContain('fill="#ffffff"');
    expect(tag).toContain('filter="url(#glow)"');
  });

  it('outline 維持黑字無光暈', () => {
    const state = { ...defaultState(2), style: 'outline' as const, texts: { '3': { t: '交集' } } };
    const tag = groupTag(renderSvg(state), 3);

    expect(tag).toContain('fill="#000000"');
    expect(tag).not.toContain('filter=');
  });
});

describe('relativeLuminance', () => {
  it('黑是 0、白是 1', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 10);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });

  it('PALETTE 最亮的 #e6a92e 是 0.454', () => {
    expect(relativeLuminance('#e6a92e')).toBeCloseTo(0.454, 3);
  });

  it('AC8 前提：PALETTE 與其所有 mixColors 組合都在 0.6 門檻以下（所以全部維持白字）', () => {
    const too_bright: string[] = [];
    for (let mask = 1; mask < 1 << PALETTE.length; mask++) {
      const members = PALETTE.filter((_, i) => mask & (1 << i));
      const color = mixColors(members);
      if (relativeLuminance(color) >= 0.6) too_bright.push(`${color} (mask ${mask})`);
    }

    expect(too_bright).toEqual([]);
  });
});

describe('regionColor：AC2 該區在目前樣式下的實際顏色', () => {
  const base = { ...defaultState(2), texts: { '3': { t: '交集' } } };

  it('flat 交集區沒 fill 時是自動混色，有 fill 時是 override', () => {
    const flat = { ...base, style: 'flat' as const };

    expect(regionColor(flat, 3)).toBe(mixColors([PALETTE[0]!, PALETTE[1]!]));
    expect(regionColor({ ...flat, texts: { '3': { t: '交集', fill: '#abcdef' } } }, 3)).toBe(
      '#abcdef',
    );
  });

  it('單圈列在任何樣式下都是該圈的顏色', () => {
    for (const style of STYLES) {
      expect(regionColor({ ...base, style }, 1)).toBe(PALETTE[0]);
      expect(regionColor({ ...base, style }, 2)).toBe(PALETTE[1]);
    }
  });

  it('outline 沒有填色，交集區取背景色', () => {
    expect(regionColor({ ...base, style: 'outline', bg: '#101010' }, 3)).toBe('#101010');
  });

  it('translucent 不透明時交集區等於最上層那圈的顏色（依圈序 source-over）', () => {
    const state = { ...base, style: 'translucent' as const, opacity: 1 };

    expect(regionColor(state, 3)).toBe(PALETTE[1]);
  });

  it('translucent 全透明時交集區等於背景色', () => {
    const state = { ...base, style: 'translucent' as const, opacity: 0, bg: '#101010' };

    expect(regionColor(state, 3)).toBe('#101010');
  });

  it('translucent 半透明時是背景與成員色依序合成的結果', () => {
    const state = {
      ...base,
      style: 'translucent' as const,
      opacity: 0.5,
      bg: '#000000',
      colors: ['#ffffff', '#000000'],
    };

    // 0.5*255 + 0.5*0 = 127.5 → 再疊一層黑：0.5*0 + 0.5*127.5 = 63.75 → #404040
    expect(regionColor(state, 3)).toBe('#404040');
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

describe('renderSvg：右下角浮水印', () => {
  const watermarkTag = (svg: string) =>
    svg.match(/<text [^>]*text-anchor="end"[^>]*>venn\.applepig\.net<\/text>/)![0];

  for (const style of STYLES) {
    it(`${style} 都帶浮水印`, () => {
      expect(renderSvg(threeCircle(style))).toContain('>venn.applepig.net<');
    });
  }

  it('位置貼齊右下角，並隨 size 等比縮放', () => {
    for (const size of [800, 1600]) {
      const tag = watermarkTag(renderSvg({ ...defaultState(2), size }));
      const x = Number(tag.match(/ x="([\d.]+)"/)![1]);
      const y = Number(tag.match(/ y="([\d.]+)"/)![1]);

      // 落在畫布內，且距右下邊界不超過 5% 畫布寬
      expect(x).toBeLessThan(size);
      expect(y).toBeLessThan(size);
      expect(size - x).toBeLessThan(size * 0.05);
      expect(size - y).toBeLessThan(size * 0.05);
    }
  });

  it('深色背景轉白字，淺色背景轉黑字', () => {
    expect(watermarkTag(renderSvg({ ...defaultState(2), bg: '#111111' }))).toContain(
      'fill="#ffffff"',
    );
    expect(watermarkTag(renderSvg({ ...defaultState(2), bg: '#fafafa' }))).toContain(
      'fill="#000000"',
    );
  });

  it('不帶 data-region，畫布點選不會把它當成可編輯的槽', () => {
    expect(watermarkTag(renderSvg(threeCircle('flat')))).not.toContain('data-region');
  });
});

describe('renderSvg：合成用的圖層開關', () => {
  const BG_RECT = /<rect width="100%" height="100%"/;

  it('預設兩層都畫', () => {
    const svg = renderSvg({ ...defaultState(2), bg: '#123456' });

    expect(svg).toMatch(BG_RECT);
    expect(svg).toContain('venn.applepig.net');
  });

  it('background: false 不畫背景 rect，底圖才透得出來', () => {
    const svg = renderSvg({ ...defaultState(2), bg: '#123456' }, { background: false });

    expect(svg).not.toMatch(BG_RECT);
    expect(svg).not.toContain('#123456');
  });

  it('watermark: false 不畫浮水印', () => {
    expect(renderSvg(defaultState(2), { watermark: false })).not.toContain('venn.applepig.net');
  });

  it('關掉圖層不影響圓與文字', () => {
    const state = { ...threeCircle('flat'), bg: '#123456' };
    const full = renderSvg(state);
    const stripped = renderSvg(state, { background: false, watermark: false });

    // 剝掉兩層之後，剩下的內容是完整版的子集
    for (const text of ['快', '好', '便宜', '不存在']) expect(stripped).toContain(`>${text}<`);
    expect(stripped.length).toBeLessThan(full.length);
    expect(full).toContain(stripped.replace(/^<svg[^>]*><defs>.*?<\/defs>/, '').replace(/<\/svg>$/, ''));
  });
});
