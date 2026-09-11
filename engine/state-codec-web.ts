import { StateError, bytesToState, decodeBase64Url, encodeBase64Url, stateToBytes } from './state-codec';
import type { VennState } from './types';

async function pipeThrough(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const blob = new Blob([bytes as BlobPart]);
  const piped = blob.stream().pipeThrough(stream as ReadableWritablePair<Uint8Array, BufferSource>);
  const buf = await new Response(piped).arrayBuffer();
  return new Uint8Array(buf);
}

export async function encodeState(state: VennState): Promise<string> {
  const packed = await pipeThrough(stateToBytes(state), new CompressionStream('deflate-raw'));
  return encodeBase64Url(packed);
}

export async function decodeState(s: string): Promise<VennState> {
  let raw: Uint8Array;
  try {
    raw = await pipeThrough(decodeBase64Url(s), new DecompressionStream('deflate-raw'));
  } catch {
    throw new StateError('s could not be decompressed');
  }
  return bytesToState(raw);
}
