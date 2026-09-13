import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { StateError, bytesToState, decodeBase64Url, encodeBase64Url, stateToBytes } from './state-codec';
import type { VennState } from './types';

export function encodeState(state: VennState): string {
  return encodeBase64Url(new Uint8Array(deflateRawSync(stateToBytes(state))));
}

/**
 * 解壓輸出上限：最壞的合法 state 展開也只有幾 KB，32KB 已經很寬。
 * 沒有這道上限，幾 KB 的 s 就能逼 server 同步配置好幾 MB。
 * `POST /api/png` 跳過解壓，改拿它當 request body 的上限，兩條路的入口尺寸才一致。
 */
export const MAX_INFLATED_BYTES = 32 * 1024;

export function decodeState(s: string): VennState {
  let raw: Uint8Array;
  try {
    const options = { maxOutputLength: MAX_INFLATED_BYTES };
    raw = new Uint8Array(inflateRawSync(decodeBase64Url(s), options));
  } catch {
    throw new StateError('s could not be decompressed');
  }
  return bytesToState(raw);
}
