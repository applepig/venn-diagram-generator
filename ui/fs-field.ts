import { ts } from './i18n';

/** 每按一次 ± 的字級倍率，與 01 的畫布工具列一致 */
const FS_STEP = 1.12;
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

  const step_down = document.createElement('button');
  step_down.type = 'button';
  step_down.textContent = '−';
  step_down.title = ts('fs.stepDown');
  step_down.addEventListener('click', () => handlers.onPick(Math.round(shown_px / FS_STEP)));

  const step_up = document.createElement('button');
  step_up.type = 'button';
  step_up.textContent = '+';
  step_up.title = ts('fs.stepUp');
  step_up.addEventListener('click', () => handlers.onPick(Math.round(shown_px * FS_STEP)));

  // change 而不是 input：邊打邊套用會讓「1」「12」這種中途值先跑一次重繪
  num.addEventListener('change', () => {
    const px = Number(num.value);
    // 清空欄位不是「設成 0」：Number('') 會被 clamp 成最小字級，把字縮到看不見
    if (num.value.trim() === '' || !Number.isFinite(px)) {
      num.value = String(shown_px);
      return;
    }
    handlers.onPick(px);
  });

  steps.append(step_down, num, unit, step_up);
  box.append(auto_btn, steps);
  root.append(label, box);

  return {
    root,
    update({ px, manual, min_px, max_px }) {
      shown_px = px;
      box.dataset.mode = manual ? 'manual' : 'auto';
      num.min = String(min_px);
      num.max = String(max_px);
      // 正在打字的欄位不回寫，否則游標會被推到尾端
      if (num !== document.activeElement && num.value !== String(px)) num.value = String(px);
    },
  };
}
