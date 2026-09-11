/**
 * 介面字串（日本語）。key 與 zh-TW 完全對齊；缺 key 時 `t()` 會退回 zh-TW 並在 console 警告。
 * 只放自然語言：符號（＋／−／—）與色碼格式提示留在 ui/，換語言不會動到它們。
 */
export const STRINGS = {
  'site.name': 'ベン図メーカー',
  'site.description': '空欄を埋めるだけでベン図ができる。状態はまるごとURLに入っています。',
  'site.homeTitle': 'ベン図メーカー｜ネタ画像がないなら自分で作ればいい',
  'site.imageAlt': 'ベン図メーカーのプレビュー画像',
  'site.titleJoiner': '｜',

  'peek.hint': 'プレビュー · タップで拡大',
  'peek.close': 'プレビューを閉じる',

  'lang.field': '言語',

  'arr.ring': '円形',
  'arr.row': '横一列',

  'style.translucent': '半透明',
  'style.flat': 'フラット',
  'style.outline': '線画',

  'field.bg': '背景',
  'field.opacity': '透明度',
  'field.radius': '大きさ',
  'field.overlap': '重なり',
  'field.size': 'サイズ',
  'field.fs': '文字サイズ',
  'field.color': '色',

  'action.downloadPng': 'PNG を保存',
  'action.downloadSvg': 'SVG を保存',
  'action.copyImage': '画像をコピー',
  'action.copyLink': 'リンクをコピー',

  'fs.auto': '自動',
  'fs.stepDown': '文字を小さく',
  'fs.stepUp': '文字を大きく',
  'color.autoMix': '自動で混色',

  'slot.empty': '（空）',
  'slot.noRegion': '今の円の大きさと重なりでは、この領域はありません。形を調整すると現れます。',
  'slot.notFlat': '塗り分けできるのは「フラット」だけです。ほかのスタイルは交差部分の色を自動で混ぜます。',

  'copy.imageUnsupported': 'このブラウザーは画像のコピーに対応していません。「PNG を保存」を使ってください。',
  'copy.imageFailed': '画像のコピーに失敗しました。「PNG を保存」を使ってください。',
  'copy.linkPrompt': 'このリンクをコピーしてください：',

  'state.tooLong':
    'テキストが多すぎて URL に収まりません。減らすと「リンクをコピー」と「PNG を保存」が使えるようになります。',
} as const;
