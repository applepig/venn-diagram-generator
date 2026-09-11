import { DEFAULT_OVERLAP, DEFAULT_RADIUS, SLOT_MASKS } from '../engine/defaults';
import type { CircleCount, VennState } from '../engine/types';
import { PALETTE } from './palette';
import { isPristine, sampleState } from './state-presets';
import { TEMPLATES } from './templates/zh-TW';

/**
 * 切圈數後的新狀態（純函式，UI 只負責套用）。
 * 圈數換了就回到該圈數的預設幾何，避免沿用上一個圈數的滑桿值把版面弄壞。
 * 沒編輯過就整組換成目標圈數的 template；編輯過就只過濾掉新圈數沒有的槽。
 */
export function nextStateForCircleCount(state: VennState, n: CircleCount): VennState {
  const geometry = {
    n,
    colors: Array.from({ length: n }, (_, i) => state.colors[i] ?? PALETTE[i] ?? '#888888'),
    overlap: DEFAULT_OVERLAP[n],
    radius: DEFAULT_RADIUS[n],
  };

  if (isPristine(state)) {
    return { ...state, ...geometry, style: TEMPLATES[n].style, texts: sampleState(n).texts };
  }

  const allowed = new Set(SLOT_MASKS[n].map(String));
  const texts = Object.fromEntries(
    Object.entries(state.texts).filter(([mask]) => allowed.has(mask)),
  );
  return { ...state, ...geometry, texts };
}
