/**
 * 編輯器介面字串。key 是「區塊.用途」，值是使用者看到的文案。
 * 只放自然語言：符號（＋／−／—）與色碼格式提示留在 ui/，換語言不會動到它們。
 */
export const STRINGS = {
  // 站台文案：server 注入 <title>／meta／JSON-LD 時取這幾條
  'site.name': '文氏圖產生器',
  'site.description': '填字就有的文氏圖產生器，狀態直接編在網址裡。',
  'site.homeTitle': '文氏圖產生器｜找不到哏圖不會自己做嗎？',
  'site.imageAlt': '文氏圖產生器預覽圖',
  /** 分享頁標題「圖上的字<這裡>站名」的接縫 */
  'site.titleJoiner': '｜',

  // ui/index.html 裡的靜態說明，由 server 依語言換掉（data-i18n）
  'peek.hint': '預覽 · 點一下放大',
  'peek.close': '關閉預覽',

  'arr.ring': '環狀',
  'arr.row': '一列',

  'style.translucent': '半透明',
  'style.flat': '平面',
  'style.outline': '線框',

  'field.bg': '背景',
  'field.opacity': '透明度',
  'field.radius': '大小',
  'field.overlap': '重疊',
  'field.size': '尺寸',
  'field.fs': '字級',
  'field.color': '顏色',

  'action.downloadPng': '下載 PNG',
  'action.downloadSvg': '下載 SVG',
  'action.copyImage': '複製圖片',
  'action.copyLink': '複製連結',

  'fs.auto': '自動',
  'fs.stepDown': '縮小字級',
  'fs.stepUp': '放大字級',
  'color.autoMix': '自動混色',

  'slot.empty': '（空）',
  'slot.noRegion': '目前的圓大小與重疊度下沒有這一區，調過幾何它才會出現。',
  'slot.notFlat': '只有「平面」樣式有可以填色的區域，交集顏色由樣式自己算。',

  'copy.imageUnsupported': '這個瀏覽器不支援複製圖片，請改用「下載 PNG」。',
  'copy.imageFailed': '複製圖片失敗，請改用「下載 PNG」。',
  'copy.linkPrompt': '複製這個連結：',
} as const;
