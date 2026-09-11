import type { CircleCount, TextSlot, VennStyle } from '../../engine/types';

export interface Template {
  style: VennStyle;
  texts: Record<string, TextSlot>;
}

/**
 * 每個圈數的預設 meme：文字槽與搭配的樣式，三組各示範一種樣式。
 * 文字裡的 `\n` 是手動換行，避免自動斷成「該做的／事」這種讀不順的行。
 */
export const TEMPLATES: Record<CircleCount, Template> = {
  2: {
    style: 'flat',
    texts: {
      '1': { t: '該做\n的事' },
      '2': { t: '想做\n的事' },
      '3': { t: '明天\n再說' },
    },
  },
  3: {
    style: 'translucent',
    texts: {
      '1': { t: '要快' },
      '2': { t: '要好' },
      '4': { t: '要便宜' },
      '3': { t: '貴' },
      '5': { t: '醜' },
      '6': { t: '慢' },
      '7': { t: '不可能' },
    },
  },
  // Adam Grant「把手舉起來」：菱形環狀 DJ→搶匪→媽媽→牧師 對到方陣 0→1→3→2
  4: {
    style: 'outline',
    texts: {
      '1': { t: 'DJ' },
      '2': { t: '銀行\n搶匪' },
      '4': { t: '牧師' },
      '8': { t: '叫小孩\n把毛衣脫下\n的媽媽' },
      '3': { t: '「大家給我\n聽好!」' },
      '5': { t: '「聽懂我在\n說什麼嗎?」' },
      '10': { t: '「別讓我\n說第二次!」' },
      // 原文「不好好聽話會有嚴重的後果」兩行會觸底，縮成這句
      '12': { t: '「不聽話會有\n嚴重的後果」' },
      '15': { t: '把手\n舉起來!!' },
    },
  },
};
