import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { SVG_EXAMPLE_QUERY, openApi, svgExampleUrl } from '../server/api-documentation';
import { MAX_SVG_QUERY_LEN } from '../server/svg-query';
import { defaultState } from '../content/state-presets';
import { MAX_STATE_PARAM_LEN } from '../engine/defaults';
import { renderSvg } from '../engine/render-svg';
import { shapeDefaults } from '../engine/shapes/index';
import { validateState } from '../engine/state-codec';
import { decodeState, encodeState } from '../engine/state-codec-node';
import { FONT_FILES } from './helpers/font';

const origin = 'https://fork.example';
const watermark = 'fork.example & friends';
const app = createApp({ fontFiles: FONT_FILES, publicOrigin: origin, watermark });
const get = (query = '') => app.request(`${origin}/api/venn.svg${query}`);

describe('single URL SVG API', () => {
  it('renders the documented CJK request as valid XML and an editable state', async () => {
    const res = await app.request(svgExampleUrl(origin));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const svg = await res.text();
    for (const text of ['藥品濫用', '物質濫用', '毒品']) expect(svg.replace(/<[^>]*>/g, '')).toContain(text);
    const share = new URL(res.headers.get('x-venn-url')!);
    expect(share.origin).toBe(origin);
    const state = decodeState(share.searchParams.get('s')!);
    expect(state.texts).toEqual({ '1': { t: SVG_EXAMPLE_QUERY.a }, '2': { t: SVG_EXAMPLE_QUERY.b }, '3': { t: SVG_EXAMPLE_QUERY.ab } });
    expect(state.colors).toEqual([SVG_EXAMPLE_QUERY.colorA, SVG_EXAMPLE_QUERY.colorB]);
    expect(svg).toBe(renderSvg(state, { watermark }));
    expect(() => new Resvg(svg, { font: { fontFiles: FONT_FILES, loadSystemFonts: false } })).not.toThrow();
  });
  it('keeps blanks empty and excludes template text and ghosts', async () => {
    for (const query of ['', '?a=&b=&ab=']) {
      const res = await get(query);
      const share = new URL(res.headers.get('x-venn-url')!);
      expect(decodeState(share.searchParams.get('s')!)).toEqual(defaultState());
      expect(await res.text()).toBe(renderSvg(defaultState(), { watermark }));
    }
  });
  it('preserves percent-encoded special characters, newlines and 80 astral code points safely', async () => {
    const texts = { a: '中文 & + # " <script>\n下一行', b: "O'Connor 空 白", ab: '𠀀'.repeat(80) };
    const res = await get(`?${new URLSearchParams(texts)}`);
    expect(res.status).toBe(200);
    const share = new URL(res.headers.get('x-venn-url')!);
    const state = decodeState(share.searchParams.get('s')!);
    expect(state.texts).toEqual({ '1': { t: texts.a }, '2': { t: texts.b }, '3': { t: texts.ab } });
    const svg = await res.text();
    expect(svg).not.toContain('<script>');
    expect(svg).toBe(renderSvg(state, { watermark }));
    expect(() => new Resvg(svg)).not.toThrow();
  });
  it('supports complete ring and row states without consuming the friendly defaults', async () => {
    for (const arr of ['ring', 'row'] as const) {
      const state = validateState({ ...defaultState(3), ...shapeDefaults(arr, 3), arr,
        style: 'flat', title: 'Title', texts: { '3': { t: 'AB', fs: 0.08, fill: '#ffffff' } },
      });
      const res = await get(`?s=${encodeState(state)}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toContain('immutable');
      expect(await res.text()).toBe(renderSvg(state, { watermark }));
      const link = new URL(res.headers.get('x-venn-url')!);
      expect(decodeState(link.searchParams.get('s')!)).toEqual(state);
    }
  });
  it('rejects ambiguous, malformed or excessive input as JSON with no-store', async () => {
    const bad = [
      '?a=A&a=B', '?s=x&s=y', '?unknown=x', '?a=A&colorA=', '?colorB=red',
      '?colorA=%23gggggg', '?s=', '?s=broken', '?s=x&a=', '?a=%00',
      `?a=${'𠀀'.repeat(81)}`, `?s=${'a'.repeat(MAX_STATE_PARAM_LEN + 1)}`,
      `?${'x'.repeat(MAX_SVG_QUERY_LEN)}`,
    ];
    for (const query of bad) {
      const res = await get(query);
      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('content-type')).toContain('application/json');
      expect((await res.json()).error).toEqual(expect.any(String));
    }
  });
  it('renders every friendly parameter example published in OpenAPI', async () => {
    const params = openApi(origin).paths['/api/venn.svg'].get.parameters;
    const query = new URLSearchParams(params.filter((p) => p.name !== 's').map((p) => [p.name, p.example]));
    const res = await get(`?${query}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('毒品');
  });
  it('stays callable when all PNG rasterizer slots are occupied', async () => {
    const small = encodeState({ ...defaultState(), size: 400 });
    const pending = Array.from({ length: 3 }, () => app.request(`${origin}/api/png?s=${small}`));
    try {
      // Start both synchronously before worker completions can release a slot.
      const busyRequest = app.request(`${origin}/api/png?s=${small}`);
      const svgRequest = get('?a=available');
      expect((await busyRequest).status).toBe(503);
      const svg = await svgRequest;
      expect(svg.status).toBe(200);
      expect((await svg.text()).replace(/<[^>]*>/g, '')).toContain('available');
    } finally {
      await Promise.all(pending);
    }
  });
});
