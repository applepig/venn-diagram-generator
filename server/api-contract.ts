// Shared by routes, documentation and smoke checks.

/** 同時進行的點陣化上限：resvg 每張圖吃滿一條 worker thread，開太多只會一起變慢 */
export const MAX_CONCURRENT_RENDERS = 3;
export const RETRY_AFTER_SECONDS = 2;

/**
 * og:image 的 cache 版號。server 不讀它，純粹是 cache-buster：
 * 底圖、版型或 template 文案改動時 bump，逼 CDN 與各社群平台重抓。
 * v2：2 圈 template 改「明天再說」、圖右下角加浮水印。
 * v3：合成時關掉浮水印，底圖已經有品牌名了（正式站目前輸出這版）。
 * v4：改成 build 時預烤靜態檔並加入 dither（開發中，未上線）。
 * v5：v3 與 v4 兩條線合併後的組合（無浮水印＋dither），兩邊都沒產出過，要蓋過 3 與 4。
 */
export const OG_IMAGE_VERSION = 5;
