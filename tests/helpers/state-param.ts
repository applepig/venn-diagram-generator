import { deflateRawSync } from 'node:zlib';
import { sampleState } from '../../shared/defaults';
import { encodeBase64Url } from '../../shared/state-codec';

/** JSON 的尾隨空白 parse 時會被忽略：合法 state 後面接空白，就是解得開又能任意放大的 payload */
function paramWithPad(pad: string): string {
  const json = JSON.stringify({ ...sampleState(), size: 400 });
  return encodeBase64Url(new Uint8Array(deflateRawSync(Buffer.from(json + pad, 'utf8'))));
}

/** 壓縮炸彈：s 本身很短，解開卻是 inflated_bytes 大小的合法 state JSON */
export function bombParam(inflated_bytes: number): string {
  return paramWithPad(' '.repeat(inflated_bytes));
}

const WHITESPACE = [' ', '\t', '\n', '\r'];

/** 偽隨機空白壓不掉，用來撐出長 s；同一個 seed 每次結果相同 */
function noisePad(count: number): string {
  let seed = 1;
  let pad = '';
  for (let i = 0; i < count; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pad += WHITESPACE[(seed >>> 24) & 3];
  }
  return pad;
}

/**
 * 解得開、且編碼後長度剛好 target 的 s。
 * base64url 不補等號，長度只會落在 mod 4 為 0、2、3 的值上，target 要挑得到的。
 */
export function paramOfLength(target: number): string {
  let lo = 0;
  let hi = 80000;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (paramWithPad(noisePad(mid)).length < target) lo = mid + 1;
    else hi = mid;
  }
  for (let count = Math.max(0, lo - 20); count <= lo + 20; count++) {
    const s = paramWithPad(noisePad(count));
    if (s.length === target) return s;
  }
  throw new Error(`湊不出長度剛好 ${target} 的合法 s`);
}
