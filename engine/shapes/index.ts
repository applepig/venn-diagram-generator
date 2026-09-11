import type { Arrangement, Circle, CircleCount, VennState } from '../types';
import { RING_DEFAULTS, RING_RADIUS_RANGE, ringCircles } from './ring';
import { ROW_RADIUS_RANGE, rowCircles, rowDefaults } from './row';

export interface ShapeGeometry {
  radius: number;
  overlap: number;
}

interface ShapeDef {
  /** 支援的圈數範圍（含兩端） */
  min_n: CircleCount;
  max_n: CircleCount;
  /** radius 的合法範圍（含兩端）；codec 驗證與 UI 滑桿都依 arr 查這裡 */
  radius_range: [number, number];
  circles: (n: number, radius: number, overlap: number) => Circle[];
  defaults: (n: number) => ShapeGeometry;
}

/**
 * 形狀 registry：排列 × 圈數。
 * 每個排列自己宣告支援的圈數、radius 合法範圍與各圈數的預設幾何。
 * overlap 範圍全排列共用 `OVERLAP_MIN`／`OVERLAP_MAX`。
 */
const SHAPES: Record<Arrangement, ShapeDef> = {
  ring: {
    min_n: 2,
    max_n: 6,
    radius_range: RING_RADIUS_RANGE,
    circles: ringCircles,
    defaults: (n) => RING_DEFAULTS[n]!,
  },
  // row(2) 與 ring(2) 是同一張圖，不給第二種編碼
  row: {
    min_n: 3,
    max_n: 6,
    radius_range: ROW_RADIUS_RANGE,
    circles: rowCircles,
    defaults: rowDefaults,
  },
};

export const ARRANGEMENTS = Object.keys(SHAPES) as Arrangement[];

export function isArrangement(value: unknown): value is Arrangement {
  return value === 'ring' || value === 'row';
}

export function isCircleCount(value: unknown): value is CircleCount {
  return typeof value === 'number' && Number.isInteger(value) && value >= 2 && value <= 6;
}

/** 該排列的 radius 合法範圍（含兩端）；codec 驗證與 UI 滑桿都取這裡 */
export function radiusRange(arr: Arrangement): [number, number] {
  return SHAPES[arr].radius_range;
}

/** 該排列支援的圈數範圍（含兩端）；錯誤訊息與 UI 選單都取這裡 */
export function circleCountRange(arr: Arrangement): [CircleCount, CircleCount] {
  return [SHAPES[arr].min_n, SHAPES[arr].max_n];
}

export function isShape(arr: Arrangement, n: number): boolean {
  return isCircleCount(n) && n >= SHAPES[arr].min_n && n <= SHAPES[arr].max_n;
}

/** state 的排列：缺席＝ring（舊連結沒有這個欄位） */
export function arrOf(state: VennState): Arrangement {
  return state.arr ?? 'ring';
}

export function shapeDefaults(arr: Arrangement, n: CircleCount): ShapeGeometry {
  return SHAPES[arr].defaults(n);
}

export function circlesFor(
  arr: Arrangement,
  n: CircleCount,
  radius: number,
  overlap: number,
): Circle[] {
  return SHAPES[arr].circles(n, radius, overlap);
}

export function circlesForState(state: VennState): Circle[] {
  return circlesFor(arrOf(state), state.n, state.radius, state.overlap);
}
