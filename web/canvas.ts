import { renderSvg } from '../shared/render-svg';
import type { VennState } from '../shared/types';

/** 與 style.css 的單欄斷點同一個值：窄版面才有 peek／overlay 兩段預覽 */
const NARROW_MQ = '(max-width: 860px)';

export interface CanvasHandlers {
  getState: () => VennState;
  /** 點到圖上的文字群組；編輯一律在屬性面板進行 */
  onRegionPicked: (mask: number) => void;
}

export interface CanvasController {
  render: () => void;
}

/** 預覽只負責畫，不接受任何直接編輯（04 AC5） */
export function createCanvas(canvas_el: HTMLElement, handlers: CanvasHandlers): CanvasController {
  const stage = canvas_el.closest('.stage') as HTMLElement;
  const narrow = window.matchMedia(NARROW_MQ);

  const isOpen = (): boolean => document.body.dataset.preview === 'open';
  const setOpen = (open: boolean): void => {
    document.body.dataset.preview = open ? 'open' : 'peek';
  };
  setOpen(false);

  canvas_el.addEventListener('click', (event) => {
    // 窄版面的 peek 條只有一格高，點不準圖上的字：這時整條的意思就是「放大」
    if (narrow.matches && !isOpen()) {
      setOpen(true);
      event.stopPropagation();
      return;
    }
    const group = (event.target as Element | null)?.closest('[data-region]');
    if (!group) return;
    // 先收起 overlay 再展開那一列：overlay 蓋住面板，而且鎖住捲動會讓 scrollIntoView 失效
    setOpen(false);
    handlers.onRegionPicked(Number(group.getAttribute('data-region')));
    // 不讓下面那個 listener 把剛收起來的 overlay 當成「點 peek 條」再打開
    event.stopPropagation();
  });

  stage.addEventListener('click', (event) => {
    if (!narrow.matches) return;
    // peek 條的文字與留白也算「點一下放大」
    if (!isOpen()) {
      setOpen(true);
      return;
    }
    // overlay 展開時，圖以外的地方（背景與關閉鈕）收回 peek
    if ((event.target as Element).closest('.canvas-wrap')) return;
    setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });

  // 轉到寬版面時 overlay 的樣式全部失效，狀態不能留在 open
  narrow.addEventListener('change', (event) => {
    if (!event.matches) setOpen(false);
  });

  return {
    render() {
      canvas_el.innerHTML = renderSvg(handlers.getState());
    },
  };
}
