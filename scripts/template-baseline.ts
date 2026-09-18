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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app';
import { PALETTE } from '../content/palette';
import { sampleState } from '../content/state-presets';
import { slotMasks } from '../engine/layout';
import { renderSvg } from '../engine/render-svg';
import { decodeState, encodeState } from '../engine/state-codec-node';
import type { CircleCount, TextSlot, VennState, VennStyle } from '../engine/types';

const FONT_FILES = [
  fileURLToPath(new URL('../assets/fonts/NotoSansTC-Bold.otf', import.meta.url)),
  fileURLToPath(new URL('../assets/fonts/NotoSansJP-Bold.otf', import.meta.url)),
];
const OG_BASE_FILE = fileURLToPath(new URL('../ui/public/og-base.png', import.meta.url));
const GOLDEN_FILE = fileURLToPath(new URL('../tests/golden/baseline.json', import.meta.url));
const ORIGIN = 'https://venn.applepig.net';

/** 正式站 `VENN_WATERMARK` 的值：golden 是帶這個浮水印凍的，重產必須沿用同一個字串 */
const WATERMARK = 'venn.applepig.net';

const app = createApp({ fontFiles: FONT_FILES, ogBaseFile: OG_BASE_FILE, watermark: WATERMARK });

/**
 * AC1(b) 的 4 圈 13 槽全填，含對角雙圈以外的每個 mask（7／11／13／14 是三重區）。
 * `fs` 與 `fill` 各出現在多個槽上：手動字級與 flat 的填色 override 都是編碼與渲染分支，
 * 漏掉任何一個都會讓重構期的迴歸溜過去。原本還有手動位移 `dx`／`dy`，
 * 10 sprint 移除該欄位後一併拿掉，golden 也因此重產（模板案例的雜湊不受影響）。
 */
const FULL_TEXTS: Record<string, TextSlot> = {
  '1': { t: '甲' },
  '2': { t: '乙', fs: 0.09 },
  '4': { t: '丙' },
  '8': { t: '丁' },
  '3': { t: '甲乙', fill: '#ffffff' },
  '5': { t: '甲丙', fs: 0.05 },
  '10': { t: '乙丁', fill: '#101010' },
  '12': { t: '丙丁' },
  '7': { t: '甲乙丙' },
  '11': { t: '甲乙丁', fs: 0.03 },
  '13': { t: '甲丙丁' },
  '14': { t: '乙丙丁', fill: '#88ccff' },
  '15': { t: '全部', fs: 0.04, fill: '#ff8800' },
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

/**
 * 每個 case 被重凍過的理由。golden 的價值在於稽核軌跡，而重產會整份覆寫輸出檔——
 * 09 那次手寫在 JSON 裡的 `refrozen` 就這樣在 10 的重產中被無聲抹掉一次。
 * 把它搬回原始碼，重產才不會再吃掉前人的紀錄。
 */
const REFROZEN: Record<string, string[]> = {
  'overlap-max': [
    '09 fit：這張圖的四個角本來被畫布切掉，正是該 sprint 要修的行為（spec 09 AC2 的唯一例外）。fit 參數 scale=0.8367、tx=ty=0.08165；其餘 7 個 case 一個位元都沒動。',
  ],
};

/** 10 sprint 移除文字位移，帶 dx/dy 的 case 因此全部重凍；三組 template 不受影響 */
const REFROZEN_10 = '10 移除文字位移 dx/dy：本 case 的 texts 帶過位移，重產後雜湊改變。三個 tpl-* 不帶位移，s 與三個雜湊一字未變。';
for (const id of ['full-translucent', 'full-flat', 'full-outline', 'overlap-min', 'overlap-max']) {
  REFROZEN[id] = [...(REFROZEN[id] ?? []), REFROZEN_10];
}

/** 15 框線改成幾何選項：只有帶 fill override 的 flat case 會變 */
REFROZEN['full-flat'] = [
  ...(REFROZEN['full-flat'] ?? []),
  '15 框線改成幾何選項：flat「有 fill override 就自動加一圈黑框」的隱藏行為移除（spec 15 AC4，使用者明確要的變更），本 case 因此少一圈黑框。框線改由 stroke_width／stroke 自己開，其餘 7 個 case 一個位元都沒動。',
];

/**
 * 對不到任何 case 的 REFROZEN 條目是壞掉的稽核軌跡：case 改名之後，
 * 理由會留在這裡卻永遠寫不進輸出，而改名的人不會收到任何提示。
 */
const CASE_IDS = new Set(CASES.map((item) => item.id));
const orphans = Object.keys(REFROZEN).filter((id) => !CASE_IDS.has(id));
if (orphans.length > 0) {
  console.error(`REFROZEN 有對不到 case 的 id：${orphans.join('、')}`);
  console.error('case 改名時請一併改這裡，否則重凍理由會靜默消失。');
  process.exit(1);
}

function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

async function pngSha256(path: string): Promise<string> {
  const res = await app.request(`${ORIGIN}${path}`);
  if (res.status !== 200) throw new Error(`${path} 回 ${res.status}，不是 200`);
  return sha256(new Uint8Array(await res.arrayBuffer()));
}

interface GoldenCase {
  id: string;
  refrozen?: string[];
  svg_sha256: string;
  png_sha256: string;
  og_png_sha256: string;
}

if (existsSync(GOLDEN_FILE) && !process.argv.includes('--force')) {
  console.error(`golden 已存在且是 AC1 的凍結基準：${GOLDEN_FILE}`);
  console.error('要重產請確認是刻意的，再加 --force。');
  process.exit(1);
}

/**
 * `--force` 只解除「不准覆寫」，不解除「要說理由」。沒有下面這道比對，
 * 一次 `--force` 就能把任意數量的雜湊換掉而測試照樣全綠——那正是 baseline.test.ts 要擋的事。
 */
const previous: { cases?: GoldenCase[] } | null = existsSync(GOLDEN_FILE)
  ? JSON.parse(readFileSync(GOLDEN_FILE, 'utf8'))
  : null;

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
    ...(REFROZEN[item.id] ? { refrozen: REFROZEN[item.id] } : {}),
    svg_sha256: sha256(renderSvg(state, { watermark: WATERMARK })),
    png_sha256: await pngSha256(`/api/png?s=${s}`),
    og_png_sha256: await pngSha256(`/api/og.png?s=${s}`),
  };
  cases.push(entry);
  console.log(`${item.id.padEnd(17)} svg=${entry.svg_sha256.slice(0, 16)} png=${entry.png_sha256.slice(0, 16)} og=${entry.og_png_sha256.slice(0, 16)}`);
}

