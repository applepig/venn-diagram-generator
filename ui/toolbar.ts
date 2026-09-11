import {
  INTERSECTION_ASPECT,
  LABEL_ASPECT,
  OVERLAP_MAX,
  OVERLAP_MIN,
  SIZE_CHOICES,
  popCount,
} from '../engine/defaults';
import { BG_SWATCHES } from '../content/palette';
import { layout, regionBox, slotMasks } from '../engine/layout';
import {
  arrOf,
  circleCountRange,
  circlesForState,
  isShape,
  radiusRange,
} from '../engine/shapes/index';
import { LOCALES, LOCALE_NAMES, type Locale } from '../content/locale';
import type { Arrangement, CircleCount, TextSlot, VennState, VennStyle } from '../engine/types';
import { ts, uiLocale } from './i18n';
import { createColorControl } from './color-control';
import { createSlotRow, type SlotRow } from './slot-row';

// 文案在 createToolbar 裡才取：模組載入時語言還沒決定（uiLocale 要讀 DOM 與 localStorage）
function styleLabels(): [VennStyle, string][] {
  return [
    ['translucent', ts('style.translucent')],
    ['flat', ts('style.flat')],
    ['outline', ts('style.outline')],
  ];
}

function arrLabels(): [Arrangement, string][] {
  return [
    ['ring', ts('arr.ring')],
    ['row', ts('arr.row')],
  ];
}

/** 圈數用示意圖而不是文字，一眼看得出幾個圈；5／6 圈畫成環狀，與 ring 的排列一致 */
const COUNT_ICONS: [CircleCount, string][] = [
  [2, '<circle cx="15" cy="11" r="8"/><circle cx="25" cy="11" r="8"/>'],
  [
    3,
    '<circle cx="20" cy="8" r="7"/><circle cx="15" cy="14" r="7"/><circle cx="25" cy="14" r="7"/>',
  ],
  [
    4,
    '<circle cx="16" cy="8" r="6.5"/><circle cx="24" cy="8" r="6.5"/>' +
      '<circle cx="16" cy="14" r="6.5"/><circle cx="24" cy="14" r="6.5"/>',
  ],
  [
    5,
    '<circle cx="20" cy="6" r="4.5"/><circle cx="24.8" cy="9.5" r="4.5"/>' +
      '<circle cx="22.9" cy="15" r="4.5"/><circle cx="17.1" cy="15" r="4.5"/>' +
      '<circle cx="15.2" cy="9.5" r="4.5"/>',
  ],
  [
    6,
    '<circle cx="20" cy="6" r="4.5"/><circle cx="24.3" cy="8.5" r="4.5"/>' +
      '<circle cx="24.3" cy="13.5" r="4.5"/><circle cx="20" cy="16" r="4.5"/>' +
      '<circle cx="15.7" cy="13.5" r="4.5"/><circle cx="15.7" cy="8.5" r="4.5"/>',
  ],
];

export interface ToolbarHandlers {
  onPatch: (patch: Partial<VennState>) => void;
  /** 切形狀（排列 × 圈數）；非法組合不會送出（按鈕已停用） */
  onShape: (arr: Arrangement, n: CircleCount) => void;
  onPatchSlot: (mask: number, patch: Partial<TextSlot>) => void;
  onCopyImage: () => void;
  onCopyLink: () => void;
  onDownloadSvg: () => void;
  /** 切介面語言；實際的導向與記憶由 ui/i18n.ts 處理 */
  onLocale: (locale: Locale) => void;
}

export interface ToolbarController {
  update: (state: VennState, png_url: string) => void;
  /** 展開某一列並捲到看得見（點預覽上的文字時用） */
  openSlot: (mask: number) => void;
}

interface Segmented<T> {
  root: HTMLElement;
  setActive: (value: T) => void;
  /** 停用選不到的選項（例如 row 沒有 2 圈），讓面板自己說明合法組合 */
  setEnabled: (isEnabled: (value: T) => boolean) => void;
}

