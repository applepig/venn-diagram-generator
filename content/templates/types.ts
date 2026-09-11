import type { TextSlot, VennStyle } from '../../engine/types';

export interface Template {
  style: VennStyle;
  texts: Record<string, TextSlot>;
}
