import { MAX_TEXT_LEN } from '../engine/defaults';
import { SWATCH_COLORS } from '../content/palette';
import { layoutTitle } from '../engine/layout';
import { titleColor } from '../engine/render-svg';
import { maxTitleFs } from '../engine/title';
import type { VennState } from '../engine/types';
import { ts } from './i18n';
import { createColorControl } from './color-control';
import { FS_MIN, createFsField, fsToPx, pxToFs } from './fs-field';

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
 * 兩處差別：顏色調的是**字色**而不是底色（標題壓在背景上、沒有自己的區域），
 * 而標題不在圖區裡，字級換算不吃圖區縮放（`scale = 1`）。
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

  let size = 1200;

  const fs_field = createFsField({
    onAuto: () => handlers.onPatch({ title_fs: undefined }),
    onPick: (px) => handlers.onPatch({ title_fs: pxToFs(px, size, 1) }),
  });

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

  body.append(text_input, fs_field.root, color_row);
  root.append(summary, body);

  return {
    root,
    update(state) {
      size = state.size;
      const title = state.title ?? '';
      if (text_input.value !== title) text_input.value = title;
      preview.textContent = firstLine(title);
      swatch.style.color = titleColor(state);
      swatch.style.background = state.bg;
      color.setValue(state.title_fill ?? null);

      // 排好版才知道自動模式下的字級是多少；沒有標題就沒有 block
      const block = layoutTitle(state);
      if (block) {
        // 顯示 block.fs 而不是 state.title_fs：band 裝不下時 layoutTitle 會夾字級，
        // 面板要說的是「畫出來多大」，不是「你填了多大」
        fs_field.update({
          px: fsToPx(block.fs, size, 1),
          manual: state.title_fs !== undefined,
          min_px: fsToPx(FS_MIN, size, 1),
          // 上限問 engine：band 長到頭之後標題就不會再變大，欄位上限寫死 FS_MAX
          // 會留一段按了不動的行程，那正是這次要修掉的「按＋沒反應」
          max_px: fsToPx(maxTitleFs(state), size, 1),
        });
      }

      // 沒有標題就沒有字可以上色或縮放：整列收起來，不留半灰的擺設
      // （字色與字級都只在有標題時進編碼，見 engine/state-codec.ts）
      fs_field.root.hidden = !block;
      color_row.hidden = !block;
    },
  };
}
