const HEX_RE = /^#[0-9a-f]{6}$/;

/**
 * 同時只開一個 popover。用 module 層的單一 listener 而不是每個控制項各裝一份：
 * 切圈數會整批換掉列，逐一裝在 document 上的 listener 會跟著舊節點留下來。
 */
let open_pop: HTMLElement | null = null;
let listeners_installed = false;

function closePop(): void {
  open_pop?.removeAttribute('data-open');
  open_pop = null;
}

function installGlobalListeners(): void {
  if (listeners_installed) return;
  listeners_installed = true;

  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (target?.closest('.pop') || target?.closest('[data-pop]')) return;
    closePop();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePop();
  });
}

export interface ColorControlOptions {
  swatches: string[];
  /** 有值時色票格多一顆「自動」，選它回傳 null（交集列的自動混色）；空字串代表沒有自動選項 */
  auto_label?: string;
  onPick: (color: string | null) => void;
}

export interface ColorControl {
  root: HTMLElement;
  /** null 代表「自動」 */
  setValue: (color: string | null) => void;
}

/**
 * 一顆色塊按鈕 ＋ 展開後的色票格／hex 輸入／原生色盤。
 * 原生 `<input type="color">` 每次開都要等系統對話框，所以擺在最後一手，不是主要入口。
 */
export function createColorControl(options: ColorControlOptions): ColorControl {
  installGlobalListeners();
  const { swatches, auto_label = '', onPick } = options;

  const root = document.createElement('div');
  root.className = 'color';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.dataset.pop = '';
  const chip = document.createElement('span');
  const caption = document.createElement('span');
  trigger.append(chip, caption);

  const pop = document.createElement('div');
  pop.className = 'pop';
  const grid = document.createElement('div');
  grid.className = 'grid';

  const auto_cell = document.createElement('button');
  if (auto_label) {
    auto_cell.type = 'button';
    auto_cell.className = 'chip auto';
    auto_cell.title = auto_label;
    auto_cell.addEventListener('click', () => {
      closePop();
      onPick(null);
    });
    grid.append(auto_cell);
  }

  const cells: [string, HTMLButtonElement][] = [];
  for (const hex of swatches) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.style.background = hex;
    cell.title = hex;
    cell.addEventListener('click', () => {
      closePop();
      onPick(hex);
    });
    grid.append(cell);
    cells.push([hex, cell]);
  }

  const more = document.createElement('div');
  more.className = 'more';
  const hex_input = document.createElement('input');
  hex_input.type = 'text';
  hex_input.className = 'hex';
  hex_input.spellcheck = false;
  hex_input.placeholder = '#rrggbb';
  const native = document.createElement('input');
  native.type = 'color';
  native.className = 'native';
  more.append(hex_input, native);

  pop.append(grid, document.createElement('hr'), more);
  root.append(trigger, pop);

  let current: string | null = null;

  hex_input.addEventListener('change', () => {
    const hex = hex_input.value.trim().replace(/^#?/, '#').toLowerCase();
    if (!HEX_RE.test(hex)) {
      // 打錯就退回目前的值，不把非法色塞進 state（server 會 400）
      hex_input.value = current ?? '';
      return;
    }
    closePop();
    onPick(hex);
  });

  native.addEventListener('change', () => {
    closePop();
    onPick(native.value);
  });

  trigger.addEventListener('click', () => {
    const was_open = pop.hasAttribute('data-open');
    closePop();
    if (was_open) return;
    pop.setAttribute('data-open', '');
    open_pop = pop;
    // 開在視窗下緣外時使用者只會看到「按了沒反應」，把它捲進來
    pop.scrollIntoView({ block: 'nearest' });
  });

  return {
    root,
    setValue(color) {
      current = color;
      const is_auto = color === null;
      chip.className = is_auto ? 'chip auto' : 'chip';
      chip.style.background = is_auto ? '' : color;
      caption.textContent = is_auto ? auto_label : color;

      auto_cell.setAttribute('aria-pressed', String(is_auto));
      for (const [hex, cell] of cells) {
        cell.setAttribute('aria-pressed', String(!is_auto && hex === color.toLowerCase()));
      }
      if (hex_input.value !== (color ?? '')) hex_input.value = color ?? '';
      native.value = color ?? '#888888';
    },
  };
}
