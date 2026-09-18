import {
  IDENTITY_TRANSFORM,
  composeTransform,
  fitTransform,
  strokeInset,
  transformCircle,
  type DiagramTransform,
} from './fit';
import { circlesForState } from './shapes/index';
import { strokeOf } from './stroke';
import type { Circle, RegionBox, VennState } from './types';

/**
 * 圖片標題佔畫布頂端的高度比例（08 AC4）。
 * 有標題時圖區等比縮到 `1 - TITLE_BAND_H`、水平置中、貼齊畫布底緣，
 * 空出來的就是這條 band——只下移不縮放會出界（row(6) 的預設幾何總寬剛好 1.0）。
 */
export const TITLE_BAND_H = 0.18;

/** band 內文字框的留白（畫布寬比例） */
const TITLE_PAD_X = 0.06;
const TITLE_PAD_Y = 0.02;

/** 標題文字：只有空白等於沒有標題，版面因此與舊連結逐像素相同 */
export function titleTextOf(state: VennState): string {
  return (state.title ?? '').trim();
}

/** 標題在 band 內可用的文字框 */
export function titleBox(): RegionBox {
  return {
    cx: 0.5,
    cy: TITLE_BAND_H / 2,
    w: 1 - 2 * TITLE_PAD_X,
    h: TITLE_BAND_H - 2 * TITLE_PAD_Y,
  };
}

/**
 * 標題造成的圖區位移：沒有標題時是恆等變換（舊連結的輸出一個位元都不變），
 * 有標題時等比縮小、水平置中、下移到 band 之下並貼齊畫布底緣。
 */
export function titleTransform(state: VennState): DiagramTransform {
  if (titleTextOf(state) === '') return IDENTITY_TRANSFORM;
  const scale = 1 - TITLE_BAND_H;
  return { scale, tx: (1 - scale) / 2, ty: 1 - scale };
}

/**
 * 圖區的總變換：先把超界的圓縮回畫布（fit），再套標題位移（09 AC4）。
 *
 * 兩者都是後製變換，排版與槽表仍在原始幾何上算；順序是先 fit 再 title，
 * 所以有標題時圖區是「塞得下的那張圖」再整組縮進 band 之下。
 *
 * fit 的內縮量要先除以標題的縮放：描邊寬度是畫布常數、不隨變換縮，
 * 在原始空間多留 `inset / title_scale`，經標題縮放後才剛好剩下一個描邊半寬。
 */
export function diagramTransform(state: VennState): DiagramTransform {
  const title = titleTransform(state);
  const fit = fitTransform(circlesForState(state), strokeInset(strokeOf(state)) / title.scale);
  return composeTransform(fit, title);
}

/** 已套用總變換的圓；`renderSvg()` 與 `layout()` 都走這個變換，兩邊自動一致 */
export function circlesForRender(state: VennState): Circle[] {
  const t = diagramTransform(state);
  const circles = circlesForState(state);
  if (t === IDENTITY_TRANSFORM) return circles;
  return circles.map((c) => transformCircle(c, t));
}
