import type { Arrangement, CircleCount, VennStyle } from '../../engine/types';
import type { Template } from './types';

/** 沒有 meme 文案的組合用的單圈標籤（spec ADR：en A–F） */
const LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** 只有單圈標籤、交集留空的 template */
function labelOnly(n: number, style: VennStyle): Template {
  return {
    style,
    texts: Object.fromEntries(
      Array.from({ length: n }, (_, i) => [String(1 << i), { t: LABELS[i]! }]),
    ),
  };
}

/**
 * 各組合的預設 meme（英文），文案取自 spec 的表格。
 * 樣式與 zh-TW 同一組：樣式是版型決定的，不隨語言變。
 * 文字裡的 `\n` 是手動換行，位置以 AC7（每格字級不觸 `MIN_FS`）為判準。
 */
export const TEMPLATES: Record<Arrangement, Partial<Record<CircleCount, Template>>> = {
  ring: {
    2: {
      style: 'flat',
      texts: {
        '1': { t: 'Things I\nshould do' },
        '2': { t: 'Things I\nwant to do' },
        '3': { t: 'Tomorrow' },
      },
    },
    3: {
      style: 'translucent',
      texts: {
        '1': { t: 'Fast' },
        '2': { t: 'Good' },
        '4': { t: 'Cheap' },
        '3': { t: 'Not\ncheap' },
        '5': { t: 'Not\ngood' },
        '6': { t: 'Not\nfast' },
        '7': { t: 'Dream\non' },
      },
    },
    /**
     * 4 圈的區域窄，同一句英文比中文寬約 1.8 倍：spec 表格的原句在預設幾何下
     * 每格都會觸到 `MIN_FS`（AC7），所以在不改語氣的前提下縮短了四格
     * （'4'、'8'、'5'、'12'）。`The\npriest` 的手動換行是為了避開自動折行把
     * 單一長字硬斷成 `Pries|t`。
     */
    4: {
      style: 'outline',
      texts: {
        '1': { t: 'DJ' },
        '2': { t: 'Bank\nrobber' },
        '4': { t: 'The\npriest' },
        '8': { t: 'Mom telling\nher kid to\ntake it off' },
        '3': { t: 'Everybody\nlisten up!' },
        '5': { t: 'Do you\nunderstand\nme?' },
        '10': { t: "Don't make\nme say it\ntwice!" },
        '12': { t: 'There will\nbe trouble' },
        '15': { t: 'Put your\nhands up!!' },
      },
    },
    5: labelOnly(5, 'translucent'),
    6: labelOnly(6, 'translucent'),
  },
  row: {
    3: labelOnly(3, 'outline'),
    4: labelOnly(4, 'outline'),
    5: labelOnly(5, 'outline'),
    6: labelOnly(6, 'outline'),
  },
};
