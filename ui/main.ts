import './style.css';
import type { Locale } from '../content/locale';
import { nextStateForLocale, nextStateForShape } from '../content/next-state';
import { sampleState } from '../content/state-presets';
import { MAX_STATE_PARAM_LEN } from '../engine/defaults';
import { renderSvg } from '../engine/render-svg';
import { arrOf } from '../engine/shapes/index';
import { decodeState, encodeState } from '../engine/state-codec-web';
import type { Arrangement, CircleCount, TextSlot, VennState } from '../engine/types';
import { createCanvas } from './canvas';
import { switchLocale, ts, uiLocale } from './i18n';
import { patchSlotTexts } from './patch-slot';
import { searchWithState, shareUrl } from './share-url';
import { createToolbar } from './toolbar';
import { watermarkText } from './watermark';

const panel_el = document.getElementById('panel')!;
const canvas_el = document.getElementById('canvas')!;
const canvas_mini_el = document.getElementById('canvas-mini')!;

const locale = uiLocale();
let state: VennState = sampleState(2, locale);
let encoded = '';
/** 編碼是非同步的，用 token 丟掉過期結果，避免慢的那次蓋掉新的 */
let encode_token = 0;
/** 最近一次的網址同步；切語言要等它做完才知道正確的 `s` */
let pending_sync: Promise<void> = Promise.resolve();
/**
 * 分享正在進行中；觸控裝置很容易連點兩下，而第二次的 `navigator.share()` 會因為
 * 已有分享進行中被 reject，接著走 fallback 把整頁跳走——分享表單還開著就離開編輯器。
 */
let share_in_flight = false;

// 面板只建一次，之後只做增量更新：在 input 事件裡重建節點會中斷拖曳手勢與游標
const toolbar = createToolbar(panel_el, {
  onPatch: (patch) => setState(patch),
  onShape: (arr, n) => setShape(arr, n),
  onPatchSlot: patchSlot,
  onCopyImage: () => void copyImage(),
  onShareImage: () => void shareImage(),
  onCopyLink: () => void copyLink(),
  onDownloadSvg: () => downloadSvg(),
  onLocale: (next) => void changeLocale(next),
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

function setShape(arr: Arrangement, n: CircleCount): void {
  if (arr === arrOf(state) && n === state.n) return;
  state = nextStateForShape(state, arr, n, locale);
  render();
}

function pngUrl(): string {
  return `/api/png?s=${encoded}`;
}

/** 分享連結不帶 lang：收件人用自己的語言看介面 */
function currentShareUrl(): string {
  return shareUrl(location.origin, encoded);
}

/** SVG 由前端這份純函式直接產出，和 /api/png 是同一張圖 */
function downloadSvg(): void {
  const svg = renderSvg(state, { watermark: watermarkText() });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'venn.svg';
  a.click();
  // 同一個 tick 就 revoke，部分瀏覽器會來不及取用而下載空檔；讓出一輪再釋放
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyImage(): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    alert(ts('copy.imageUnsupported'));
    return;
  }
  try {
    const res = await fetch(pngUrl());
    // server 出錯時的內文不能當 PNG 寫進剪貼簿；丟出去讓下面的 catch 照常提示失敗
    if (!res.ok) throw new Error(`/api/png ${res.status}`);

    await navigator.clipboard.write([new ClipboardItem({ 'image/png': await res.blob() })]);
  } catch {
    alert(ts('copy.imageFailed'));
  }
}

/**
 * iPadOS 的 `<a download>` 只到得了「檔案 › 下載項目」，唯一進得了「照片」的路徑是
 * Web Share 帶 File——iOS 的分享表單這時才會出現「儲存影像」（12 AC2）。
 */
async function shareImage(): Promise<void> {
  if (share_in_flight) return;
  share_in_flight = true;
  try {
    const res = await fetch(pngUrl());
    // server 出錯時的內文不能包成 venn.png 送進分享表單；丟出去走 fallback，讓錯誤原樣現形
    if (!res.ok) throw new Error(`/api/png ${res.status}`);

    const file = new File([await res.blob()], 'venn.png', { type: 'image/png' });
    // 只帶 files：舊 Safari 併上 text／url 會整個分享失敗
    await navigator.share({ files: [file] });
  } catch (err) {
    // 使用者自己關掉分享表單不是錯誤，別跳提示（AC3）
    if ((err as { name?: string } | null)?.name === 'AbortError') return;
    // 其餘失敗（例如 await 之後 transient activation 已失效）退回直接開圖：
    // /api/png 沒有 Content-Disposition，會 inline 顯示，長按就能加入照片（AC4）
    location.assign(pngUrl());
  } finally {
    share_in_flight = false;
  }
}

async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(currentShareUrl());
  } catch {
    prompt(ts('copy.linkPrompt'), currentShareUrl());
  }
}

/**
 * 切語言前要用「目前這份 state」的編碼，不能用網址上的 `s`——`syncUrl()` 是非同步的，
 * 最後一筆編輯可能還沒寫回網址就被整頁 reload 帶走（AC19）。
 */
async function changeLocale(next: Locale): Promise<void> {
  // 編碼失敗不該擋住切語言：`switchLocale` 在 encoded 為空時會沿用網址上的 s
  await pending_sync.catch(() => {});
  switchLocale(next, encoded);
}

function render(): void {
  canvas.render();
  toolbar.update(state, pngUrl());
  pending_sync = syncUrl();
  pending_sync.catch(console.error);
}

async function syncUrl(): Promise<void> {
  const token = ++encode_token;
  const next = await encodeState(state);
  if (token !== encode_token) return;
  encoded = next;
  // 只改 s：lang 這類參數留著，不然按一下滑桿就把使用者選的語言從網址上抹掉
  history.replaceState(null, '', searchWithState(location.search, encoded));
  // 超過 server 收得下的長度時，分享連結與 /api/png 都會被擋成 400：先說明再停用（AC15）
  toolbar.setTooLong(encoded.length > MAX_STATE_PARAM_LEN);
  // 編碼完成後才知道正確的下載連結與 og 分享網址，補一次面板
  toolbar.update(state, pngUrl());
}

async function boot(): Promise<void> {
  const s = new URLSearchParams(location.search).get('s');
  if (s) {
    try {
      // 沒編輯過的 template 換成目前語言的版本；使用者改過的字一律不動
      state = nextStateForLocale(await decodeState(s), locale);
    } catch {
      // 壞掉的連結就從範例開始，不要卡在白畫面
      state = sampleState(2, locale);
    }
  }
  render();
}

void boot();
