import { placeholderTexts } from '../content/state-presets';
import { slotAtPoint } from '../engine/layout';
import { renderSvg } from '../engine/render-svg';
import { arrOf } from '../engine/shapes/index';
import type { VennState } from '../engine/types';
import { uiLocale } from './i18n';
import { watermarkText } from './watermark';

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
  /** 點到圖上的區域；編輯一律在屬性面板進行 */
  onRegionPicked: (mask: number) => void;
}

export interface CanvasController {
  render: () => void;
}

function maskOf(target: EventTarget | null): number | null {
  const group = (target as Element | null)?.closest('[data-region]');
  return group ? Number(group.getAttribute('data-region')) : null;
}

/**
 * 點擊落在哪一個文字槽（14 AC2）：先認文字群組，沒點到字才用幾何命中測試。
 * 空的區域沒有 `[data-region]` 可認，而 outline 樣式的圓是 `fill="none"`、
 * 連有字以外的地方都只會命中背景 rect，所以幾何測試是空槽唯一的入口。
 *
 * 螢幕座標用 `getScreenCTM()` 換算：SVG 自己的變換與可能的留白都算在裡面，
 * 再除以 viewBox 邊長就是 engine 用的 0..1 單位空間。
 */
function pickedMask(canvas_el: HTMLElement, state: VennState, event: MouseEvent): number | null {
  const tagged = maskOf(event.target);
  if (tagged !== null) return tagged;

  /**
   * 走到這裡表示點的不是文字槽，而浮水印與標題也是 `<text>`（兩者都刻意不帶 `data-region`）。
   * 它們不是可編輯的槽，壓在圓上時也不該讓幾何測試穿透過去開那一列。
   */
  if ((event.target as Element | null)?.closest('text')) return null;

  const svg = canvas_el.querySelector('svg');
  const ctm = svg?.getScreenCTM();
  if (!svg || !ctm) return null;

  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
  const size = svg.viewBox.baseVal.width;
  return slotAtPoint(state, p.x / size, p.y / size);
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

  // 小圖條是 fixed 的，不佔文件空間：大圖還看得到時就藏起來，免得畫面上同時有兩個預覽。
  // 用 fixed 而不是 sticky＋display:none，是因為切換 sticky 元素的顯示會改變文件高度，面板會跳。
  document.body.dataset.peek = 'hidden';
  // 觀察大圖本身而不是整個 .stage：動作列也在 stage 裡，看 stage 會等到動作列也捲出去才滑進來
  const wrap = els.main.closest('.canvas-wrap')!;
  new IntersectionObserver(
    ([entry]) => {
      document.body.dataset.peek = entry?.isIntersecting ? 'hidden' : 'stuck';
    },
    { threshold: 0 },
  ).observe(wrap);

  els.main.addEventListener('click', (event) => {
    const mask = pickedMask(els.main, handlers.getState(), event);
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
      const mask = pickedMask(els.mini, handlers.getState(), event);
      // 點到圓外的空白處不收起，只有點到區域才跳去那一列（14 AC3、AC6）
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
      const state = handlers.getState();
      // 幽靈字只在這裡給：下載 SVG／PNG 與 og 都走沒有 ghosts 的同一支 renderSvg
      const svg = renderSvg(state, {
        watermark: watermarkText(),
        ghosts: placeholderTexts(arrOf(state), state.n, uiLocale()),
      });
      els.main.innerHTML = svg;
      // 同一份 SVG 出現兩次會有兩個 id="glow"，小圖換掉自己那組再插入
      els.mini.innerHTML = svg
        .replaceAll('id="glow"', 'id="glow-mini"')
        .replaceAll('url(#glow)', 'url(#glow-mini)');
    },
  };
}
