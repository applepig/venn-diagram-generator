/**
 * 命令列旗標 → 友善 spec 的純邏輯。與 I/O 分開才測得動：
 * 讀檔、讀 stdin、寫檔與退出碼留在 `cli/venn.ts`，這裡只做值的合併與驗證。
 */
import { popCount } from '../engine/defaults';
import { isArrangement } from '../engine/shapes/index';
import { validateState } from '../engine/state-codec';
import type { Arrangement, CircleCount } from '../engine/types';
import {
  LETTERS,
  SPEC_FIELDS,
  SpecError,
  type RichSlot,
  type SpecSlot,
  type VennSpec,
  checkSlot,
  circleCountOf,
  lettersFromMask,
  slotMaskIn,
  stateToSpec,
} from './spec';

/** `parseArgs` 的 values；`multiple: true` 的旗標會是字串陣列 */
export type Flags = Record<string, string | boolean | string[] | undefined>;

export function str(flags: Flags, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

export function list(flags: Flags, name: string): string[] {
  const value = flags[name];
  return Array.isArray(value) ? value : [];
}

/** `A=工作` → `['A', '工作']`。等號右邊原樣保留，中文與空白都不動。 */
export function parsePair(flag: string, raw: string): [string, string] {
  const at = raw.indexOf('=');
  if (at < 0) throw new SpecError(`--${flag} expects KEY=value, got "${raw}"`);
  return [raw.slice(0, at), raw.slice(at + 1)];
}

export function toNumber(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new SpecError(`--${name} must be a number, got "${raw}"`);
  return value;
}

/**
 * `--json` 收兩種格式：友善 spec（字母 key）與原始 `VennState`（bitmask key，
 * `venn decode --raw` 與 URL 裡的那份）。使用者手上常常已經有後者——從分享連結 decode 出來、
 * 或從測試 fixture 複製，不該被逼著先手轉一次。判別看 `sets` 與 `v` 哪個在。
 */
export function specFromJson(parsed: unknown): VennSpec {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SpecError('--json must contain a JSON object');
  }
  const object = parsed as Record<string, unknown>;
  const friendly = object.sets !== undefined;
  const state = object.v !== undefined;
  if (friendly === state) {
    const shape = friendly ? 'has both "sets" and "v"' : 'has neither "sets" nor "v"';
    throw new SpecError(
      `--json ${shape}, so the format is ambiguous.\n` +
        '  friendly spec: {"sets": ["A label", "B label"], "texts": {"AB": "overlap"}}\n' +
        '  raw VennState: {"v": 1, "n": 2, "texts": {"3": {"t": "overlap"}}, ...} — bitmask keys,\n' +
        '                 exactly what "venn decode --raw" prints and what the share URL holds',
    );
  }
  // 原始 state 先過 validateState 再轉成友善 spec，旗標才有東西可以疊
  if (!friendly) return stateToSpec(validateState(parsed));

  /**
   * 認不得的 top-level 欄位一律報錯。`specToState()` 只讀它認得的欄位，所以少一個 s 的
   * `"text"`、大寫的 `"Title"` 本來會被靜默吞掉，出一張少了東西的圖並退出碼 0——
   * agent 看不到畫布，這種「成功地給錯答案」比直接失敗危險得多。
   */
  const unknown = Object.keys(object).filter((key) => !SPEC_FIELDS.includes(key));
  if (unknown.length > 0) {
    throw new SpecError(
      `--json has unknown field${unknown.length > 1 ? 's' : ''} ${unknown.map((k) => `"${k}"`).join(', ')}\n` +
        `valid fields: ${SPEC_FIELDS.join(' ')}`,
    );
  }
  if (!Array.isArray(object.sets)) {
    throw new SpecError('sets must be an array of circle labels, one per circle');
  }
  return parsed as VennSpec;
}

/**
 * 只換文字、保留該格既有的 `fs`／`fill`——改一句話不該把別人調過的東西一起洗掉。
 * 空字串也一樣：`--text AB=` 是「這格不要字」，不是「這格連填色都不要」。
 * 純字串的槽沒有可留的東西，清空後會在 `slotOf()` 收斂成「整格不存在」。
 */
function withText(current: SpecSlot | undefined, text: string): SpecSlot {
  if (current === undefined || typeof current === 'string') return text;
  return { ...current, t: text };
}

