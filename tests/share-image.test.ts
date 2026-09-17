/**
 * 12 AC1：分享圖片按鈕的能力探測。
 * 按鈕的 DOM 行為與 iOS 分享表單只能實機驗，這裡守的是「什麼情況下該不該冒出這顆按鈕」。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShareImageFile } from '../ui/share-image';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AC1 canShareImageFile()', () => {
  it('瀏覽器說收得下 PNG File 時回 true', () => {
    vi.stubGlobal('navigator', { canShare: () => true });

    expect(canShareImageFile()).toBe(true);
  });

  it('瀏覽器說收不下時回 false', () => {
    vi.stubGlobal('navigator', { canShare: () => false });

    expect(canShareImageFile()).toBe(false);
  });

  it('沒有 navigator.canShare 的瀏覽器回 false', () => {
    vi.stubGlobal('navigator', {});

    expect(canShareImageFile()).toBe(false);
  });

  it('canShare 丟例外時回 false，不讓探測炸掉整個面板', () => {
    vi.stubGlobal('navigator', {
      canShare: () => {
        throw new TypeError('bad argument');
      },
    });

    expect(canShareImageFile()).toBe(false);
  });

  it('問的是一個真的 PNG File：Safari 依檔案型別決定收不收', () => {
    const canShare = vi.fn(() => true);
    vi.stubGlobal('navigator', { canShare });

    canShareImageFile();

    expect(canShare).toHaveBeenCalledOnce();
    const [{ files }] = canShare.mock.calls[0] as unknown as [{ files: File[] }];
    expect(files).toHaveLength(1);
    expect(files[0]!.type).toBe('image/png');
  });
});
