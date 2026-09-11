/**
 * AC13：`/api/png` 渲染日文漢字不出豆腐。
 *
 * `NotoSansTC-Bold.otf` 有假名，但缺日文字形的漢字（`盗`、`涙`、`剣` 都不在裡面）。
 * spec ADR 的解法是 resvg 多載一個 `NotoSansJP-Bold.otf` 靠逐字 fallback 補，
 * **SVG 裡的 `font-family` 一個字元都不改**（golden 比的是 SVG 的 sha256）。
 *
 * 判定方式：resvg 缺字時畫的是 notdef 方框（豆腐），而同一個 notdef 對所有缺字都一樣——
 * 所以「只載 TC 渲染兩個不同缺字得到同一張 PNG」就是豆腐基準本身的證明。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defaultState } from '../content/state-presets';
import { encodeState } from '../engine/state-codec-node';
import { createApp } from '../server/app';
import { FONT_FILE, FONT_FILES } from './helpers/font';

const ORIGIN = 'https://venn.example.test';
/** 小圖就足夠：測的是有沒有字形，不是版面 */
const SIZE = 400;

/** 正式站的設定：TC ＋ JP 兩個檔 */
const app = createApp({ fontFiles: FONT_FILES });
/** 對照組：只載 TC，日文漢字一定出豆腐 */
const tc_only = createApp({ fontFiles: [FONT_FILE] });

async function pngHash(target: ReturnType<typeof createApp>, text: string): Promise<string> {
  const s = encodeState({ ...defaultState(2), size: SIZE, texts: { '1': { t: text } } });
  const res = await target.request(`${ORIGIN}/api/png?s=${s}`);

  expect(res.status).toBe(200);
  return createHash('sha256').update(new Uint8Array(await res.arrayBuffer())).digest('hex');
}

describe('AC13 日文漢字不出豆腐', () => {
  it('前提：只載 TC 時三個不同的日文漢字渲染出同一張圖（那張就是豆腐）', async () => {
    const tofu = await pngHash(tc_only, '盗');
    const second = await pngHash(tc_only, '涙');
    const third = await pngHash(tc_only, '剣');
    const blank = await pngHash(tc_only, '');

    expect(second).toBe(tofu);
    expect(third).toBe(tofu);
    // 而且豆腐真的有畫東西（不是「什麼都沒畫」剛好也相等）
    expect(tofu).not.toBe(blank);
  }, 30_000);

  it('正式設定渲染「盗」不是豆腐，也不是空白', async () => {
    const tofu = await pngHash(tc_only, '盗');
    const blank = await pngHash(app, '');
    const rendered = await pngHash(app, '盗');

    expect(rendered).not.toBe(tofu);
    expect(rendered).not.toBe(blank);
  }, 30_000);

  it('正式設定下「盗」與「脱」是兩個不同的字形，不是同一顆豆腐', async () => {
    const nusumu = await pngHash(app, '盗');
    const nugu = await pngHash(app, '脱');

    expect(nusumu).not.toBe(nugu);
  }, 30_000);

  it('ja 4 圈 template 的「銀行強盗」整串渲染與只載 TC 的結果不同（真的用到 JP 的字形）', async () => {
    const text = '銀行\n強盗';
    const with_jp = await pngHash(app, text);
    const without = await pngHash(tc_only, text);

    expect(with_jp).not.toBe(without);
  }, 30_000);

  it('TC 有的字不受影響：載不載 JP 都是同一張圖（golden 的前提）', async () => {
    for (const text of ['該做\n的事', 'Things I\nshould do', '早い']) {
      const both = await pngHash(app, text);
      const tc = await pngHash(tc_only, text);

      expect(both, text).toBe(tc);
    }
  }, 30_000);
});
