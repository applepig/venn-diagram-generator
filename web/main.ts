import './style.css';
import { sampleState } from '../shared/defaults';
import { nextStateForCircleCount } from '../shared/circle-count';
import { renderSvg } from '../shared/render-svg';
import { decodeState, encodeState } from '../shared/state-codec-web';
import type { CircleCount, TextSlot, VennState } from '../shared/types';
import { createCanvas } from './canvas';
import { patchSlotTexts } from './patch-slot';
import { createToolbar } from './toolbar';

const panel_el = document.getElementById('panel')!;
const canvas_el = document.getElementById('canvas')!;
const canvas_mini_el = document.getElementById('canvas-mini')!;

let state: VennState = sampleState();
let encoded = '';
/** 編碼是非同步的，用 token 丟掉過期結果，避免慢的那次蓋掉新的 */
let encode_token = 0;

// 面板只建一次，之後只做增量更新：在 input 事件裡重建節點會中斷拖曳手勢與游標
const toolbar = createToolbar(panel_el, {
  onPatch: (patch) => setState(patch),
  onCircleCount: (n) => setCircleCount(n),
  onPatchSlot: patchSlot,
  onCopyImage: () => void copyImage(),
  onCopyLink: () => void copyLink(),
  onDownloadSvg: () => downloadSvg(),
});

const canvas = createCanvas(
  { main: canvas_el, mini: canvas_mini_el },
  {
    getState: () => state,
    onRegionPicked: (mask) => toolbar.openSlot(mask),
  },
);

function patchSlot(mask: number, patch: Partial<TextSlot>): void {
  setState({ texts: patchSlotTexts(state.texts, String(mask), patch) });
}

function setState(patch: Partial<VennState>): void {
  state = { ...state, ...patch };
  render();
}

function setCircleCount(n: CircleCount): void {
  if (n === state.n) return;
  state = nextStateForCircleCount(state, n);
  render();
}

function pngUrl(): string {
  return `/api/png?s=${encoded}`;
}

function shareUrl(): string {
  return `${location.origin}/?s=${encoded}`;
}

/** SVG 由前端這份純函式直接產出，和 /api/png 是同一張圖 */
function downloadSvg(): void {
  const url = URL.createObjectURL(new Blob([renderSvg(state)], { type: 'image/svg+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'venn.svg';
  a.click();
  // 同一個 tick 就 revoke，部分瀏覽器會來不及取用而下載空檔；讓出一輪再釋放
  setTimeout(() => URL.revokeObjectURL(url), 0);
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
  // 編碼完成後才知道正確的下載連結與 og 分享網址，補一次面板
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
}

void boot();
