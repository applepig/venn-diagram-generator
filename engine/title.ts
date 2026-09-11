import { circlesForState } from './shapes/index';
import type { Circle, RegionBox, TextBlock, VennState } from './types';

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

/** 單位空間的相似變換：先等比縮放，再平移 */
export interface DiagramTransform {
  scale: number;
  tx: number;
  ty: number;
}

const IDENTITY: DiagramTransform = { scale: 1, tx: 0, ty: 0 };

/**
 * 圖區的擺放方式：沒有標題時是恆等變換（舊連結的輸出一個位元都不變），
 * 有標題時等比縮小、水平置中、下移到 band 之下並貼齊畫布底緣。
 */
export function diagramTransform(state: VennState): DiagramTransform {
  if (titleTextOf(state) === '') return IDENTITY;
  const scale = 1 - TITLE_BAND_H;
  return { scale, tx: (1 - scale) / 2, ty: 1 - scale };
}

function transformCircle(c: Circle, t: DiagramTransform): Circle {
  return { x: c.x * t.scale + t.tx, y: c.y * t.scale + t.ty, r: c.r * t.scale };
}

/** 已套用標題位移的圓；`renderSvg()` 與 `layout()` 都走這個變換，兩邊自動一致 */
export function circlesForRender(state: VennState): Circle[] {
  const t = diagramTransform(state);
  const circles = circlesForState(state);
  if (t === IDENTITY) return circles;
  return circles.map((c) => transformCircle(c, t));
}

/**
 * 把預設空間排好的文字區塊搬到同一個變換上。
 * 排版本身仍在預設空間算（取樣密度與槽表不受標題影響），只有結果跟著圖區縮放，
 * 所以有無標題的版面是嚴格的等比關係。
 */
export function transformBlock(block: TextBlock, t: DiagramTransform): TextBlock {
  if (t === IDENTITY) return block;
  return {
    ...block,
    box: {
      cx: block.box.cx * t.scale + t.tx,
      cy: block.box.cy * t.scale + t.ty,
      w: block.box.w * t.scale,
      h: block.box.h * t.scale,
    },
    cx: block.cx * t.scale + t.tx,
    cy: block.cy * t.scale + t.ty,
    fs: block.fs * t.scale,
  };
}
