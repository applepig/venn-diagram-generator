import { maskAt } from './layout';
import type { Circle } from './types';

/**
 * 把一組圓切成「文氏圖區域」的閉合路徑。
 *
 * 作法：各圓在與其他圓的交點處切成弧段 → 每段弧取中點，往圓內／外各偏一點測 membership，
 * 得到這段弧兩側分屬哪兩個區域 → 屬於同一區域的弧段依端點串成閉合迴路 →
 * 一個區域的所有迴路合成單一 `<path>`，用 fill-rule=evenodd 處理環狀（有洞）的區域。
 *
 * 這條路走的原因：巢狀 clipPath 版本讓 resvg 4 圈 1200px 要 2.7 秒（AC 1b 要 < 0.5 秒），
 * 而弧段路徑只是幾十條 `A` 指令，rasterizer 幾乎不花錢。
 */

const TAU = Math.PI * 2;
/** 相切／同心的容差（單位空間，畫布寬 = 1） */
const EPS_TOUCH = 1e-9;
/** 短到這個角度以下的弧段視為數值雜訊 */
const EPS_ARC = 1e-9;
/** membership 探測點離圓周的距離；夠小才不會跨過鄰近的圓周，夠大才穩定 */
const PROBE = 1e-4;

interface Pt {
  x: number;
  y: number;
}

interface Arc {
  /** 所屬圓的 index */
  ci: number;
  /** 起始角（弧度），沿角度遞增方向掃過 span */
  a0: number;
  span: number;
  p0: Pt;
  p1: Pt;
  /** 圓內側那一格的 region mask（一定含 ci） */
  inner: number;
  /** 圓外側那一格的 region mask（一定不含 ci） */
  outer: number;
}

/** 帶方向的弧段：讓區域內部恆在前進方向的同一側，串迴路時每個端點只會有一條出邊 */
interface Directed {
  arc: Arc;
  /** +1 沿角度遞增（區域在圓內），-1 沿角度遞減（區域在圓外） */
  dir: 1 | -1;
  start: Pt;
  end: Pt;
}

function intersectCircles(a: Circle, b: Circle): [Pt, Pt] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d <= EPS_TOUCH) return null; // 同心
  if (d >= a.r + b.r - EPS_TOUCH) return null; // 相離或外切
  if (d <= Math.abs(a.r - b.r) + EPS_TOUCH) return null; // 包含或內切

  const t = (d * d + a.r * a.r - b.r * b.r) / (2 * d);
  const h = Math.sqrt(Math.max(0, a.r * a.r - t * t));
  const mx = a.x + (t / d) * dx;
  const my = a.y + (t / d) * dy;
  return [
    { x: mx - (dy / d) * h, y: my + (dx / d) * h },
    { x: mx + (dy / d) * h, y: my - (dx / d) * h },
  ];
}

function buildArcs(circles: Circle[]): Arc[] {
  const cuts: { angle: number; p: Pt }[][] = circles.map(() => []);
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      const points = intersectCircles(circles[i]!, circles[j]!);
      if (!points) continue;
      // 兩個圓共用同一個點物件，串迴路時端點才會完全吻合
      for (const p of points) {
        cuts[i]!.push({ angle: Math.atan2(p.y - circles[i]!.y, p.x - circles[i]!.x), p });
        cuts[j]!.push({ angle: Math.atan2(p.y - circles[j]!.y, p.x - circles[j]!.x), p });
      }
    }
  }

  const arcs: Arc[] = [];
  circles.forEach((c, i) => {
    const push = (a0: number, span: number, p0: Pt, p1: Pt) => {
      const mid = a0 + span / 2;
      const cos = Math.cos(mid);
      const sin = Math.sin(mid);
      arcs.push({
        ci: i,
        a0,
        span,
        p0,
        p1,
        inner: maskAt(circles, c.x + (c.r - PROBE) * cos, c.y + (c.r - PROBE) * sin),
        outer: maskAt(circles, c.x + (c.r + PROBE) * cos, c.y + (c.r + PROBE) * sin),
      });
    };

    const list = cuts[i]!.sort((a, b) => a.angle - b.angle);
    if (list.length === 0) {
      // 完全分離或完全被包含的圓：整圈是一段弧
      const p = { x: c.x + c.r, y: c.y };
      push(0, TAU, p, p);
      return;
    }
    for (let k = 0; k < list.length; k++) {
      const cur = list[k]!;
      const next = list[(k + 1) % list.length]!;
      let span = next.angle - cur.angle;
      if (span <= 0) span += TAU;
      if (span < EPS_ARC) continue;
      push(cur.angle, span, cur.p, next.p);
    }
  });
  return arcs;
}

