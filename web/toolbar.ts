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

function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const el = document.createElement('label');
  el.textContent = label;
  wrap.append(el, control);
  return wrap;
}

function segmented<T extends string | number>(
  options: [T, string][],
  current: T,
  onPick: (value: T) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'seg';
  for (const [value, label] of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.setAttribute('aria-pressed', String(value === current));
    btn.addEventListener('click', () => onPick(value));
    wrap.append(btn);
  }
  return wrap;
}

function slider(
  value: number,
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
  el.value = String(value);
  el.addEventListener('input', () => onInput(Number(el.value)));
  return el;
}

function colorInput(value: string, onInput: (value: string) => void): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'color';
  el.value = value;
  el.addEventListener('input', () => onInput(el.value));
  return el;
}

export interface ToolbarHandlers {
  onPatch: (patch: Partial<VennState>) => void;
  onCircleCount: (n: CircleCount) => void;
  onCopyImage: () => void;
  onCopyLink: () => void;
}

export function renderToolbar(
  root: HTMLElement,
  state: VennState,
  png_url: string,
  handlers: ToolbarHandlers,
): void {
  root.replaceChildren();

  root.append(
    field(
      '圈數',
      segmented<CircleCount>(
        [
          [2, '2 圈'],
          [3, '3 圈'],
          [4, '4 圈'],
        ],
        state.n,
        handlers.onCircleCount,
      ),
    ),
    field(
      '樣式',
      segmented<VennStyle>(STYLE_LABELS, state.style, (style) => handlers.onPatch({ style })),
    ),
  );

  if (state.style === 'translucent') {
    root.append(
      field(
        `透明度 ${state.opacity.toFixed(2)}`,
        slider(state.opacity, 0.15, 1, 0.05, (opacity) => handlers.onPatch({ opacity })),
      ),
    );
  }

  root.append(
    field(
      `重疊度 ${state.overlap.toFixed(2)}`,
      slider(state.overlap, OVERLAP_MIN, OVERLAP_MAX, 0.01, (overlap) =>
        handlers.onPatch({ overlap }),
      ),
    ),
    field(
      `圓大小 ${state.radius.toFixed(2)}`,
      slider(state.radius, RADIUS_MIN, RADIUS_MAX, 0.005, (radius) => handlers.onPatch({ radius })),
    ),
  );

  const swatches = document.createElement('div');
  swatches.className = 'swatches';
  for (let i = 0; i < state.n; i++) {
    swatches.append(
      colorInput(state.colors[i] ?? PALETTE[i] ?? '#888888', (value) => {
        const colors = [...state.colors];
        colors[i] = value;
        handlers.onPatch({ colors });
      }),
    );
  }
  root.append(field('每圈顏色', swatches));

  root.append(field('背景色', colorInput(state.bg, (bg) => handlers.onPatch({ bg }))));

  const size_select = document.createElement('select');
  for (const size of SIZE_CHOICES) {
    const opt = document.createElement('option');
    opt.value = String(size);
    opt.textContent = `${size} × ${size}`;
    opt.selected = size === state.size;
    size_select.append(opt);
  }
  size_select.addEventListener('change', () =>
    handlers.onPatch({ size: Number(size_select.value) }),
  );
  root.append(field('輸出尺寸', size_select));

  const actions = document.createElement('div');
  actions.className = 'actions';

  const download = document.createElement('a');
  download.className = 'primary';
  download.textContent = '下載 PNG';
  download.href = png_url;
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
  root.append(actions);
}
