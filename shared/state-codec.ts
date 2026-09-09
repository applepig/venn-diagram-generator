import {
  MAX_TEXT_LEN,
  OVERLAP_MAX,
  OVERLAP_MIN,
  RADIUS_MAX,
  RADIUS_MIN,
  SIZE_MAX,
  SIZE_MIN,
  SLOT_MASKS,
} from './defaults';
import type { CircleCount, TextSlot, VennState, VennStyle } from './types';

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
  if (!BASE64URL_RE.test(s)) throw new StateError('狀態參數不是合法的 base64url');
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  let bin: string;
  try {
    bin = atob(padded);
  } catch {
    throw new StateError('狀態參數不是合法的 base64url');
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
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new StateError(`${name} 必須是數字`);
  if (v < min || v > max) throw new StateError(`${name} 必須介於 ${min} 與 ${max} 之間`);
  return v;
}

function requireHex(v: unknown, name: string): string {
  if (typeof v !== 'string' || !HEX_RE.test(v)) {
    throw new StateError(`${name} 必須是 #rrggbb 格式的顏色`);
  }
  return v;
}

function parseSlot(key: string, raw: unknown): TextSlot {
  if (!isRecord(raw)) throw new StateError(`文字槽 ${key} 格式錯誤`);
  if (typeof raw.t !== 'string') throw new StateError(`文字槽 ${key} 缺少文字內容`);
  if ([...raw.t].length > MAX_TEXT_LEN) {
    throw new StateError(`文字槽 ${key} 超過 ${MAX_TEXT_LEN} 字上限`);
  }

  const slot: TextSlot = { t: raw.t };
  if (raw.fs !== undefined) slot.fs = requireNumber(raw.fs, `文字槽 ${key} 的字級`, 0.001, 1);
  if (raw.dx !== undefined) slot.dx = requireNumber(raw.dx, `文字槽 ${key} 的水平偏移`, -1, 1);
  if (raw.dy !== undefined) slot.dy = requireNumber(raw.dy, `文字槽 ${key} 的垂直偏移`, -1, 1);
  return slot;
}

export function validateState(input: unknown): VennState {
  if (!isRecord(input)) throw new StateError('狀態必須是物件');
  if (input.v !== 1) throw new StateError('不支援的狀態版本');

  const n = input.n;
  if (n !== 2 && n !== 3 && n !== 4) throw new StateError('圈數必須是 2、3 或 4');

  const style = input.style;
  if (typeof style !== 'string' || !STYLES.includes(style as VennStyle)) {
    throw new StateError('不認得的樣式');
  }

  const size = requireNumber(input.size, '尺寸', SIZE_MIN, SIZE_MAX);
  if (!Number.isInteger(size)) throw new StateError('尺寸必須是整數');

  if (!Array.isArray(input.colors) || input.colors.length !== n) {
    throw new StateError(`顏色數量必須等於圈數（${n}）`);
  }
  const colors = input.colors.map((c, i) => requireHex(c, `第 ${i + 1} 圈的顏色`));

  if (!isRecord(input.texts)) throw new StateError('文字槽必須是物件');
  const allowed = new Set(SLOT_MASKS[n as CircleCount].map(String));
  const texts: Record<string, TextSlot> = {};
  for (const [key, raw] of Object.entries(input.texts)) {
    if (!allowed.has(key)) throw new StateError(`文字槽 ${key} 不屬於 ${n} 圈版面`);
    texts[key] = parseSlot(key, raw);
  }

  return {
    v: 1,
    n: n as CircleCount,
    style: style as VennStyle,
    opacity: requireNumber(input.opacity, '透明度', 0, 1),
    overlap: requireNumber(input.overlap, '重疊度', OVERLAP_MIN, OVERLAP_MAX),
    radius: requireNumber(input.radius, '圓半徑', RADIUS_MIN, RADIUS_MAX),
    colors,
    bg: requireHex(input.bg, '背景色'),
    size,
    texts,
  };
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
    throw new StateError('狀態參數不是合法的 JSON');
  }
  return validateState(parsed);
}
