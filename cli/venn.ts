/**
 * `venn` CLI：把友善 spec 變成分享網址、SVG 或 PNG。
 *
 * 這一層只做 I/O：讀檔、讀 stdin、寫檔、退出碼。旗標怎麼併成一份 spec 在 `cli/flags.ts`。
 * 參數解析用 Node 內建的 `util.parseArgs`，套件因此維持零 runtime 依賴（resvg 除外）——
 * 這是離線出圖承諾的一部分：`npx` 只下載字型與 resvg，不拉一串 CLI 框架。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { renderSvg } from '../engine/render-svg';
import { encodeState, decodeState } from '../engine/state-codec-node';
import type { VennState } from '../engine/types';
import { shareUrl } from '../ui/share-url';
import { type Flags, applyFlags, specFromJson, str } from './flags';
import { SpecError, type VennSpec, specToState, stateToSpec } from './spec';

/** 分享網址的最後手段；與 package.json 的 homepage 一致 */
const FALLBACK_BASE_URL = 'https://venn.applepig.net';

/**
 * 與 server／bake-og 同一組字型：主字型 TC，日文漢字缺字由 JP 逐字補。
 * 路徑從本檔位置推，不從 cwd：`npx` 的使用者在哪個目錄跑都要找得到套件內的字型。
 * 原始碼（`cli/venn.ts`）與 bundle（`dist-cli/venn.mjs`）都在套件根目錄下一層，所以同一組相對路徑通用。
 */
const FONT_FILES = ['NotoSansTC-Bold.otf', 'NotoSansJP-Bold.otf'].map((name) =>
  fileURLToPath(new URL(`../assets/fonts/${name}`, import.meta.url)),
);

/** 點陣化失敗；與參數錯誤分開，才能用退出碼區分「使用者打錯」與「這台機器跑不動」 */
class RenderError extends Error {}

const HELP = `venn — Venn diagram generator

Usage:
  venn url    [options]            print the shareable editor URL
  venn svg    [options] [-o file]  write an SVG (default: venn.svg)
  venn png    [options] [-o file]  write a PNG  (default: venn.png)
  venn decode <url-or-s> [--raw]   print the JSON behind a share URL

Describing a diagram:
  Circles are letters: A is the first circle, B the second, up to F.
  A text slot is the set of circles it belongs to, so AB is the overlap of A and B.

  --set A=Work            label of a circle; repeat once per circle (order fixes A, B, C...)
  --text AB=No sleep      text inside an overlap; repeat as needed
                          Letter case and order do not matter: ba == AB.
  --fs AB=0.09            manual font size for one slot, as a fraction of the canvas
  --fill AB=#ffffff       colour override for one region (flat style only)
  --json <file|->         read the whole spec as JSON ("-" reads stdin). Accepts either
                          the friendly format (has "sets") or a raw VennState (has "v"),
                          which is what "venn decode --raw" and the URL both use.
                          The flags above override whatever the JSON said.

Not every overlap exists. The legal slots depend on arrangement x circle count:
ring(4) draws four circles in a square, so A and D never touch and "AD" is
rejected. The error lists every legal slot for your combination.

Options:
  --arr ring|row          arrangement (default: ring; row needs 3..6 circles)
  --style translucent|flat|outline
  --title <text>          title drawn above the diagram
  --size <px>             canvas size, 400..2000 (default: 1200)
  --bg #rrggbb            background colour
  --opacity <0..1>        fill opacity
  --overlap <0.6..1.6>    how far the circles reach into each other
  --radius <number>       circle radius as a fraction of the canvas
  --colors '#aabbcc,#ddeeff'   one colour per circle
  --base-url <origin>     host for the share URL (env: VENN_BASE_URL)
      --raw               decode only: print the raw VennState instead of friendly JSON
  -o, --out <file>        output file for svg/png
  -h, --help              show this help
      --version           print the version

Examples:
  venn png --set A=Work --set B=Life --text AB="No sleep" -o life.png
  echo '{"sets":["工作","生活"],"texts":{"AB":"沒有睡眠"}}' | venn png --json -
  venn decode 'https://venn.applepig.net/?s=...'
  venn decode 'https://venn.applepig.net/?s=...' --raw > state.json
`;

