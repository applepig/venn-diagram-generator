/**
 * 版本號散在三個檔案，漂掉不會有任何地方報錯：npm 發的是新版，
 * plugin 卻在 `/plugin install` 的畫面上自稱舊版。這支就是那道閘門。
 * 同步靠 `scripts/sync-plugin-version.ts`（npm 的 `version` lifecycle hook 會跑）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`${ROOT}${path}`, 'utf8'));
}

describe('版本號三處一致', () => {
  const pkg_version = String(readJson('package.json').version);

  it('package.json 的版本是 semver', () => {
    expect(pkg_version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  it('.claude-plugin/plugin.json 與 package.json 同版', () => {
    expect(readJson('.claude-plugin/plugin.json').version).toBe(pkg_version);
  });

  it('.claude-plugin/marketplace.json 的 venn 條目與 package.json 同版', () => {
    const plugins = readJson('.claude-plugin/marketplace.json').plugins as {
      name: string;
      version: string;
    }[];
    const venn = plugins.find((p) => p.name === 'venn');
    expect(venn).toBeDefined();
    expect(venn?.version).toBe(pkg_version);
  });
});