function segmented<T extends string | number>(
  class_name: string,
  options: [T, string][],
  render: (btn: HTMLButtonElement, label: string) => void,
  onPick: (value: T) => void,
): Segmented<T> {
  const root = document.createElement('div');
  root.className = class_name;
  const buttons: [T, HTMLButtonElement][] = [];

  for (const [value, label] of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    render(btn, label);
    btn.addEventListener('click', () => onPick(value));
    root.append(btn);
    buttons.push([value, btn]);
  }

  return {
    root,
    setActive: (current) => {
      for (const [value, btn] of buttons) btn.setAttribute('aria-pressed', String(value === current));
    },
    setEnabled: (isEnabled) => {
      for (const [value, btn] of buttons) btn.disabled = !isEnabled(value);
    },
  };
}

interface SliderField {
  root: HTMLElement;
  input: HTMLInputElement;
  value_el: HTMLElement;
}

/** 一格「標籤 ＋ 目前值 ＋ 滑桿」 */
function sliderField(
  label_text: string,
  min: number,
  max: number,
  step: number,
  onInput: (value: number) => void,
): SliderField {
  const root = document.createElement('div');
  root.className = 'stack';

  const row = document.createElement('div');
  row.className = 'row';
  const label = document.createElement('label');
  label.textContent = label_text;
  const value_el = document.createElement('span');
  value_el.className = 'val';
  row.append(label, value_el);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.addEventListener('input', () => onInput(Number(input.value)));

  root.append(row, input);
  return { root, input, value_el };
}

/**
 * 只在值真的不同時才寫回控制項。
 * 拖曳中的滑桿本身就是事件來源，回寫同一個值是多餘的，
 * 而寫入不同的值（或整個換掉節點）會中斷瀏覽器的拖曳手勢。
 */
function syncValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  if (el.value !== value) el.value = value;
}

function labeledRow(label_text: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row';
  const label = document.createElement('label');
  label.textContent = label_text;
  row.append(label, control);
  return row;
}

