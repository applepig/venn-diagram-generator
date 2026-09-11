import type { Arrangement, CircleCount, VennStyle } from '../../engine/types';
import type { Template } from './types';

/** 沒有 meme 文案的組合用的單圈標籤（spec ADR：ja 沿用 A–F） */
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
 * 各組合的預設 meme（日本語），文案取自 spec 的表格。
 * 樣式與 zh-TW 同一組：樣式是版型決定的，不隨語言變。
 * 文字裡的 `\n` 是手動換行，位置以 AC13（每格字級不觸 `MIN_FS`）為判準。
 * 3 圈用吉野家的「早い・うまい・安い」。
 */
export const TEMPLATES: Record<Arrangement, Partial<Record<CircleCount, Template>>> = {
  ring: {
    2: {
      style: 'flat',
      texts: {
        '1': { t: 'やるべき\nこと' },
        '2': { t: 'やりたい\nこと' },
        // 手動換行：不然 4 字會被自動折成「明日や／る」
        '3': { t: '明日\nやる' },
      },
    },
    3: {
      style: 'translucent',
      texts: {
        '1': { t: '早い' },
        '2': { t: 'うまい' },
        '4': { t: '安い' },
        '3': { t: '安く\nない' },
        '5': { t: 'うまく\nない' },
        '6': { t: '早く\nない' },
        '7': { t: '夢のまた夢' },
      },
    },
    4: {
      style: 'outline',
      texts: {
        '1': { t: 'DJ' },
        '2': { t: '銀行\n強盗' },
        '4': { t: '牧師' },
        '8': { t: 'セーターを\n脱がせたい\n母' },
        '3': { t: '「みんな\n聞け!」' },
        // 4 圈的相鄰交集很窄：這兩格排成兩行都剛好觸到 `MIN_FS`，改成三行才有餘裕（AC13）
        '5': { t: '「言ってる\n意味\nわかる?」' },
        '10': { t: '「二度も\n言わせる\nな!」' },
        '12': { t: '「ひどい目に\n遭うぞ」' },
        '15': { t: '手を\n上げろ!!' },
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
