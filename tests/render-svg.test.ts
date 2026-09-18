import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { mixColors, regionColor, relativeLuminance, renderSvg } from '../engine/render-svg';
import { layout, maskAt } from '../engine/layout';
import { circlesForRender } from '../engine/title';
import { circlesFor, circlesForState } from '../engine/shapes/index';
import { nextStateForShape } from '../content/next-state';
import { PALETTE } from '../content/palette';
import { defaultState, initialState, sampleState, templateTexts } from '../content/state-presets';
import type { Arrangement, CircleCount, VennState, VennStyle } from '../engine/types';
import { FONT_FILE } from './helpers/font';
import { decodePng, pngPixel, pngSize } from './helpers/png';

const STYLES: VennStyle[] = ['translucent', 'flat', 'outline'];

/** 浮水印文字由呼叫端提供，測試用假站名就好：engine 不該知道任何真實站名 */
const WATERMARK = 'venn.example.test';

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

function hexRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * 每個區域「畫出來」是什麼顏色：點陣化後，在每一區離所有圓周最遠的那個點取樣。
 * 從像素驗而不是讀 SVG 屬性，填色寫在 path 上還是掛在群組不透明度上都測得到同一件事。
 */
function renderedRegionColors(state: VennState): Map<number, [number, number, number]> {
  const size = state.size;
  const circles = circlesForRender(state);
  const png = decodePng(Buffer.from(renderPng(renderSvg(state))));

  const best = new Map<number, { margin: number; x: number; y: number }>();
  for (let x = 0; x < size; x += 2) {
    for (let y = 0; y < size; y += 2) {
      const ux = (x + 0.5) / size;
      const uy = (y + 0.5) / size;
      const mask = maskAt(circles, ux, uy);
      if (mask === 0) continue;
      const margin = Math.min(...circles.map((c) => Math.abs(Math.hypot(ux - c.x, uy - c.y) - c.r)));
      const current = best.get(mask);
      if (!current || margin > current.margin) best.set(mask, { margin, x, y });
    }
  }

  const colors = new Map<number, [number, number, number]>();
  for (const [mask, { margin, x, y }] of best) {
    if (margin * size < 3) continue; // 太窄的區域取不到不受抗鋸齒影響的點
    const [r, g, b] = pngPixel(png, x, y);
    colors.set(mask, [r, g, b]);
  }
  return colors;
}

