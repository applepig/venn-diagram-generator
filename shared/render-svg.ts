import { LINE_HEIGHT } from './defaults';
import { circlesFor, layout } from './layout';
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

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
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
 * 平面填色：每個區域一條由弧段串成的閉合路徑（見 shared/region-geometry.ts）。
 * 相鄰區域共用同一段弧，但兩邊各自抗鋸齒仍會在接縫透出一絲背景色，
 * 所以補一道同色細描邊把接縫蓋掉。
 */
function flatRegions(circles: Circle[], colors: string[], size: number): string {
  // 輸出永遠是 1 使用者單位 = 1 像素，所以描邊寬度用固定值（跨 size 一致地蓋掉 1px 級的接縫）
  const stroke_w = 1.5;
  let body = '';
  for (const [mask, d] of regionPaths(circles, size)) {
    const members: number[] = [];
    for (let i = 0; i < circles.length; i++) if (mask & (1 << i)) members.push(i);
    const color = mixColors(members.map((i) => colors[i] ?? '#888888'));
    body +=
      `<path d="${d}" fill-rule="evenodd" fill="${escapeXml(color)}" ` +
      `stroke="${escapeXml(color)}" stroke-width="${stroke_w}"/>`;
  }
  return body;
}

// ---------- SVG ----------

export function renderSvg(state: VennState, opts: { editor?: boolean } = {}): string {
  const size = state.size;
  const circles = circlesFor(state.n, state.radius, state.overlap);
  const is_outline = state.style === 'outline';

  let defs = '';
  let body = '';

  if (state.style === 'flat') {
    body += flatRegions(circles, state.colors, size);
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

  const text_fill = is_outline ? '#000000' : '#ffffff';
  const glow_attr = is_outline ? '' : ' filter="url(#glow)"';

  for (const block of layout(state, opts)) {
    const fs = block.fs * size;
    const line_h = fs * LINE_HEIGHT;
    const y0 = block.cy * size - ((block.lines.length - 1) * line_h) / 2;
    const tspans = block.lines
      .map(
        (line, i) =>
          `<text x="${block.cx * size}" y="${y0 + i * line_h}" font-size="${fs}">${escapeXml(line)}</text>`,
      )
      .join('');
    const opacity_attr = block.placeholder ? ' opacity="0.35"' : '';
    const placeholder_attr = block.placeholder ? ' data-placeholder="1"' : '';
    body +=
      `<g data-region="${block.mask}"${placeholder_attr}${opacity_attr} fill="${text_fill}" ` +
      `font-family="${FONT_FAMILY}" font-weight="700" text-anchor="middle" ` +
      `dominant-baseline="central"${glow_attr}>${tspans}</g>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<defs>${defs}</defs>` +
    `<rect width="100%" height="100%" fill="${escapeXml(state.bg)}"/>` +
    body +
    `</svg>`
  );
}
