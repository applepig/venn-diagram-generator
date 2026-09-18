import { ts } from './i18n';

/** 每按一次 ± 的字級倍率，與 01 的畫布工具列一致 */
export const FS_STEP = 1.12;
/** 手動字級的上下限（畫布寬比例）；codec 放到 0.001..1，但那個範圍在 UI 上沒有意義 */
export const FS_MIN = 0.012;
export const FS_MAX = 0.5;

/**
 * state 的 fs 存在「沒有標題的預設空間」，有標題時圖區會再等比縮 `scale`（見 engine/title.ts）。
 * 面板顯示與寫回都要把這一層算進去，否則按一次＋反而讓畫出來的字變小。
 * 標題自己不在圖區裡，所以標題那一列傳 `scale = 1`。
 */
export function fsToPx(unit_fs: number, size: number, scale: number): number {
  return Math.round(unit_fs * scale * size);
}

/**
 * 夾在這一格當下的 px 上下限內（標題那列的上限隨文字而變，見 `maxTitleFs()`）。
 * ± 與手打的值都要先過這一關再寫回 state：超過上限的值排版會夾回同一個字級，
 * 使用者看到的是「按了沒反應」，網址卻一直在變。
 */
export function clampPx(px: number, min_px: number, max_px: number): number {
  return Math.min(max_px, Math.max(min_px, px));
}

/**
 * 這一格的 px 上下限（上限由呼叫端決定，標題那列問 engine 的 `maxTitleFs()`）。
 * 上限比預設下限還低時（行數多到 band 塞不下），下限跟著往下走：
 * 上下限倒置的話 `clampPx` 會把每一次 ± 都夾成同一個值，又變成按了沒反應。
 */
export function fsBoundsPx(
  max_fs: number,
  size: number,
  scale: number,
): { min_px: number; max_px: number } {
  const max_px = fsToPx(max_fs, size, scale);
  return { min_px: Math.min(fsToPx(FS_MIN, size, scale), max_px), max_px };
}

/** 面板上的 px → state 的 fs，夾在 UI 有意義的上下限內 */
export function pxToFs(px: number, size: number, scale: number): number {
  return Math.min(FS_MAX, Math.max(FS_MIN, px / (scale * size)));
}

export interface FsFieldHandlers {
  /** 切回自動字級（清掉 state 上的手動值） */
  onAuto: () => void;
  /** 使用者指定的 px；呼叫端自己換算回 state 的 fs */
  onPick: (px: number) => void;
}

export interface FsFieldView {
  /** 目前該顯示的 px：自動模式時是排版算出來的值 */
  px: number;
  /** true＝使用者手動指定過，外框的 accent 落在 ± 那一側 */
  manual: boolean;
  min_px: number;
  max_px: number;
}

export interface FsField {
  /** 整列（標籤 ＋ 控制項）；沒有字可以調字級時由呼叫端整列隱藏 */
  root: HTMLElement;
  update: (view: FsFieldView) => void;
}

/**
 * 一格字級控制：`[自動] [− N px +]`。文字槽與圖片標題共用同一顆，
 * 兩邊的手感（步進倍率、上下限、打字時不回寫）因此不會各自漂移。
 */
export function createFsField(handlers: FsFieldHandlers): FsField {
  const root = document.createElement('div');
  root.className = 'row';

  const label = document.createElement('label');
  label.textContent = ts('field.fs');

  const box = document.createElement('div');
  box.className = 'fs';

  const auto_btn = document.createElement('button');
  auto_btn.type = 'button';
  auto_btn.className = 'auto-btn';
  auto_btn.textContent = ts('fs.auto');
  auto_btn.addEventListener('click', () => handlers.onAuto());

  const steps = document.createElement('div');
  steps.className = 'steps';
  const num = document.createElement('input');
  num.type = 'number';
  num.className = 'num';
  num.step = '1';
  num.setAttribute('aria-label', ts('field.fs'));
  const unit = document.createElement('span');
  unit.className = 'unit';
  unit.textContent = 'px';

  let shown_px = 0;
  // 上下限由呼叫端每次 update 給：標題那列的上限隨標題文字變（engine 的 maxTitleFs）
  let min_px = 0;
  let max_px = Number.POSITIVE_INFINITY;
  const pick = (px: number) => handlers.onPick(clampPx(px, min_px, max_px));

  const step_down = document.createElement('button');
  step_down.type = 'button';
  step_down.textContent = '−';
  step_down.title = ts('fs.stepDown');
  step_down.addEventListener('click', () => pick(Math.round(shown_px / FS_STEP)));

  const step_up = document.createElement('button');
  step_up.type = 'button';
  step_up.textContent = '+';
  step_up.title = ts('fs.stepUp');
  step_up.addEventListener('click', () => pick(Math.round(shown_px * FS_STEP)));

  // change 而不是 input：邊打邊套用會讓「1」「12」這種中途值先跑一次重繪
  num.addEventListener('change', () => {
    const px = Number(num.value);
    // 清空欄位不是「設成 0」：Number('') 會被 clamp 成最小字級，把字縮到看不見
    if (num.value.trim() === '' || !Number.isFinite(px)) {
      num.value = String(shown_px);
      return;
    }
    pick(px);
  });

  steps.append(step_down, num, unit, step_up);
  box.append(auto_btn, steps);
  root.append(label, box);

  return {
    root,
    update(view) {
      const { px, manual } = view;
      shown_px = px;
      min_px = view.min_px;
      max_px = view.max_px;
      box.dataset.mode = manual ? 'manual' : 'auto';
      num.min = String(min_px);
      num.max = String(max_px);
      // 正在打字的欄位不回寫，否則游標會被推到尾端
      if (num !== document.activeElement && num.value !== String(px)) num.value = String(px);
    },
  };
}
