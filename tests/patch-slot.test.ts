import { describe, expect, it } from 'vitest';
import { MAX_TEXT_LEN } from '../engine/defaults';
import { isPristine, sampleState } from '../content/state-presets';
import { patchSlotTexts } from '../ui/patch-slot';

/** 4 圈 template 沒有給 7、11、13、14 這幾個三重槽，是天然的空槽 */
const EMPTY_MASK = '7';

describe('patchSlotTexts：空槽不留幽靈', () => {
  it('對空槽按「自動」字級不會寫進 texts，state 仍算沒編輯過', () => {
    const state = sampleState(4);

    const texts = patchSlotTexts(state.texts, EMPTY_MASK, { fs: undefined });

    expect(EMPTY_MASK in texts).toBe(false);
    expect(isPristine({ ...state, texts })).toBe(true);
  });

  it('對空槽按「自動混色」不會寫進 texts，state 仍算沒編輯過', () => {
    const state = sampleState(4);

    const texts = patchSlotTexts(state.texts, EMPTY_MASK, { fill: undefined });

    expect(EMPTY_MASK in texts).toBe(false);
    expect(isPristine({ ...state, texts })).toBe(true);
  });

  it('把既有槽的文字清空後，該槽整個消失', () => {
    const state = sampleState(2);

    const texts = patchSlotTexts(state.texts, '1', { t: '' });

    expect('1' in texts).toBe(false);
  });

  it('空文字但帶 fill 的槽要留著（挖白的空槽是有效設定）', () => {
    const texts = patchSlotTexts({ '3': { t: '', fill: '#ffffff' } }, '3', { t: '' });

    expect(texts['3']).toEqual({ t: '', fill: '#ffffff' });
  });
});

describe('patchSlotTexts：欄位合併', () => {
  it('對空槽輸入文字會建出新槽', () => {
    const texts = patchSlotTexts({}, '3', { t: '拖到明天' });

    expect(texts['3']).toEqual({ t: '拖到明天' });
  });

  it('套 fs 只改字級，文字與其他欄位原樣保留', () => {
    const texts = patchSlotTexts({ '1': { t: '要快', fill: '#ffffff' } }, '1', { fs: 0.08 });

    expect(texts['1']).toEqual({ t: '要快', fill: '#ffffff', fs: 0.08 });
  });

  it('undefined 代表回到自動：欄位被移除而不是留一個 undefined 值', () => {
    const texts = patchSlotTexts({ '1': { t: '要快', fs: 0.08 } }, '1', { fs: undefined });

    expect(texts['1']).toEqual({ t: '要快' });
    expect('fs' in texts['1']!).toBe(false);
  });

  it('不改動傳進來的 texts', () => {
    const before = { '1': { t: '要快' } };

    patchSlotTexts(before, '1', { fs: 0.08 });

    expect(before).toEqual({ '1': { t: '要快' } });
  });

  it('其他槽原封不動', () => {
    const before = { '1': { t: '要快' }, '2': { t: '要好' } };

    const texts = patchSlotTexts(before, '1', { t: '要更快' });

    expect(texts['2']).toEqual({ t: '要好' });
  });
});

describe('patchSlotTexts：長度上限', () => {
  it('超過上限的文字被截到上限，codec 不會因此拋錯', () => {
    const texts = patchSlotTexts({}, '1', { t: '字'.repeat(MAX_TEXT_LEN + 20) });

    expect(texts['1']!.t).toBe('字'.repeat(MAX_TEXT_LEN));
  });

  it('以 code point 截斷，不會砍出半個 emoji', () => {
    const texts = patchSlotTexts({}, '1', { t: '🎉'.repeat(MAX_TEXT_LEN + 5) });

    expect(texts['1']!.t).toBe('🎉'.repeat(MAX_TEXT_LEN));
  });

  it('剛好上限長度的文字原樣保留', () => {
    const t = '字'.repeat(MAX_TEXT_LEN);

    expect(patchSlotTexts({}, '1', { t })!['1']!.t).toBe(t);
  });
});
