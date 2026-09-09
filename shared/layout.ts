import {
  EDITOR_PLACEHOLDER,
  INTERSECTION_ASPECT,
  INTERSECTION_START_FS,
  LABEL_ASPECT,
  LABEL_START_FS,
  LINE_HEIGHT,
  MIN_FS,
  SLOT_MASKS,
  popCount,
} from './defaults';
import type { Circle, CircleCount, RegionBox, TextBlock, VennState } from './types';

/**
 * 全部幾何都在「單位空間」計算：畫布寬 = 1，字級與座標都是畫布寬比例。
 * 這讓排版結果與 size 完全無關，同一份 state 在 800 / 1600 產出一致的版面。
 */

// prototype 驗證過的取樣密度：等同 1000px 畫布上每 5px 取一點
const SAMPLE_STEP = 1 / 200;
// 文字框由中心往外長的步進，等同 1000px 畫布上 2px
const GROW_STEP = 0.002;
// 長到邊界後留一點內縮，避免字貼著區域邊緣
const BOX_INSET = 0.92;

const CJK_RANGES = '⺀-鿿豈-﫿＀-￯';
const CJK_RE = new RegExp(`[${CJK_RANGES}]`);
// token：CJK 逐字可斷、Latin／數字連續段不可拆、空白當分隔
const TOKEN_RE = new RegExp(`[${CJK_RANGES}]|[^\\s${CJK_RANGES}]+|\\s+`, 'g');

function charWidth(ch: string): number {
  if (CJK_RE.test(ch)) return 1;
  if (ch === ' ') return 0.3;
  return 0.62;
}

export function estimateWidth(line: string, fs: number): number {
  let sum = 0;
  for (const ch of line) sum += charWidth(ch);
  return sum * fs;
}

