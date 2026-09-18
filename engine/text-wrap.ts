/**
 * 換行與字寬估算：不認識圓、槽或 band，只認「一段字、一個字級、一個框寬」。
 *
 * 獨立成 leaf module（不 import engine 裡的任何東西）是刻意的：`layout.ts` 與 `title.ts`
 * 都要用它，放在其中一邊會讓兩個檔互相 import。engine 前後端共用，載入順序不由我們決定，
 * 不留那個環比較安全。
 *
 * 字寬不量 DOM，用字元分類估：前端與 server 才會排出同一份版面。
 */

/**
 * CJK 三段：部首補充～統一漢字、相容漢字、全形與半形。
 *
 * 寫成碼位 escape 不是為了可攜——兩段的端點是未指派碼位（U+9FFF／U+FAFF／U+FF00／U+FFEF），
 * 而 U+F900 的字形與一般漢字 U+8C48 長得一模一樣：直接貼字元改過一次，起點就從 U+F900
 * 掉成 U+8C48，範圍多吃了 U+A000–U+F8FF（韓文、彝文、私用區全被當成漢字），測試還全綠。
 * 寫成 escape 後這一行全是 ASCII，改得動、也看得出邊界；邊界本身由 tests/layout.test.ts
 * 的「CJK 判定的邊界」守著。
 */
const CJK_RANGES = '\u{2E80}-\u{9FFF}\u{F900}-\u{FAFF}\u{FF00}-\u{FFEF}';
const CJK_RE = new RegExp(`[${CJK_RANGES}]`);
// token：CJK 逐字可斷、Latin／數字連續段不可拆、空白當分隔
const TOKEN_RE = new RegExp(`[${CJK_RANGES}]|[^\\s${CJK_RANGES}]+|\\s+`, 'g');

function charWidth(ch: string): number {
  if (CJK_RE.test(ch)) return 1;
  if (ch === ' ') return 0.3;
  return 0.62;
}

export function estimateWidth(line: string, fs: number): number {
  let sum = 0;
  for (const ch of line) sum += charWidth(ch);
  return sum * fs;
}

/** 單一 token 本身就比框寬時逐字硬斷，否則不可拆的 Latin 長字會直接溢出框 */
function breakOversizedToken(token: string, fs: number, max_w: number): string[] {
  const parts: string[] = [];
  let cur = '';
  for (const ch of token) {
    if (cur && estimateWidth(cur + ch, fs) > max_w) {
      parts.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

// 禁則：這些字不能站在行首（收尾標點），「（ 不能停在行尾（開頭標點）
const NO_LINE_START = '」!?。，、）';
const NO_LINE_END = '「（';

/**
 * 把禁字黏到相鄰 token 上，讓貪婪換行沒有機會在禁則位置斷行。
 * 只在黏完仍放得進框寬時才黏：黏不下就讓禁則退讓——溢出框比禁字站行首更糟
 * （01 spec AC1 明訂觸底時保證水平不溢出）。字級還有空間縮時 fitText 會先縮字，
 * 縮到下限才會走到這個退讓路徑。
 */
function applyKinsoku(tokens: string[], fs: number, max_w: number): string[] {
  const fits = (s: string) => estimateWidth(s, fs) <= max_w;

  const glued: string[] = [];
  for (const token of tokens) {
    const prev = glued[glued.length - 1];
    if (
      prev !== undefined &&
      prev.trim() !== '' &&
      NO_LINE_START.includes(token[0]!) &&
      fits(prev + token)
    ) {
      glued[glued.length - 1] = prev + token;
      continue;
    }
    glued.push(token);
  }

  const out: string[] = [];
  for (let i = glued.length - 1; i >= 0; i--) {
    const token = glued[i]!;
    const next = out[0];
    if (
      next !== undefined &&
      NO_LINE_END.includes(token[token.length - 1]!) &&
      fits(token + next)
    ) {
      out[0] = token + next;
      continue;
    }
    out.unshift(token);
  }
  return out;
}

export function wrapText(text: string, fs: number, max_w: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const raw = para.match(TOKEN_RE) ?? [];
    const tokens: string[] = [];
    for (const token of raw) {
      if (token.trim() !== '' && estimateWidth(token, fs) > max_w) {
        tokens.push(...breakOversizedToken(token, fs, max_w));
      } else {
        tokens.push(token);
      }
    }
    let cur = '';
    for (const token of applyKinsoku(tokens, fs, max_w)) {
      if (cur && estimateWidth(cur + token, fs) > max_w) {
        out.push(cur.trim());
        cur = token.trim() === '' ? '' : token;
      } else {
        cur += token;
      }
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

/**
 * 使用者按 Enter 打出的硬行，沒有換行意圖時回 null。
 * 空行不算手動行（wrapText 一向丟掉空段落），濾完不到兩行就沒有換行意圖，
 * 交給自動折行——否則尾端多按一次 Enter 就會壓成一行、字級崩掉。
 */
export function hardLines(text: string): string[] | null {
  const manual = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  return manual.length >= 2 ? manual : null;
}

/**
 * 手動字級下的換行：字級不能動，所以硬行只在每行都放得下時成立；
 * 任一行放不下就整段退回自動折行，用折行保住水平不溢出（01-mvp AC1）。
 */
export function wrapManualFs(text: string, fs: number, max_w: number): string[] {
  const hard = hardLines(text);
  if (hard && hard.every((l) => estimateWidth(l, fs) <= max_w)) return hard;
  return wrapText(text, fs, max_w);
}
