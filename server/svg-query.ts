import { defaultState } from '../content/state-presets';
import { MAX_STATE_PARAM_LEN } from '../engine/defaults';
import { StateError, validateState } from '../engine/state-codec';
import { decodeState, encodeState } from '../engine/state-codec-node';

export const SVG_QUERY_KEYS = ['s', 'a', 'b', 'ab', 'colorA', 'colorB'] as const;
// Allow percent-encoding of the complete s value, plus the fixed key overhead.
export const MAX_SVG_QUERY_LEN = MAX_STATE_PARAM_LEN * 3 + 256;

export function svgQuery(url: URL) {
  if (url.search.length > MAX_SVG_QUERY_LEN) throw new StateError('query is too long');
  const params = url.searchParams;
  const seen = new Set<string>();
  for (const [key] of params) {
    if (!SVG_QUERY_KEYS.some((allowed) => key === allowed))
      throw new StateError(`unknown query parameter ${key}`);
    if (seen.has(key)) throw new StateError(`duplicate query parameter ${key}`);
    seen.add(key);
  }
  const encoded = params.get('s');
  if (encoded !== null) {
    if (params.size !== 1) throw new StateError('s cannot be combined with friendly parameters');
    if (!encoded) throw new StateError('missing state parameter s');
    if (encoded.length > MAX_STATE_PARAM_LEN) throw new StateError('s is too long');
    const state = decodeState(encoded);
    return { state, param: encodeState(state), encoded: true };
  }
  const base = defaultState(2);
  for (const [key, mask] of [['a', '1'], ['b', '2'], ['ab', '3']] as const) {
    const text = params.get(key);
    if (text !== null && text !== '') base.texts[mask] = { t: text };
  }
  const colorA = params.get('colorA');
  const colorB = params.get('colorB');
  if (colorA !== null) base.colors[0] = colorA;
  if (colorB !== null) base.colors[1] = colorB;
  const state = validateState(base);
  const param = encodeState(state);
  if (param.length > MAX_STATE_PARAM_LEN) throw new StateError('s is too long');
  return { state, param, encoded: false };
}
