/**
 * 圖片右下角浮水印的文字。
 * 由 server 依 env `VENN_WATERMARK` 注入 `<meta name="venn:watermark">`：
 * 畫布預覽、下載 SVG 與 `/api/png` 因此同一個來源，維持 WYSIWYG。
 * 沒注入就是空字串，`renderSvg` 不畫。
 */
export function watermarkText(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="venn:watermark"]');
  return meta?.content ?? '';
}
