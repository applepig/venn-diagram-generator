import { ts } from './i18n';
import { canShareImageFile } from './share-image';

export interface ActionsHandlers {
  onCopyImage: () => void;
  /** 只有探測通過時才會被接上按鈕（12 AC1） */
  onShareImage: () => void;
  onCopyLink: () => void;
  onDownloadSvg: () => void;
}

export interface ActionsController {
  root: HTMLElement;
  /** png_url 要等編碼完成才正確，所以 syncUrl() 之後會再叫一次 */
  update: (png_url: string) => void;
  /**
   * 編出來的 `s` 超過 server 收得下的長度時停用會用到它的動作並說明原因（AC15）：
   * 分享連結與 `/api/png` 這時都會被 server 以 400 擋掉，讓按鈕維持可按只會換來壞掉的結果。
   */
  setTooLong: (too_long: boolean) => void;
}

/** 匯出動作排在畫布下方，不進屬性面板（16 AC2） */
export function createActions(root: HTMLElement, handlers: ActionsHandlers): ActionsController {
  root.replaceChildren();

  const actions = document.createElement('div');
  actions.className = 'actions';

  const download_png = document.createElement('a');
  download_png.className = 'primary';
  download_png.textContent = ts('action.downloadPng');
  download_png.download = 'venn.png';

  const actionButton = (label: string, onClick: () => void) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  };

  const copy_link = actionButton(ts('action.copyLink'), handlers.onCopyLink);
  // 收不下 PNG File 的瀏覽器連按鈕都不建：擺一顆按了必定失敗的鈕比沒有更糟（12 AC1）
  const share_image = canShareImageFile()
    ? actionButton(ts('action.shareImage'), handlers.onShareImage)
    : null;

  actions.append(
    download_png,
    actionButton(ts('action.downloadSvg'), handlers.onDownloadSvg),
    actionButton(ts('action.copyImage'), handlers.onCopyImage),
    ...(share_image ? [share_image] : []),
    copy_link,
  );

  // 超長提示：平常隱藏，只有 s 塞不進網址時才出現在動作列上方
  const too_long_hint = document.createElement('p');
  too_long_hint.className = 'note warn';
  too_long_hint.textContent = ts('state.tooLong');
  too_long_hint.hidden = true;

  root.append(too_long_hint, actions);

  let too_long = false;

  return {
    root,

    update(png_url) {
      // 超長時不給 href：<a> 沒有 disabled，拿掉連結才真的點不動
      if (too_long) download_png.removeAttribute('href');
      else download_png.href = png_url;
    },

    setTooLong(next) {
      too_long = next;
      too_long_hint.hidden = !next;
      copy_link.disabled = next;
      // 分享圖片也要停：它抓的 /api/png 這時同樣是 400（12 AC5）
      if (share_image) share_image.disabled = next;
      download_png.setAttribute('aria-disabled', String(next));
      download_png.classList.toggle('disabled', next);
      if (next) download_png.removeAttribute('href');
    },
  };
}
