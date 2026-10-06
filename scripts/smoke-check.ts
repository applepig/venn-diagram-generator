import { pathToFileURL } from 'node:url';
import { encodeState } from '../engine/state-codec-node';
import { API_EXAMPLE, SVG_EXAMPLE_QUERY } from '../server/api-documentation';

/** Run against the container first, then the public origin. No browser or JS needed. */
export async function smokeCheck(
  origin: string,
  expectedRevision?: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const base = new URL(origin);
  if (!['http:', 'https:'].includes(base.protocol) || base.pathname !== '/' || base.search || base.hash)
    throw new Error('Expected an HTTP(S) origin without a path, query or fragment');
  async function get(path: string, mime: string): Promise<Response> {
    const url = new URL(path, base);
    const res = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'cache-control': 'no-cache' },
    });
    if (res.status !== 200) throw new Error(`${url}: HTTP ${res.status}; redirect=${res.headers.get('location') ?? 'none'}`);
    if (!res.headers.get('content-type')?.startsWith(mime))
      throw new Error(`${url}: expected ${mime}, received ${res.headers.get('content-type')}`);
    if (expectedRevision && res.headers.get('x-venn-revision') !== expectedRevision)
      throw new Error(`${url}: expected revision ${expectedRevision}, received ${res.headers.get('x-venn-revision') ?? 'missing'}`);
    return res;
  }
  const home = await (await get('/', 'text/html')).text();
  if (!home.includes('<title>') || !home.includes('href="/api"'))
    throw new Error('Homepage is not the application HTML with API discovery');
  const llms = await (await get('/llms.txt', 'text/plain')).text();
  // The internal localhost probe still documents PUBLIC_ORIGIN, not localhost.
  if (!llms.startsWith('# Venn Diagram Generator') || !/https?:\/\/[^\s]+\/api\/png/.test(llms))
    throw new Error('llms.txt is not the API documentation');
  const docs = await (await get('/api', 'text/html')).text();
  if (!docs.includes('POST /api/png') || !docs.includes('href="/openapi.json"'))
    throw new Error('API documentation is missing the callable API or OpenAPI link');
  const spec = await (await get('/openapi.json', 'application/vnd.oai.openapi+json')).json();
  if (spec.openapi !== '3.1.0' || !spec.paths?.['/api/png']?.post)
    throw new Error('OpenAPI is missing the PNG operation');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) && spec.servers?.[0]?.url !== base.origin)
    throw new Error('OpenAPI describes a different public origin');
  const svgResponse = await get(`/api/venn.svg?${new URLSearchParams(SVG_EXAMPLE_QUERY)}`, 'image/svg+xml');
  const svg = await svgResponse.text();
  if (!svg.includes('<svg') || !svg.includes('毒品') || !svgResponse.headers.get('x-venn-url'))
    throw new Error('SVG API did not render the example with an editable share URL');
  // PNG/OG URLs are immutable: probe this build using a fresh cache key, rather
  // than mistaking a valid older cached response for the running server version.
  const probe = encodeURIComponent(expectedRevision ?? String(Date.now()));
  const image = await get(`/api/png?s=${encodeState(API_EXAMPLE)}&smoke=${probe}`, 'image/png');
  const imageBytes = new Uint8Array(await image.arrayBuffer());
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => imageBytes[i] === byte))
    throw new Error('Diagram response is not a PNG');
  const png = await get(`/api/og.png?lang=en&smoke=${probe}`, 'image/png');
  const bytes = new Uint8Array(await png.arrayBuffer());
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte))
    throw new Error('Image response is not a PNG');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  const origin = args[0] ?? process.env.PUBLIC_ORIGIN ?? '';
  smokeCheck(origin, args[1])
    .then(() => console.log(`Smoke check passed: ${origin}`))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
