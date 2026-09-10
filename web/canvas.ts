import { renderSvg } from '../shared/render-svg';
import type { VennState } from '../shared/types';

/** 與 style.css 的單欄斷點同一個值：窄版面才有 sticky 小圖與 overlay */
const NARROW_MQ = '(max-width: 860px)';

export interface CanvasElements {
  /** 頁面頂端的大圖，跟著內容捲走 */
  main: HTMLElement;
  /** sticky 條裡的小圖，點一下放大成 overlay */
  mini: HTMLElement;
}

export interface CanvasHandlers {
  getState: () => VennState;
  /** 點到圖上的文字群組；編輯一律在屬性面板進行 */
  onRegionPicked: (mask: number) => void;
}

export interface CanvasController {
  render: () => void;
}

function maskOf(target: EventTarget | null): number | null {
  const group = (target as Element | null)?.closest('[data-region]');
  return group ? Number(group.getAttribute('data-region')) : null;
}

/** 預覽只負責畫，不接受任何直接編輯（04 AC5） */
export function createCanvas(els: CanvasElements, handlers: CanvasHandlers): CanvasController {
  const peek = els.mini.closest('.peek') as HTMLElement;
  const narrow = window.matchMedia(NARROW_MQ);

  const isOpen = (): boolean => document.body.dataset.preview === 'open';
  const setOpen = (open: boolean): void => {
    document.body.dataset.preview = open ? 'open' : 'peek';
  };
  setOpen(false);

  els.main.addEventListener('click', (event) => {
    const mask = maskOf(event.target);
    if (mask !== null) handlers.onRegionPicked(mask);
  });

  peek.addEventListener('click', (event) => {
    if (!narrow.matches) return;
    // 收合狀態的小圖只有一格高，點不準圖上的字：整條的意思就是「放大」
    if (!isOpen()) {
      setOpen(true);
      return;
    }
    if ((event.target as Element).closest('.canvas-wrap')) {
      const mask = maskOf(event.target);
      // 點到圖的空白處不收起，只有點到文字才跳去那一列
      if (mask === null) return;
      // 先收起 overlay：它蓋住面板，而且鎖住捲動會讓 scrollIntoView 失效
      setOpen(false);
      handlers.onRegionPicked(mask);
      return;
    }
    // 背景與關閉鈕
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
      const svg = renderSvg(handlers.getState());
      els.main.innerHTML = svg;
      // 同一份 SVG 出現兩次會有兩個 id="glow"，小圖換掉自己那組再插入
      els.mini.innerHTML = svg
        .replaceAll('id="glow"', 'id="glow-mini"')
        .replaceAll('url(#glow)', 'url(#glow-mini)');
    },
  };
}
