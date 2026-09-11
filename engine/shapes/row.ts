import type { Circle } from '../types';

/** 一列 n 顆圓佔掉的畫布寬預算（左右各留 4% 邊） */
const ROW_SPAN = 0.92;

/** 預設重疊度：Audi 四環的比例，也保證每個中間圈都留得住自己的單圈槽（overlap ≥ 1） */
const ROW_OVERLAP = 1.15;

/**
 * 一列的圓本來就得比 ring 小：row(6) 的預設 radius 只有 0.119，
 * 所以 radius 下限放寬到 0.1（ring 維持 0.2）。
 */
export const ROW_RADIUS_RANGE: [number, number] = [0.1, 0.35];

/**
 * overlap 固定 1.15，radius 由一列總寬 `2r + (n−1)·overlap·r = ROW_SPAN` 反解。
 *
 * 反解 radius 而不是反解 overlap：overlap < 1 時中間圈會被左右鄰圓夾掉專屬區域
 * （`regionBox` 回 null、槽表缺單圈槽），而 6 顆圓要塞進 0.92 又得把 overlap 壓到 0.52。
 * 反解 radius 就能同時保住「每個圈都標得到字」與「圓不與畫布相切」（AC4）。
 * 不對齊滑桿步進：0.005 的進位會讓 row(6) 的邊界餘裕掉到 0.04 以下。
 */
export function rowDefaults(n: number): { radius: number; overlap: number } {
  return { radius: ROW_SPAN / (2 + (n - 1) * ROW_OVERLAP), overlap: ROW_OVERLAP };
}

/** 水平一列，index 由左到右，整列以畫布中線為中心 */
export function rowCircles(n: number, radius: number, overlap: number): Circle[] {
  const d = overlap * radius;
  const x0 = 0.5 - ((n - 1) * d) / 2;
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * d, y: 0.5, r: radius }));
}
