import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { renderSvg } from '../shared/render-svg';
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
