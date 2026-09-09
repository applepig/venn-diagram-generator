import { fileURLToPath } from 'node:url';

export const FONT_FILE = fileURLToPath(
  new URL('../../assets/fonts/NotoSansTC-Bold.otf', import.meta.url),
);
