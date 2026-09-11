import type { StringKey } from '../content/locale';
import type { Arrangement, CircleCount } from '../engine/types';
import { ts } from './i18n';

export interface ShapeChoice {
  arr: Arrangement;
  n: CircleCount;
  /** 選單上的標籤 key（`shape.<arr><n>`） */
  key: StringKey;
}

/** 圈數 icon 那排涵蓋的組合：經典的 ring 2／3／4，選單不必重複列 */
export const COUNT_CHOICES: CircleCount[] = [2, 3, 4];

/** 選單固定列出的四個額外形狀 */
const EXTRA_SHAPES: [Arrangement, CircleCount][] = [
  ['row', 3],
  ['row', 4],
  ['ring', 5],
  ['ring', 6],
];

function choiceOf(arr: Arrangement, n: CircleCount): ShapeChoice {
  return { arr, n, key: `shape.${arr}${n}` as StringKey };
}

/** 圈數 icon 蓋不到的組合＝額外形狀：選單按鈕進 active 態、圈數 icon 全部退出 */
export function isExtraShape(arr: Arrangement, n: CircleCount): boolean {
  return !(arr === 'ring' && COUNT_CHOICES.includes(n));
}

/**
 * 選單要列的項目。UI 沒有入口的組合（row(5)／row(6)，engine 仍支援）
 * 在載入到它時臨時插在最後，選走就消失——否則使用者看不出自己在哪個形狀上。
 */
export function shapeMenuItems(arr: Arrangement, n: CircleCount): ShapeChoice[] {
  const items = EXTRA_SHAPES.map(([a, c]) => choiceOf(a, c));
  const listed = items.some((item) => item.arr === arr && item.n === n);
  if (!listed && isExtraShape(arr, n)) items.push(choiceOf(arr, n));
  return items;
}

export interface ShapeMenu {
  root: HTMLElement;
  /** 依目前組合重建選單項目與 active 態 */
  update: (arr: Arrangement, n: CircleCount) => void;
}

/**
 * 圈數列尾端的額外形狀 dropdown（ADR-08-2）。
 * `<select>` 佔一整行、視覺權重跟語言與尺寸同級，額外形狀是次要入口，所以收成一顆按鈕。
 */
export function createShapeMenu(onPick: (arr: Arrangement, n: CircleCount) => void): ShapeMenu {
  const root = document.createElement('div');
  root.className = 'shape-menu';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'shape-trigger';
  trigger.title = ts('shape.more');
  trigger.setAttribute('aria-label', ts('shape.more'));
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.innerHTML =
    `<svg viewBox="0 0 40 22" fill="none" stroke="currentColor" stroke-width="1.6">` +
    `<circle cx="14" cy="11" r="6"/><circle cx="24" cy="11" r="6"/>` +
    `<path d="M32 9.5 L35 13 L38 9.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`;

  const menu = document.createElement('div');
  menu.className = 'shape-pop';
  menu.setAttribute('role', 'menu');

  const setOpen = (open: boolean): void => {
    if (open) menu.setAttribute('data-open', '');
    else menu.removeAttribute('data-open');
    trigger.setAttribute('aria-expanded', String(open));
  };
  setOpen(false);

  trigger.addEventListener('click', () => setOpen(!menu.hasAttribute('data-open')));

  // 點外面與 Esc 都收起來；listener 掛在 document 上，選單本身不重建節點
  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (target && root.contains(target)) return;
    setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });

  root.append(trigger, menu);

  return {
    root,
    update(arr, n) {
      const items = shapeMenuItems(arr, n);
      menu.replaceChildren(
        ...items.map((item) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.setAttribute('role', 'menuitem');
          btn.textContent = ts(item.key);
          btn.setAttribute('aria-pressed', String(item.arr === arr && item.n === n));
          btn.addEventListener('click', () => {
            setOpen(false);
            onPick(item.arr, item.n);
          });
          return btn;
        }),
      );
      trigger.setAttribute('aria-pressed', String(isExtraShape(arr, n)));
    },
  };
}
