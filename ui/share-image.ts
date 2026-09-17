/**
 * 探測這個瀏覽器收不收得下「一個 PNG 檔」的系統分享（12 AC1）。
 * 不看 UA：能力逐版本在變，問瀏覽器本人比猜型號準。
 * 探測一定要帶真的 PNG File——Safari 是依檔案型別決定收不收，空的 files 問不出結果。
 */
export function canShareImageFile(): boolean {
  try {
    const probe = new File(['x'], 'venn.png', { type: 'image/png' });
    return navigator.canShare?.({ files: [probe] }) === true;
  } catch {
    // 沒有 File 建構子、或 canShare 對不認得的參數直接丟例外的舊瀏覽器
    return false;
  }
}
