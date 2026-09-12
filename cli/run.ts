/**
 * `venn.ts` 裡不碰檔案系統的那部分。抽出來才測得動：`venn.ts` 尾端有 top-level `await main()`，
 * 一 import 就會執行，所以留在那裡的邏輯只能靠 subprocess 驗。
 */
import { type Flags, str } from './flags';
import { SpecError } from './spec';

/** 分享網址的最後手段；與 package.json 的 homepage 一致 */
export const FALLBACK_BASE_URL = 'https://venn.applepig.net';

/** 點陣化失敗；與參數錯誤分開，才能用退出碼區分「使用者打錯」與「這台機器跑不動」 */
export class RenderError extends Error {}

/** 退出碼：0 成功、1 參數或 spec 有誤、2 點陣化失敗 */
export function exitCodeFor(err: unknown): number {
  return err instanceof RenderError ? 2 : 1;
}

/** `--base-url` → `VENN_BASE_URL` → 內建常數；尾斜線修掉，否則網址會多一條斜線 */
export function baseUrlOf(flags: Flags, env: NodeJS.ProcessEnv = process.env): string {
  const raw = str(flags, 'base-url') ?? env.VENN_BASE_URL ?? FALLBACK_BASE_URL;
  return raw.replace(/\/+$/, '');
}

/**
 * 吃完整分享網址或裸的 `s` 字串；貼過來的東西通常是前者。
 * 一律走 `new URL`，不自己切字串：手切取不掉 `#` 之後的錨點，而聊天軟體與瀏覽器
 * 很常在網址尾巴補一段，`s` 剛好是最後一個參數時就會連錨點一起被當成狀態。
 */
export function stateParamOf(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') throw new SpecError('decode expects a share URL or an s parameter');
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.includes('?')) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed, 'https://venn.invalid');
  } catch {
    throw new SpecError(`could not parse "${input}" as a URL`);
  }
  const s = url.searchParams.get('s');
  if (!s) throw new SpecError('that URL has no ?s= parameter');
  return s;
}
