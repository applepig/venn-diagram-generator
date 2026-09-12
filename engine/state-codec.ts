import { MAX_TEXT_LEN, OVERLAP_MAX, OVERLAP_MIN, SIZE_MAX, SIZE_MIN } from './defaults';
import { slotMasks } from './layout';
import {
  circleCountRange,
  isArrangement,
  isCircleCount,
  isShape,
  radiusRange,
} from './shapes/index';
import type { Arrangement, TextSlot, VennState, VennStyle } from './types';

/**
 * 狀態解析失敗。訊息一律英文固定值：API 是機器介面，不走 i18n（07 ADR）。
 */
export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateError';
  }
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const STYLES: VennStyle[] = ['translucent', 'flat', 'outline'];

// ---------- base64url（Node 與瀏覽器共用，不依賴 Buffer） ----------

export function encodeBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeBase64Url(s: string): Uint8Array {
  if (!BASE64URL_RE.test(s)) throw new StateError('s is not valid base64url');
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  let bin: string;
  try {
    bin = atob(padded);
  } catch {
    throw new StateError('s is not valid base64url');
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---------- schema 驗證 ----------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireNumber(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new StateError(`${name} must be a number`);
  if (v < min || v > max) throw new StateError(`${name} must be between ${min} and ${max}`);
  return v;
}

function requireHex(v: unknown, name: string): string {
  if (typeof v !== 'string' || !HEX_RE.test(v)) {
    throw new StateError(`${name} must be a #rrggbb color`);
  }
  return v;
}

/**
 * XML 1.0 不接受的字元：除了 \t \n \r 以外的 C0 控制字元，以及非字元 U+FFFE／U+FFFF。
 * 這些字元 JSON 載得動、SVG 載不動，放行的話會在點陣化階段炸成 500。
 */
const INVALID_XML_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;

/** 落單的 surrogate 同樣不是合法的 XML 字元 */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function parseSlot(key: string, raw: unknown): TextSlot {
  if (!isRecord(raw)) throw new StateError(`text slot ${key} must be an object`);
  if (typeof raw.t !== 'string') throw new StateError(`text slot ${key} is missing t`);
  if ([...raw.t].length > MAX_TEXT_LEN) {
    throw new StateError(`text slot ${key} exceeds the ${MAX_TEXT_LEN} character limit`);
  }
  if (INVALID_XML_RE.test(raw.t) || hasLoneSurrogate(raw.t)) {
    throw new StateError(`text slot ${key} contains characters that cannot be rendered`);
  }

  const slot: TextSlot = { t: raw.t };
  if (raw.fs !== undefined) slot.fs = requireNumber(raw.fs, `text slot ${key} fs`, 0.001, 1);
  if (raw.dx !== undefined) slot.dx = requireNumber(raw.dx, `text slot ${key} dx`, -1, 1);
  if (raw.dy !== undefined) slot.dy = requireNumber(raw.dy, `text slot ${key} dy`, -1, 1);
  if (raw.fill !== undefined) slot.fill = requireHex(raw.fill, `text slot ${key} fill`);
  return slot;
}

/**
 * 圖片標題（08 AC3）。驗證比照文字槽的 `t`：長度、XML 畫不出來的字元、落單 surrogate，
 * 空字串一律收斂成「沒有標題」，由呼叫端決定不寫進物件。
 */
function parseTitle(raw: unknown): string {
  if (typeof raw !== 'string') throw new StateError('title must be a string');
  if ([...raw].length > MAX_TEXT_LEN) {
    throw new StateError(`title exceeds the ${MAX_TEXT_LEN} character limit`);
  }
  if (INVALID_XML_RE.test(raw) || hasLoneSurrogate(raw)) {
    throw new StateError('title contains characters that cannot be rendered');
  }
  return raw;
}

export function validateState(input: unknown): VennState {
  if (!isRecord(input)) throw new StateError('state must be an object');
  if (input.v !== 1) throw new StateError('unsupported state version');

  const n = input.n;
  if (!isCircleCount(n)) throw new StateError('n must be an integer between 2 and 6');

  // 缺席＝ring，所以舊連結不必帶這個欄位
  if (input.arr !== undefined && !isArrangement(input.arr)) {
    throw new StateError('arr must be "ring" or "row"');
  }
  const arr: Arrangement = input.arr ?? 'ring';
  if (!isShape(arr, n)) {
    const [min_n, max_n] = circleCountRange(arr);
    throw new StateError(`${arr} arrangement supports ${min_n} to ${max_n} circles, not ${n}`);
  }

  const style = input.style;
  if (typeof style !== 'string' || !STYLES.includes(style as VennStyle)) {
    throw new StateError('unknown style');
  }

  const size = requireNumber(input.size, 'size', SIZE_MIN, SIZE_MAX);
  if (!Number.isInteger(size)) throw new StateError('size must be an integer');

  if (!Array.isArray(input.colors) || input.colors.length !== n) {
    throw new StateError(`colors must have exactly ${n} entries`);
  }
  const colors = input.colors.map((c, i) => requireHex(c, `color ${i + 1}`));

  if (!isRecord(input.texts)) throw new StateError('texts must be an object');
  const allowed = new Set(slotMasks(arr, n).map(String));
  const texts: Record<string, TextSlot> = {};
  for (const [key, raw] of Object.entries(input.texts)) {
    if (!allowed.has(key)) throw new StateError(`text slot ${key} does not exist in ${arr}(${n})`);
    texts[key] = parseSlot(key, raw);
  }

  // radius 的範圍依排列而定：row 的圓比 ring 小，ring 的範圍不動（舊連結全是 ring）
  const [radius_min, radius_max] = radiusRange(arr);

  const state: VennState = {
    v: 1,
    n,
    style: style as VennStyle,
    opacity: requireNumber(input.opacity, 'opacity', 0, 1),
    overlap: requireNumber(input.overlap, 'overlap', OVERLAP_MIN, OVERLAP_MAX),
    radius: requireNumber(input.radius, 'radius', radius_min, radius_max),
    colors,
    bg: requireHex(input.bg, 'bg'),
    size,
    texts,
  };
  // ring 一律不寫進編碼：舊連結的編碼字串因此一個位元都不變
  if (arr !== 'ring') state.arr = arr;
  // 空標題同樣不寫進編碼，理由與 ring 相同
  const title = input.title === undefined ? '' : parseTitle(input.title);
  const title_fill =
    input.title_fill === undefined ? undefined : requireHex(input.title_fill, 'title_fill');
  if (title !== '') {
    state.title = title;
    // 字色只跟著標題走：沒有標題就沒有東西可以上色，留著只會讓同一張圖有兩種編碼
    if (title_fill !== undefined) state.title_fill = title_fill;
  }
  return state;
}

// ---------- JSON <-> bytes ----------

export function stateToBytes(state: VennState): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(validateState(state)));
}

export function bytesToState(bytes: Uint8Array): VennState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new StateError('s does not contain valid JSON');
  }
  return validateState(parsed);
}
