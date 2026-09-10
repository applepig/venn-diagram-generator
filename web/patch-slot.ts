import { MAX_TEXT_LEN } from '../shared/defaults';
import type { TextSlot } from '../shared/types';

/** 以 code point 截，不然會砍出落單的 surrogate，validateState 反而擋下來 */
function clampText(t: string): string {
  const code_points = Array.from(t);
  return code_points.length <= MAX_TEXT_LEN ? t : code_points.slice(0, MAX_TEXT_LEN).join('');
}

/**
 * 對單一槽套 patch，回傳新的 texts（純函式，不動傳進來的物件）。
 * patch 裡的 `undefined` 代表「回到自動」，要真的把 key 拿掉，不是留一個 undefined 值在 state 裡。
 * 合併後只剩空文字的槽整個刪掉：不然對空槽按「自動」會留下一個 `{t:''}` 幽靈槽，
 * isPristine 從此為 false，切圈數就不再載入 template。
 */
export function patchSlotTexts(
  texts: Record<string, TextSlot>,
  key: string,
  patch: Partial<TextSlot>,
): Record<string, TextSlot> {
  const slot: TextSlot = { ...(texts[key] ?? { t: '' }), ...patch };
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) delete slot[field as keyof TextSlot];
  }
  slot.t = clampText(slot.t);

  const next = { ...texts };
  const is_empty = slot.t === '' && Object.keys(slot).length === 1;
  if (is_empty) delete next[key];
  else next[key] = slot;
  return next;
}
