import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { smokeCheck } from '../scripts/smoke-check';
import { FONT_FILES } from './helpers/font';

describe('deployment smoke checks', () => {
  const origin = 'https://fork.example';
  const app = createApp({ fontFiles: FONT_FILES, publicOrigin: origin, revision: 'test-revision',
    loadIndexHtml: () => readFileSync(resolve('ui/index.html'), 'utf8'),
    ogBaseFile: resolve('ui/public/og-base.png') });
  const localFetch: typeof fetch = async (input, init) => app.request(String(input), init);

  it('checks the actual app routes and PNG, including the deployed revision', async () => {
    await expect(smokeCheck(origin, 'test-revision', localFetch)).resolves.toBeUndefined();
    // Probing the container does not change the documented public origin.
    await expect(smokeCheck('http://localhost:3000', 'test-revision', localFetch)).resolves.toBeUndefined();
  });
  it('rejects an old image and SPA fallback instead of marking a deployment ready', async () => {
    await expect(smokeCheck(origin, 'old-revision', localFetch)).rejects.toThrow('expected revision');
    const fallback: typeof fetch = async () => new Response('<title>SPA</title><a href="/api">API</a>', {
      headers: { 'content-type': 'text/html' },
    });
    await expect(smokeCheck(origin, undefined, fallback)).rejects.toThrow('expected text/plain');
  });
  it('preserves HTTP failures and redirects in diagnostic output', async () => {
    for (const status of [404, 302]) {
      const fail: typeof fetch = async () => new Response('', { status, headers: { location: '/login' } });
      await expect(smokeCheck(origin, undefined, fail)).rejects.toThrow(`HTTP ${status}; redirect=/login`);
    }
  });
});