if (previous?.cases) {
  const before = new Map(previous.cases.map((item) => [item.id, item]));
  const unexplained: string[] = [];
  for (const entry of cases) {
    const old = before.get(entry.id);
    // 新增的 case 沒有可比的舊值，不需要重凍理由
    if (!old) continue;

    const changed = (['svg_sha256', 'png_sha256', 'og_png_sha256'] as const).filter(
      (field) => old[field] !== entry[field],
    );
    if (changed.length === 0) continue;

    // 這一次重凍必須留下新的理由；沿用上次那幾條不算解釋這次的改動
    if ((REFROZEN[entry.id]?.length ?? 0) > (old.refrozen?.length ?? 0)) continue;
    unexplained.push(`${entry.id}（${changed.join('、')}）`);
  }
  if (unexplained.length > 0) {
    console.error('以下 case 的雜湊變了，但 REFROZEN 沒有為這次重凍新增理由：');
    for (const line of unexplained) console.error(`  ${line}`);
    console.error('請在 REFROZEN 對應的 id 底下加一條說明這次為什麼變，再重跑。');
    process.exit(1);
  }
}

const golden = {
  note:
    'AC1 golden：以 07 sprint 重構前的程式產出，任何 milestone 都不得修改。測試紅了是實作錯，不是 golden 錯。' +
    '唯一能重產的情況是行為已由使用者確認要變，重產理由逐案記在各 case 的 refrozen。' +
    '最近一次重產：10 sprint 移除文字位移 dx/dy（使用者決定：編輯器沒有任何控制項能產生位移，欄位不該留在資料結構裡）。' +
    '該次重產中，五個帶位移的 case（full-translucent／full-flat／full-outline／overlap-min／overlap-max）雜湊改變，' +
    '三個模板 case（tpl-2／tpl-3／tpl-4）的 s 與三個雜湊未變。' +
    '重產時腳本會逐 case 比對舊雜湊，有變動而 REFROZEN 沒有新增理由就中止。',
  slot_masks_4: [...slotMasks('ring', 4)],
  palette: PALETTE,
  cases,
};

mkdirSync(fileURLToPath(new URL('../tests/golden', import.meta.url)), { recursive: true });
writeFileSync(GOLDEN_FILE, `${JSON.stringify(golden, null, 2)}\n`, 'utf8');
console.log(`\n已寫入 ${GOLDEN_FILE}（${cases.length} 個 case）`);
