import './style.css';
import {
  DEFAULT_OVERLAP,
  DEFAULT_RADIUS,
  PALETTE,
  SLOT_MASKS,
  sampleState,
} from '../shared/defaults';
import { decodeState, encodeState } from '../shared/state-codec-web';
import type { CircleCount, TextSlot, VennState } from '../shared/types';
import { createCanvas } from './canvas';
import { createToolbar } from './toolbar';

const toolbar_el = document.getElementById('toolbar')!;
const canvas_el = document.getElementById('canvas')!;
const overlay_el = document.getElementById('overlay')!;

let state: VennState = sampleState();
let encoded = '';
/** 編碼是非同步的，用 token 丟掉過期結果，避免慢的那次蓋掉新的 */
let encode_token = 0;

// 工具列只建一次，之後只做增量更新：在 input 事件裡重建節點會中斷拖曳手勢
const toolbar = createToolbar(toolbar_el, {
  onPatch: (patch) => setState(patch),
  onCircleCount: (n) => setCircleCount(n),
  onCopyImage: () => void copyImage(),
  onCopyLink: () => void copyLink(),
});

const canvas = createCanvas(canvas_el, overlay_el, {
  getState: () => state,
  setText: (mask, t) => patchSlot(mask, { t }),
  patchSlot,
  resetSlot: (mask) => {
    const slot = state.texts[String(mask)];
    if (!slot) return;
    setState({ texts: { ...state.texts, [String(mask)]: { t: slot.t } } });
  },
});

function patchSlot(mask: number, patch: Partial<TextSlot>): void {
  const key = String(mask);
  const current: TextSlot = state.texts[key] ?? { t: '' };
  setState({ texts: { ...state.texts, [key]: { ...current, ...patch } } });
}

function setState(patch: Partial<VennState>): void {
  state = { ...state, ...patch };
  render();
}

function setCircleCount(n: CircleCount): void {
  if (n === state.n) return;
  // 圈數換了就回到該圈數的預設幾何，避免沿用上一個圈數的滑桿值把版面弄壞
  const allowed = new Set(SLOT_MASKS[n].map(String));
  const texts = Object.fromEntries(
    Object.entries(state.texts).filter(([mask]) => allowed.has(mask)),
  );
  const colors = Array.from({ length: n }, (_, i) => state.colors[i] ?? PALETTE[i] ?? '#888888');
  setState({ n, texts, colors, overlap: DEFAULT_OVERLAP[n], radius: DEFAULT_RADIUS[n] });
}

function pngUrl(): string {
  return `/api/png?s=${encoded}`;
}

function shareUrl(): string {
  return `${location.origin}/?s=${encoded}`;
}

async function copyImage(): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    alert('這個瀏覽器不支援複製圖片，請改用「下載 PNG」。');
    return;
  }
  try {
    const blob = await (await fetch(pngUrl())).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch {
    alert('複製圖片失敗，請改用「下載 PNG」。');
  }
}

async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(shareUrl());
  } catch {
    prompt('複製這個連結：', shareUrl());
  }
}

function render(): void {
  canvas.render();
  toolbar.update(state, pngUrl());
  void syncUrl();
}

async function syncUrl(): Promise<void> {
  const token = ++encode_token;
  const next = await encodeState(state);
  if (token !== encode_token) return;
  encoded = next;
  history.replaceState(null, '', `?s=${encoded}`);
  // 編碼完成後才知道正確的下載連結與 og 分享網址，補一次工具列
  toolbar.update(state, pngUrl());
}

async function boot(): Promise<void> {
  const s = new URLSearchParams(location.search).get('s');
  if (s) {
    try {
      state = await decodeState(s);
    } catch {
      // 壞掉的連結就從範例開始，不要卡在白畫面
      state = sampleState();
    }
  }
  render();
  window.addEventListener('resize', () => canvas.render());
}

void boot();
