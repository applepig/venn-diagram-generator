import { MAX_TEXT_LEN } from '../engine/defaults';
import { SWATCH_COLORS } from '../content/palette';
import { titleColor } from '../engine/render-svg';
import type { VennState } from '../engine/types';
import { ts } from './i18n';
import { createColorControl } from './color-control';

export interface TitleRowHandlers {
  onPatch: (patch: Partial<VennState>) => void;
}

export interface TitleRow {
  root: HTMLDetailsElement;
  update: (state: VennState) => void;
}

/** 收合列只放得下一行；沒有標題時要看得出來是空的 */
function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim() !== '') ?? ts('slot.empty');
}

/**
 * 圖片標題那一列。外形與文字槽同一套（`.slot`），所以它就排在 A／B／A+B 那一組的第一列：
 * 標題和槽一樣是「圖上的一段字」，分開放在面板頂端反而看不出是同類東西。
 *
 * 差別只有顏色的語意：標題壓在背景上、沒有自己的區域，能調的是**字色**而不是底色，
 * 自動＝依背景亮度取黑白（與浮水印同一條判準）。
 */
export function createTitleRow(handlers: TitleRowHandlers): TitleRow {
  const root = document.createElement('details');
  root.className = 'slot';
  root.dataset.title = '';

  const summary = document.createElement('summary');
  const swatch = document.createElement('span');
  swatch.className = 'swatch text';
  // 字色的色塊畫成一個字，才不會被當成跟上下幾列一樣的底色
  swatch.textContent = 'A';
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = ts('field.title');
  const preview = document.createElement('span');
  preview.className = 'txt';
  summary.append(swatch, tag, preview);

  const body = document.createElement('div');
  body.className = 'body';

  const text_input = document.createElement('textarea');
  text_input.rows = 2;
  // 比照槽的文字：超過上限 encodeState 會拋錯而停止更新 URL，在輸入端就打住
  text_input.maxLength = MAX_TEXT_LEN;
  text_input.addEventListener('input', () => handlers.onPatch({ title: text_input.value }));

  const color_row = document.createElement('div');
  color_row.className = 'row';
  const color_label = document.createElement('label');
  color_label.textContent = ts('field.textColor');
  const color = createColorControl({
    swatches: SWATCH_COLORS,
    auto_label: ts('color.autoContrast'),
    onPick: (picked) => handlers.onPatch({ title_fill: picked ?? undefined }),
  });
  color_row.append(color_label, color.root);

  body.append(text_input, color_row);
  root.append(summary, body);

  return {
    root,
    update(state) {
      const title = state.title ?? '';
      if (text_input.value !== title) text_input.value = title;
      preview.textContent = firstLine(title);
      swatch.style.color = titleColor(state);
      swatch.style.background = state.bg;
      color.setValue(state.title_fill ?? null);
      // 沒有標題就沒有字可以上色；字色一律跟著標題進編碼（見 state-codec）
      color.setDisabled(title.trim() === '');
    },
  };
}
