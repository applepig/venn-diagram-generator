/**
 * `venn` CLI：把友善 spec 變成分享網址、SVG 或 PNG。
 *
 * 參數解析用 Node 內建的 `util.parseArgs`，套件因此維持零 runtime 依賴（resvg 除外）——
 * 這是離線出圖承諾的一部分：`npx` 只下載字型與 resvg，不拉一串 CLI 框架。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { popCount } from '../engine/defaults';
import { renderSvg } from '../engine/render-svg';
import { isArrangement } from '../engine/shapes/index';
import { validateState } from '../engine/state-codec';
import { encodeState, decodeState } from '../engine/state-codec-node';
import type { Arrangement, CircleCount, VennState } from '../engine/types';
import { shareUrl } from '../ui/share-url';
import {
  LETTERS,
  SpecError,
  type SpecSlot,
  type VennSpec,
  lettersFromMask,
  slotMaskIn,
  specToState,
  stateToSpec,
} from './spec';

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
  venn decode <url-or-s>           print the friendly JSON behind a share URL

Describing a diagram:
  Circles are letters: A is the first circle, B the second, up to F.
  A text slot is the set of circles it belongs to, so AB is the overlap of A and B.

  --set A=Work            label of a circle; repeat once per circle (order fixes A, B, C...)
  --text AB=No sleep      text inside an overlap; repeat as needed
                          Letter case and order do not matter: ba == AB.
  --json <file|->         read the whole spec as JSON ("-" reads stdin).
                          Individual --set/--text flags override the JSON.

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
  -o, --out <file>        output file for svg/png
  -h, --help              show this help
      --version           print the version

Examples:
  venn png --set A=Work --set B=Life --text AB="No sleep" -o life.png
  echo '{"sets":["工作","生活"],"texts":{"AB":"沒有睡眠"}}' | venn png --json -
  venn decode 'https://venn.applepig.net/?s=...'
`;

function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  return String(pkg.version);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** `A=工作` → `[0, '工作']`。等號右邊原樣保留，中文與空白都不動。 */
function parsePair(flag: string, raw: string): [string, string] {
  const at = raw.indexOf('=');
  if (at < 0) throw new SpecError(`--${flag} expects KEY=value, got "${raw}"`);
  return [raw.slice(0, at), raw.slice(at + 1)];
}

function toNumber(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new SpecError(`--${name} must be a number, got "${raw}"`);
  return value;
}

type Flags = Record<string, string | boolean | string[] | undefined>;

function str(flags: Flags, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

function list(flags: Flags, name: string): string[] {
  const value = flags[name];
  return Array.isArray(value) ? value : [];
}

/**
 * `--json` 收兩種格式：友善 spec（字母 key）與原始 `VennState`（bitmask key，`venn decode --raw`
 * 與 URL 裡的那份）。使用者手上常常已經有後者——從分享連結 decode 出來、或從測試 fixture 複製，
 * 不該被逼著先手轉一次。原始 state 先過 `validateState()` 再轉成友善 spec，旗標才有東西可以疊。
 */
async function loadJsonSpec(source: string): Promise<VennSpec> {
  const raw = source === '-' ? await readStdin() : readFileSync(resolve(source), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new SpecError(`--json is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SpecError('--json must contain a JSON object');
  }

  const object = parsed as Record<string, unknown>;
  const friendly = object.sets !== undefined;
  const state = object.v !== undefined;
  if (friendly === state) {
    const shape = friendly ? 'has both "sets" and "v"' : 'has neither "sets" nor "v"';
    throw new SpecError(
      `--json ${shape}, so the format is ambiguous.\n` +
        '  friendly spec: {"sets": ["A label", "B label"], "texts": {"AB": "overlap"}}\n' +
        '  raw VennState: {"v": 1, "n": 2, "texts": {"3": {"t": "overlap"}}, ...} — bitmask keys, as printed by `venn decode --raw`',
    );
  }
  return friendly ? (parsed as VennSpec) : stateToSpec(validateState(parsed));
}

/** 旗標疊在 `--json` 之上：JSON 給底稿，命令列上明寫的覆蓋它。 */
async function buildSpec(flags: Flags): Promise<VennSpec> {
  const json_source = str(flags, 'json');
  const base: VennSpec = json_source === undefined ? { sets: [] } : await loadJsonSpec(json_source);

  const sets: (SpecSlot | undefined)[] = Array.isArray(base.sets) ? [...base.sets] : [];
  for (const raw of list(flags, 'set')) {
    const [key, value] = parsePair('set', raw);
    const letter = key.replace(/\s+/g, '').toUpperCase();
    const index = LETTERS.indexOf(letter);
    if (letter.length !== 1 || index < 0) {
      throw new SpecError(`--set expects a single circle letter A..F, got "${key}"`);
    }
    sets[index] = value;
  }
  // sparse 陣列代表使用者跳過了某一圈（給了 A 與 C 卻沒給 B），那幾乎一定是打錯字
  const missing = [...sets.keys()].filter((i) => sets[i] === undefined).map((i) => LETTERS[i]);
  if (missing.length > 0) {
    throw new SpecError(`missing --set for circle ${missing.join(', ')}; circles must be contiguous from A`);
  }

  const texts: Record<string, SpecSlot> = { ...(base.texts ?? {}) };
  for (const raw of list(flags, 'text')) {
    const [key, value] = parsePair('text', raw);
    texts[key] = value;
  }

  const spec: VennSpec = { ...base, sets: sets as SpecSlot[], texts };
  const arr = str(flags, 'arr');
  if (arr !== undefined) spec.arr = arr as VennSpec['arr'];
  const style = str(flags, 'style');
  if (style !== undefined) spec.style = style;
  const title = str(flags, 'title');
  if (title !== undefined) spec.title = title;
  const bg = str(flags, 'bg');
  if (bg !== undefined) spec.bg = bg;
  const colors = str(flags, 'colors');
  if (colors !== undefined) spec.colors = colors.split(',').map((c) => c.trim());
  for (const name of ['size', 'opacity', 'overlap', 'radius'] as const) {
    const raw = str(flags, name);
    if (raw !== undefined) spec[name] = toNumber(name, raw);
  }
  return spec;
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
      json: { type: 'string' },
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
    console.log(JSON.stringify(stateToSpec(decodeState(stateParamOf(input))), null, 2));
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
