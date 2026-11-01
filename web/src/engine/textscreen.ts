// The three remaining in-world text menus and the tracking arm, transcribed from SOLAR1.EXE.
// Linear = file + 0xf200; far `lcall 0x131e,OFF` -> 0x231e0 + OFF. Blob i = DS - 0xAD.
//
//   m  FUN_231e_3a81 @0x26c61  TASKS: prints DS:0x4986 header, then for each quest word
//      DS:0x3ab5 + i*2 (a $-list of task strings at DS:0x4a34, one per word, 0xffff sentinel) a
//      non-zero word prints task[i]; ends with FUN_231e_2f4d + FUN_231e_8a92 (the key wait).
//   /  FUN_231e_? @0x2dd9f     HELP: re-installs INT 9 from DS:0xb998, waits a key, then the topic
//      block at DS:0x83ae.
//   d  FUN_231e_? @0x2e987     TRACK: sets DS:0x3ae1 to the next visible actor whose record byte
//      +0xb < 5 (a "trackable" class); "NOTHING TO TRACK" (DS:0x49a3) when none.

import { WIDTH, type Framebuffer } from '../framebuffer.ts';
import { drawWrapped, type TextFont } from './text.ts';
import { DS_FILE_DELTA } from './state.ts';
import type { State } from './state.ts';

/** A `$`-terminated string resident in the EXE's initialized data segment (file = DS + 0xF90). This
 *  is NOT the transient status pool (messages.ts uses DS + 0xE00 for those); these strings are link
 *  data, so the state-format.md law applies. Trailing `0x01` (the message-center advance marker) is
 *  stripped. */
export function dataString(exe: Uint8Array, ds: number): string {
  let p = ds + DS_FILE_DELTA;
  let s = '';
  while (p < exe.length && exe[p] !== 0x24 && exe[p] !== 0x00) { s += String.fromCharCode(exe[p] === 0x60 ? 0x27 : exe[p]); p += 1; }
  return s.replace(/^\x01+/, '').replace(/\x01+$/, '');
}

/** A run of `$`-separated strings starting at DS offset, up to `max` records. `0x01` edge markers stripped. */
function dataStrings(exe: Uint8Array, ds: number, max: number): string[] {
  let p = ds + DS_FILE_DELTA;
  const out: string[] = [];
  while (p < exe.length && out.length < max) {
    if (exe[p] === 0x00) break;
    let s = '';
    while (p < exe.length && exe[p] !== 0x24 && exe[p] !== 0x00) { s += String.fromCharCode(exe[p] === 0x60 ? 0x27 : exe[p]); p += 1; }
    p += 1; // consume the '$'
    out.push(s.replace(/^\x01+/, '').replace(/\x01+$/, ''));
  }
  return out;
}

export const TASKS = {
  header: 0x4986,        // "         TASKS TO COMPLETE"
  strings: 0x4a34,       // first task string; $-separated, parallel to the flag words
  flagsBase: 0x3ab5,     // 15 words, 0xffff = end
  footer: 0x591b,        // "            PRESS A KEY" (@0x26c9a)
  cite: '@0x26c61 FUN_231e_3a81',
};

export const HELP_TOPICS = 0x83ae; // "MAIN HELP MENU / THE STORY / ..." block

/** Read the $-separated task strings starting at DS:0x4a34 from the EXE image. */
export function taskStrings(exe: Uint8Array): string[] {
  return dataStrings(exe, TASKS.strings, 32);
}

/** Active tasks: walk the flag words DS:0x3ab5 + i*2 exactly as @0x26c73 does — 0xffff ends the walk,
 *  a non-zero word prints task[i] (task strings live at DS:0x4a34, one record per slot). */
export function activeTasks(exe: Uint8Array, sv: State): { index: number; text: string }[] {
  const strings = taskStrings(exe);
  const out: { index: number; text: string }[] = [];
  for (let i = 0; i < strings.length; i++) {
    let w: number;
    try { w = sv.wordAt(TASKS.flagsBase + i * 2); } catch { break; }
    if (w === 0xffff) break;      // @0x26c73 `cmp word ptr [di+0x3ab5],0xffff / je done`
    if (w !== 0) out.push({ index: i, text: strings[i] });
  }
  return out;
}

export interface TextScreen {
  title: string;
  body: string[];          // one entry per logical line (wrapped at draw time)
  footer?: string;
  site: number;
  /** When set, the screen is a two-level menu: number keys / click show that option's page, and a
   *  further key returns to this list — the `@0x2ddc0` selector -> page -> `jmp 0x2ddc0` loop. */
  options?: { label: string; cite: string }[];
  pageOf?: (option: number) => string;   // resolve an option index to its page text
  /** A help page (not the topic list): any key returns to the topic list. */
  returnToHelp?: boolean;
}

