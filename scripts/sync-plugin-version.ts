// 版本號有三處：package.json（npm）、.claude-plugin/plugin.json 與 marketplace.json（Claude Code plugin）。
// 這支把後兩者對齊 package.json，由 npm 的 `version` lifecycle hook 在 bump 之後、commit 之前呼叫，
// 所以 `npm version minor` 一個指令就會把三處一起改進同一筆 commit 與 tag。
// 漂掉的話 npm 發的是新版、plugin 卻自稱舊版，而且沒有任何地方會報錯——tests/version-sync.test.ts 守這件事。
// 用法：pnpm tsx scripts/sync-plugin-version.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * 只換版本號那一行，不重寫整份 JSON：`JSON.stringify` 會把鍵序與排版洗掉，
 * 讓每次發版的 diff 從一行變成整個檔案。
 */
function patchVersion(path: string, current: string, next: string): boolean {
  const before = readFileSync(path, 'utf8');
  const needle = `"version": "${current}"`;
  if (!before.includes(needle)) {
    throw new Error(`${path}: 找不到 ${needle}，版本欄位的寫法可能變了`);
  }
  const after = before.replace(needle, `"version": "${next}"`);
  if (after === before) return false;
  writeFileSync(path, after);
  return true;
}

const pkg_file = `${ROOT}package.json`;
const plugin_file = `${ROOT}.claude-plugin/plugin.json`;
const marketplace_file = `${ROOT}.claude-plugin/marketplace.json`;

const version = String(readJson(pkg_file).version);
const plugin_version = String(readJson(plugin_file).version);

// marketplace 是一個清單，認名字而不是位置：之後多收一個 plugin 進來也不會改到錯的那筆
const entries = readJson(marketplace_file).plugins as { name: string; version: string }[];
const venn = entries.find((entry) => entry.name === 'venn');
if (venn === undefined) {
  throw new Error(`${marketplace_file}: 找不到 name 為 "venn" 的 plugin 條目`);
}
const marketplace_version = String(venn.version);

let changed = 0;
if (plugin_version !== version && patchVersion(plugin_file, plugin_version, version)) changed++;
if (marketplace_version !== version && patchVersion(marketplace_file, marketplace_version, version))
  changed++;

console.log(
  changed === 0
    ? `plugin 版本已是 ${version}，無須同步`
    : `plugin 版本同步到 ${version}（${changed} 個檔案）`,
);
