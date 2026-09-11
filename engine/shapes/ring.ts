import type { Circle } from '../types';

/**
 * 環狀排列。每顆圓的圓心在半徑 R 的環上，
 * R = overlap·r / (2·sin(π/n))，也就是「相鄰兩圓的圓心距剛好是 overlap·r」。
 */

/**
 * 凍結的角度表（度；0° 在右，y 往下為正，所以角度遞增是順時針）。
 * 2／3／4 圈的順序是既有分享連結的 circle index，改動會讓舊連結的顏色與文字整組錯位：
 * 4 圈是方陣順序（0 左上、1 右上、2 左下、3 右下），3 圈的 index 1 在左下、2 在右下，
 * 兩者都不是自然環狀順序。5／6 圈是新的，從 −90° 起順時針。
 */
const RING_ANGLES: Record<number, number[]> = {
  2: [180, 0],
  3: [-90, 150, 30],
  4: [-135, -45, 135, 45],
  5: [-90, -18, 54, 126, 198],
  6: [-90, -30, 30, 90, 150, 210],
};

/** 3 圈整體下移 R·0.25，讓上方那顆圓的標籤有頂部空間（凍結值，見 01-mvp） */
const RING3_OFFSET_Y = 0.25;

/** 環狀排列各圈數的預設幾何（畫布寬比例）。2／3／4 圈是既有連結的值，不得改動。 */
export const RING_DEFAULTS: Record<number, { radius: number; overlap: number }> = {
  2: { radius: 0.3, overlap: 1.2 },
  3: { radius: 0.29, overlap: 1.15 },
  4: { radius: 0.33, overlap: 0.8 },
  // 5／6 圈是這個 sprint 新增的，取「R + r 不超出畫布」下最大的圓
  5: { radius: 0.24, overlap: 1.0 },
  6: { radius: 0.23, overlap: 1.0 },
};

/** 環半徑：相鄰兩圓的圓心距等於 overlap·r */
export function ringRadius(n: number, radius: number, overlap: number): number {
  return (overlap * radius) / (2 * Math.sin(Math.PI / n));
}

/** 座標軸投影量：|t| 在浮點雜訊內視為 0，其餘只取 t 的正負號乘上量值 */
function axis(t: number, magnitude: number): number {
  if (Math.abs(t) < 1e-12) return 0;
  return Math.sign(t) * magnitude;
}

export function ringCircles(n: number, radius: number, overlap: number): Circle[] {
  const d = overlap * radius;
  const R = ringRadius(n, radius, overlap);
  const base_y = 0.5 + (n === 3 ? R * RING3_OFFSET_Y : 0);
  /**
   * 2 圈與 4 圈的角度都落在 45° 的倍數上，R·|cos θ| 與 R·|sin θ| 化簡後剛好是 d/2
   * （cos θ 與 sin(π/n) 約掉）。這裡直接用 d 算，不繞 R·Math.cos：
   * 兩次浮點捨入會與重構前的 `d/2` 差 1 ulp，而 render-svg 印的是圓心座標的全精度字串，
   * 差 1 ulp 就讓舊連結的 SVG 不再位元相同（AC1）。
   */
  const half_d = n === 2 || n === 4 ? d / 2 : null;

  return RING_ANGLES[n]!.map((deg) => {
    const a = (deg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return half_d === null
      ? { x: 0.5 + R * cos, y: base_y + R * sin, r: radius }
      : { x: 0.5 + axis(cos, half_d), y: base_y + axis(sin, half_d), r: radius };
  });
}
