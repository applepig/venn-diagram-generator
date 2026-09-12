/**
 * CLI 的 I/O 層。純邏輯（`stateParamOf`／`baseUrlOf`／退出碼映射）直接 import 驗，
 * 子命令與退出碼走 subprocess 跑真的 bundle——`cli/venn.ts` 尾端有 top-level `await main()`，
 * import 進來就會直接執行，只能從外面跑。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { FALLBACK_BASE_URL, RenderError, baseUrlOf, exitCodeFor, stateParamOf } from '../cli/run';
import { SpecError } from '../cli/spec';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUNDLE = join(ROOT, 'dist-cli/venn.mjs');

/** 一條真的分享網址，下面的 decode 測試都從它變化出來 */
const S =
  'NclBaoNQFIXhvfxOL0FfQPBuJXTwNLdFEA2-F6kRN1E6TCgddAOl0EHpblqzjeAgHPgH35kY0ExoUSeEODaGEnvfhuZYWRsRuoOv6jii6SYXusH6xh_QbOOE3u_rY1ivrVB1TdcHdEfirCgtR0gs94UzHoTyCSV59OsQQn0yNHNpKkR7jgGdyNZElP_vj7_fM7Pg7nR9fVu-flba3mn5fLle3pnn-QY';

describe('stateParamOf', () => {
  it('裸的 s 字串原樣回傳', () => {
    expect(stateParamOf(S)).toBe(S);
    expect(stateParamOf(`  ${S}  `)).toBe(S);
  });

  it('完整分享網址取得出 s', () => {
    expect(stateParamOf(`https://venn.applepig.net/?s=${S}`)).toBe(S);
  });

  it('網址尾巴帶 fragment 時不把錨點併進 s', () => {
    expect(stateParamOf(`https://venn.applepig.net/?s=${S}#hello`)).toBe(S);
  });

  it('s 之前還有別的參數，且帶 fragment', () => {
    expect(stateParamOf(`https://venn.applepig.net/?lang=en&s=${S}#foo`)).toBe(S);
  });

  it('只有 query 的片段也吃得下', () => {
    expect(stateParamOf(`?s=${S}`)).toBe(S);
  });

  it('沒有 s 參數的網址報錯', () => {
    expect(() => stateParamOf('https://venn.applepig.net/?lang=en')).toThrow(SpecError);
  });

  it('空字串報錯', () => {
    expect(() => stateParamOf('   ')).toThrow(SpecError);
  });
});

describe('baseUrlOf', () => {
  it('旗標優先於環境變數', () => {
    expect(baseUrlOf({ 'base-url': 'https://a.example' }, { VENN_BASE_URL: 'https://b.example' })).toBe(
      'https://a.example',
    );
  });

  it('沒有旗標時取環境變數', () => {
    expect(baseUrlOf({}, { VENN_BASE_URL: 'https://b.example' })).toBe('https://b.example');
  });

  it('兩者都沒有時退回內建常數', () => {
    expect(baseUrlOf({}, {})).toBe(FALLBACK_BASE_URL);
  });

  it('尾斜線修掉，網址不會多一條斜線', () => {
    expect(baseUrlOf({ 'base-url': 'https://a.example///' }, {})).toBe('https://a.example');
  });
});

describe('exitCodeFor', () => {
  it('點陣化失敗是 2，其餘是 1', () => {
    expect(exitCodeFor(new RenderError('boom'))).toBe(2);
    expect(exitCodeFor(new SpecError('bad flag'))).toBe(1);
    expect(exitCodeFor(new Error('anything else'))).toBe(1);
  });
});

describe('subprocess：跑真的 bundle', () => {
  // 每次都重建，否則測試會對著上一次的 bundle 綠掉
  beforeAll(() => {
    execFileSync('pnpm', ['build:cli'], { cwd: ROOT, timeout: 120_000 });
  }, 120_000);

  const venn = (args: string[], input?: string) =>
    spawnSync(process.execPath, [BUNDLE, ...args], { encoding: 'utf8', input, cwd: ROOT });

  it('url 印出帶 s 的分享網址', () => {
    const out = venn(['url', '--set', 'A=工作', '--set', 'B=生活', '--text', 'AB=沒睡']);
    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toMatch(/^https:\/\/venn\.applepig\.net\/\?s=[A-Za-z0-9_-]+$/);
  });

  it('svg 寫出檔案並印出路徑與網址兩行', () => {
    const dir = mkdtempSync(join(tmpdir(), 'venn-cli-'));
    const file = join(dir, 'out.svg');
    const out = venn(['svg', '--set', 'A=工作', '--set', 'B=生活', '-o', file]);
    expect(out.status).toBe(0);

    const lines = out.stdout.trim().split('\n');
    expect(lines[0]).toBe(`${file} (1200x1200)`);
    expect(lines[1]).toMatch(/^https:\/\/venn\.applepig\.net\/\?s=/);
    expect(readFileSync(file, 'utf8')).toMatch(/^<svg xmlns=/);
  });

  it('png 從 stdin 收 JSON，寫出真的 PNG', () => {
    const dir = mkdtempSync(join(tmpdir(), 'venn-cli-'));
    const file = join(dir, 'out.png');
    const spec = JSON.stringify({ sets: ['工作', '生活'], texts: { AB: '沒有睡眠' } });
    const out = venn(['png', '--json', '-', '-o', file], spec);
    expect(out.status).toBe(0);

    // PNG 的 magic number；只認前八個位元組，不比對整張圖
    const head = [...readFileSync(file).subarray(0, 8)];
    expect(head).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(statSync(file).size).toBeGreaterThan(1000);
  });

  it('decode 印出友善 JSON，--raw 印出原始 state', () => {
    const friendly = venn(['decode', `https://venn.applepig.net/?s=${S}`]);
    expect(friendly.status).toBe(0);
    expect(JSON.parse(friendly.stdout).sets).toEqual(['工作', '生活']);

    const raw = venn(['decode', S, '--raw']);
    expect(raw.status).toBe(0);
    expect(JSON.parse(raw.stdout).v).toBe(1);
  });

  it('decode 吃得下帶 fragment 的網址', () => {
    const out = venn(['decode', `https://venn.applepig.net/?lang=en&s=${S}#section`]);
    expect(out.status).toBe(0);
    expect(JSON.parse(out.stdout).texts).toEqual({ AB: '沒睡' });
  });

  it('spec 有誤時退出碼 1，訊息走 stderr', () => {
    const out = venn(['url', '--set', 'A=1', '--set', 'B=2', '--set', 'C=3', '--set', 'D=4', '--text', 'AD=x']);
    expect(out.status).toBe(1);
    expect(out.stdout).toBe('');
    expect(out.stderr).toContain('valid slots for ring(4)');
  });

  it('點陣化失敗時退出碼 2', () => {
    // resvg 解析不到的目錄：bundle 把它列為 external，所以只有 png 這條路會炸
    const dir = mkdtempSync(join(tmpdir(), 'venn-cli-'));
    const isolated = join(dir, 'venn.mjs');
    copyFileSync(BUNDLE, isolated);

    const svg = spawnSync(process.execPath, [isolated, 'svg', '--set', 'A=a', '--set', 'B=b'], {
      encoding: 'utf8',
      cwd: dir,
    });
    expect(svg.status).toBe(0);

    const png = spawnSync(process.execPath, [isolated, 'png', '--set', 'A=a', '--set', 'B=b'], {
      encoding: 'utf8',
      cwd: dir,
    });
    expect(png.status).toBe(2);
    expect(png.stderr).toContain('venn:');
  });
});
