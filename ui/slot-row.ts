import {
  INTERSECTION_START_FS,
  LABEL_START_FS,
  MAX_TEXT_LEN,
  popCount,
} from '../engine/defaults';
import { regionColor } from '../engine/render-svg';
import type { TextBlock, TextSlot, VennState } from '../engine/types';
import { SWATCH_COLORS, createColorControl } from './color-control';

/** 每按一次 ± 的字級倍率，與 01 的畫布工具列一致 */
const FS_STEP = 1.12;
/** 手動字級的上下限（畫布寬比例）；codec 放到 0.001..1，但那個範圍在 UI 上沒有意義 */
const FS_MIN = 0.012;
const FS_MAX = 0.5;

const EMPTY_LABEL = '（空）';
/** 空槽在自動模式沒有字級可顯示：給個佔位符，不要顯示 start fs 誘人去按 ± */
const NO_FS_PLACEHOLDER = '—';
const NO_REGION_NOTE = '目前的圓大小與重疊度下沒有這一區，調過幾何它才會出現。';
const NOT_FLAT_NOTE = '只有「平面」樣式有可以填色的區域，交集顏色由樣式自己算。';

export interface SlotRowHandlers {
  onPatchSlot: (mask: number, patch: Partial<TextSlot>) => void;
  onPickCircleColor: (index: number, color: string) => void;
}

export interface SlotRow {
  root: HTMLDetailsElement;
  mask: number;
  update: (state: VennState, block: TextBlock | undefined, region_exists: boolean) => void;
}

/** mask 的成員圓標籤：1 → `A`、3 → `A+B`、7 → `A+B+C` */
export function slotTag(mask: number): string {
  const parts: string[] = [];
  for (let i = 0; mask >> i; i++) if (mask & (1 << i)) parts.push(String.fromCharCode(65 + i));
  return parts.join('+');
}

/** 收合列只放得下一行；空白槽要看得出來是空的，不然那一列像壞掉 */
function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim() !== '') ?? EMPTY_LABEL;
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

  // 字級：[自動] [− N px +]，data-mode 決定哪一邊有 accent 外框
  const fs_row = document.createElement('div');
  fs_row.className = 'row';
  const fs_label = document.createElement('label');
  fs_label.textContent = '字級';
  const fs_box = document.createElement('div');
  fs_box.className = 'fs';

  const auto_btn = document.createElement('button');
  auto_btn.type = 'button';
  auto_btn.className = 'auto-btn';
  auto_btn.textContent = '自動';
  auto_btn.addEventListener('click', () => handlers.onPatchSlot(mask, { fs: undefined }));

  const steps = document.createElement('div');
  steps.className = 'steps';
  const num = document.createElement('input');
  num.type = 'number';
  num.className = 'num';
  num.step = '1';
  num.setAttribute('aria-label', '字級');
  const unit = document.createElement('span');
  unit.className = 'unit';
  unit.textContent = 'px';

  // 字級的 state 是畫布寬比例，UI 顯示的是換算到目前輸出尺寸的 px，所以每次都要拿當下的 size 換算
  let size = 1200;
  let shown_px = 0;
  let shown_value = '';

  const setPx = (px: number): void => {
    const unit_fs = Math.min(FS_MAX, Math.max(FS_MIN, px / size));
    handlers.onPatchSlot(mask, { fs: unit_fs });
  };

  const step_down = document.createElement('button');
  step_down.type = 'button';
  step_down.textContent = '−';
  step_down.title = '縮小字級';
  step_down.addEventListener('click', () => setPx(Math.round(shown_px / FS_STEP)));

  const step_up = document.createElement('button');
  step_up.type = 'button';
  step_up.textContent = '+';
  step_up.title = '放大字級';
  step_up.addEventListener('click', () => setPx(Math.round(shown_px * FS_STEP)));

  // change 而不是 input：邊打邊套用會讓「1」「12」這種中途值先跑一次重繪
  num.addEventListener('change', () => {
    const px = Number(num.value);
    // 清空欄位不是「設成 0」：Number('') 會被 clamp 成最小字級，把字縮到看不見
    if (num.value.trim() === '' || !Number.isFinite(px)) {
      num.value = shown_value;
      return;
    }
    setPx(px);
  });

  steps.append(step_down, num, unit, step_up);
  fs_box.append(auto_btn, steps);
  fs_row.append(fs_label, fs_box);

  const color_row = document.createElement('div');
  color_row.className = 'row';
  const color_label = document.createElement('label');
  color_label.textContent = '顏色';
  const color = createColorControl({
    swatches: SWATCH_COLORS,
    auto_label: is_label ? '' : '自動混色',
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

  body.append(text_input, fs_row, color_row, note);
  root.append(summary, body);

  return {
    root,
    mask,
    update(state, block, region_exists) {
      size = state.size;
      const slot = state.texts[String(mask)];
      const text = slot?.t ?? '';

      // AC2：單圈列的代表色就是圈色（和展開後的控制項同一個值），交集列取該區實際畫出來的顏色
      swatch.style.background = is_label
        ? (state.colors[circle_index] ?? '#888888')
        : regionColor(state, mask);
      preview.textContent = firstLine(text);
      if (text_input.value !== text) text_input.value = text;

      const auto_fs = block?.fs ?? (is_label ? LABEL_START_FS : INTERSECTION_START_FS);
      shown_px = Math.round((slot?.fs ?? auto_fs) * size);
      fs_box.dataset.mode = slot?.fs === undefined ? 'auto' : 'manual';
      num.min = String(Math.round(FS_MIN * size));
      num.max = String(Math.round(FS_MAX * size));
      // 沒有文字又是自動模式，就沒有字級可調：顯示 start fs 會讓人按 + 寫入過大的手動字級
      const no_fs = text === '' && slot?.fs === undefined;
      num.placeholder = no_fs ? NO_FS_PLACEHOLDER : '';
      shown_value = no_fs ? '' : String(shown_px);
      // 正在打字的欄位不回寫，否則游標會被推到尾端
      if (num !== document.activeElement && num.value !== shown_value) {
        num.value = shown_value;
      }

      const fill_locked = !is_label && state.style !== 'flat';
      color.setValue(is_label ? (state.colors[circle_index] ?? '#888888') : (slot?.fill ?? null));
      color.setDisabled(fill_locked || !region_exists);

      // AC4：區域不存在就整列停用，不讓使用者打了字卻不出現在圖上
      root.classList.toggle('disabled', !region_exists);
      text_input.disabled = !region_exists;
      auto_btn.disabled = !region_exists;
      for (const btn of [step_down, step_up]) btn.disabled = !region_exists || no_fs;
      num.disabled = !region_exists || no_fs;

      const reason = !region_exists ? NO_REGION_NOTE : fill_locked ? NOT_FLAT_NOTE : '';
      note.textContent = reason;
      note.hidden = reason === '';
    },
  };
}
