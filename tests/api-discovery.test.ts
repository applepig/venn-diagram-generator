import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { API_EXAMPLE, openApi } from '../server/api-documentation';
import { defaultState } from '../content/state-presets';
import { LOCALES, t } from '../content/locale';
import { ARRANGEMENTS, circleCountRange, shapeDefaults } from '../engine/shapes/index';
import { slotMasks } from '../engine/layout';
import { validateState } from '../engine/state-codec';
import { decodeState } from '../engine/state-codec-node';
import type { CircleCount } from '../engine/types';
import { FONT_FILES } from './helpers/font';
import { pngSize } from './helpers/png';

const source = readFileSync(resolve('ui/index.html'), 'utf8');
const origin = 'https://fork.example';
const dist = mkdtempSync(join(tmpdir(), 'venn-discovery-'));
writeFileSync(join(dist, 'index.html'), source);
afterAll(() => rmSync(dist, { recursive: true, force: true }));

describe('discover → describe → call without JavaScript', () => {
  // The same real template is used by dev's loader and production's cached disk read.
  for (const mode of ['dev', 'production'] as const) {
    const app = createApp({ fontFiles: FONT_FILES, publicOrigin: origin,
      ...(mode === 'dev' ? { loadIndexHtml: () => source } : { distDir: dist }),
    });
    it(`${mode}: source HTML exposes API in every locale, then links to working docs and OpenAPI`, async () => {
      for (const locale of LOCALES) {
        const response = await app.request(`${origin}/?lang=${locale}`);
        const html = await response.text();
        const readable = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<head>[\s\S]*?<\/head>/, '');
        expect(readable).toContain(t('site.intro', locale));
        expect(readable).toContain(t('site.apiIntro', locale));
        expect(readable).toContain('href="/api"');
        expect(readable).toContain('href="/openapi.json"');
        expect(html).toContain('rel="service-desc" type="application/vnd.oai.openapi+json"');
        expect(response.headers.get('cache-control')).toBe('private, no-cache');
        expect(response.headers.get('vary')).toContain('Accept-Language');
      }
      const doc = await app.request(`${origin}/api`);
      expect(doc.status).toBe(200);
      const body = await doc.text();
      expect(body).not.toContain('<script');
      expect(body).toContain('POST /api/png');
      expect(body).toContain(`${origin}/api/png`);
      expect(body).toContain('row(3)  1 2 4 3 6');
      expect(body).not.toMatch(/\n\+  /);
      expect(body).not.toContain('https://venn.applepig.net');
      const spec = await app.request(`${origin}/openapi.json`);
      expect(spec.headers.get('content-type')).toContain('application/vnd.oai.openapi+json');
      const json = await spec.json();
      expect(json.servers).toEqual([{ url: origin }]);
      const state = json.paths['/api/png'].post.requestBody.content['application/json'].example;
      const image = await app.request(`${origin}/api/png`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(state),
      });
      expect(image.status).toBe(200);
      expect(pngSize(Buffer.from(await image.arrayBuffer()))).toEqual({ width: state.size, height: state.size });
      const share = new URL(image.headers.get('x-venn-url')!);
      expect(share.origin).toBe(origin);
      expect(decodeState(share.searchParams.get('s')!)).toEqual(validateState(state));
      expect((await (await app.request(share.href)).text())).toContain('noindex, follow');
      const llms = await (await app.request(`${origin}/llms.txt`)).text();
      expect(llms).toContain(`${origin}/api)`);
      expect(llms).toContain(`${origin}/openapi.json)`);
      expect(llms).toContain(JSON.stringify(API_EXAMPLE));
    });
  }
  it('escapes a forwarded origin in HTML and preserves it as JSON data', async () => {
    const app = createApp({ fontFiles: [] });
    const headers = { 'x-forwarded-host': 'example"><script>alert(1)</script>', 'x-forwarded-proto': 'https' };
    const doc = await (await app.request('http://localhost/api', { headers })).text();
    expect(doc).not.toContain('<script>alert(1)</script>');
    expect(doc).toContain('&lt;script&gt;');
  });
});

describe('OpenAPI 3.1 matches runtime constraints', () => {
  const spec = openApi(origin);
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const valid = ajv.compile({ components: spec.components, $ref: '#/components/schemas/VennState' });
  it('passes a real OpenAPI validator', async () => {
    await expect(SwaggerParser.validate(JSON.parse(JSON.stringify(spec)))).resolves.toBeDefined();
  });
  it('accepts valid states for every shape and rejects wrong counts, radius and region keys', () => {
    expect(valid(API_EXAMPLE)).toBe(true);
    for (const arr of ARRANGEMENTS) {
      const [min, max] = circleCountRange(arr);
      for (let n = min; n <= max; n++) {
        const state = validateState({ ...defaultState(n), arr, ...shapeDefaults(arr, n),
          texts: Object.fromEntries(slotMasks(arr, n as CircleCount).map((mask) => [mask, { t: '字' }])),
        });
        expect(valid(state)).toBe(true);
        for (const bad of [{ ...state, colors: [] }, { ...state, radius: 0.01 },
          { ...state, texts: { '63': { t: 'invalid' } }, n: 2 },
          { ...state, size: 399 }, { ...state, texts: { '1': { t: '𠀀'.repeat(81) } } }]) {
          expect(valid(bad)).toBe(false);
          expect(() => validateState(bad)).toThrow();
        }
      }
    }
    expect(valid({ ...defaultState(2), arr: 'row' })).toBe(false);
    expect(valid({ ...API_EXAMPLE, opacity: undefined })).toBe(false);
  });
});
