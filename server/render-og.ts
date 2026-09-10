import { renderAsync } from '@resvg/resvg-js';
import { renderSvg } from '../shared/render-svg';
import type { VennState } from '../shared/types';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const DIAGRAM_X = 645;
const DIAGRAM_Y = 68;
const DIAGRAM_SIZE = 494;

/**
 * 已內建品牌文案的底圖與去除背景的既有圖表 SVG 合成為外層 SVG，只做一次 Resvg 點陣化。
 * 圖表縮放整張正方形畫布，不重排內部圓形或文字。
 */
export async function renderOgPng(
  state: VennState,
  font_file: string,
  base_png: Uint8Array,
): Promise<Uint8Array> {
  const base_uri = `data:image/png;base64,${Buffer.from(base_png).toString('base64')}`;
  const diagram_body = renderSvg(state)
    .replace(/<rect width="100%" height="100%" fill="[^"]*"\/>/, '')
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '');
  const diagram_scale = DIAGRAM_SIZE / state.size;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">` +
    `<image href="${base_uri}" width="${OG_WIDTH}" height="${OG_HEIGHT}"/>` +
    `<g transform="translate(${DIAGRAM_X} ${DIAGRAM_Y}) scale(${diagram_scale})"><g>${diagram_body}</g></g>` +
    `</svg>`;

  const image = await renderAsync(svg, {
    fitTo: { mode: 'width', value: OG_WIDTH },
    font: { fontFiles: [font_file], loadSystemFonts: false, defaultFontFamily: 'Noto Sans TC' },
  });
  return image.asPng();
}
