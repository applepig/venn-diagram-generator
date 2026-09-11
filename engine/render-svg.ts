import { LINE_HEIGHT } from './defaults';
import { centerShift, circlesFor, layout } from './layout';
import { regionPaths } from './region-geometry';
import type { Circle, VennState } from './types';

const FONT_FAMILY = 'Noto Sans TC';

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------- 平面填色的區域配色 ----------

/** state.colors 短於圈數時的備援色（正常流程不會發生，codec 會擋下來） */
const FALLBACK_COLOR = '#888888';

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function rgbToHex(r: number, g: number, b: number): string {
  const channel = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/**
 * 顏料式混色：成員色 RGB 平均後拉飽和並隨層數加深，
 * 讓交集區讀起來是「更深的另一個顏色」而不是灰掉的平均值。
 */
export function mixColors(hexes: string[]): string {
  if (hexes.length === 0) return '#000000';
  if (hexes.length === 1) return hexes[0]!;

  let r = 0;
  let g = 0;
  let b = 0;
  for (const hex of hexes) {
    const [pr, pg, pb] = hexToRgb(hex);
    r += pr / hexes.length;
    g += pg / hexes.length;
    b += pb / hexes.length;
  }
  const [h, s, l] = rgbToHsl(r, g, b);
  const depth = hexes.length - 2; // 雙重 0、三重 1、四重 2
  return hslToHex(h, Math.min(1, Math.max(s * 1.7, 0.6)) * (1 - 0.15 * depth), l * (0.8 - 0.15 * depth));
}

/**
 * 平面填色：每個區域一條由弧段串成的閉合路徑（見 engine/region-geometry.ts）。
 * 相鄰區域共用同一段弧，但兩邊各自抗鋸齒仍會在接縫透出一絲背景色，
 * 所以補一道同色細描邊把接縫蓋掉。
 */
function flatRegions(state: VennState, circles: Circle[], size: number): string {
  // 輸出永遠是 1 使用者單位 = 1 像素，所以描邊寬度用固定值（跨 size 一致地蓋掉 1px 級的接縫）
  const stroke_w = 1.5;
  let body = '';
  for (const [mask, d] of regionPaths(circles, size)) {
    const color = regionColor(state, mask);
    body +=
      `<path d="${d}" fill-rule="evenodd" fill="${escapeXml(color)}" ` +
      `stroke="${escapeXml(color)}" stroke-width="${stroke_w}"/>`;
  }
  return body;
}

// ---------- 亮度與區域代表色 ----------

/** WCAG 相對亮度：sRGB 通道線性化後加權；0 是黑、1 是白 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 超過這個亮度就改用黑字（AC8）；PALETTE 與其混色最亮 0.454，只有淺色 override 會過線 */
const DARK_TEXT_LUMINANCE = 0.6;

function membersOf(mask: number): number[] {
  const members: number[] = [];
  for (let i = 0; mask >> i; i++) if (mask & (1 << i)) members.push(i);
  return members;
}

/**
 * 一個區域在目前樣式下實際看到的顏色：
 * flat 是 `fill` override 或自動混色、translucent 是背景與成員色依圈序 source-over 疊出來的、
 * outline 沒有填色所以是背景色；單圈區一律取該圈的顏色，與面板上的顏色控制項一致。
 */
export function regionColor(state: VennState, mask: number): string {
  const members = membersOf(mask);
  const colorOf = (i: number) => state.colors[i] ?? FALLBACK_COLOR;

  if (state.style === 'flat') {
    return state.texts[String(mask)]?.fill ?? mixColors(members.map(colorOf));
  }
  if (members.length === 1) return colorOf(members[0]!);
  if (state.style === 'outline') return state.bg;

  let [r, g, b] = hexToRgb(state.bg);
  for (const i of members) {
    const [sr, sg, sb] = hexToRgb(colorOf(i));
    const a = state.opacity;
    r = a * sr + (1 - a) * r;
    g = a * sg + (1 - a) * g;
    b = a * sb + (1 - a) * b;
  }
  return rgbToHex(r, g, b);
}

// ---------- 浮水印 ----------

/** 字級與邊距都取畫布寬比例，換 size 時比例不變 */
const WATERMARK_FS = 0.022;
const WATERMARK_PAD = 0.028;
const WATERMARK_OPACITY = 0.38;
/** 浮水印壓在 bg 上，門檻取中間值就夠；區域文字的 DARK_TEXT_LUMINANCE 是另一回事 */
const WATERMARK_DARK_TEXT_LUMINANCE = 0.5;

/**
 * 右下角導流浮水印。四圈最大半徑的圓也碰不到這個角（角落距最近圓心 0.478 > r 上限 0.35），
 * 所以底下一定是 bg，字色只看背景亮度、不需要光暈。
 * 不帶 data-region：畫布點選走 [data-region]，浮水印不該被當成可編輯的槽。
 */
function watermark(state: VennState, text: string): string {
  const size = state.size;
  const fill =
    relativeLuminance(state.bg) >= WATERMARK_DARK_TEXT_LUMINANCE ? '#000000' : '#ffffff';
  const pos = size * (1 - WATERMARK_PAD);
  return (
    `<text x="${pos}" y="${pos}" font-family="${FONT_FAMILY}" font-size="${size * WATERMARK_FS}" ` +
    `text-anchor="end" fill="${fill}" fill-opacity="${WATERMARK_OPACITY}">${escapeXml(text)}</text>`
  );
}

// ---------- SVG ----------

/**
 * 整張畫布專屬的圖層交給呼叫端決定：
 * 合成情境（`server/render-og.ts`）疊到別的底圖上時要關掉背景，不必事後用 regex 剝字串；
 * 浮水印文字是部署設定（站名），engine 自己不認識任何站名。
 */
export interface RenderOptions {
  /** 畫滿版背景 rect；疊圖時關掉才不會蓋住底圖 */
  background?: boolean;
  /** 右下角浮水印的文字；省略或空字串＝不畫 */
  watermark?: string;
}

export function renderSvg(state: VennState, opts: RenderOptions = {}): string {
  const { background = true, watermark: watermark_text = '' } = opts;
  const size = state.size;
  const circles = circlesFor(state.n, state.radius, state.overlap);
  const is_outline = state.style === 'outline';

  let defs = '';
  let body = '';

  if (state.style === 'flat') {
    body += flatRegions(state, circles, size);
    // 挖白（或任何淺色 override）的區域貼在淺色背景上看不出圓，補一圈輪廓把梗撐住；
    // 沒有 override 的 flat 圖不加，舊連結的畫面一個像素都不動
    if (Object.values(state.texts).some((slot) => slot.fill !== undefined)) {
      body += circles
        .map(
          (c) =>
            `<circle cx="${c.x * size}" cy="${c.y * size}" r="${c.r * size}" fill="none" stroke="#000000" stroke-width="${size * 0.004}"/>`,
        )
        .join('');
    }
  } else if (is_outline) {
    body += circles
      .map(
        (c) =>
          `<circle cx="${c.x * size}" cy="${c.y * size}" r="${c.r * size}" fill="none" stroke="#000000" stroke-width="${size * 0.006}"/>`,
      )
      .join('');
  } else {
    body +=
      `<g style="isolation:isolate">` +
      circles
        .map(
          (c, i) =>
            `<circle cx="${c.x * size}" cy="${c.y * size}" r="${c.r * size}" fill="${escapeXml(state.colors[i] ?? '#888888')}" fill-opacity="${state.opacity}"/>`,
        )
        .join('') +
      `</g>`;
  }

  if (!is_outline) {
    defs +=
      `<filter id="glow" x="-20%" y="-20%" width="140%" height="140%">` +
      `<feDropShadow dx="0" dy="0" stdDeviation="${size * 0.006}" flood-color="#000" flood-opacity="0.75"/>` +
      `</filter>`;
  }

  for (const block of layout(state)) {
    // flat 的區域可能被 override 成淺色，白字＋光暈會糊掉，改看該區實際亮度取黑白
    const on_light =
      state.style === 'flat' &&
      relativeLuminance(regionColor(state, block.mask)) >= DARK_TEXT_LUMINANCE;
    const text_fill = is_outline || on_light ? '#000000' : '#ffffff';
    const glow_attr = is_outline || on_light ? '' : ' filter="url(#glow)"';
    const fs = block.fs * size;
    const line_h = fs * LINE_HEIGHT;
    const y0 = block.cy * size - ((block.lines.length - 1) * line_h) / 2;
    const tspans = block.lines
      .map(
        (line, i) =>
          `<text x="${(block.cx + centerShift(line, block.fs)) * size}" y="${y0 + i * line_h}" ` +
          `font-size="${fs}">${escapeXml(line)}</text>`,
      )
      .join('');
    body +=
      `<g data-region="${block.mask}" fill="${text_fill}" ` +
      `font-family="${FONT_FAMILY}" font-weight="700" text-anchor="middle" ` +
      `dominant-baseline="central"${glow_attr}>${tspans}</g>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<defs>${defs}</defs>` +
    (background ? `<rect width="100%" height="100%" fill="${escapeXml(state.bg)}"/>` : '') +
    body +
    (watermark_text ? watermark(state, watermark_text) : '') +
    `</svg>`
  );
}
