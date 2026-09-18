export type VennStyle = 'translucent' | 'flat' | 'outline';

export type CircleCount = 2 | 3 | 4 | 5 | 6;

/** 圓的排列方式：環狀（含 2 圈並排與 4 圈方陣）或水平一列 */
export type Arrangement = 'ring' | 'row';

/**
 * 一個文字槽。`fs` 只在使用者手動調整過時存在，
 * 缺席代表「自動」：字級由 fit 演算法決定。文字一律畫在區域框中心。
 */
export interface TextSlot {
  /** 文字內容，允許 `\n` 換行 */
  t: string;
  /** 手動字級，畫布寬比例 */
  fs?: number;
  /** 該區的填色 override（`#rrggbb`），只在 flat 樣式生效；缺席代表自動混色 */
  fill?: string;
}

export interface VennState {
  v: 1;
  /**
   * 排列方式；缺席＝`ring`。編碼時 `ring` 一律省略，
   * 所以 `v` 維持 1、舊連結的編碼字串也一個位元都不變。
   */
  arr?: Arrangement;
  n: CircleCount;
  /**
   * 圖片標題；畫在畫布頂端的 title band 裡。空字串或缺席＝沒有標題，
   * 編碼時一律省略（與 `arr` 同一手法），所以 `v` 維持 1、舊連結的編碼字串不變。
   */
  title?: string;
  /** 標題的字色（`#rrggbb`）；缺席代表自動：依標題壓著的底色取黑或白。沒有標題時一律不寫進編碼。 */
  title_fill?: string;
  /** 標題的手動字級，畫布寬比例；缺席代表自動 fit。同樣只在有標題時進編碼。 */
  title_fs?: number;
  style: VennStyle;
  /**
   * 圓框線寬度，畫布寬比例（0..`STROKE_W_MAX`）；缺席＝依樣式取預設（見 engine/stroke.ts）。
   * 等於該樣式預設值時一律不寫進編碼，所以沒帶這個欄位的舊連結編碼字串不變。
   */
  stroke_w?: number;
  /** 框線顏色（`#rrggbb`）；缺席＝`DEFAULT_STROKE_COLOR`。框線寬度 0 時不寫進編碼。 */
  stroke?: string;
  opacity: number;
  overlap: number;
  radius: number;
  colors: string[];
  bg: string;
  size: number;
  /** key 是成員圓 bitmask 的十進位字串（circle i = bit i） */
  texts: Record<string, TextSlot>;
}

/** 單位空間（0..1，畫布寬為 1）的圓 */
export interface Circle {
  x: number;
  y: number;
  r: number;
}

/** 單位空間的區域文字框 */
export interface RegionBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export type SlotKind = 'label' | 'intersection';

/** layout() 的輸出：一個已排版好的文字區塊，全部座標都在單位空間 */
export interface TextBlock {
  mask: number;
  kind: SlotKind;
  /** 區域內接文字框 */
  box: RegionBox;
  /** 文字中心，等於 `box` 的中心 */
  cx: number;
  cy: number;
  /** 字級，畫布寬比例 */
  fs: number;
  lines: string[];
}

/** layoutTitle() 的輸出：畫在 title band 裡的標題，座標同樣在單位空間 */
export interface TitleBlock {
  /** 文字中心 */
  cx: number;
  cy: number;
  fs: number;
  lines: string[];
}
