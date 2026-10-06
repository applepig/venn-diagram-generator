import { defaultState } from '../content/state-presets';
import { FS_CODEC_MIN, MAX_STATE_PARAM_LEN, MAX_TEXT_LEN, OVERLAP_MIN, OVERLAP_MAX, SIZE_MIN, SIZE_MAX } from '../engine/defaults';
import { slotMasks } from '../engine/layout';
import { escapeXml } from '../engine/render-svg';
import { ARRANGEMENTS, circleCountRange, radiusRange } from '../engine/shapes/index';
import { validateState } from '../engine/state-codec';
import { encodeState, MAX_INFLATED_BYTES } from '../engine/state-codec-node';
import { STROKE_WIDTH_MAX } from '../engine/stroke';
import type { CircleCount } from '../engine/types';
import { MAX_CONCURRENT_RENDERS, OG_IMAGE_VERSION, RETRY_AFTER_SECONDS } from './api-contract';
import { MAX_SVG_QUERY_LEN } from './svg-query';

/** One executable example shared by HTML, llms.txt and OpenAPI. */
export const API_EXAMPLE = validateState({ ...defaultState(), size: 400,
  texts: { '1': { t: 'Coffee' }, '2': { t: 'Sleep' }, '3': { t: 'Me at 3am' } },
});
export const SVG_EXAMPLE_QUERY = { a: '藥品濫用', b: '物質濫用', ab: '毒品', colorA: '#E76F51', colorB: '#2A9D8F' };
export function svgExampleUrl(origin: string): string {
  return `${origin}/api/venn.svg?${new URLSearchParams(SVG_EXAMPLE_QUERY)}`;
}

export function slotTable(): string {
  return ARRANGEMENTS.flatMap((arr) => {
    const [min, max] = circleCountRange(arr);
    return Array.from({ length: max - min + 1 }, (_, i) => {
      const n = (min + i) as CircleCount;
      return `${`${arr}(${n})`.padEnd(8)}${slotMasks(arr, n).join(' ')}`;
    });
  }).join('\n');
}

const hex = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
const fraction = { type: 'number', minimum: FS_CODEC_MIN, maximum: 1 };
const errorContent = { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } };
const badState = { description: 'Missing, malformed or invalid input. Errors are English; Cache-Control: no-store.', content: errorContent };
const busy = { description: 'PNG/OG rasterizer is busy. Retry after the indicated seconds; Cache-Control: no-store.',
  headers: { 'Retry-After': { schema: { type: 'integer', const: RETRY_AFTER_SECONDS } } }, content: errorContent };
const sParameter = (required: boolean) => ({ name: 's', in: 'query', required,
  description: `base64url(deflate-raw(UTF-8 JSON VennState)), without padding. Inflated JSON limit: ${MAX_INFLATED_BYTES} bytes.`,
  schema: { type: 'string', minLength: 1, maxLength: MAX_STATE_PARAM_LEN, pattern: '^[A-Za-z0-9_-]+$' },
  example: encodeState(API_EXAMPLE),
});