/**
 * Draw a menu screen into a 320x200 frame: a darkened page, a centered title, a wrapped body and an
 * optional footer, matching the message-centre block FUN_231e_3a81 uses (wrap width 0xc4, ten rows a
 * page like FUN_231e_2cf5). Callers own the key wait (@0x2f4d/@0x8a92); this only paints.
 */
export function drawTextScreen(fb: Framebuffer, font: TextFont, screen: TextScreen, shade: (v: number) => number): void {
  for (let y = 4; y < 196; y++) {
    for (let x = 5; x < 315; x++) {
      const p = y * WIDTH + x;
      fb.vram[p] = shade(fb.vram[p]);
    }
  }
  drawWrapped(fb, font, screen.title, { x: 15, y: 15, width: 196, maxLines: 1, lineHeight: 8 });
  let y = 31;
  for (const line of screen.body) {
    const rows = drawWrapped(fb, font, line, { x: 20, y, width: 280, maxLines: 2, lineHeight: 8 });
    y += Math.max(1, rows.length) * 8 + 2;
    if (y > 178) break;
  }
  if (screen.footer) drawWrapped(fb, font, screen.footer, { x: 15, y: 186, width: 196, maxLines: 1 });
  fb.dirty = true;
}

/** The HELP block at DS:0x83ae: one record, `MAIN HELP MENU` title + 7 `\x01`-separated topic labels. */
export function helpTopics(exe: Uint8Array): string[] {
  const first = dataStrings(exe, HELP_TOPICS, 1)[0] ?? '';
  return first.split('\x01').map((s) => s.replace(/\s+$/, '')).filter(Boolean).slice(1);
}

/**
 * The topic -> page mapping from the `cmp al,N` chain at @0x2dde4..@0x2df06. Each is the `$` string
 * lcall'd to FUN_231e_8bdc; the option-2 (Control Panel) page is chosen by DS:0x3ade (the sound /
 * message-display enable — @0x2de46 `cmp byte[0x3ade],1`).
 */
export const HELP_PAGES = Object.freeze([
  { label: 'THE STORY', page: 0x8d6e, cite: '@0x2ddef lea bx,[0x8d6e]' },
  { label: 'ORDERING INFORMATION', page: 0x740e, cite: '@0x2de14 lea bx,[0x740e]' },
  { label: 'Control Panel', page: 0x8ff2, pageAlt: 0x9522, gate: 0x3ade, cite: '@0x2de39 lea bx,[0x8ff2] or [0x9522] when DS:0x3ade==1' },
  { label: 'Radar', page: 0x9f12, cite: '@0x2de86 lea bx,[0x9f12]' },
  { label: 'Using keyboard, mouse or joystick', page: 0xa269, cite: '@0x2deb0 lea bx,[0xa269]' },
  { label: 'GETTING STARTED', page: 0x843e, cite: '@0x2deda lea bx,[0x843e]' },
  { label: 'Return to the game', exit: true, cite: '@0x2df04 cmp al,6 -> exit @0x2df0b' },
]);

/** Resolve which page bytes a help option draws, honouring the DS:0x3ade gate. */
export function helpPageText(exe: Uint8Array, sv: State, option: number): string {
  const p = HELP_PAGES[option];
  if (!p || p.exit) return '';
  let addr = p.page ?? 0;
  if (p.gate !== undefined && p.pageAlt !== undefined) {
    try { if (sv.byteAt(p.gate) === 1) addr = p.pageAlt; } catch { /* no blob: keep the default page */ }
  }
  return dataString(exe, addr);
}

/** The MAIN HELP MENU topic screen (@0x2ddd3 FUN_231e_5133, AL=7). */
export function openHelp(exe: Uint8Array, sv: State, site: number): TextScreen {
  return {
    title: 'MAIN HELP MENU',
    body: HELP_PAGES.map((p, i) => `${i + 1}. ${p.label}`),
    options: HELP_PAGES.map((p) => ({ label: p.label, cite: p.cite })),
    pageOf: (option: number) => helpPageText(exe, sv, option),
    site,
  };
}

/**
 * Select a help option: exit (or the Return row) closes the modal; otherwise show that topic's page,
 * which re-arms the topic list on the next key (@0x2de12/@0x2de37/... `jmp 0x2ddc0`). Returns the new
 * screen state (or null when the menu is dismissed).
 */
export function helpChoose(current: TextScreen, option: number, exe: Uint8Array, sv: State): TextScreen | null {
  const page = HELP_PAGES[option];
  if (!page || page.exit) return null;
  return { title: page.label, body: [helpPageText(exe, sv, option)], footer: 'press a key to return to the menu', site: 0x2ddc0, returnToHelp: true };
}
