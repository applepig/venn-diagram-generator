/**
 * 介面字串（英文）。key 與 zh-TW 完全對齊；缺 key 時 `t()` 會退回 zh-TW 並在 console 警告。
 * 只放自然語言：符號（＋／−／—）與色碼格式提示留在 ui/，換語言不會動到它們。
 * 撇號一律用 U+2019（’）：ASCII 的 ' 進 meta 屬性會被 escape 成 &apos;，讀起來很難看。
 */
export const STRINGS = {
  'site.name': 'Venn Diagram Maker',
  'site.description': 'Fill in the blanks and get a Venn diagram. The whole state lives in the URL.',
  'site.homeTitle': 'Venn Diagram Maker | Cannot find the meme? Make it yourself.',
  'site.imageAlt': 'Venn Diagram Maker preview',
  'site.titleJoiner': ' | ',

  'peek.hint': 'Preview · tap to enlarge',
  'peek.close': 'Close preview',

  'lang.field': 'Language',

  'shape.more': 'More',
  'shape.row3': 'Row of 3',
  'shape.row4': 'Audi (4 circles)',
  'shape.ring5': 'Flower (5 circles)',
  'shape.ring6': 'Flower (6 circles)',
  'shape.row5': 'Row of 5',
  'shape.row6': 'Row of 6',

  'style.translucent': 'Translucent',
  'style.flat': 'Flat',
  'style.outline': 'Outline',

  'field.title': 'Title',
  'field.bg': 'Background',
  'field.opacity': 'Opacity',
  'field.radius': 'Circle size',
  'field.overlap': 'Overlap',
  'field.size': 'Export size',
  'field.fs': 'Font size',
  'field.color': 'Color',
  'field.textColor': 'Text color',

  'action.downloadPng': 'Download PNG',
  'action.downloadSvg': 'Download SVG',
  'action.copyImage': 'Copy image',
  'action.copyLink': 'Copy link',

  'fs.auto': 'Auto',
  'fs.stepDown': 'Smaller text',
  'fs.stepUp': 'Larger text',
  'color.autoMix': 'Auto blend',
  'color.autoContrast': 'Auto B/W',

  'slot.empty': '(empty)',
  'slot.noRegion': 'This region does not exist at the current circle size and overlap. Adjust the geometry to bring it back.',
  'slot.notFlat': 'Only the flat style has fillable regions; other styles blend intersection colors themselves.',

  'copy.imageUnsupported': 'This browser cannot copy images. Use “Download PNG” instead.',
  'copy.imageFailed': 'Copying the image failed. Use “Download PNG” instead.',
  'copy.linkPrompt': 'Copy this link:',

  'state.tooLong':
    'Too much text to fit in a share link. Delete some to re-enable “Copy link” and “Download PNG”.',
} as const;
