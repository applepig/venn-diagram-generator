/**
 * 友善輸入層：把「字母集合」的描述（`AB` ＝第一圈與第二圈的交集）轉成 engine 的 `VennState`，
 * 以及反向轉回來給 `venn decode` 用。
 *
 * CLI 的使用者（人或 agent）不該碰 bitmask：`texts` 的 key 是 `1`、`15` 這種十進位字串，
 * 沒有這層就得自己算 2^i 的 OR，而且算錯只會得到一句「slot 7 does not exist」。
 */
import { slotMasks } from '../engine/layout';
import { popCount } from '../engine/defaults';
import { arrOf, isArrangement, isCircleCount, shapeDefaults } from '../engine/shapes/index';
import { validateState } from '../engine/state-codec';
import type { Arrangement, CircleCount, TextSlot, VennState } from '../engine/types';
import { defaultState } from '../content/state-presets';

/** 圈 index 0..5 對應的字母；圈數上限是 6（`CircleCount`） */
export const LETTERS = 'ABCDEF';

export class SpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecError';
  }
}

/**
 * 一格文字。多數情況只需要文字本身，所以直接給字串；
 * 從編輯器連結 decode 回來的圖可能帶手動字級或區域填色，那時才會是物件形式——
 * 沒有這個形式，「decode → 改字 → 重新產圖」會把使用者在編輯器裡調過的東西弄丟。
 */
export type SpecSlot = string | { t: string; fs?: number; fill?: string };

/** 物件形式的一格文字 */
export type RichSlot = Exclude<SpecSlot, string>;

/** `--json` 收的、`venn decode` 吐的友善格式 */
export interface VennSpec {
  arr?: Arrangement;
  /** 每圈的標籤文字，長度即圈數；空字串＝該圈不給標籤 */
  sets: SpecSlot[];
  /** key 是字母組合（大小寫與順序不拘），只放交集區；單圈標籤走 `sets` */
  texts?: Record<string, SpecSlot>;
  title?: string;
  style?: string;
  opacity?: number;
  overlap?: number;
  radius?: number;
  colors?: string[];
  bg?: string;
  size?: number;
  titleFill?: string;
  titleFs?: number;
}

/**
 * `VennSpec` 的全部欄位。型別標成 `Record<keyof VennSpec, true>`：日後增刪欄位卻漏改這張表，
 * 編譯就會紅——白名單一旦漏掉新欄位，使用者寫對了反而被當成拼錯。
 */
const SPEC_FIELD_SET: Record<keyof VennSpec, true> = {
  arr: true,
  sets: true,
  texts: true,
  title: true,
  style: true,
  opacity: true,
  overlap: true,
  radius: true,
  colors: true,
  bg: true,
  size: true,
  titleFill: true,
  titleFs: true,
};

/** 友善 spec 認得的 top-level 欄位；拼錯時的錯誤訊息與 skill 文件都取這裡 */
export const SPEC_FIELDS: string[] = Object.keys(SPEC_FIELD_SET);

/**
 * 一格文字的形狀檢查。`specToState()` 與 per-slot 旗標共用同一道關卡，
 * 所以 `{"AB": null}` 不管有沒有配 `--fs`，拿到的都是同一句話。
 */
export function checkSlot(raw: unknown, key: string): SpecSlot {
  if (typeof raw === 'string') return raw;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SpecError(`text slot "${key}" must be a string or an object with t`);
  }
  if (typeof (raw as Record<string, unknown>).t !== 'string') {
    throw new SpecError(`text slot "${key}" is missing t`);
  }
  return raw as RichSlot;
}

/** `AB` → 3。大小寫與字母順序不拘，`BA` 等於 `AB`。 */
export function maskFromLetters(letters: string): number {
  // 空白一律忽略：`--text "A B=x"` 這種寫法在 shell 裡很自然，不值得為它報錯
  const key = letters.replace(/\s+/g, '').toUpperCase();
  if (key === '') throw new SpecError('text slot key must not be empty');

  let mask = 0;
  for (const ch of key) {
    const index = LETTERS.indexOf(ch);
    if (index < 0) {
      throw new SpecError(`text slot "${letters}" has an invalid letter "${ch}" (use A..F)`);
    }
    const bit = 1 << index;
    if (mask & bit) throw new SpecError(`text slot "${letters}" repeats the letter "${ch}"`);
    mask |= bit;
  }
  return mask;
}

/** 3 → `AB`。字母一律由小到大，所以同一個 mask 只有一種寫法。 */
export function lettersFromMask(mask: number): string {
  let out = '';
  for (let i = 0; i < LETTERS.length; i++) {
    if (mask >> i & 1) out += LETTERS[i];
  }
  return out;
}

/** 該組合的全部合法槽，以字母表示；錯誤訊息與 skill 文件都取這裡 */
export function validSlotLetters(arr: Arrangement, n: CircleCount): string[] {
  return slotMasks(arr, n).map(lettersFromMask);
}

/** 圈數就是 `sets` 的長度；CLI 在解析 per-slot 旗標前也要先確定它，所以獨立成一個檢查 */
export function circleCountOf(count: number): CircleCount {
  if (!isCircleCount(count)) throw new SpecError(`sets must have 2 to 6 entries, not ${count}`);
  return count;
}

