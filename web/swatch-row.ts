import { PALETTE } from '../shared/defaults';

/** 色票列的預設選色：palette 四色 ＋ 常用色（含黑、白、灰） */
export const SWATCH_COLORS = [
  ...PALETTE,
  '#111111',
  '#ffffff',
  '#8a8f99',
  '#8b5cf6',
  '#e05fa0',
];

export interface SwatchRow {
  root: HTMLElement;
  /** 標記目前顏色；不在色票內時由「自訂」格顯示它 */
  setValue: (color: string) => void;
}

/**
 * 一列可點選的色票，最後一格才開原生色盤。
 * 原生 <input type="color"> 每次開都要等 GTK 對話框，多數操作不該付這個成本。
 * 刻意不綁「圈」的概念，之後區域填色可以直接重用。
 */
export function createSwatchRow(options: string[], onPick: (color: string) => void): SwatchRow {
  const root = document.createElement('div');
  root.className = 'swatch-row';

  const cells: [string, HTMLButtonElement][] = [];
  for (const color of options) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'swatch';
    cell.title = color;
    cell.style.background = color;
    cell.addEventListener('click', () => onPick(color));
    root.append(cell);
    cells.push([color, cell]);
  }

  const custom = document.createElement('label');
  custom.className = 'swatch swatch-custom';
  custom.title = '自訂顏色';
  const custom_input = document.createElement('input');
  custom_input.type = 'color';
  custom_input.addEventListener('input', () => onPick(custom_input.value));
  custom.append(custom_input);
  root.append(custom);

  return {
    root,
    setValue(color) {
      const normalized = color.toLowerCase();
      let matched = false;
      for (const [value, cell] of cells) {
        const active = value.toLowerCase() === normalized;
        cell.setAttribute('aria-pressed', String(active));
        matched = matched || active;
      }
      custom.setAttribute('aria-pressed', String(!matched));
      // 色票沒有這個顏色時，「自訂」格就是它的預覽
      custom.style.background = matched ? '' : color;
      if (custom_input.value !== color) custom_input.value = color;
    },
  };
}