/** 單一 token 本身就比框寬時逐字硬斷，否則不可拆的 Latin 長字會直接溢出框 */
function breakOversizedToken(token: string, fs: number, max_w: number): string[] {
  const parts: string[] = [];
  let cur = '';
  for (const ch of token) {
    if (cur && estimateWidth(cur + ch, fs) > max_w) {
      parts.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

export function wrapText(text: string, fs: number, max_w: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const raw = para.match(TOKEN_RE) ?? [];
    const tokens: string[] = [];
    for (const token of raw) {
      if (token.trim() !== '' && estimateWidth(token, fs) > max_w) {
        tokens.push(...breakOversizedToken(token, fs, max_w));
      } else {
        tokens.push(token);
      }
    }
    let cur = '';
    for (const token of tokens) {
      if (cur && estimateWidth(cur + token, fs) > max_w) {
        out.push(cur.trim());
        cur = token.trim() === '' ? '' : token;
      } else {
        cur += token;
      }
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

/** 先換行，塞不下就縮字，縮到下限為止 */
export function fitText(
  text: string,
  box: RegionBox,
  start_fs: number,
  min_fs = MIN_FS,
): { fs: number; lines: string[] } {
  for (let fs = start_fs; fs >= min_fs; fs *= 0.95) {
    const lines = wrapText(text, fs, box.w);
    const longest = Math.max(0, ...lines.map((l) => estimateWidth(l, fs)));
    if (longest <= box.w && lines.length * fs * LINE_HEIGHT <= box.h) return { fs, lines };
  }
  return { fs: min_fs, lines: wrapText(text, min_fs, box.w) };
}

export function circlesFor(n: CircleCount, radius: number, overlap: number): Circle[] {
  const cx = 0.5;
  const cy = 0.5;
  const r = radius;
  const d = overlap * r;

  if (n === 2) {
    return [
      { x: cx - d / 2, y: cy, r },
      { x: cx + d / 2, y: cy, r },
    ];
  }

  if (n === 3) {
    const ring = d / Math.sqrt(3);
    // 整體下移，讓上方那顆圓的標籤有頂部空間
    const gy = cy + ring * 0.25;
    return [-90, 150, 30].map((deg) => {
      const a = (deg * Math.PI) / 180;
      return { x: cx + ring * Math.cos(a), y: gy + ring * Math.sin(a), r };
    });
  }

  // 4 圈：2×2 花瓣
  const h = d / 2;
  return [
    { x: cx - h, y: cy - h, r },
    { x: cx + h, y: cy - h, r },
    { x: cx - h, y: cy + h, r },
    { x: cx + h, y: cy + h, r },
  ];
}

export function maskAt(circles: Circle[], x: number, y: number): number {
  let mask = 0;
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i]!;
    if (Math.hypot(x - c.x, y - c.y) <= c.r) mask |= 1 << i;
  }
  return mask;
}

/**
 * 像素取樣求區域重心，再從重心以固定長寬比向外長矩形，
 * 直到矩形邊界碰到區域邊緣為止。區域不存在或細到放不下框時回傳 null。
 */
// 取樣成本不低（每個區域 200×200 點），編輯器拖曳與拉滑桿時同一組幾何會重算很多次
const box_cache = new Map<string, RegionBox | null>();
const BOX_CACHE_MAX = 512;

export function regionBox(circles: Circle[], mask: number, aspect: number): RegionBox | null {
  const key = `${circles.map((c) => `${c.x},${c.y},${c.r}`).join(';')}|${mask}|${aspect}`;
  const cached = box_cache.get(key);
  if (cached !== undefined) return cached;

  const box = computeRegionBox(circles, mask, aspect);
  if (box_cache.size >= BOX_CACHE_MAX) box_cache.clear();
  box_cache.set(key, box);
  return box;
}

function computeRegionBox(circles: Circle[], mask: number, aspect: number): RegionBox | null {
  let sum_x = 0;
  let sum_y = 0;
  let count = 0;
  for (let y = 0; y < 1; y += SAMPLE_STEP) {
    for (let x = 0; x < 1; x += SAMPLE_STEP) {
      if (maskAt(circles, x, y) === mask) {
        sum_x += x;
        sum_y += y;
        count++;
      }
    }
  }
  if (!count) return null;

  const cx = sum_x / count;
  const cy = sum_y / count;

  let half_w = 0;
  for (let t = GROW_STEP; t <= 1; t += GROW_STEP) {
    const w = t;
    const h = t / aspect;
    let ok = true;
    for (let i = 0; i <= 8 && ok; i++) {
      const f = i / 8;
      const probes: [number, number][] = [
        [cx - w + 2 * w * f, cy - h],
        [cx - w + 2 * w * f, cy + h],
        [cx - w, cy - h + 2 * h * f],
        [cx + w, cy - h + 2 * h * f],
      ];
      ok = probes.every(([x, y]) => maskAt(circles, x, y) === mask);
    }
    if (!ok) break;
    half_w = t;
  }
  if (half_w === 0) return null;

  return { cx, cy, w: 2 * half_w * BOX_INSET, h: ((2 * half_w) / aspect) * BOX_INSET };
}

function startFsFor(kind: 'label' | 'intersection'): number {
  return kind === 'label' ? LABEL_START_FS : INTERSECTION_START_FS;
}

function aspectFor(kind: 'label' | 'intersection'): number {
  return kind === 'label' ? LABEL_ASPECT : INTERSECTION_ASPECT;
}

export function layout(state: VennState, opts: { editor?: boolean } = {}): TextBlock[] {
  const circles = circlesFor(state.n, state.radius, state.overlap);
  const blocks: TextBlock[] = [];

  // 單圈標籤先排，交集後排：交集是主角，畫在上層
  const masks = [...SLOT_MASKS[state.n]].sort((a, b) => popCount(a) - popCount(b));

  for (const mask of masks) {
    const slot = state.texts[String(mask)];
    const text = slot?.t ?? '';
    const is_empty = text.trim() === '';
    if (is_empty && !opts.editor) continue;

    const kind = popCount(mask) === 1 ? 'label' : 'intersection';
    const box = regionBox(circles, mask, aspectFor(kind));
    if (!box) continue;

    const display = is_empty ? EDITOR_PLACEHOLDER : text;
    const manual_fs = typeof slot?.fs === 'number';
    // 手動指定字級時只換行不縮字，否則 +/- 按鈕會被自動排版吃掉
    const fitted = manual_fs
      ? { fs: slot!.fs!, lines: wrapText(display, slot!.fs!, box.w) }
      : fitText(display, box, startFsFor(kind));

    blocks.push({
      mask,
      kind,
      box,
      cx: box.cx + (slot?.dx ?? 0),
      cy: box.cy + (slot?.dy ?? 0),
      fs: fitted.fs,
      lines: fitted.lines,
      placeholder: is_empty,
    });
  }

  return blocks;
}