export function openApi(origin: string) {
  const shapes = ARRANGEMENTS.flatMap((arr) => {
    const [min, max] = circleCountRange(arr);
    const [radiusMin, radiusMax] = radiusRange(arr);
    return Array.from({ length: max - min + 1 }, (_, i) => {
      const n = (min + i) as CircleCount;
      return { ...(arr === 'row' ? { required: ['arr'] } : {}), properties: {
        arr: { const: arr }, n: { const: n },
        radius: { minimum: radiusMin, maximum: radiusMax },
        colors: { minItems: n, maxItems: n },
        texts: { propertyNames: { enum: slotMasks(arr, n).map(String) } },
      } };
    });
  });
  return {
    openapi: '3.1.0',
    info: { title: 'Venn Diagram API', version: '1.1.0',
      description: 'Public, stateless diagram generation. No account or API key. The browser editor requires JavaScript; these APIs do not.' },
    servers: [{ url: origin }],
    externalDocs: { description: 'API documentation', url: `${origin}/api` },
    paths: {
      '/api/venn.svg': { get: { operationId: 'getVennSvg', summary: 'Generate an SVG with one GET URL',
        description: `Two mutually exclusive modes: s alone supports any valid state, or a/b/ab/colorA/colorB describe a two-circle diagram with product defaults. Missing/empty text is an empty region; no query produces an empty two-circle SVG. Unknown or duplicate parameters and mixing s with any friendly parameter return 400. Serialized query limit: ${MAX_SVG_QUERY_LEN} characters (including ?). Use percent encoding, especially %23 for # and %2B for +. Fonts are not embedded; standalone SVG font display depends on the reader. SVG does not consume PNG rasterizer workers.`,
        parameters: [sParameter(false),
          ...(['a', 'b', 'ab'] as const).map((name) => ({ name, in: 'query',
            description: name === 'ab' ? 'Text in A∩B, the intersection region.' : `Text exclusively in ${name.toUpperCase()}, outside the intersection.`,
            schema: { type: 'string', maxLength: MAX_TEXT_LEN }, example: SVG_EXAMPLE_QUERY[name],
          })),
          ...(['colorA', 'colorB'] as const).map((name) => ({ name, in: 'query',
            description: 'Circle color; omitted uses the product default. Empty string is invalid.',
            schema: hex, example: SVG_EXAMPLE_QUERY[name],
          })),
        ], responses: {
          '200': { description: 'Inline SVG. Friendly mode: no-cache; s mode: immutable one-year cache. No sample/placeholder text.',
            headers: { 'X-Venn-Url': { description: 'Editable share URL for the validated state.', schema: { type: 'string', format: 'uri' } } },
            content: { 'image/svg+xml': { schema: { type: 'string' } } } },
          '400': badState,
        } } },
      '/api/png': {
        get: { operationId: 'getVennPng', summary: 'Render an existing encoded state as a square PNG',
          parameters: [sParameter(true)], responses: {
            '200': { description: 'PNG at state.size pixels. Cache-Control: public, max-age=31536000, immutable.',
              content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } },
            '400': badState, '503': busy,
          } },
        post: { operationId: 'createVennPng', summary: 'Render a complete JSON state and return an editable share link',
          description: `All required state fields must be supplied. Body limit: ${MAX_INFLATED_BYTES} bytes; normalized encoded state limit: ${MAX_STATE_PARAM_LEN} characters.`,
          requestBody: { required: true, content: { 'application/json': {
            schema: { $ref: '#/components/schemas/VennState' }, example: API_EXAMPLE,
          } } }, responses: {
            '200': { description: 'Square PNG; Cache-Control: no-store.',
              headers: { 'X-Venn-Url': { description: 'Editable share URL; reuse its s parameter with GET /api/png.', schema: { type: 'string', format: 'uri' } } },
              content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } },
            '400': badState, '413': { description: 'JSON body exceeds the byte limit.', content: errorContent }, '503': busy,
          } },
      },
      '/api/og.png': { get: { operationId: 'getVennSocialImage', summary: 'Render the 1200 × 630 social banner',
        description: 'Social branding surrounds the diagram. Without s, renders a sample. Language is taken only from the query, not cookies or Accept-Language.',
        parameters: [sParameter(false),
          { name: 'lang', in: 'query', schema: { type: 'string', enum: ['zh-TW', 'en', 'ja'], default: 'zh-TW' } },
          { name: 'v', in: 'query', description: 'Cache buster for the social-image layout; not the state version. Rendering ignores it.', schema: { type: 'integer' }, example: OG_IMAGE_VERSION },
        ], responses: {
          '200': { description: '1200 × 630 PNG; immutable one-year cache.', content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } },
          '400': badState, '503': busy, '500': { description: 'OG base image is not configured.', content: errorContent },
        } } },
    },
    components: { schemas: {
      Error: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
      TextSlot: { type: 'object', required: ['t'], description: 'Unknown fields are ignored for old-link compatibility. XML-invalid characters and unpaired surrogates are rejected by the runtime validator.',
        properties: { t: { type: 'string', maxLength: MAX_TEXT_LEN }, fs: fraction, fill: { ...hex, description: 'Region fill override, used only by flat style.' } } },
      VennState: { type: 'object',
        description: 'Circle i is bit i; texts keys are decimal region masks (1=A only, 2=B only, 3=A∩B). Legal masks depend on arrangement and circle count. Unknown fields are ignored. Title/slot text rejects XML-invalid characters. The encoded state must also fit the URL limit.',
        required: ['v', 'n', 'style', 'opacity', 'overlap', 'radius', 'colors', 'bg', 'size', 'texts'],
        properties: {
          v: { type: 'integer', const: 1 }, n: { type: 'integer', minimum: 2, maximum: 6 },
          arr: { type: 'string', enum: ['ring', 'row'], default: 'ring' },
          style: { type: 'string', enum: ['translucent', 'flat', 'outline'] },
          opacity: { type: 'number', minimum: 0, maximum: 1, description: 'Required for all styles; only translucent uses it.' },
          overlap: { type: 'number', minimum: OVERLAP_MIN, maximum: OVERLAP_MAX },
          radius: { type: 'number', description: 'Canvas-width fraction; ring 0.2–0.35, row 0.1–0.35. See shape-specific constraints.' },
          colors: { type: 'array', items: hex }, bg: hex,
          size: { type: 'integer', minimum: SIZE_MIN, maximum: SIZE_MAX },
          texts: { type: 'object', additionalProperties: { $ref: '#/components/schemas/TextSlot' } },
          title: { type: 'string', maxLength: MAX_TEXT_LEN }, title_fill: hex, title_fs: fraction,
          stroke_width: { type: 'number', minimum: 0, maximum: STROKE_WIDTH_MAX }, stroke: hex,
        }, oneOf: shapes, examples: [API_EXAMPLE],
      },
    } },
  };
}

