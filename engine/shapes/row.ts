import { OVERLAP_MAX, OVERLAP_MIN, RADIUS_MIN } from '../defaults';
import type { Circle } from '../types';

/** 一列 n 顆圓佔掉的畫布寬預算（左右各留 4% 邊） */
const ROW_SPAN = 0.92;

/**
 * 一列 n 顆圓的總寬是 `2r + (n−1)·overlap·r`。radius 取 codec 允許的最小值
 * （row 的圓本來就得比 ring 小，再小就編不進 state），overlap 由總寬反解、
 * 對齊滑桿的 0.01 步進後夾回合法範圍。
 *
 * n=6 反解出 0.52、低於 `OVERLAP_MIN`，夾成 0.6 之後總寬剛好 1.0（圓與畫布邊相切）。
 * 要讓 6 圈一列也留邊，得為 row 放寬 radius 下限——那是 M4 的預設幾何決策。
 */
export function rowDefaults(n: number): { radius: number; overlap: number } {
  const radius = RADIUS_MIN;
  const solved = (ROW_SPAN - 2 * radius) / ((n - 1) * radius);
  const stepped = Math.round(solved * 100) / 100;
  return { radius, overlap: Math.min(OVERLAP_MAX, Math.max(OVERLAP_MIN, stepped)) };
}

/** 水平一列，index 由左到右，整列以畫布中線為中心 */
export function rowCircles(n: number, radius: number, overlap: number): Circle[] {
  const d = overlap * radius;
  const x0 = 0.5 - ((n - 1) * d) / 2;
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * d, y: 0.5, r: radius }));
}
