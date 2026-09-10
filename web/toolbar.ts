import {
  INTERSECTION_ASPECT,
  LABEL_ASPECT,
  OVERLAP_MAX,
  OVERLAP_MIN,
  RADIUS_MAX,
  RADIUS_MIN,
  SIZE_CHOICES,
  SLOT_MASKS,
  popCount,
} from '../shared/defaults';
import { circlesFor, layout, regionBox } from '../shared/layout';
import type { CircleCount, TextSlot, VennState, VennStyle } from '../shared/types';
import { BG_SWATCHES, createColorControl } from './color-control';
import { createSlotRow, type SlotRow } from './slot-row';

const STYLE_LABELS: [VennStyle, string][] = [
  ['translucent', '半透明'],
  ['flat', '平面'],
  ['outline', '線框'],
];

/** 圈數用示意圖而不是文字，一眼看得出 2／3／4 的排列 */
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
];

export interface ToolbarHandlers {
  onPatch: (patch: Partial<VennState>) => void;
  onCircleCount: (n: CircleCount) => void;
  onPatchSlot: (mask: number, patch: Partial<TextSlot>) => void;
  onCopyImage: () => void;
  onCopyLink: () => void;
  onDownloadSvg: () => void;
}

export interface ToolbarController {
  update: (state: VennState, png_url: string) => void;
  /** 展開某一列並捲到看得見（點預覽上的文字時用） */
  openSlot: (mask: number) => void;
}

interface Segmented<T> {
  root: HTMLElement;
  setActive: (value: T) => void;
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

  const count_seg = segmented<CircleCount>(
    'counts',
    COUNT_ICONS,
    (btn, icon) => {
      btn.innerHTML = `<svg viewBox="0 0 40 22" fill="none" stroke="currentColor" stroke-width="1.6">${icon}</svg>`;
    },
    handlers.onCircleCount,
  );

  const style_seg = segmented<VennStyle>(
    'seg',
    STYLE_LABELS,
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
  const bg_row = labeledRow('背景', bg_color.root);

  const opacity = sliderField('透明度', 0.15, 1, 0.05, (o) => handlers.onPatch({ opacity: o }));
  const radius = sliderField('大小', RADIUS_MIN, RADIUS_MAX, 0.005, (r) =>
    handlers.onPatch({ radius: r }),
  );
  const overlap = sliderField('重疊', OVERLAP_MIN, OVERLAP_MAX, 0.01, (o) =>
    handlers.onPatch({ overlap: o }),
  );

  const slots_el = document.createElement('div');
  slots_el.className = 'slots';

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
  const size_row = labeledRow('尺寸', size_select);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const download_png = document.createElement('a');
  download_png.className = 'primary';
  download_png.textContent = '下載 PNG';
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
    actionButton('下載 SVG', handlers.onDownloadSvg),
    actionButton('複製圖片', handlers.onCopyImage),
    actionButton('複製連結', handlers.onCopyLink),
  );

  const divider = () => document.createElement('hr');

  root.append(
    count_seg.root,
    style_row,
    bg_row,
    opacity.root,
    radius.root,
    overlap.root,
    divider(),
    slots_el,
    divider(),
    size_row,
    actions,
  );

  // 色票與槽列的 handler 都需要最新的 colors，但自己不該持有 state 副本
  let latest_state: VennState | null = null;
  let rows: SlotRow[] = [];

  /** 只有圈數變動才需要重建槽列，其餘情況沿用既有節點（保住展開狀態與游標） */
  function syncRows(state: VennState): void {
    const masks = SLOT_MASKS[state.n];
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

    const circles = circlesFor(state.n, state.radius, state.overlap);
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

      count_seg.setActive(state.n);
      style_seg.setActive(state.style);
      bg_color.setValue(state.bg);

      opacity.root.hidden = state.style !== 'translucent';
      opacity.value_el.textContent = state.opacity.toFixed(2);
      syncValue(opacity.input, String(state.opacity));

      radius.value_el.textContent = state.radius.toFixed(2);
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
