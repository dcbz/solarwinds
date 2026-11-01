// FUN_231e_99c2 @0x2cba2 — the shared F1/Escape disk menu.
// Labels are the `$`/0x01-delimited strings at DS:0x6bc3 in SOLAR1.EXE.

import { WIDTH, type Framebuffer } from '../framebuffer.ts';
import { drawCentered, drawText, type TextFont } from './text.ts';
import { shadeIndex } from './conversation.ts';

export interface MenuItem { key: string; label: string; action: 'load' | 'save' | 'return' | 'order' | 'quit' | 'new' }

export const MENU_ITEMS: readonly MenuItem[] = Object.freeze([
  { key: 'l', label: 'L)OAD A SAVED GAME', action: 'load' },
  { key: 's', label: 'S)AVE CURRENT GAME', action: 'save' },
  { key: 'r', label: 'R)ETURN TO GAME', action: 'return' },
  { key: 'o', label: 'O)RDERING INFORMATION', action: 'order' },
  { key: 'q', label: 'Q)UIT GAME', action: 'quit' },
  { key: 'n', label: 'N)EW GAME', action: 'new' },
]);

export function drawMenu(fb: Framebuffer, font: TextFont, selected: number, note = ''): void {
  // The original modal darkens the page before drawing its text. Preserve the
  // palette-ramp transform used by the adjacent conversation modal.
  for (let y = 28; y < 174; y++) {
    for (let x = 43; x < 277; x++) {
      const p = y * WIDTH + x;
      fb.vram[p] = shadeIndex(fb.vram[p]);
    }
  }
  drawCentered(fb, font, 42, 'DISK OPTIONS');
  for (let i = 0; i < MENU_ITEMS.length; i++) {
    const prefix = i === selected ? '> ' : '  ';
    drawText(fb, font, (64 + i * 16) * WIDTH + 72, prefix + MENU_ITEMS[i].label);
  }
  if (note) drawCentered(fb, font, 164, note);
  fb.dirty = true;
}

export function menuIndexForKey(key: string): number {
  const normalized = key.length === 1 ? key.toLowerCase() : key;
  return MENU_ITEMS.findIndex((item) => item.key === normalized);
}
