/**
 * 產出 AC1 的 golden：把「重構前這份程式」對一組代表性分享連結的輸出雜湊凍結成
 * `tests/golden/baseline.json`，之後每個 milestone 由 `tests/baseline.test.ts` 逐項比對。
 *
 * golden 一旦 commit 就是凍結的判定基準：重構後測試紅了是實作錯，不是 golden 錯，
 * 所以這支腳本預設拒絕覆寫既有檔案，要重產必須明確 `--force`。
 *
 * 用法：pnpm tsx scripts/template-baseline.ts [--force]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app';
import { PALETTE } from '../content/palette';
import { sampleState } from '../content/state-presets';
import { slotMasks } from '../engine/layout';
import { renderSvg } from '../engine/render-svg';
import { decodeState, encodeState } from '../engine/state-codec-node';
import type { CircleCount, TextSlot, VennState, VennStyle } from '../engine/types';

const FONT_FILE = fileURLToPath(new URL('../assets/fonts/NotoSansTC-Bold.otf', import.meta.url));
const OG_BASE_FILE = fileURLToPath(new URL('../ui/public/og-base.png', import.meta.url));
const GOLDEN_FILE = fileURLToPath(new URL('../tests/golden/baseline.json', import.meta.url));
const ORIGIN = 'https://venn.applepig.net';

/** 正式站 `VENN_WATERMARK` 的值：golden 是帶這個浮水印凍的，重產必須沿用同一個字串 */
const WATERMARK = 'venn.applepig.net';

const app = createApp({ fontFile: FONT_FILE, ogBaseFile: OG_BASE_FILE, watermark: WATERMARK });

/**
 * AC1(b) 的 4 圈 13 槽全填，含對角雙圈以外的每個 mask（7／11／13／14 是三重區）。
 * `fs`／`dx`／`dy`／`fill` 各出現在多個槽上：手動字級、手動位移與 flat 的填色 override
 * 都是編碼與渲染分支，漏掉任何一個都會讓重構期的迴歸溜過去。
 */
const FULL_TEXTS: Record<string, TextSlot> = {
  '1': { t: '甲' },
  '2': { t: '乙', fs: 0.09 },
  '4': { t: '丙', dx: 0.02 },
  '8': { t: '丁', dy: -0.02 },
  '3': { t: '甲乙', fill: '#ffffff' },
  '5': { t: '甲丙', fs: 0.05, dx: -0.01, dy: 0.01 },
  '10': { t: '乙丁', fill: '#101010' },
  '12': { t: '丙丁' },
  '7': { t: '甲乙丙' },
  '11': { t: '甲乙丁', fs: 0.03 },
  '13': { t: '甲丙丁', dx: 0.005, dy: -0.005 },
  '14': { t: '乙丙丁', fill: '#88ccff' },
  '15': { t: '全部', fs: 0.04, dx: 0.003, dy: 0.003, fill: '#ff8800' },
};

/** 與 PALETTE 全不同的自訂色，其中兩色亮到會踩上淺底改黑字的分支 */
const CUSTOM_COLORS = ['#123456', '#abcdef', '#00ff88', '#ff0066'];

function fullState(style: VennStyle, extra: Partial<VennState> = {}): VennState {
  const base = sampleState(4);
  return { ...base, style, colors: CUSTOM_COLORS, texts: FULL_TEXTS, ...extra };
}

interface Case {
  id: string;
  /** 對應 AC1 的哪一小項 */
  ac: 'a' | 'b' | 'c';
  label: string;
  state: VennState;
}

const CASES: Case[] = [
  ...([2, 3, 4] as CircleCount[]).map((n) => ({
    id: `tpl-${n}`,
    ac: 'a' as const,
    label: `${n} 圈 zh template 預設連結`,
    state: sampleState(n),
  })),
  {
    id: 'full-translucent',
    ac: 'b',
    label: '4 圈 13 槽全填，translucent ＋ 深色背景 ＋ 自訂透明度',
    state: fullState('translucent', { bg: '#1a1a2e', opacity: 0.45 }),
  },
  {
    id: 'full-flat',
    ac: 'b',
    label: '4 圈 13 槽全填，flat ＋ fill override ＋ size 800',
    state: fullState('flat', { size: 800 }),
  },
  {
    id: 'full-outline',
    ac: 'b',
    label: '4 圈 13 槽全填，outline',
    state: fullState('outline'),
  },
  {
    id: 'overlap-min',
    ac: 'c',
    label: '4 圈 overlap 0.6（下限）',
    state: fullState('translucent', { overlap: 0.6 }),
  },
  {
    id: 'overlap-max',
    ac: 'c',
    label: '4 圈 overlap 1.6（上限，五個區域消失）',
    state: fullState('translucent', { overlap: 1.6 }),
  },
];

function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

async function pngSha256(path: string): Promise<string> {
  const res = await app.request(`${ORIGIN}${path}`);
  if (res.status !== 200) throw new Error(`${path} 回 ${res.status}，不是 200`);
  return sha256(new Uint8Array(await res.arrayBuffer()));
}

if (existsSync(GOLDEN_FILE) && !process.argv.includes('--force')) {
  console.error(`golden 已存在且是 AC1 的凍結基準：${GOLDEN_FILE}`);
  console.error('要重產請確認是刻意的，再加 --force。');
  process.exit(1);
}

// 全部 case 都走 decodeState(encodeState(state))：與測試取得 state 的路徑完全一致，
// 順便確保凍結的 `s` 真的解得開。
const cases = [];
for (const item of CASES) {
  const s = encodeState(item.state);
  const state = decodeState(s);
  const entry = {
    id: item.id,
    ac: item.ac,
    label: item.label,
    s,
    svg_sha256: sha256(renderSvg(state, { watermark: WATERMARK })),
    png_sha256: await pngSha256(`/api/png?s=${s}`),
    og_png_sha256: await pngSha256(`/api/og.png?s=${s}`),
  };
  cases.push(entry);
  console.log(`${item.id.padEnd(17)} svg=${entry.svg_sha256.slice(0, 16)} png=${entry.png_sha256.slice(0, 16)} og=${entry.og_png_sha256.slice(0, 16)}`);
}

const golden = {
  note: 'AC1 golden：以 07 sprint 重構前的程式產出，任何 milestone 都不得修改。測試紅了是實作錯，不是 golden 錯。',
  slot_masks_4: [...slotMasks('ring', 4)],
  palette: PALETTE,
  cases,
};

mkdirSync(fileURLToPath(new URL('../tests/golden', import.meta.url)), { recursive: true });
writeFileSync(GOLDEN_FILE, `${JSON.stringify(golden, null, 2)}\n`, 'utf8');
console.log(`\n已寫入 ${GOLDEN_FILE}（${cases.length} 個 case）`);
