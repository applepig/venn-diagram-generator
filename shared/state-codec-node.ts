import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { StateError, bytesToState, decodeBase64Url, encodeBase64Url, stateToBytes } from './state-codec';
import type { VennState } from './types';

export function encodeState(state: VennState): string {
  return encodeBase64Url(new Uint8Array(deflateRawSync(stateToBytes(state))));
}

export function decodeState(s: string): VennState {
  let raw: Uint8Array;
  try {
    raw = new Uint8Array(inflateRawSync(decodeBase64Url(s)));
  } catch {
    throw new StateError('狀態參數解壓縮失敗');
  }
  return bytesToState(raw);
}
