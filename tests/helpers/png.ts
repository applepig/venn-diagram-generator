import { inflateSync } from 'node:zlib';

/** 讀 PNG 的 IHDR chunk 拿真實像素尺寸 */
export function pngSize(buf: Buffer): { width: number; height: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(signature)) throw new Error('不是 PNG：signature 不符');
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') throw new Error('PNG 缺少 IHDR chunk');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export interface DecodedPng {
  width: number;
  height: number;
  channels: number;
  pixels: Buffer;
}

/** 解 PNG scanline，讓測試從公開 PNG 像素驗證合成區域。 */
export function decodePng(buf: Buffer): DecodedPng {
  const { width, height } = pngSize(buf);
  const color_type = buf[25];
  const channels = color_type === 6 ? 4 : color_type === 2 ? 3 : 0;
  if (channels === 0) throw new Error(`PNG color type ${color_type} 不受支援`);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < buf.length; ) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') chunks.push(buf.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)]!;
    if (filter > 4) throw new Error(`PNG filter ${filter} 不受支援`);
    const current = Buffer.from(raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? current[i - channels]! : 0;
      const up = previous[i]!;
      const upper_left = i >= channels ? previous[i - channels]! : 0;
      if (filter === 1) current[i] = current[i]! + left;
      else if (filter === 2) current[i] = current[i]! + up;
      else if (filter === 3) current[i] = current[i]! + Math.floor((left + up) / 2);
      else if (filter === 4) {
        const estimate = left + up - upper_left;
        const distances = [
          Math.abs(estimate - left),
          Math.abs(estimate - up),
          Math.abs(estimate - upper_left),
        ];
        const nearest =
          distances[0]! <= distances[1]! && distances[0]! <= distances[2]!
            ? left
            : distances[1]! <= distances[2]!
              ? up
              : upper_left;
        current[i] = current[i]! + nearest;
      }
    }
    current.copy(pixels, row * stride);
    previous = current;
  }
  return { width, height, channels, pixels };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 區域內每通道的平均值。dither 讓單一像素可以差到 ±70，但平均值不動，
 * 所以「底圖有沒有被蓋掉／位移」這類斷言改看區域平均才不會誤紅。
 */
export function meanRgb(image: DecodedPng, rect?: Rect): [number, number, number] {
  const { x = 0, y = 0, w = image.width, h = image.height } = rect ?? {};
  let r = 0;
  let g = 0;
  let b = 0;
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      const offset = (row * image.width + col) * image.channels;
      r += image.pixels[offset]!;
      g += image.pixels[offset + 1]!;
      b += image.pixels[offset + 2]!;
    }
  }
  const count = w * h;
  return [r / count, g / count, b / count];
}
