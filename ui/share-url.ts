/**
 * 分享連結與 URL 同步的純函式（不碰 DOM，才測得動）。
 */

/**
 * 分享連結只帶 `s`：收件人用自己的語言看介面，圖上的文字本來就在 `s` 裡。
 */
export function shareUrl(origin: string, encoded: string): string {
  return `${origin}/?s=${encoded}`;
}

/**
 * `history.replaceState` 用的新 query：只改 `s`，其餘參數（例如 `lang`）原樣保留。
 */
export function searchWithState(search: string, encoded: string): string {
  const params = new URLSearchParams(search);
  params.set('s', encoded);
  return `?${params.toString()}`;
}
