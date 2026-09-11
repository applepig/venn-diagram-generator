import { renderAsync } from '@resvg/resvg-js';
import { renderSvg } from '../engine/render-svg';
import type { VennState } from '../engine/types';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const DIAGRAM_X = 645;
const DIAGRAM_Y = 68;
const DIAGRAM_SIZE = 494;

const DITHER_ID = 'og-dither';
/** 固定 seed：build 時烤出來的靜態圖要有決定性，content hash 才不會每次都變 */
const DITHER_SEED = 7;
/** 粗顆粒（低 baseFrequency）比細顆粒抗降採樣，社群平台縮圖後雜訊仍在 */
const DITHER_FREQUENCY = 0.5;
/** 上限由目視決定：0.6 在 1:1 檢視下顆粒肉眼可見，0.25 抖動仍在（48.6 dB）但看不出來 */
const DITHER_OPACITY = 0.25;

/**
 * DC 中性的灰雜訊：飽和度歸零＋alpha 壓成 1，再以 overlay 疊上去——
 * overlay 對 50% 灰是恆等運算，所以平均亮度不動，只把平坦色塊打散成雜訊，
 * 讓社群平台重壓 JPEG 時不會生出大片 banding。
 *
 * `color-interpolation-filters="sRGB"` 不可省：預設的 linearRGB 會讓灰雜訊轉回 sRGB 後偏亮，
 * 結果是整張圖被提亮而不是抖動（已實測平均 RGB 從 224/233/238 變 226/235/240）。
 */
const DITHER_MARKUP =
  `<filter id="${DITHER_ID}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">` +
  `<feTurbulence type="fractalNoise" baseFrequency="${DITHER_FREQUENCY}" numOctaves="1" seed="${DITHER_SEED}"/>` +
  `<feColorMatrix type="saturate" values="0"/>` +
  `<feComponentTransfer><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>` +
  `</filter>`;

const DITHER_LAYER =
  `<g style="mix-blend-mode:overlay" opacity="${DITHER_OPACITY}">` +
  `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" filter="url(#${DITHER_ID})"/>` +
  `</g>`;

/**
 * 已內建品牌文案的底圖與去除背景的既有圖表 SVG 合成為外層 SVG，只做一次 Resvg 點陣化。
 * 圖表縮放整張正方形畫布，不重排內部圓形或文字。
 * 背景與浮水印由 renderSvg 的開關關掉：底圖要透出來，品牌名底圖上已經有了。
 */
export async function renderOgPng(
  state: VennState,
  font_file: string,
  base_png: Uint8Array,
  opts: { dither?: boolean } = {},
): Promise<Uint8Array> {
  const dither = opts.dither ?? true;
  const base_uri = `data:image/png;base64,${Buffer.from(base_png).toString('base64')}`;
  const diagram_body = renderSvg(state, { background: false, watermark: false })
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '');
  const diagram_scale = DIAGRAM_SIZE / state.size;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">` +
    (dither ? `<defs>${DITHER_MARKUP}</defs>` : '') +
    `<image href="${base_uri}" width="${OG_WIDTH}" height="${OG_HEIGHT}"/>` +
    `<g transform="translate(${DIAGRAM_X} ${DIAGRAM_Y}) scale(${diagram_scale})"><g>${diagram_body}</g></g>` +
    (dither ? DITHER_LAYER : '') +
    `</svg>`;

  const image = await renderAsync(svg, {
    fitTo: { mode: 'width', value: OG_WIDTH },
    font: { fontFiles: [font_file], loadSystemFonts: false, defaultFontFamily: 'Noto Sans TC' },
  });
  return image.asPng();
}