export function apiDocumentation(origin: string): string {
  const e = escapeXml;
  const json = JSON.stringify(API_EXAMPLE, null, 2);
  const pngUrl = `${origin}/api/png?s=${encodeState(API_EXAMPLE)}`;
  const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
  const curl = `curl -sD headers.txt -o venn.png -H 'content-type: application/json' \\\n  --data ${quote(json)} \\\n  ${quote(`${origin}/api/png`)}`;
  const node = `import { deflateRawSync } from 'node:zlib';\nconst state = ${json};\nconst s = deflateRawSync(Buffer.from(JSON.stringify(state), 'utf8')).toString('base64url');\nconsole.log(new URL('/api/png?s=' + s, ${JSON.stringify(origin)}).href);`;
  const fields = Object.entries(openApi(origin).components.schemas.VennState.properties)
    .map(([name, schema]) => {
      const rules: Record<string, unknown> = schema;
      const parts = [String(rules.type)];
      if ('const' in rules) parts.push(`must be ${String(rules.const)}`);
      if (Array.isArray(rules.enum)) parts.push(rules.enum.join(' / '));
      if ('minimum' in rules) parts.push(`${rules.minimum}–${rules.maximum}`);
      if ('maxLength' in rules) parts.push(`up to ${rules.maxLength} code points`);
      if ('pattern' in rules) parts.push('#rrggbb color');
      if ('description' in rules) parts.push(String(rules.description));
      if (name === 'colors') parts.push('exactly n #rrggbb colors');
      if (name === 'texts') parts.push('decimal region keys → {t, fs?, fill?}; see the region table below');
      return `<tr><th scope="row"><code>${e(name)}</code></th><td>${e(parts.join('; '))}</td></tr>`;
    }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Venn Diagram API</title><meta name="description" content="Generate Venn diagrams through a public HTTP API. Examples, state schema and OpenAPI.">
<link rel="canonical" href="${e(origin)}/api"><link rel="service-desc" type="application/vnd.oai.openapi+json" href="/openapi.json">
<style>body{font:16px/1.6 system-ui,sans-serif;margin:0 auto;padding:24px;max-width:900px;color:#222;background:#fafafa}a{color:#1558a6}pre{padding:16px;background:#eee;overflow:auto}code{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #ccc}h1,h2{line-height:1.2}nav{display:flex;flex-wrap:wrap;gap:16px}img{max-width:100%;height:auto}</style></head><body>
<nav><a href="/">Diagram editor</a><a rel="service-desc" href="/openapi.json">OpenAPI specification</a><a href="/llms.txt">llms.txt</a></nav>
<main><h1>Venn Diagram API</h1><p>Create diagrams with 2–6 circles using HTTP. No account or API key. The editor uses JavaScript; this documentation and the APIs do not.</p>
<h2>Generate an SVG with one URL</h2><p><code>GET /api/venn.svg</code> accepts <code>a</code> (A only), <code>b</code> (B only), <code>ab</code> (A∩B), and optional <code>colorA</code> / <code>colorB</code> (#rrggbb). This friendly mode always uses two circles; other state fields use product defaults. Missing or empty text leaves the region blank; no query produces an empty diagram. Colors may be omitted but cannot be empty.</p>
<p><a href="${e(svgExampleUrl(origin))}">Open the example SVG</a></p><pre><code>${e(svgExampleUrl(origin))}</code></pre>
<p>Use <code>URLSearchParams</code> or a URL encoder. Encode # as %23 and + as %2B; unencoded # starts a fragment and never reaches the server. For full styles and shapes, use <code>/api/venn.svg?s=&lt;state&gt;</code>. Do not mix s with friendly parameters. Duplicate or unknown parameters return 400; the serialized query including ? is limited to ${MAX_SVG_QUERY_LEN} characters. Success returns <code>image/svg+xml; charset=utf-8</code> and <code>X-Venn-Url</code> for the same editable diagram. Fonts are not embedded: use PNG when identical glyph rendering across readers is required. SVG serialization does not use the PNG worker quota.</p>
<h2>Generate a PNG in one request</h2><p><code>POST /api/png</code> accepts a complete VennState JSON body. Save the response as PNG. The <code>X-Venn-Url</code> response header gives an editable share link for the same diagram.</p>
<pre><code>${e(curl)}</code></pre><p>Inspect <code>headers.txt</code> for <code>X-Venn-Url</code>. To fetch the diagram again, reuse its <code>s</code> parameter with GET.</p>
<h2>Fetch a diagram by URL</h2><p><code>GET /api/png?s=&lt;state&gt;</code> returns a square PNG at <code>state.size</code> pixels. <code>s</code> is base64url without padding of raw DEFLATE of UTF-8 JSON, not gzip or zlib-wrapped DEFLATE. Copy it from an editor/share link, or generate it with Node:</p>
<pre><code>${e(node)}</code></pre><p><a href="${e(pngUrl)}">Fetch the example PNG</a></p>
<h2>Complete state</h2><p>Required: <code>v, n, style, opacity, overlap, radius, colors, bg, size, texts</code>. Missing required fields return 400; they do not receive defaults. <code>arr</code> defaults to ring. Colors must contain exactly n entries. Title and region text have a ${MAX_TEXT_LEN}-Unicode-code-point limit; newlines wrap text. XML-invalid characters are rejected. <code>fs</code> and <code>title_fs</code> are canvas-width fractions (${FS_CODEC_MIN}–1). <code>fill</code> affects only flat regions. Unknown state fields are ignored for old-link compatibility.</p>
<p>Optional: <code>arr, title, title_fill, title_fs, stroke_width, stroke</code>. Title styling is kept only with a nonempty title; stroke defaults depend on style, and stroke color is ignored when the resolved width is zero.</p>
<table><caption>Field types and constraints (also available in OpenAPI)</caption><tbody>${fields}</tbody></table>
<h2>Region keys</h2><p><code>texts</code> maps decimal bitmasks to <code>{"t":"words","fs":0.09,"fill":"#ffffff"}</code>; fs and fill are optional. Circle i is bit i: 1 = A only, 2 = B only, 3 = A∩B, 7 = A∩B∩C. These describe exclusive regions, not whole-set membership. Empty <code>texts: {}</code> is valid. Legal keys are computed from the shape:</p><pre>${e(slotTable())}</pre>
<p>ring(2) and ring(3) support every combination. Other shapes may lack overlaps; for example row(3) has no 5 or 7. An unavailable slot is a 400. Rearrange circles or use fewer circles when necessary.</p>
<h2>Social image</h2><p><code>GET /api/og.png?v=${OG_IMAGE_VERSION}&amp;s=&lt;state&gt;&amp;lang=en</code> returns a branded 1200 × 630 PNG, rather than the square diagram. Without s it renders a sample. Language uses only the query (zh-TW, en, ja); cookies and Accept-Language do not change a cached image. v is a layout cache buster, not the state version.</p>
<h2>Errors and limits</h2><p>Expected API errors are English JSON <code>{"error":"..."}</code> with <code>Cache-Control: no-store</code>. 400 means invalid/missing input; 413 means the POST body exceeds ${MAX_INFLATED_BYTES} bytes. Encoded s is limited to ${MAX_STATE_PARAM_LEN} characters, and decompressed JSON to ${MAX_INFLATED_BYTES} bytes. PNG and OG share ${MAX_CONCURRENT_RENDERS} concurrent rasterizers: 503 with <code>Retry-After: ${RETRY_AFTER_SECONDS}</code> means wait and retry the same request. A missing OG base image returns 500.</p>
<h2>Caching</h2><p>GET PNG/OG and SVG s mode use <code>public, max-age=31536000, immutable</code>; POST PNG is <code>no-store</code> and renders on every call. Friendly SVG mode is <code>no-cache</code> because product defaults can change. Produce with POST, then reuse GET for repeat fetches. Renderer or watermark changes may leave previously cached images visible at unchanged URLs; deployments must account for cache invalidation.</p>
<h2>Other interfaces</h2><p>Use the <a href="/llms.txt">agent guide</a> for CLI and plugin instructions, or read the <a href="https://github.com/applepig/venn-diagram-generator">source and README</a>.</p>
</main></body></html>`;
}
