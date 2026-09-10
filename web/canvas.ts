import { renderSvg } from '../shared/render-svg';
import type { VennState } from '../shared/types';

export interface CanvasHandlers {
  getState: () => VennState;
  /** 點到圖上的文字群組；編輯一律在左欄的屬性面板進行 */
  onRegionPicked: (mask: number) => void;
}

export interface CanvasController {
  render: () => void;
}

/** 預覽只負責畫，不接受任何直接編輯（04 AC5） */
export function createCanvas(canvas_el: HTMLElement, handlers: CanvasHandlers): CanvasController {
  canvas_el.addEventListener('click', (event) => {
    const group = (event.target as Element | null)?.closest('[data-region]');
    if (!group) return;
    handlers.onRegionPicked(Number(group.getAttribute('data-region')));
  });

  return {
    render() {
      canvas_el.innerHTML = renderSvg(handlers.getState());
    },
  };
}
