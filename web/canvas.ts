import { LINE_HEIGHT } from '../shared/defaults';
import { layout } from '../shared/layout';
import { renderSvg } from '../shared/render-svg';
import type { TextBlock, TextSlot, VennState } from '../shared/types';

const DRAG_THRESHOLD_PX = 4;
/** 必須與 .slot-edit 的 border-width 一致 */
const EDIT_BORDER_PX = 2;
const FS_STEP = 1.12;
const FS_MIN = 0.012;
const FS_MAX = 0.5;

export interface CanvasHandlers {
  getState: () => VennState;
  setText: (mask: number, t: string) => void;
  patchSlot: (mask: number, patch: Partial<TextSlot>) => void;
  resetSlot: (mask: number) => void;
}

export interface CanvasController {
  render: () => void;
}

export function createCanvas(
  canvas_el: HTMLElement,
  overlay_el: HTMLElement,
  handlers: CanvasHandlers,
): CanvasController {
  let selected_mask: number | null = null;
  let editing_mask: number | null = null;
  let editor_el: HTMLTextAreaElement | null = null;
  let tools_el: HTMLElement | null = null;

  const blocksOf = (): TextBlock[] => layout(handlers.getState(), { editor: true });
  const blockFor = (mask: number) => blocksOf().find((b) => b.mask === mask) ?? null;

  /** 單位空間 → 畫布 CSS 像素 */
  const px = (unit: number) => unit * canvas_el.clientWidth;

  function finishEdit(): void {
    if (!editor_el) return;
    editor_el.remove();
    editor_el = null;
    editing_mask = null;
    render();
  }

  function deselect(): void {
    selected_mask = null;
    tools_el?.remove();
    tools_el = null;
  }

  function setFontSize(mask: number, next: number): void {
    handlers.patchSlot(mask, { fs: Math.min(FS_MAX, Math.max(FS_MIN, next)) });
  }

  function renderTools(block: TextBlock | null): void {
    tools_el?.remove();
    tools_el = null;
    if (!block) return;

    const el = document.createElement('div');
    el.className = 'slot-tools';
    const height = Math.max(block.lines.length, 1) * block.fs * LINE_HEIGHT;
    el.style.left = `${px(block.cx)}px`;
    el.style.top = `${px(block.cy - height / 2) - 10}px`;

    const button = (label: string, title: string, action: () => void) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.title = title;
      // 不讓按鈕搶走 textarea 的 focus，否則 blur 會先把編輯關掉
      btn.addEventListener('pointerdown', (e) => e.preventDefault());
      btn.addEventListener('click', action);
      return btn;
    };

    el.append(
      button('A−', '縮小字級', () => setFontSize(block.mask, block.fs / FS_STEP)),
      button('A+', '放大字級', () => setFontSize(block.mask, block.fs * FS_STEP)),
      button('恢復自動', '清除手動字級與位移', () => handlers.resetSlot(block.mask)),
    );
    overlay_el.append(el);
    tools_el = el;
  }

  function startEdit(mask: number): void {
    const block = blockFor(mask);
    if (!block) return;

    finishEdit();
    editing_mask = mask;

    const slot = handlers.getState().texts[String(mask)];
    // box-sizing 是 border-box，虛線邊框會吃掉內容寬高，要外加回去
    // 否則文字比 layout 算出來的框窄一圈，一打字就提早折行、第一行還會被裁掉
    const content_w = Math.max(px(block.box.w), 40);
    const content_h = Math.max(px(Math.max(block.lines.length, 1) * block.fs * LINE_HEIGHT), 24);
    const width = content_w + EDIT_BORDER_PX * 2;
    const height = content_h + EDIT_BORDER_PX * 2;

    const ta = document.createElement('textarea');
    ta.className = 'slot-edit';
    ta.value = slot?.t ?? '';
    ta.style.left = `${px(block.cx) - width / 2}px`;
    ta.style.top = `${px(block.cy) - height / 2}px`;
    ta.style.width = `${width}px`;
    ta.style.height = `${height}px`;
    ta.style.fontSize = `${px(block.fs)}px`;

    // 估寬演算法與瀏覽器實際字型度量會有幾 px 落差，內容一旦比框高，
    // textarea 會捲到游標處把第一行推出視野。直接讓框長到剛好裝得下。
    const fitHeight = () => {
      ta.style.height = `${height}px`;
      if (ta.scrollHeight > ta.clientHeight) {
        ta.style.height = `${ta.scrollHeight + EDIT_BORDER_PX * 2}px`;
      }
      ta.style.top = `${px(block.cy) - ta.offsetHeight / 2}px`;
      ta.scrollTop = 0;
    };

    ta.addEventListener('input', () => {
      handlers.setText(mask, ta.value);
      fitHeight();
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finishEdit();
      }
    });
    ta.addEventListener('blur', () => finishEdit());

    overlay_el.append(ta);
    editor_el = ta;
    fitHeight();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    render();
  }

  function beginDrag(event: PointerEvent, mask: number): void {
    const slot = handlers.getState().texts[String(mask)];
    const start_x = event.clientX;
    const start_y = event.clientY;
    const base_dx = slot?.dx ?? 0;
    const base_dy = slot?.dy ?? 0;
    let dragged = false;

    const onMove = (e: PointerEvent) => {
      const move_x = e.clientX - start_x;
      const move_y = e.clientY - start_y;
      if (!dragged && Math.hypot(move_x, move_y) < DRAG_THRESHOLD_PX) return;
      dragged = true;
      const w = canvas_el.clientWidth;
      handlers.patchSlot(mask, { dx: base_dx + move_x / w, dy: base_dy + move_y / w });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!dragged) startEdit(mask);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  canvas_el.addEventListener('pointerdown', (event) => {
    const target = event.target as Element | null;
    const group = target?.closest('[data-region]');
    if (!group) {
      finishEdit();
      deselect();
      return;
    }

    const mask = Number(group.getAttribute('data-region'));
    if (editing_mask === mask) return;

    finishEdit();
    selected_mask = mask;
    renderTools(blockFor(mask));
    beginDrag(event, mask);
  });

  function render(): void {
    canvas_el.innerHTML = renderSvg(handlers.getState(), { editor: true });

    // 正在編輯的那一槽由 textarea 代表，SVG 上不重複畫一次
    if (editing_mask !== null) {
      const group = canvas_el.querySelector<SVGElement>(`[data-region="${editing_mask}"]`);
      if (group) group.style.display = 'none';
    }

    if (selected_mask !== null) {
      const block = blockFor(selected_mask);
      if (block) renderTools(block);
      else deselect();
    }
  }

  return { render };
}