/** 旗標疊在 `--json` 的底稿之上：JSON 給底稿，命令列上明寫的覆蓋它。 */
export function applyFlags(base: VennSpec, flags: Flags): VennSpec {
  if (!Array.isArray(base.sets)) {
    throw new SpecError('sets must be an array of circle labels, one per circle');
  }
  // 形狀先驗過，per-slot 旗標才不會在 `null` 上讀 `.t` 炸成看不懂的 TypeError
  const sets: (SpecSlot | undefined)[] = base.sets.map((slot, i) =>
    slot === undefined ? undefined : checkSlot(slot, LETTERS[i] ?? String(i)),
  );
  const set_flags: [number, string][] = list(flags, 'set').map((raw) => {
    const [key, value] = parsePair('set', raw);
    const letter = key.replace(/\s+/g, '').toUpperCase();
    const index = LETTERS.indexOf(letter);
    if (letter.length !== 1 || index < 0) {
      throw new SpecError(`--set expects a single circle letter A..F, got "${key}"`);
    }
    // 先佔位：圈數要先定下來，per-slot 旗標才驗得了槽位
    if (index >= sets.length) sets.length = index + 1;
    return [index, value];
  });

  // 排列與圈數必須早於 texts 決定：哪些槽合法由 `arr × n` 決定
  const arr_raw = str(flags, 'arr') ?? base.arr;
  if (arr_raw !== undefined && !isArrangement(arr_raw)) {
    throw new SpecError('--arr must be "ring" or "row"');
  }
  const arr: Arrangement = arr_raw ?? 'ring';
  const count: CircleCount = circleCountOf(sets.length);

  /**
   * 每一格只住在一個地方：單圈標籤在 `sets`，交集在 `texts`，key 一律正規化成 `AB` 這種寫法。
   * 沒有這道正規化，JSON 的 `"AB"` 與命令列的 `--text ba=` 會變成兩筆指向同一個 mask 的資料。
   */
  const texts: Record<string, SpecSlot> = {};
  const slotRef = (key: string) => {
    const mask = slotMaskIn(arr, count, key);
    const letters = lettersFromMask(mask);
    const index = popCount(mask) === 1 ? LETTERS.indexOf(letters) : -1;
    return {
      get: (): SpecSlot | undefined => (index >= 0 ? sets[index] : texts[letters]),
      set: (value: SpecSlot): void => {
        if (index >= 0) sets[index] = value;
        else texts[letters] = value;
      },
    };
  };

  for (const [key, raw] of Object.entries(base.texts ?? {})) {
    const value = checkSlot(raw, key);
    const ref = slotRef(key);
    ref.set(typeof value === 'string' ? withText(ref.get(), value) : value);
  }
  for (const [index, value] of set_flags) sets[index] = withText(sets[index], value);
  for (const raw of list(flags, 'text')) {
    const [key, value] = parsePair('text', raw);
    const ref = slotRef(key);
    ref.set(withText(ref.get(), value));
  }

  // sparse 陣列代表使用者跳過了某一圈（給了 A 與 C 卻沒給 B），那幾乎一定是打錯字
  const missing = [...sets.keys()].filter((i) => sets[i] === undefined).map((i) => LETTERS[i]);
  if (missing.length > 0) {
    throw new SpecError(
      `missing --set for circle ${missing.join(', ')}; circles must be contiguous from A`,
    );
  }

  // per-slot 旗標最後跑：它們調整的是某一格既有的文字，所以文字得先就位
  const editSlot = (
    flag: string,
    raw: string,
    edit: (slot: RichSlot, value: string) => void,
  ): void => {
    const [key, value] = parsePair(flag, raw);
    const ref = slotRef(key);
    const current = ref.get();
    const text = current == null || typeof current === 'string' ? current : current.t;
    if (current == null || text === undefined || text === '') {
      throw new SpecError(
        `--${flag} needs text in slot ${key} first; add --text ${key}=... or --set`,
      );
    }
    const slot: RichSlot = typeof current === 'string' ? { t: current } : { ...current };
    edit(slot, value);
    ref.set(slot);
  };
  for (const raw of list(flags, 'fs')) {
    editSlot('fs', raw, (slot, value) => {
      slot.fs = toNumber('fs', value);
    });
  }
  for (const raw of list(flags, 'fill')) {
    editSlot('fill', raw, (slot, value) => {
      slot.fill = value.trim();
    });
  }

  const spec: VennSpec = { ...base, arr, sets: sets as SpecSlot[], texts };
  const style = str(flags, 'style');
  if (style !== undefined) spec.style = style;
  const title = str(flags, 'title');
  if (title !== undefined) spec.title = title;
  const bg = str(flags, 'bg');
  if (bg !== undefined) spec.bg = bg;
  // 標題的字色與字級只在有 title 時進編碼，那道收斂在 validateState，這裡照傳即可
  const title_fill = str(flags, 'title-fill');
  if (title_fill !== undefined) spec.titleFill = title_fill;
  const title_fs = str(flags, 'title-fs');
  if (title_fs !== undefined) spec.titleFs = toNumber('title-fs', title_fs);
  // 框線寬度與顏色；值域與「等於預設就不寫」的收斂都在 validateState
  const stroke_width = str(flags, 'stroke-width');
  if (stroke_width !== undefined) spec.strokeWidth = toNumber('stroke-width', stroke_width);
  const stroke = str(flags, 'stroke');
  if (stroke !== undefined) spec.stroke = stroke;
  const colors = str(flags, 'colors');
  if (colors !== undefined) spec.colors = colors.split(',').map((c) => c.trim());
  for (const name of ['size', 'opacity', 'overlap', 'radius'] as const) {
    const raw = str(flags, name);
    if (raw !== undefined) spec[name] = toNumber(name, raw);
  }
  return spec;
}
