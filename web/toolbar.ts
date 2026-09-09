import {
  OVERLAP_MAX,
  OVERLAP_MIN,
  PALETTE,
  RADIUS_MAX,
  RADIUS_MIN,
  SIZE_CHOICES,
} from '../shared/defaults';
import type { CircleCount, VennState, VennStyle } from '../shared/types';

const STYLE_LABELS: [VennStyle, string][] = [
  ['translucent', '半透明'],
  ['flat', '平面填色'],
  ['outline', '線框'],
];

const CIRCLE_LABELS: [CircleCount, string][] = [
  [2, '2 圈'],
  [3, '3 圈'],
  [4, '4 圈'],
];

export interface ToolbarHandlers {
  onPatch: (patch: Partial<VennState>) => void;
  onCircleCount: (n: CircleCount) => void;
  onCopyImage: () => void;
  onCopyLink: () => void;
}

export interface ToolbarController {
  update: (state: VennState, png_url: string) => void;
}

interface Field {
  root: HTMLElement;
  label: HTMLLabelElement;
}

function field(label_text: string, control: HTMLElement): Field {
  const root = document.createElement('div');
  root.className = 'field';
  const label = document.createElement('label');
  label.textContent = label_text;
  root.append(label, control);
  return { root, label };
}

interface Segmented<T> {
  root: HTMLElement;
  setActive: (value: T) => void;
}

function segmented<T extends string | number>(
  options: [T, string][],
  onPick: (value: T) => void,
): Segmented<T> {
  const root = document.createElement('div');
  root.className = 'seg';
  const buttons: [T, HTMLButtonElement][] = [];

  for (const [value, label] of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', () => onPick(value));
    root.append(btn);
    buttons.push([value, btn]);
  }

  return {
    root,
    setActive: (current) => {
      for (const [value, btn] of buttons) {
        btn.setAttribute('aria-pressed', String(value === current));
      }
    },
  };
}

function slider(
  min: number,
  max: number,
  step: number,
  onInput: (value: number) => void,
): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'range';
  el.min = String(min);
  el.max = String(max);
  el.step = String(step);
  el.addEventListener('input', () => onInput(Number(el.value)));
  return el;
}

/**
 * 只在值真的不同時才寫回控制項。
 * 拖曳中的滑桿本身就是事件來源，回寫同一個值是多餘的，
 * 而寫入不同的值（或整個換掉節點）會中斷瀏覽器的拖曳手勢。
 */
function syncValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  if (el.value !== value) el.value = value;
}

export function createToolbar(root: HTMLElement, handlers: ToolbarHandlers): ToolbarController {
  root.replaceChildren();

  const count_seg = segmented<CircleCount>(CIRCLE_LABELS, handlers.onCircleCount);
  const count_field = field('圈數', count_seg.root);

  const style_seg = segmented<VennStyle>(STYLE_LABELS, (style) => handlers.onPatch({ style }));
  const style_field = field('樣式', style_seg.root);

  const opacity_input = slider(0.15, 1, 0.05, (opacity) => handlers.onPatch({ opacity }));
  const opacity_field = field('透明度', opacity_input);

  const overlap_input = slider(OVERLAP_MIN, OVERLAP_MAX, 0.01, (overlap) =>
    handlers.onPatch({ overlap }),
  );
  const overlap_field = field('重疊度', overlap_input);

  const radius_input = slider(RADIUS_MIN, RADIUS_MAX, 0.005, (radius) =>
    handlers.onPatch({ radius }),
  );
  const radius_field = field('圓大小', radius_input);

  const swatches = document.createElement('div');
  swatches.className = 'swatches';
  const swatch_inputs: HTMLInputElement[] = [];
  const colors_field = field('每圈顏色', swatches);

  const bg_input = document.createElement('input');
  bg_input.type = 'color';
  bg_input.addEventListener('input', () => handlers.onPatch({ bg: bg_input.value }));
  const bg_field = field('背景色', bg_input);

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
  const size_field = field('輸出尺寸', size_select);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const download = document.createElement('a');
  download.className = 'primary';
  download.textContent = '下載 PNG';
  download.download = 'venn.png';

  const copy_image = document.createElement('button');
  copy_image.type = 'button';
  copy_image.textContent = '複製圖片';
  copy_image.addEventListener('click', handlers.onCopyImage);

  const copy_link = document.createElement('button');
  copy_link.type = 'button';
  copy_link.textContent = '複製連結';
  copy_link.addEventListener('click', handlers.onCopyLink);

  actions.append(download, copy_image, copy_link);

  root.append(
    count_field.root,
    style_field.root,
    opacity_field.root,
    overlap_field.root,
    radius_field.root,
    colors_field.root,
    bg_field.root,
    size_field.root,
    actions,
  );

  // 色票的 input handler 需要最新的 colors，但自己不該持有 state 副本
  let latest_state: VennState | null = null;

  /** 只有圈數變動才需要重建色票列，其餘情況沿用既有節點 */
  function syncSwatches(state: VennState): void {
    if (swatch_inputs.length !== state.n) {
      swatches.replaceChildren();
      swatch_inputs.length = 0;
      for (let i = 0; i < state.n; i++) {
        const input = document.createElement('input');
        input.type = 'color';
        input.addEventListener('input', () => {
          if (!latest_state) return;
          const colors = [...latest_state.colors];
          colors[i] = input.value;
          handlers.onPatch({ colors });
        });
        swatches.append(input);
        swatch_inputs.push(input);
      }
    }
    for (let i = 0; i < swatch_inputs.length; i++) {
      syncValue(swatch_inputs[i]!, state.colors[i] ?? PALETTE[i] ?? '#888888');
    }
  }

  return {
    update(state, png_url) {
      latest_state = state;

      count_seg.setActive(state.n);
      style_seg.setActive(state.style);

      opacity_field.root.hidden = state.style !== 'translucent';
      opacity_field.label.textContent = `透明度 ${state.opacity.toFixed(2)}`;
      syncValue(opacity_input, String(state.opacity));

      overlap_field.label.textContent = `重疊度 ${state.overlap.toFixed(2)}`;
      syncValue(overlap_input, String(state.overlap));

      radius_field.label.textContent = `圓大小 ${state.radius.toFixed(2)}`;
      syncValue(radius_input, String(state.radius));

      syncSwatches(state);
      syncValue(bg_input, state.bg);
      syncValue(size_select, String(state.size));

      download.href = png_url;
    },
  };
}
