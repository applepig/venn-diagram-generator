/**
 * 圓的預設配色；state.colors 沒給就從這裡取前 n 色。
 * 六色對應最多的圈數，5／6 圈不用灰色補位。全部色與其混色的相對亮度都在
 * 白字門檻 0.6 以下（見 render-svg 的 `DARK_TEXT_LUMINANCE`）。
 */
export const PALETTE = ['#2e9be6', '#e6a92e', '#e04848', '#3cb54a', '#8b5cf6', '#e05fa0'];

/** 顏色 popover 的選色：palette 六色 ＋ 黑、白、灰 */
export const SWATCH_COLORS = [...PALETTE, '#111111', '#ffffff', '#8a8f99'];

/** 背景色的常用選色：淺底、紙色、深底 */
export const BG_SWATCHES = ['#fafafa', '#ffffff', '#f4e6c8', '#d9dee6', '#2f3440', '#14161a'];
