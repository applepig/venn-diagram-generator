import { LINE_HEIGHT } from './defaults';
import {
  IDENTITY_TRANSFORM,
  composeTransform,
  fitTransform,
  strokeInset,
  transformCircle,
  type DiagramTransform,
} from './fit';
// layout.ts 也 import 這個檔：兩邊都只在函式內互相呼叫、頂層不求值，這個環是安全的
import { wrapManualFs } from './layout';
import { circlesForState } from './shapes/index';
import { strokeOf } from './stroke';
import type { Circle, RegionBox, VennState } from './types';

/**
 * 圖片標題佔畫布頂端的高度比例（08 AC4）——17 起改成**下限**：自動字級維持這個值，
 * 手動放大字級時 band 由 `titleBandH()` 推得、只會更高。
 * 有標題時圖區等比縮到 `1 - band`、水平置中、貼齊畫布底緣，
 * 空出來的就是這條 band——只下移不縮放會出界（row(6) 的預設幾何總寬剛好 1.0）。
 */
export const TITLE_BAND_H = 0.18;

/** band 高度的上限（17 AC4）：再長下去圖區就沒剩多少，超過就回到夾字級 */
export const TITLE_BAND_MAX = 0.5;

/** band 內文字框的留白（畫布寬比例）；band 高度的公式吃得到 TITLE_PAD_Y，所以匯出給測試對值 */
const TITLE_PAD_X = 0.06;
export const TITLE_PAD_Y = 0.02;

/** 標題文字：只有空白等於沒有標題，版面因此與舊連結逐像素相同 */
export function titleTextOf(state: VennState): string {
  return (state.title ?? '').trim();
}

/** band 的文字框寬度：只吃水平留白，不依賴 band 高度——`titleBandH()` 因此能拿它算行數 */
function titleBoxW(): number {
  return 1 - 2 * TITLE_PAD_X;
}

/**
 * 這張圖的 title band 高度（17 AC1）。自動字級一律 TITLE_BAND_H——舊連結的輸出因此一個位元都不變；
 * 手動字級時改由「這幾行放得下」推得，band 只會比 TITLE_BAND_H 高、最多到 TITLE_BAND_MAX，
 * 再大就由 `layoutTitle()` 回到夾字級（AC4）。
 *
 * 行數用 `wrapManualFs()` 算：折行只吃文字框寬度、不看 band 高度，先算寬再算高沒有循環相依。
 */
export function titleBandH(state: VennState): number {
  const text = titleTextOf(state);
  const fs = state.title_fs;
  if (text === '' || fs === undefined) return TITLE_BAND_H;

  const lines = wrapManualFs(text, fs, titleBoxW()).length;
  const needed = lines * fs * LINE_HEIGHT + 2 * TITLE_PAD_Y;
  return Math.min(Math.max(TITLE_BAND_H, needed), TITLE_BAND_MAX);
}

/** 標題在 band 內可用的文字框 */
export function titleBox(state: VennState): RegionBox {
  const band = titleBandH(state);
  return {
    cx: 0.5,
    cy: band / 2,
    w: titleBoxW(),
    h: band - 2 * TITLE_PAD_Y,
  };
}

/**
 * 標題造成的圖區位移：沒有標題時是恆等變換（舊連結的輸出一個位元都不變），
 * 有標題時等比縮小、水平置中、下移到 band 之下並貼齊畫布底緣。
 */
export function titleTransform(state: VennState): DiagramTransform {
  if (titleTextOf(state) === '') return IDENTITY_TRANSFORM;
  const scale = 1 - titleBandH(state);
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