function pointKey(p: Pt): string {
  return `${p.x.toFixed(9)},${p.y.toFixed(9)}`;
}

function loopsFor(arcs: Arc[], mask: number): Directed[][] {
  const items: Directed[] = [];
  for (const arc of arcs) {
    if (arc.inner === mask) items.push({ arc, dir: 1, start: arc.p0, end: arc.p1 });
    else if (arc.outer === mask) items.push({ arc, dir: -1, start: arc.p1, end: arc.p0 });
  }
  if (items.length === 0) return [];

  const by_start = new Map<string, Directed[]>();
  for (const item of items) {
    const key = pointKey(item.start);
    const bucket = by_start.get(key);
    if (bucket) bucket.push(item);
    else by_start.set(key, [item]);
  }

  const used = new Set<Directed>();
  const loops: Directed[][] = [];
  for (const seed of items) {
    if (used.has(seed)) continue;
    const loop: Directed[] = [];
    let cur: Directed | undefined = seed;
    while (cur && !used.has(cur)) {
      used.add(cur);
      loop.push(cur);
      if (cur.arc.span >= TAU) break; // 整圓自成一個迴路
      // 端點相接的下一段；退化情況（三圓共點）取第一條可用的，路徑仍會閉合
      cur = (by_start.get(pointKey(cur.end)) ?? []).find((x) => !used.has(x));
    }
    loops.push(loop);
  }
  return loops;
}

function num(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

function pathOf(loops: Directed[][], circles: Circle[], size: number): string {
  let d = '';
  for (const loop of loops) {
    const first = loop[0];
    if (!first) continue;
    const c = circles[first.arc.ci]!;
    const r = c.r * size;

    if (first.arc.span >= TAU) {
      // A 指令畫不出 360°，整圓拆成兩段半圓
      const sweep = first.dir === 1 ? 1 : 0;
      const left = num((c.x - c.r) * size);
      const right = num((c.x + c.r) * size);
      const cy = num(c.y * size);
      d +=
        `M${left} ${cy}A${num(r)} ${num(r)} 0 1 ${sweep} ${right} ${cy}` +
        `A${num(r)} ${num(r)} 0 1 ${sweep} ${left} ${cy}Z`;
      continue;
    }

    d += `M${num(first.start.x * size)} ${num(first.start.y * size)}`;
    for (const item of loop) {
      const ri = circles[item.arc.ci]!.r * size;
      const large = item.arc.span > Math.PI ? 1 : 0;
      const sweep = item.dir === 1 ? 1 : 0;
      d +=
        `A${num(ri)} ${num(ri)} 0 ${large} ${sweep} ` +
        `${num(item.end.x * size)} ${num(item.end.y * size)}`;
    }
    d += 'Z';
  }
  return d;
}

/**
 * 回傳每個存在的區域（成員 bitmask）對應的 `<path d="…">`，座標已乘上 size。
 * 不存在的區域不會出現在結果裡。路徑需搭配 `fill-rule="evenodd"` 使用。
 */
export function regionPaths(circles: Circle[], size: number): Map<number, string> {
  const arcs = buildArcs(circles);
  const paths = new Map<number, string>();
  for (let mask = 1; mask < 1 << circles.length; mask++) {
    const loops = loopsFor(arcs, mask);
    if (loops.length === 0) continue;
    const d = pathOf(loops, circles, size);
    if (d) paths.set(mask, d);
  }
  return paths;
}
