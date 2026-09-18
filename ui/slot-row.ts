import {
  INTERSECTION_START_FS,
  LABEL_START_FS,
  MAX_TEXT_LEN,
  popCount,
} from '../engine/defaults';
import { SWATCH_COLORS } from '../content/palette';
import { placeholderTexts } from '../content/state-presets';
import { regionColor } from '../engine/render-svg';
import { arrOf } from '../engine/shapes/index';
import { diagramTransform } from '../engine/title';
import type { TextBlock, TextSlot, VennState } from '../engine/types';
import { ts, uiLocale } from './i18n';
import { createColorControl } from './color-control';
import { FS_MAX, FS_MIN, createFsField, fsToPx, pxToFs } from './fs-field';

export interface SlotRowHandlers {
  onPatchSlot: (mask: number, patch: Partial<TextSlot>) => void;
  onPickCircleColor: (index: number, color: string) => void;
}

export interface SlotRow {
  root: HTMLDetailsElement;
  mask: number;
  update: (state: VennState, block: TextBlock | undefined, region_exists: boolean) => void;
  /** 把游標放進這一列的文字框（點畫布區域時用） */
  focusText: () => void;
}

/** mask 的成員圓標籤：1 → `A`、3 → `A+B`、7 → `A+B+C` */
export function slotTag(mask: number): string {
  const parts: string[] = [];
  for (let i = 0; mask >> i; i++) if (mask & (1 << i)) parts.push(String.fromCharCode(65 + i));
  return parts.join('+');
}

/** 收合列只放得下一行；沒有內容時回空字串，由呼叫端決定要顯示提示還是「（空）」 */
function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim() !== '') ?? '';
}

/**
 * 該槽的示範文字：輸入框的 placeholder 與收合列的灰字提示都取自 template。
 * template 只是提示，不進 state——使用者不必先清掉範例才能寫自己的字。
 */
function hintFor(state: VennState, mask: number): string {
  return placeholderTexts(arrOf(state), state.n, uiLocale())[String(mask)] ?? '';
}

export function createSlotRow(mask: number, handlers: SlotRowHandlers): SlotRow {
  const is_label = popCount(mask) === 1;
  const circle_index = Math.log2(mask);

  const root = document.createElement('details');
  root.className = 'slot';
  root.dataset.mask = String(mask);

  const summary = document.createElement('summary');
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = slotTag(mask);
  const preview = document.createElement('span');
  preview.className = 'txt';
  summary.append(swatch, tag, preview);

  const body = document.createElement('div');
  body.className = 'body';

  const text_input = document.createElement('textarea');
  text_input.rows = 2;
  // 超過上限 encodeState 會拋錯而整個停止更新 URL，寧可在輸入端就打住（UTF-16 計數比 code point 嚴格）
  text_input.maxLength = MAX_TEXT_LEN;
  text_input.addEventListener('input', () => handlers.onPatchSlot(mask, { t: text_input.value }));

  // 字級的 state 是畫布寬比例，UI 顯示的是換算到目前輸出尺寸的 px，
  // 所以每次都要拿當下的 size 與圖區縮放（有標題時 < 1）換算
  let size = 1200;
  let scale = 1;

  const fs_field = createFsField({
    onAuto: () => handlers.onPatchSlot(mask, { fs: undefined }),
    onPick: (px) => handlers.onPatchSlot(mask, { fs: pxToFs(px, size, scale) }),
  });

  const color_row = document.createElement('div');
  color_row.className = 'row';
  const color_label = document.createElement('label');
  color_label.textContent = ts('field.color');
  const color = createColorControl({
    swatches: SWATCH_COLORS,
    auto_label: is_label ? '' : ts('color.autoMix'),
    onPick: (picked) => {
      if (is_label) {
        if (picked) handlers.onPickCircleColor(circle_index, picked);
        return;
      }
      handlers.onPatchSlot(mask, { fill: picked ?? undefined });
    },
  });
  color_row.append(color_label, color.root);

  const note = document.createElement('p');
  note.className = 'note';

  body.append(text_input, fs_field.root, color_row, note);
  root.append(summary, body);

  return {
    root,
    mask,

    focusText() {
      // 區域不存在時整列是停用狀態，focus 一個 disabled 的框只會把游標丟掉（14 AC5）
      if (text_input.disabled) return;
      // 捲動歸 openSlot 的 scrollIntoView 管：focus 自己捲會把那一列送到 peek 條底下
      text_input.focus({ preventScroll: true });
    },

    update(state, block, region_exists) {
      size = state.size;
      scale = diagramTransform(state).scale;
      const slot = state.texts[String(mask)];
      const text = slot?.t ?? '';
      const hint = hintFor(state, mask);
      text_input.placeholder = hint;

      // AC2：單圈列的代表色就是圈色（和展開後的控制項同一個值），交集列取該區實際畫出來的顏色
      swatch.style.background = is_label
        ? (state.colors[circle_index] ?? '#888888')
        : regionColor(state, mask);
      const own_line = firstLine(text);
      // 自己的字用正常灰；還沒寫字就用更淡的示範字，一眼看得出那不是圖上的內容
      preview.textContent = own_line || firstLine(hint) || ts('slot.empty');
      preview.classList.toggle('ghost', own_line === '');
      if (text_input.value !== text) text_input.value = text;

      // block.fs 已經套過圖區縮放，換回預設空間才和 slot.fs 同一把尺
      const auto_fs = block
        ? block.fs / scale
        : is_label
          ? LABEL_START_FS
          : INTERSECTION_START_FS;
      fs_field.update({
        px: fsToPx(slot?.fs ?? auto_fs, size, scale),
        manual: slot?.fs !== undefined,
        min_px: fsToPx(FS_MIN, size, scale),
        max_px: fsToPx(FS_MAX, size, scale),
      });

      color.setValue(is_label ? (state.colors[circle_index] ?? '#888888') : (slot?.fill ?? null));

      /**
       * 按了不會有任何效果的控制項一律整列收起來，不留半灰的擺設：
       * 沒有文字就沒有字級可調（顯示 start fs 只會誘人按＋寫入過大的手動值），
       * 交集區的填色只有 flat 樣式吃得到，區域不存在時整個 body 只剩「為什麼」那一句。
       */
      const has_text = text.trim() !== '';
      fs_field.root.hidden = !region_exists || (!has_text && slot?.fs === undefined);
      color_row.hidden = !region_exists || (!is_label && state.style !== 'flat');

      // AC4：區域不存在就整列停用，不讓使用者打了字卻不出現在圖上
      root.classList.toggle('disabled', !region_exists);
      text_input.disabled = !region_exists;

      note.textContent = region_exists ? '' : ts('slot.noRegion');
      note.hidden = region_exists;
    },
  };
}