export function createToolbar(root: HTMLElement, handlers: ToolbarHandlers): ToolbarController {
  root.replaceChildren();

  // 排列與圈數都要另一半的目前值才組得出形狀，兩個 handler 都從 latest_state 取
  const arr_seg = segmented<Arrangement>(
    'seg',
    arrLabels(),
    (btn, label) => {
      btn.textContent = label;
    },
    (arr) => {
      const n = latest_state?.n ?? 2;
      // row 沒有 2 圈：切過去時退到該排列的最少圈數
      handlers.onShape(arr, isShape(arr, n) ? n : circleCountRange(arr)[0]);
    },
  );
  const arr_row = document.createElement('div');
  arr_row.className = 'row';
  arr_row.append(arr_seg.root);

  const count_seg = segmented<CircleCount>(
    'counts',
    COUNT_ICONS,
    (btn, icon) => {
      btn.innerHTML = `<svg viewBox="0 0 40 22" fill="none" stroke="currentColor" stroke-width="1.6">${icon}</svg>`;
    },
    (n) => handlers.onShape(latest_state ? arrOf(latest_state) : 'ring', n),
  );

  const style_seg = segmented<VennStyle>(
    'seg',
    styleLabels(),
    (btn, label) => {
      btn.textContent = label;
    },
    (style) => handlers.onPatch({ style }),
  );
  const style_row = document.createElement('div');
  style_row.className = 'row';
  style_row.append(style_seg.root);

  const bg_color = createColorControl({
    swatches: BG_SWATCHES,
    onPick: (bg) => {
      if (bg) handlers.onPatch({ bg });
    },
  });
  const bg_row = labeledRow(ts('field.bg'), bg_color.root);

  const opacity = sliderField(ts('field.opacity'), 0.15, 1, 0.05, (o) =>
    handlers.onPatch({ opacity: o }),
  );
  // radius 的範圍依排列而定（row 的圓比 ring 小），所以每次 update 都依 state 重設
  const radius = sliderField(ts('field.radius'), ...radiusRange('ring'), 0.005, (r) =>
    handlers.onPatch({ radius: r }),
  );
  const overlap = sliderField(ts('field.overlap'), OVERLAP_MIN, OVERLAP_MAX, 0.01, (o) =>
    handlers.onPatch({ overlap: o }),
  );

  const slots_el = document.createElement('div');
  slots_el.className = 'slots';

  // 語言下拉：選項名用各語言的自稱，目前值就是這次載入決定的語言
  const lang_select = document.createElement('select');
  for (const locale of LOCALES) {
    const opt = document.createElement('option');
    opt.value = locale;
    opt.textContent = LOCALE_NAMES[locale];
    lang_select.append(opt);
  }
  lang_select.value = uiLocale();
  lang_select.addEventListener('change', () => handlers.onLocale(lang_select.value as Locale));
  const lang_row = labeledRow(ts('lang.field'), lang_select);

  const size_select = document.createElement('select');
  for (const size of SIZE_CHOICES) {
    const opt = document.createElement('option');
    opt.value = String(size);
    opt.textContent = `${size} × ${size}`;
    size_select.append(opt);
  }
  size_select.addEventListener('change', () =>
    handlers.onPatch({ size: Number(size_select.value) }),
  );
  const size_row = labeledRow(ts('field.size'), size_select);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const download_png = document.createElement('a');
  download_png.className = 'primary';
  download_png.textContent = ts('action.downloadPng');
  download_png.download = 'venn.png';

  const actionButton = (label: string, onClick: () => void) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  };

  actions.append(
    download_png,
    actionButton(ts('action.downloadSvg'), handlers.onDownloadSvg),
    actionButton(ts('action.copyImage'), handlers.onCopyImage),
    actionButton(ts('action.copyLink'), handlers.onCopyLink),
  );

  const divider = () => document.createElement('hr');

  root.append(
    arr_row,
    count_seg.root,
    style_row,
    bg_row,
    opacity.root,
    radius.root,
    overlap.root,
    divider(),
    slots_el,
    divider(),
    lang_row,
    size_row,
    actions,
  );

  // 色票與槽列的 handler 都需要最新的 colors，但自己不該持有 state 副本
  let latest_state: VennState | null = null;
  let rows: SlotRow[] = [];

  /** 只有槽數變動才需要重建槽列，其餘情況沿用既有節點（保住展開狀態與游標） */
  function syncRows(state: VennState): void {
    const masks = slotMasks(arrOf(state), state.n);
    if (rows.length !== masks.length) {
      rows = masks.map((mask) =>
        createSlotRow(mask, {
          onPatchSlot: handlers.onPatchSlot,
          onPickCircleColor: (index, color) => {
            if (!latest_state) return;
            const colors = [...latest_state.colors];
            colors[index] = color;
            handlers.onPatch({ colors });
          },
        }),
      );
      slots_el.replaceChildren(...rows.map((row) => row.root));
    }

    const circles = circlesForState(state);
    const blocks = new Map(layout(state).map((block) => [block.mask, block]));
    for (const row of rows) {
      const aspect = popCount(row.mask) === 1 ? LABEL_ASPECT : INTERSECTION_ASPECT;
      const exists = regionBox(circles, row.mask, aspect) !== null;
      row.update(state, blocks.get(row.mask), exists);
    }
  }

  return {
    update(state, png_url) {
      latest_state = state;
      const arr = arrOf(state);

      arr_seg.setActive(arr);
      count_seg.setActive(state.n);
      count_seg.setEnabled((n) => isShape(arr, n));
      style_seg.setActive(state.style);
      bg_color.setValue(state.bg);

      opacity.root.hidden = state.style !== 'translucent';
      opacity.value_el.textContent = state.opacity.toFixed(2);
      syncValue(opacity.input, String(state.opacity));

      const [radius_min, radius_max] = radiusRange(arr);
      // 先放範圍再寫值：範圍還是舊的時候寫進去的值會被瀏覽器夾掉
      radius.input.min = String(radius_min);
      radius.input.max = String(radius_max);
      radius.value_el.textContent = state.radius.toFixed(3);
      syncValue(radius.input, String(state.radius));

      overlap.value_el.textContent = state.overlap.toFixed(2);
      syncValue(overlap.input, String(state.overlap));

      syncRows(state);
      syncValue(size_select, String(state.size));

      download_png.href = png_url;
    },

    openSlot(mask) {
      const row = rows.find((r) => r.mask === mask);
      if (!row) return;
      for (const other of rows) if (other !== row) other.root.open = false;
      row.root.open = true;
      row.root.scrollIntoView({ block: 'nearest' });
    },
  };
}