/**
 * 字母組合 → mask，並確認該槽在這個組合裡真的存在。
 * 合法槽隨 `arr × n` 變（`ring(4)` 的 A 與 D 根本不相交），所以錯誤訊息一律附上完整清單——
 * 只說「不存在」會讓人以為是拼錯字，附清單才知道要改用哪一格。
 */
export function slotMaskIn(arr: Arrangement, n: CircleCount, key: string): number {
  const mask = maskFromLetters(key);
  if (!slotMasks(arr, n).includes(mask)) {
    throw new SpecError(
      `text slot "${key}" does not exist in ${arr}(${n})\n` +
        `valid slots for ${arr}(${n}): ${validSlotLetters(arr, n).join(' ')}`,
    );
  }
  return mask;
}

function slotOf(raw: SpecSlot, key: string): TextSlot | null {
  const checked = checkSlot(raw, key);
  if (typeof checked === 'string') return checked === '' ? null : { t: checked };

  // fs/fill 的值域由 validateState 把關，這裡只負責搬過去
  const slot: TextSlot = { t: checked.t };
  if (checked.fs !== undefined) slot.fs = checked.fs;
  if (checked.fill !== undefined) slot.fill = checked.fill;

  /**
   * 空文字＋沒有任何樣式才等於「這一格不存在」。只看文字會弄丟 flat 樣式的挖白手法：
   * `{"t":"","fill":"#ffffff"}` 是一個沒有字但要塗白的區域，編輯器留得住（`ui/patch-slot.ts`
   * 只在整格剩下 `t` 時才刪），`renderSvg` 也照樣採用它的 `fill`。
   */
  if (slot.t === '' && slot.fs === undefined && slot.fill === undefined) return null;
  return slot;
}

function specSlotOf(slot: TextSlot): SpecSlot {
  const rich = slot.fs !== undefined || slot.fill !== undefined;
  return rich ? { ...slot } : slot.t;
}

/**
 * 友善 spec → `VennState`。沒給的欄位沿用該組合的預設幾何與 `defaultState()`，
 * 最後一律過 `validateState()`，所以值域錯誤的訊息與 server 收到的完全一樣。
 */
export function specToState(spec: VennSpec): VennState {
  if (!Array.isArray(spec.sets)) throw new SpecError('sets is required and must be an array');
  const count = circleCountOf(spec.sets.length);

  if (spec.arr !== undefined && !isArrangement(spec.arr)) {
    throw new SpecError('arr must be "ring" or "row"');
  }
  const arr: Arrangement = spec.arr ?? 'ring';

  const base = defaultState(count);
  const geometry = shapeDefaults(arr, count);

  const texts: Record<string, TextSlot> = {};
  const put = (key: string, raw: SpecSlot): void => {
    const mask = slotMaskIn(arr, count, key);
    const slot = slotOf(raw, key);
    if (slot === null) delete texts[String(mask)];
    else texts[String(mask)] = slot;
  };

  // sets 先進場，texts 後蓋：同一格兩邊都給時以明確指名的 texts 為準
  spec.sets.forEach((raw, i) => put(LETTERS[i]!, raw));
  for (const [key, raw] of Object.entries(spec.texts ?? {})) put(key, raw);

  const state: Record<string, unknown> = {
    v: 1,
    n: count,
    style: spec.style ?? base.style,
    opacity: spec.opacity ?? base.opacity,
    overlap: spec.overlap ?? geometry.overlap,
    radius: spec.radius ?? geometry.radius,
    colors: spec.colors ?? base.colors,
    bg: spec.bg ?? base.bg,
    size: spec.size ?? base.size,
    texts,
  };
  if (arr !== 'ring') state.arr = arr;
  if (spec.title !== undefined && spec.title !== '') {
    state.title = spec.title;
    if (spec.titleFill !== undefined) state.title_fill = spec.titleFill;
    if (spec.titleFs !== undefined) state.title_fs = spec.titleFs;
  }

  // validateState 是 SSOT：值域、槽位、顏色數量的錯誤訊息與 server 端一字不差
  return validateState(state);
}

/** `VennState` → 友善 spec；`specToState()` 吃回去要得到同一份 state。 */
export function stateToSpec(state: VennState): VennSpec {
  const arr = arrOf(state);
  const sets: SpecSlot[] = [];
  for (let i = 0; i < state.n; i++) {
    const slot = state.texts[String(1 << i)];
    sets.push(slot ? specSlotOf(slot) : '');
  }

  const texts: Record<string, SpecSlot> = {};
  // 依 slotMasks 的順序輸出（單圈在前、交集依 popCount 遞增），JSON 讀起來才有次序
  for (const mask of slotMasks(arr, state.n)) {
    if (popCount(mask) < 2) continue;
    const slot = state.texts[String(mask)];
    if (slot) texts[lettersFromMask(mask)] = specSlotOf(slot);
  }

  const spec: VennSpec = { arr, sets };
  if (Object.keys(texts).length > 0) spec.texts = texts;
  if (state.title !== undefined) spec.title = state.title;
  spec.style = state.style;
  spec.opacity = state.opacity;
  spec.overlap = state.overlap;
  spec.radius = state.radius;
  spec.colors = [...state.colors];
  spec.bg = state.bg;
  spec.size = state.size;
  if (state.title_fill !== undefined) spec.titleFill = state.title_fill;
  if (state.title_fs !== undefined) spec.titleFs = state.title_fs;
  return spec;
}
