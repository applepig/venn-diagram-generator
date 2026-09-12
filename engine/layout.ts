import {
  INTERSECTION_ASPECT,
  INTERSECTION_START_FS,
  LABEL_ASPECT,
  LABEL_START_FS,
  LINE_HEIGHT,
  MIN_FS,
  popCount,
} from './defaults';
import { arrOf, circlesFor, circlesForState, shapeDefaults } from './shapes/index';
import { diagramTransform, titleBox, titleTextOf, transformBlock } from './title';
import type {
  Arrangement,
  Circle,
  CircleCount,
  RegionBox,
  TextBlock,
  TitleBlock,
  VennState,
} from './types';

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

// 禁則：這些字不能站在行首（收尾標點），「（ 不能停在行尾（開頭標點）
const NO_LINE_START = '」!?。，、）';
const NO_LINE_END = '「（';

/**
 * 把禁字黏到相鄰 token 上，讓貪婪換行沒有機會在禁則位置斷行。
 * 只在黏完仍放得進框寬時才黏：黏不下就讓禁則退讓——溢出框比禁字站行首更糟
 * （01 spec AC1 明訂觸底時保證水平不溢出）。字級還有空間縮時 fitText 會先縮字，
 * 縮到下限才會走到這個退讓路徑。
 */
function applyKinsoku(tokens: string[], fs: number, max_w: number): string[] {
  const fits = (s: string) => estimateWidth(s, fs) <= max_w;

  const glued: string[] = [];
  for (const token of tokens) {
    const prev = glued[glued.length - 1];
    if (
      prev !== undefined &&
      prev.trim() !== '' &&
      NO_LINE_START.includes(token[0]!) &&
      fits(prev + token)
    ) {
      glued[glued.length - 1] = prev + token;
      continue;
    }
    glued.push(token);
  }

  const out: string[] = [];
  for (let i = glued.length - 1; i >= 0; i--) {
    const token = glued[i]!;
    const next = out[0];
    if (
      next !== undefined &&
      NO_LINE_END.includes(token[token.length - 1]!) &&
      fits(token + next)
    ) {
      out[0] = token + next;
      continue;
    }
    out.unshift(token);
  }
  return out;
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
    for (const token of applyKinsoku(tokens, fs, max_w)) {
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

/**
 * 使用者按 Enter 打出的硬行，沒有換行意圖時回 null。
 * 空行不算手動行（wrapText 一向丟掉空段落），濾完不到兩行就沒有換行意圖，
 * 交給自動折行——否則尾端多按一次 Enter 就會壓成一行、字級崩掉。
 */
function hardLines(text: string): string[] | null {
  const manual = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  return manual.length >= 2 ? manual : null;
}

/**
 * 手動字級下的換行：字級不能動，所以硬行只在每行都放得下時成立；
 * 任一行放不下就整段退回自動折行，用折行保住水平不溢出（01-mvp AC1）。
 */
export function wrapManualFs(text: string, fs: number, max_w: number): string[] {
  const hard = hardLines(text);
  if (hard && hard.every((l) => estimateWidth(l, fs) <= max_w)) return hard;
  return wrapText(text, fs, max_w);
}

// 置中補償只認全形括號：它們的墨跡只佔半格（「靠右、」靠左），
// 置中要補的是那半格空白。!?。，、 的墨跡不偏在半格，整個掛出去反而看起來偏右。
const SHIFT_BRACKET_START = '「（『';
const SHIFT_BRACKET_END = '」）』';
// 行尾的標點串裡只有括號要補償，其餘標點跳過不計（全形半形都要認：
// 打「聽好」！」的人和打「聽好！」」的人看到的偏移是同一個）
const SHIFT_TAIL_SKIP = '!?。，、！？；：';

/**
 * 一行文字置中時要挪的水平量（單位空間）。行首的開括號讓正文看起來偏右、
 * 行尾的收括號讓正文看起來偏左；把兩邊的半格空白差額分攤到兩側就是補償量。
 */
export function centerShift(line: string, fs: number): number {
  let l = 0;
  for (const ch of line) {
    if (!SHIFT_BRACKET_START.includes(ch)) break;
    l++;
  }

  let r = 0;
  for (let i = line.length - 1; i >= 0; i--) {
    const ch = line[i]!;
    if (SHIFT_BRACKET_END.includes(ch)) {
      r++;
      continue;
    }
    if (SHIFT_TAIL_SKIP.includes(ch)) continue;
    break;
  }

  return ((r - l) * 0.5 * fs) / 2;
}

/** 先換行，塞不下就縮字，縮到下限為止 */
export function fitText(
  text: string,
  box: RegionBox,
  start_fs: number,
  min_fs = MIN_FS,
): { fs: number; lines: string[] } {
  // 手動換行是硬換行：只縮字，不再對使用者定好的行做自動折行
  const hard = hardLines(text);
  for (let fs = start_fs; fs >= min_fs; fs *= 0.95) {
    const lines = hard ?? wrapText(text, fs, box.w);
    const longest = Math.max(0, ...lines.map((l) => estimateWidth(l, fs)));
    if (longest <= box.w && lines.length * fs * LINE_HEIGHT <= box.h) return { fs, lines };
  }
  return { fs: min_fs, lines: wrapText(text, min_fs, box.w) };
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

function kindOf(mask: number): 'label' | 'intersection' {
  return popCount(mask) === 1 ? 'label' : 'intersection';
}

function aspectFor(kind: 'label' | 'intersection'): number {
  return kind === 'label' ? LABEL_ASPECT : INTERSECTION_ASPECT;
}

// 每個 (arr, n) 的槽表是常數，但一組要掃 2^n 個 mask × 200×200 取樣：算過就留著
const slot_masks_cache = new Map<string, readonly number[]>();

/**
 * 該 (arr, n) 的合法文字槽（成員 bitmask），依 popCount 遞增、同 popCount 依 mask 遞增排序。
 *
 * 判準只有一條：在該組合的**預設幾何**下 `regionBox()` 非 null，不設面積門檻
 * （2／3／4 圈加門檻反而會多擋掉三重區）。絕不吃 state 的實際幾何：
 * 4 圈 overlap ≥ 1.5 時有五個區域消失，照實際幾何推導會讓這些合法舊連結直接 400。
 */
export function slotMasks(arr: Arrangement, n: CircleCount): readonly number[] {
  const key = `${arr}-${n}`;
  const cached = slot_masks_cache.get(key);
  if (cached) return cached;

  const { radius, overlap } = shapeDefaults(arr, n);
  const circles = circlesFor(arr, n, radius, overlap);
  const masks: number[] = [];
  for (let mask = 1; mask < 1 << n; mask++) {
    if (regionBox(circles, mask, aspectFor(kindOf(mask))) !== null) masks.push(mask);
  }
  masks.sort((a, b) => popCount(a) - popCount(b) || a - b);

  const frozen = Object.freeze(masks);
  slot_masks_cache.set(key, frozen);
  return frozen;
}

/**
 * 標題的排版（08 AC4）：band 內置中、字級自動 fit，手動 `\n` 與自動折行都沿用區域文字那一套。
 * 沒有標題時回 null。
 */
export function layoutTitle(state: VennState): TitleBlock | null {
  const text = titleTextOf(state);
  if (text === '') return null;

  const box = titleBox();
  /**
   * 手動字級時只換行不縮字，比照文字槽：否則按＋會被自動排版吃掉。
   * 但字級再大也不能超過 band 裝得下一行的高度——區域文字溢出只是蓋到隔壁，
   * 標題溢出是直接被畫布上緣切掉（AC4 的「不出界」對手動字級一樣成立）。
   */
  const manual_fs =
    state.title_fs === undefined ? undefined : Math.min(state.title_fs, box.h / LINE_HEIGHT);
  const fitted =
    manual_fs === undefined
      ? fitText(text, box, LABEL_START_FS)
      : { fs: manual_fs, lines: wrapManualFs(text, manual_fs, box.w) };
  // fitText 縮到字級下限仍放不下時不再檢查高度，行數多的標題會衝出 band 被畫布上緣切掉、
  // 還蓋到圖區。band 是固定高度：截到放得下的行數，寧可少幾行也不出界（AC4）。
  const max_lines = Math.max(1, Math.floor(box.h / (fitted.fs * LINE_HEIGHT)));
  return { cx: box.cx, cy: box.cy, fs: fitted.fs, lines: fitted.lines.slice(0, max_lines) };
}

export function layout(state: VennState): TextBlock[] {
  // 排版在「沒有標題」的預設空間算，最後整組套上同一個變換：
  // 取樣密度與槽的有無不受標題影響，有無標題的版面是嚴格的等比關係
  const circles = circlesForState(state);
  const blocks: TextBlock[] = [];

  // 單圈標籤先排，交集後排：交集是主角，畫在上層
  const masks = slotMasks(arrOf(state), state.n);

  for (const mask of masks) {
    const slot = state.texts[String(mask)];
    const text = slot?.t ?? '';
    if (text.trim() === '') continue;

    const kind = kindOf(mask);
    const box = regionBox(circles, mask, aspectFor(kind));
    if (!box) continue;

    const manual_fs = typeof slot?.fs === 'number';
    // 手動指定字級時只換行不縮字，否則 +/- 按鈕會被自動排版吃掉
    const fitted = manual_fs
      ? { fs: slot!.fs!, lines: wrapManualFs(text, slot!.fs!, box.w) }
      : fitText(text, box, startFsFor(kind));

    blocks.push({
      mask,
      kind,
      box,
      cx: box.cx + (slot?.dx ?? 0),
      cy: box.cy + (slot?.dy ?? 0),
      fs: fitted.fs,
      lines: fitted.lines,
    });
  }

  const transform = diagramTransform(state);
  return blocks.map((block) => transformBlock(block, transform));
}
