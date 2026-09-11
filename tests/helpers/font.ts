import { fileURLToPath } from 'node:url';

/** 主字型：`defaultFontFamily` 指的就是它（`Noto Sans TC`） */
export const FONT_FILE = fileURLToPath(
  new URL('../../assets/fonts/NotoSansTC-Bold.otf', import.meta.url),
);

/** 日文漢字用的補字字型；SVG 的 font-family 不提它，靠 resvg 逐字 fallback */
export const JP_FONT_FILE = fileURLToPath(
  new URL('../../assets/fonts/NotoSansJP-Bold.otf', import.meta.url),
);

/** 正式站載入的字型清單（`server/index.ts` 的預設值在測試這一側的對照） */
export const FONT_FILES = [FONT_FILE, JP_FONT_FILE];