/** 點陣化的取樣值與預期色比對；±1 容差留給 alpha 合成與我們自己四捨五入的落差 */
function expectColorNear(actual: [number, number, number], expected_hex: string, label: string) {
  hexRgb(expected_hex).forEach((v, ch) => {
    expect(Math.abs(actual[ch]! - v), `${label} 通道 ${ch}`).toBeLessThanOrEqual(1);
  });
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
    const circles = circlesFor('ring', 4, state.radius, state.overlap);
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

/**
 * 文字的垂直位置。這條只能由真的 renderer 來判：SVG 字串裡的 y 是基線，
 * 「看起來有沒有置中」要看點陣化後的墨跡落在哪裡——`dominant-baseline="central"`
 * 產出的字串一樣「合法」，畫出來卻整體偏下。
 */
describe('renderSvg：文字的視覺垂直置中', () => {
  const size = 800;

  /** 深底白字，畫面上只有一段文字，所以整張掃白點就是那段字的墨跡 */
  function oneTextState(text: string) {
    return {
      ...defaultState(2),
      style: 'flat' as const,
      size,
      bg: '#101010',
      colors: ['#123456', '#225533'],
      texts: { '3': { t: text } },
    };
  }

  function inkCenterY(png: Uint8Array): number {
    const img = decodePng(Buffer.from(png));
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const [r, g, b] = pngPixel(img, x, y);
        if (r > 235 && g > 235 && b > 235) {
          if (top < 0) top = y;
          bottom = y;
          break;
        }
      }
    }
    expect(top, '掃不到白字，這個測試就沒有意義').toBeGreaterThan(0);
    return (top + bottom) / 2;
  }

  // 大寫拉丁與漢字的墨跡框不同高，兩種都要落在中心上
  for (const text of ['ABC', '中文字']) {
    it(`「${text}」的墨跡中心落在區塊中心上`, () => {
      const state = oneTextState(text);
      const block = layout(state).find((b) => b.mask === 3)!;

      const offset = inkCenterY(renderPng(renderSvg(state))) - block.cy * size;

      // 容差 5% 字級：抗鋸齒與字型本身的上下不對稱都在這個量級之內
      expect(Math.abs(offset), `偏移 ${offset}px`).toBeLessThan(0.05 * block.fs * size);
    });
  }

  it('多行文字整組對稱於區塊中心', () => {
    const state = oneTextState('上面一行\n下面一行');
    const block = layout(state).find((b) => b.mask === 3)!;

    const offset = inkCenterY(renderPng(renderSvg(state))) - block.cy * size;

    expect(block.lines).toHaveLength(2);
    expect(Math.abs(offset), `偏移 ${offset}px`).toBeLessThan(0.05 * block.fs * size);
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

  /**
   * 15 AC4：原本 flat 一旦有 `fill` override 就自動補一圈黑框（舊 AC7）。
   * 那個隱藏行為已從 spec 移除——要框線請開 `stroke_width`，所以這兩條斷言跟著反過來。
   */
  it('flat 有 override 也不自動描邊', () => {
    expect(renderSvg(twoCircle('flat', '#ffffff'))).not.toContain('fill="none"');
  });

  it('沒有 override 的 flat 圖同樣不畫圓輪廓', () => {
    expect(renderSvg(twoCircle('flat'))).not.toContain('fill="none"');
  });

  it('translucent 即使帶 fill 也不畫圓輪廓', () => {
    expect(renderSvg(twoCircle('translucent', '#ffffff'))).not.toContain('fill="none"');
  });
});

/**
 * 15 AC1／AC3：框線是幾何選項，三種樣式共用同一條畫框線的路徑。
 * 寬度缺席時依樣式取預設（outline 0.006，flat 與 translucent 0）。
 */
describe('renderSvg：15 框線選項', () => {
  const rings = (svg: string) => [...svg.matchAll(/<circle [^>]*fill="none"[^>]*>/g)].map((m) => m[0]);

  function twoCircle(style: VennStyle, stroke: Partial<VennState> = {}): VennState {
    return { ...defaultState(2), style, texts: { '1': { t: '甲' }, '2': { t: '乙' } }, ...stroke };
  }

  it('outline 沒帶欄位時仍是 0.6% 的黑框', () => {
    const drawn = rings(renderSvg({ ...twoCircle('outline'), size: 1000 }));

    expect(drawn).toHaveLength(2);
    for (const ring of drawn) {
      expect(ring).toContain('stroke="#000000"');
      expect(ring).toContain('stroke-width="6"');
    }
  });

  for (const style of STYLES) {
    it(`${style}：開了 stroke_width 就每個圓一圈框線，寬度與顏色照 state`, () => {
      const svg = renderSvg({
        ...twoCircle(style, { stroke_width: 0.02, stroke: '#ff0000' }),
        size: 1000,
      });
      const drawn = rings(svg);

      expect(drawn).toHaveLength(2);
      for (const ring of drawn) {
        expect(ring).toContain('stroke="#ff0000"');
        expect(ring).toContain('stroke-width="20"');
      }
      expect(renderPng(svg).length).toBeGreaterThan(1000);
    });

    it(`${style}：stroke_width 0 時完全不畫框線`, () => {
      expect(renderSvg(twoCircle(style, { stroke_width: 0 }))).not.toContain('fill="none"');
    });
  }

  it('框線寬度隨畫布尺寸等比縮放（畫布寬比例）', () => {
    const at = (size: number) =>
      rings(renderSvg(twoCircle('flat', { stroke_width: 0.01, size })))[0]!;

    expect(at(800)).toContain('stroke-width="8"');
    expect(at(1600)).toContain('stroke-width="16"');
  });

  it('框線畫在填色之上、文字之下', () => {
    const svg = renderSvg({
      ...defaultState(2),
      style: 'flat',
      stroke_width: 0.01,
      texts: { '1': { t: '甲' }, '2': { t: '乙' } },
    });

    expect(svg.indexOf('<path')).toBeLessThan(svg.indexOf('fill="none"'));
    expect(svg.indexOf('fill="none"')).toBeLessThan(svg.indexOf('<g data-region='));
  });

  /** flat 的區域路徑各自帶一條同色 1.5px 描邊蓋接縫（抗鋸齒補丁），框線選項不該影響它 */
  it('flat 的接縫描邊仍在，且不受框線顏色影響', () => {
    const svg = renderSvg({
      ...defaultState(2),
      style: 'flat',
      stroke_width: 0.01,
      stroke: '#ff0000',
      texts: {},
    });
    const paths = [...svg.matchAll(/<path [^>]*>/g)].map((m) => m[0]);

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path).toContain('stroke-width="1.5"');
      expect(path).not.toContain('stroke="#ff0000"');
    }
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

  it('flat 與 outline 的單圈區是該圈的顏色', () => {
    for (const style of ['flat', 'outline'] as const) {
      expect(regionColor({ ...base, style }, 1)).toBe(PALETTE[0]);
      expect(regionColor({ ...base, style }, 2)).toBe(PALETTE[1]);
    }
  });

  /** 18：translucent 的單圈區畫出來是壓過 opacity 的色，regionColor 跟著回同一個值 */
  it('translucent 的單圈區是圈色壓在背景上的結果', () => {
    const state = { ...base, style: 'translucent' as const, opacity: 0.5, bg: '#000000' };

    expect(regionColor({ ...state, colors: ['#ffffff', '#ffffff'] }, 1)).toBe('#808080');
    expect(regionColor({ ...state, opacity: 1 }, 1)).toBe(PALETTE[0]);
  });

  it('outline 沒有填色，交集區取背景色', () => {
    expect(regionColor({ ...base, style: 'outline', bg: '#101010' }, 3)).toBe('#101010');
  });

  it('translucent 不透明時交集區等於成員色的顏料混色（不再是最上層那圈）', () => {
    const state = { ...base, style: 'translucent' as const, opacity: 1 };

    expect(regionColor(state, 3)).toBe(mixColors([PALETTE[0]!, PALETTE[1]!]));
  });

  it('translucent 全透明時交集區等於背景色', () => {
    const state = { ...base, style: 'translucent' as const, opacity: 0, bg: '#101010' };

    expect(regionColor(state, 3)).toBe('#101010');
  });

  it('translucent 半透明時是顏料混色壓在背景上的結果', () => {
    const state = {
      ...base,
      style: 'translucent' as const,
      opacity: 0.5,
      bg: '#000000',
      colors: ['#ff0000', '#ff0000'],
    };

    // 混色：平均仍是 #ff0000 → hsl(0, 1, 0.5) → 拉飽和後 l*0.8 = 0.4 → #cc0000；
    // 再以 0.5 壓在黑底上：204*0.5 = 102 → #660000
    expect(regionColor(state, 3)).toBe('#660000');
  });
});

/**
 * 18：translucent 改用顏料混色。交集色改由 `mixColors()` 決定再整體壓一次 opacity，
 * 所以與圈序無關，而單圈區的顏色與改版前相同（`mixColors([c]) === c`）。
 */
describe('renderSvg：18 translucent 顏料混色', () => {
  /** 前景以 alpha 壓在背景上的結果（`fill-opacity` 的定義，也是改版前單圈區的畫法） */
  function over(fg: string, alpha: number, bg: string): [number, number, number] {
    const channels = (hex: string) =>
      [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
    const [fr, fg_, fb] = channels(fg);
    const [br, bg_, bb] = channels(bg);
    return [alpha * fr + (1 - alpha) * br, alpha * fg_ + (1 - alpha) * bg_, alpha * fb + (1 - alpha) * bb];
  }

  function translucentState(extra: Partial<VennState> = {}): VennState {
    return {
      ...defaultState(3),
      style: 'translucent',
      opacity: 0.5,
      bg: '#102030',
      size: 400,
      ...extra,
    };
  }

  it('交換圈的顏色後，同一組成員的交集色不變', () => {
    const state = translucentState({ colors: ['#ff0000', '#0000ff', '#00ff00'] });
    const swapped = { ...state, colors: ['#0000ff', '#ff0000', '#00ff00'] };
    const drawn = renderedRegionColors(state);
    const drawn_swapped = renderedRegionColors(swapped);

    for (const mask of [3, 7]) {
      expect(regionColor(swapped, mask), `mask ${mask}`).toBe(regionColor(state, mask));
      expect(drawn_swapped.get(mask), `mask ${mask} 畫出來的顏色`).toEqual(drawn.get(mask));
    }
  });

  it('每個區域畫出來的顏色都等於 regionColor()（面板色塊與畫布同一個值）', () => {
    const state = translucentState({ colors: ['#ff0000', '#0000ff', '#00ff00'] });
    const drawn = renderedRegionColors(state);

    expect(drawn.size).toBe(7); // 前提：三圈七區都取到了樣
    for (const [mask, color] of drawn) {
      expectColorNear(color, regionColor(state, mask), `mask ${mask}`);
    }
  });

  it('單圈區的顏色與改版前相同：圈色以 opacity 壓在背景上', () => {
    const size = 400;
    const state = translucentState({ size, colors: ['#ff0000', '#0000ff', '#00ff00'] });
    const circles = circlesForRender(state);
    const png = decodePng(Buffer.from(renderPng(renderSvg(state))));

    circles.forEach((c, i) => {
      // 只屬於第 i 圈的取樣點：從圓心往外推到 0.8r，方向挑離其他圓最遠的那一側
      const away = Math.atan2(c.y - 0.5, c.x - 0.5);
      const x = Math.round((c.x + 0.8 * c.r * Math.cos(away)) * size);
      const y = Math.round((c.y + 0.8 * c.r * Math.sin(away)) * size);
      expect(maskAt(circles, (x + 0.5) / size, (y + 0.5) / size), `取樣點只該落在第 ${i} 圈`).toBe(
        1 << i,
      );

      const expected = over(state.colors[i]!, state.opacity, state.bg);
      const [r, g, b] = pngPixel(png, x, y);
      expect([r, g, b].map(Math.round), `第 ${i} 圈`).toEqual(expected.map(Math.round));
    });
  });

  it('opacity 越低，交集色越靠近背景色', () => {
    const bg = '#102030';
    const at = (opacity: number) => regionColor(translucentState({ opacity, bg }), 3);

    expect(at(0)).toBe(bg);
    expect(at(1)).toBe(mixColors([PALETTE[0]!, PALETTE[1]!]));
    expect(at(0.5)).not.toBe(at(1));
  });
});

describe('renderSvg：style 差異', () => {
  it('translucent 有填色，outline 的區域裡看到的是背景色', () => {
    const base = { ...defaultState(2), size: 400 };
    const translucent = { ...base, style: 'translucent' as const, opacity: 0.6 };
    const outline = { ...base, style: 'outline' as const };

    expectColorNear(renderedRegionColors(translucent).get(3)!, regionColor(translucent, 3), '交集區');
    expectColorNear(renderedRegionColors(outline).get(3)!, base.bg, 'outline 的交集區');
    expect(renderSvg(outline)).toContain('fill="none"');
  });

  it('opacity 改變會反映在輸出上', () => {
    const at = (opacity: number) => {
      const state = { ...defaultState(2), style: 'translucent' as const, opacity, size: 400 };
      const drawn = renderedRegionColors(state).get(3)!;
      expectColorNear(drawn, regionColor(state, 3), `opacity ${opacity} 的交集區`);
      return drawn;
    };

    expect(at(0.3)).not.toEqual(at(0.6));
  });

  it('背景色沿用 state.bg', () => {
    expect(renderSvg({ ...defaultState(2), bg: '#123456' })).toContain('#123456');
  });

  it('每圈顏色沿用 state.colors：單圈區畫的就是該圈的色（壓過 opacity）', () => {
    const state = { ...defaultState(3), colors: ['#c01111', '#22b022', '#3333a0'], size: 400 };
    const drawn = renderedRegionColors(state);

    for (const mask of [1, 2, 4]) {
      expectColorNear(drawn.get(mask)!, regionColor(state, mask), `mask ${mask}`);
    }
    expect(new Set([1, 2, 4].map((mask) => String(drawn.get(mask)))).size).toBe(3);
  });
});

describe('renderSvg：右下角浮水印', () => {
  const watermarkTag = (svg: string) => svg.match(/<text [^>]*text-anchor="end"[^>]*>.*?<\/text>/)![0];

  for (const style of STYLES) {
    it(`${style} 傳入文字就畫浮水印`, () => {
      expect(renderSvg(threeCircle(style), { watermark: WATERMARK })).toContain(`>${WATERMARK}<`);
    });
  }

  it('省略 watermark 就不畫（engine 不認識任何站名）', () => {
    expect(renderSvg(threeCircle('flat'))).not.toContain('text-anchor="end"');
  });

  it('watermark 是空字串等於不畫', () => {
    expect(renderSvg(threeCircle('flat'), { watermark: '' })).not.toContain('text-anchor="end"');
  });

  it('文字經 XML escape，含 & 的站名也產出合法 SVG', () => {
    const svg = renderSvg({ ...defaultState(2), size: 400 }, { watermark: 'a & b' });

    expect(svg).toContain('>a &amp; b<');
    expect(() => renderPng(svg)).not.toThrow();
  });

  it('位置貼齊右下角，並隨 size 等比縮放', () => {
    for (const size of [800, 1600]) {
      const tag = watermarkTag(renderSvg({ ...defaultState(2), size }, { watermark: WATERMARK }));
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
    expect(
      watermarkTag(renderSvg({ ...defaultState(2), bg: '#111111' }, { watermark: WATERMARK })),
    ).toContain('fill="#ffffff"');
    expect(
      watermarkTag(renderSvg({ ...defaultState(2), bg: '#fafafa' }, { watermark: WATERMARK })),
    ).toContain('fill="#000000"');
  });

  it('不帶 data-region，畫布點選不會把它當成可編輯的槽', () => {
    expect(watermarkTag(renderSvg(threeCircle('flat'), { watermark: WATERMARK }))).not.toContain(
      'data-region',
    );
  });
});

describe('renderSvg：合成用的圖層開關', () => {
  const BG_RECT = /<rect width="100%" height="100%"/;

  it('背景預設畫，浮水印預設不畫', () => {
    const svg = renderSvg({ ...defaultState(2), bg: '#123456' });

    expect(svg).toMatch(BG_RECT);
    expect(svg).not.toContain('text-anchor="end"');
  });

  it('background: false 不畫背景 rect，底圖才透得出來', () => {
    const svg = renderSvg({ ...defaultState(2), bg: '#123456' }, { background: false });

    expect(svg).not.toMatch(BG_RECT);
    expect(svg).not.toContain('#123456');
  });

  it('關掉圖層不影響圓與文字', () => {
    const state = { ...threeCircle('flat'), bg: '#123456' };
    const full = renderSvg(state, { watermark: WATERMARK });
    const stripped = renderSvg(state, { background: false });

    // 剝掉兩層之後，剩下的內容是完整版的子集
    for (const text of ['快', '好', '便宜', '不存在']) expect(stripped).toContain(`>${text}<`);
    expect(stripped.length).toBeLessThan(full.length);
    expect(full).toContain(stripped.replace(/^<svg[^>]*><defs>.*?<\/defs>/, '').replace(/<\/svg>$/, ''));
  });
});

/**
 * AC4：5／6 圈與 row 的新組合要真的畫得出來。判準是「真的 renderer 吃得下」
 * ＋「點陣化後的像素尺寸等於 state.size」，不是 SVG 字串長怎樣。
 */
describe('AC4 新組合（ring 5／6、row 3～6）渲染得出來且尺寸正確', () => {
  const COMBOS: [Arrangement, CircleCount][] = [
    ['ring', 5],
    ['ring', 6],
    ['row', 3],
    ['row', 4],
    ['row', 5],
    ['row', 6],
  ];

  for (const [arr, n] of COMBOS) {
    it(`${arr}(${n}) 的預設 state 經 resvg 渲染不拋錯，輸出 800×800 且每個標籤都畫出來`, () => {
      // 每個槽都填上該組合的 template 文字（編輯器只把它當 placeholder，這裡要的是「有字」）
      const base = nextStateForShape(initialState(2), arr, n);
      const state = { ...base, texts: templateTexts(arr, n), size: 800 };

      expect(state.n).toBe(n);
      const svg = renderSvg(state, { watermark: WATERMARK });
      expect(svg).toContain('width="800"');
      expect(svg).toContain('height="800"');

      // 每個圈的標籤都要真的排進圖裡：區域消失時 layout 會默默跳過那一格
      const labels = Object.values(state.texts).map((slot) => slot.t);
      expect(labels).toHaveLength(n);
      for (const label of labels) expect(svg, `${arr}(${n}) 標籤 ${label}`).toContain(`>${label}<`);

      let png: Buffer | undefined;
      expect(() => {
        png = Buffer.from(renderPng(svg));
      }).not.toThrow();
      expect(pngSize(png!)).toEqual({ width: 800, height: 800 });
    });
  }

  it('row(n) 的圓在預設幾何下完整落在畫布內，左右各留 ≥ 0.04', () => {
    for (const n of [3, 4, 5, 6] as CircleCount[]) {
      const state = nextStateForShape(sampleState(2), 'row', n);
      const circles = circlesForState(state);

      for (const c of circles) {
        expect(c.x - c.r, `row(${n}) 左`).toBeGreaterThanOrEqual(0.04 - 1e-12);
        expect(c.x + c.r, `row(${n}) 右`).toBeLessThanOrEqual(0.96 + 1e-12);
        expect(c.y - c.r, `row(${n}) 上`).toBeGreaterThanOrEqual(0);
        expect(c.y + c.r, `row(${n}) 下`).toBeLessThanOrEqual(1);
      }
    }
  });
});

/**
 * 13：空槽的示範文字只畫在編輯器預覽上。判準是「輸出路徑一個位元都不變」
 * ＋「幽靈字與真的寫進去的字排在同一個位置」，不是 SVG 字串長怎樣。
 */
describe('13 ghosts：空槽的示範文字', () => {
  const GHOSTS = { '1': '該做\n的事', '2': '想做\n的事', '3': '明天\n再說' };

  it('不傳 ghosts 時輸出與改版前一致（下載、/api/png、og 走的就是這條）', () => {
    const state = initialState(2);

    expect(renderSvg(state, { watermark: WATERMARK })).not.toContain('data-ghost');
    expect(renderSvg({ ...state, texts: { '1': { t: '貓' } } }, { ghosts: {} })).toBe(
      renderSvg({ ...state, texts: { '1': { t: '貓' } } }),
    );
  });

  it('空槽畫出淡淡的示範字，並且仍可點選跳到那一列', () => {
    const svg = renderSvg(initialState(2), { ghosts: GHOSTS });

    expect(svg).toContain('data-ghost=""');
    expect(svg).toContain('>該做<');
    expect(svg).toContain('>明天<');
    // 幽靈字群組也帶 data-region，點提示字就是想編那一格
    expect(svg).toMatch(/<g data-region="3"[^>]*data-ghost=""/);
  });

  it('已經有自己的字的槽不再畫幽靈字（不會兩層字疊在一起）', () => {
    const state = { ...initialState(2), texts: { '1': { t: '貓' } } };
    const svg = renderSvg(state, { ghosts: GHOSTS });

    expect(svg).toContain('>貓<');
    expect(svg).not.toContain('>該做<');
    expect(svg).toContain('>想做<');
  });

  it('幽靈字的位置與字級等同於真的把同一段字寫進 state', () => {
    const texts = Object.fromEntries(Object.entries(GHOSTS).map(([mask, t]) => [mask, { t }]));
    const ghosted = renderSvg(initialState(2), { ghosts: GHOSTS });
    const written = renderSvg({ ...initialState(2), texts });

    const lines = (svg: string) => svg.match(/<text x="[^"]+" y="[^"]+" font-size="[^"]+"/g);
    expect(lines(ghosted)).toEqual(lines(written));
  });

  it('只有 t 是空白的槽才吃提示；使用者打了空白鍵不算寫過字', () => {
    const state = { ...initialState(2), texts: { '1': { t: '  ' } } };

    expect(renderSvg(state, { ghosts: GHOSTS })).toContain('>該做<');
  });
});
