import {
  INTERSECTION_ASPECT,
  INTERSECTION_START_FS,
  LABEL_ASPECT,
  LABEL_START_FS,
  LINE_HEIGHT,
  MIN_FS,
  popCount,
} from './defaults';
import { transformBlock } from './fit';
import { arrOf, circlesFor, circlesForState, shapeDefaults } from './shapes/index';
import { estimateWidth, hardLines, wrapManualFs, wrapText } from './text-wrap';
import {
  circlesForRender,
  diagramTransform,
  maxTitleFs,
  titleBox,
  titleTextOf,
} from './title';
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
export const SAMPLE_STEP = 1 / 200;
// 文字框由中心往外長的步進，等同 1000px 畫布上 2px
const GROW_STEP = 0.002;
// 長到邊界後留一點內縮，避免字貼著區域邊緣
const BOX_INSET = 0.92;
// 取樣時「這個點一定配不到這個 mask」的判定緩衝（見 computeRegionBox）
const SKIP_GUARD = 1e-9;

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
  /**
   * 取樣範圍跟著圓的包圍盒走（09 AC4）：幾何超出畫布時（fit 之前的原始座標）
   * 只掃 `[0,1)` 會把區域重心截掉，文字就會擠在畫布邊上。
   * 幾何在畫布內時起點與終點就是 0 與 1，迴圈與現況完全相同。
   */
  const x_start = Math.min(0, ...circles.map((c) => c.x - c.r));
  const x_end = Math.max(1, ...circles.map((c) => c.x + c.r));
  const y_start = Math.min(0, ...circles.map((c) => c.y - c.r));
  const y_end = Math.max(1, ...circles.map((c) => c.y + c.r));

  /**
   * 這一槽的點必須落在**每一顆成員圓**裡，也就是成員圓包圍盒的交集內；
   * 交集外的點一定配不到這個 mask，跳過不算。迴圈的起點與步進不動，
   * 算得進來的點與順序都一樣，重心因此逐位元不變——省的是超界幾何撐大取樣範圍後
   * 那一大片空掃（ring(6) 極端組合約 14 倍）。
   *
   * 交集要外擴 `SKIP_GUARD`：包圍盒是 `c.x − c.r` 減出來的，`maskAt` 用的是 hypot，
   * 圓周上的取樣點兩邊可能差一個浮點尾數（1e-16 級）。緩衝比殘差大七個數量級、
   * 比取樣步進小六個數量級，邊界點因此一律交給 `maskAt` 裁決。
   */
  let mx0 = -Infinity;
  let mx1 = Infinity;
  let my0 = -Infinity;
  let my1 = Infinity;
  for (let i = 0; i < circles.length; i++) {
    if (!(mask & (1 << i))) continue;
    const c = circles[i]!;
    mx0 = Math.max(mx0, c.x - c.r - SKIP_GUARD);
    mx1 = Math.min(mx1, c.x + c.r + SKIP_GUARD);
    my0 = Math.max(my0, c.y - c.r - SKIP_GUARD);
    my1 = Math.min(my1, c.y + c.r + SKIP_GUARD);
  }

  let sum_x = 0;
  let sum_y = 0;
  let count = 0;
  for (let y = y_start; y < y_end; y += SAMPLE_STEP) {
    if (y < my0 || y > my1) continue;
    for (let x = x_start; x < x_end; x += SAMPLE_STEP) {
      if (x < mx0 || x > mx1) continue;
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

/**
 * 這一槽在目前的幾何下畫不畫得出來（09 AC7）。
 * `layout()` 與 `ui/toolbar.ts` 的「區域不存在」都問這一個函式，兩邊因此不會各自取樣：
 * 判定一律用原始幾何（fit 與標題都是等比後製變換，不會讓區域生出來或消失）。
 */
export function regionExists(state: VennState, mask: number): boolean {
  return regionBox(circlesForState(state), mask, aspectFor(kindOf(mask))) !== null;
}

/**
 * 畫布座標（0..1 單位空間）落在哪一個文字槽（14 AC1）。
 *
 * 圓取 `circlesForRender()`：使用者點的是畫出來的圖，fit 與標題變換都得算進去。
 * 回 null 的兩種情況——所有圓之外（AC3），或命中的 mask 不在 `slotMasks()` 裡（AC4，
 * 幾何上生得出來但面板沒有那一列）；呼叫端一律當「什麼都沒點到」處理。
 */
export function slotAtPoint(state: VennState, x: number, y: number): number | null {
  const mask = maskAt(circlesForRender(state), x, y);
  if (mask === 0) return null;
  return slotMasks(arrOf(state), state.n).includes(mask) ? mask : null;
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

  const box = titleBox(state);

  /**
   * 手動字級時只換行不縮字，比照文字槽：否則按＋會被自動排版吃掉。
   * band 會照著字級長高（17 AC1），所以指定多大就畫多大，直到 band 長到上限為止；
   * 之後夾到 `maxTitleFs()`——那是「所有行都還放得下」的字級，字變小但一行都不少：
   * 靜默截掉最後一行等於吃掉使用者打的字，字級變小看得見、也調得回來。
   *
   * 夾值是常數上限而不是「band 減留白再除以行高」，後者會被浮點誤差啃掉一個 ulp，
   * 讓 0.188 畫成 0.18799999999999997。
   */
  const manual_fs =
    state.title_fs === undefined ? undefined : Math.min(state.title_fs, maxTitleFs(state));
  const fitted =
    manual_fs === undefined
      ? fitText(text, box, LABEL_START_FS)
      : { fs: manual_fs, lines: wrapManualFs(text, manual_fs, box.w) };

  // 手動字級的高度由 band 與 maxTitleFs() 一起保證放得下，一行都不必截
  if (manual_fs !== undefined) {
    return { cx: box.cx, cy: box.cy, fs: fitted.fs, lines: fitted.lines };
  }

  // fitText 縮到字級下限仍放不下時不再檢查高度，行數多的標題會衝出 band 被畫布上緣切掉、
  // 還蓋到圖區。band 這時已經是固定高度：截到放得下的行數，寧可少幾行也不出界（08 AC4）。
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
      cx: box.cx,
      cy: box.cy,
      fs: fitted.fs,
      lines: fitted.lines,
    });
  }

  const transform = diagramTransform(state);
  return blocks.map((block) => transformBlock(block, transform));
}