function readPackageVersion(): string {
  const file = fileURLToPath(new URL('../package.json', import.meta.url));
  return String(JSON.parse(readFileSync(file, 'utf8')).version);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function loadJsonSpec(source: string): Promise<VennSpec> {
  const raw = source === '-' ? await readStdin() : readFileSync(resolve(source), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new SpecError(`--json is not valid JSON: ${(err as Error).message}`);
  }
  return specFromJson(parsed);
}

async function buildSpec(flags: Flags): Promise<VennSpec> {
  const source = str(flags, 'json');
  const base: VennSpec = source === undefined ? { sets: [] } : await loadJsonSpec(source);
  return applyFlags(base, flags);
}

function baseUrlOf(flags: Flags): string {
  const raw = str(flags, 'base-url') ?? process.env.VENN_BASE_URL ?? FALLBACK_BASE_URL;
  return raw.replace(/\/+$/, '');
}

function urlFor(state: VennState, flags: Flags): string {
  return shareUrl(baseUrlOf(flags), encodeState(state));
}

/** 寫出圖檔後印兩行：檔案位置，以及同一張圖的可編輯網址 */
function reportWrite(file: string, state: VennState, flags: Flags): void {
  console.log(`${file} (${state.size}x${state.size})`);
  console.log(urlFor(state, flags));
}

function outPath(flags: Flags, fallback: string): string {
  return resolve(str(flags, 'out') ?? fallback);
}

async function renderPng(svg: string, size: number): Promise<Uint8Array> {
  // 動態 import：`venn svg` 與 `venn url` 完全不該碰到原生模組
  const { renderAsync } = await import('@resvg/resvg-js');
  const image = await renderAsync(svg, {
    fitTo: { mode: 'width', value: size },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Noto Sans TC' },
  });
  return image.asPng();
}

/** 吃完整分享網址或裸的 `s` 字串；貼過來的東西通常是前者 */
function stateParamOf(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') throw new SpecError('decode expects a share URL or an s parameter');
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes('?')) {
    const query = trimmed.slice(trimmed.indexOf('?') + 1);
    const s = new URLSearchParams(query).get('s');
    if (!s) throw new SpecError('that URL has no ?s= parameter');
    return s;
  }
  return trimmed;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      set: { type: 'string', multiple: true },
      text: { type: 'string', multiple: true },
      fs: { type: 'string', multiple: true },
      fill: { type: 'string', multiple: true },
      json: { type: 'string' },
      raw: { type: 'boolean' },
      arr: { type: 'string' },
      style: { type: 'string' },
      title: { type: 'string' },
      size: { type: 'string' },
      bg: { type: 'string' },
      opacity: { type: 'string' },
      overlap: { type: 'string' },
      radius: { type: 'string' },
      colors: { type: 'string' },
      out: { type: 'string', short: 'o' },
      'base-url': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
    },
  });
  const flags = values as Flags;
  const command = positionals[0];

  if (flags.version === true) {
    console.log(readPackageVersion());
    return 0;
  }
  if (flags.help === true || command === undefined || command === 'help') {
    console.log(HELP);
    return command === undefined && flags.help !== true ? 1 : 0;
  }

  if (command === 'decode') {
    const input = positionals[1];
    if (input === undefined) throw new SpecError('decode expects a share URL or an s parameter');
    const state = decodeState(stateParamOf(input));
    // --raw 印 URL 裡的那份 state；兩種格式 `--json` 都收得回去
    console.log(JSON.stringify(flags.raw === true ? state : stateToSpec(state), null, 2));
    return 0;
  }

  if (command !== 'url' && command !== 'svg' && command !== 'png') {
    throw new SpecError(`unknown command "${command}"; try venn --help`);
  }

  const state = specToState(await buildSpec(flags));

  if (command === 'url') {
    console.log(urlFor(state, flags));
    return 0;
  }

  const svg = renderSvg(state);
  if (command === 'svg') {
    const file = outPath(flags, 'venn.svg');
    writeFileSync(file, svg, 'utf8');
    reportWrite(file, state, flags);
    return 0;
  }

  const file = outPath(flags, 'venn.png');
  let png: Uint8Array;
  try {
    png = await renderPng(svg, state.size);
  } catch (err) {
    throw new RenderError(`could not rasterize the diagram: ${(err as Error).message}`);
  }
  writeFileSync(file, png);
  reportWrite(file, state, flags);
  return 0;
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(`venn: ${(err as Error).message}`);
  process.exitCode = err instanceof RenderError ? 2 : 1;
}
