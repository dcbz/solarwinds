// Solar Winds — the screen compositor FUN_231e_7e6d @0x2b04d.
//
// This is the routine the port could not name a source for (`TODO_ART_SOURCE@0x2b04d`). It is not a
// plain `rep movsb` of one scratch page: it is a two-mode compositor whose single argument is the
// mode byte, and the art it draws comes from the record stream the loader last decoded into the
// arena described by the descriptor block DS:0x6b8b..DS:0x6bbd.
//
// The proof that the arena is BH_PAN.DAT is arithmetic, not narrative. Every number below is either
// a literal in the instruction stream or a value that only BH_PAN's layout reproduces:
//
//   BH_PAN (stone, dispatcher slot 8 @0x2fa22, decode loop @0x2fac3) decodes to 45,071 bytes:
//     rec0 91x135 @+0x00000..0x2FFB   rec1 91x135 @+0x2FFD   rec2 91x135 @+0x5FFA
//     rec3 90x24  @+0x8FFD (pixels @+0x8FFF)   rec4 93x65 @+0x986F (pixels @+0x9871)
//   The blit hard-codes ES:[0x8FFF] (@0x2b0ec, 45 words x 24 rows) and ES:[0x9871] (@0x2b157,
//   93 x 65, dest VRAM:0xE3 = col 227 rows 0..64 because the row advance `ADD SI,0xE3` @0x2b175
//   lands SI on 320+227 = row 1 col 227). 0x8FFF and 0x9871 are exactly rec3/rec4's pixel offsets,
//   and the walk's fixed block size 0x5B x 0x87 (@0x2b0ae/@0x2b0ac) is exactly rec0..rec2's 91x135.
//   No other shipped resource has 91x135 records (checked against all 20 dispatcher streams: BH_MS
//   35x35, BH_PLAN 30x24.., BH_SEQ2 49x27.., BH_MW2P 45x45, BH_MW3A/B ~115x94, BH_SML 8x8).
//
// Call sites: 21 `lcall 0x131e,0x7e6d` in the image, and *every* one of them is preceded by either
// `mov al,[0x3c91]` or `mov al,<n>` immediately followed by `mov [0x3c91],al` — so the page id and
// the mode global are the same number. Grouped by the function that contains them:
//   0x23f58 FUN_231e_0bf6 @0x23dd6+0x182   the pump epilogue: forces mode 1 and repaints
//   0x2c567,0x2c590 FUN_231e_91ed @0x2c3cd  both gated on `cmp byte [0x3c91],4`
//   0x2cbb5,0x2d14f FUN_231e_99c2 @0x2cba2  the shared in-game menu (entry and exit)
//   0x2e120/0x2e160/0x2e1ae FUN_231e_ad48   another AL=3 / AL=4 / AL=2 mode-switch trio
//   0x2e3b4,0x2e4ad,0x2e60e                 three "back to the title" helpers, one call each
//   0x2e6f2,0x2e708,0x2e725 FUN_231e_b509   STATE 1 handler: the a/w/e arms
//   0x2e9fe   FUN_231e_b809 @0x2e9e9+0x15   STATE 2 handler: its Escape arm
//   0x2eaa2   FUN_231e_b8ad @0x2ea8d+0x15   STATE 4 handler: its Escape arm
//   0x2eba1   FUN_231e_b9ac @0x2eb8c+0x15   STATE 3 handler: its Escape arm
//   0x2ec9c,0x2ece9,0x2ed0d FUN_231e_ba64   the pager body — all three of its tails repaint
//   0x2ee3c   FUN_231e_bc39 @0x2ee19        cursor reset to 1, then repaint
// Every state handler therefore has exactly one compositor call (its Escape arm), state 1 has three
// (the mode switches), and paging repaints the current page without changing which page it is.
//
// Addresses are linear byte coordinates (file offset + 0xf200). DS-relative fields are given as
// linear = DS offset + 0x10190, matching re/state-format.md.

import { Framebuffer, WIDTH } from '../framebuffer.ts';
import { clearBarMirrors } from './bars.ts';

export const PAGE_BLIT = 0x2b04d; // FUN_231e_7e6d
export const PAGE_TAIL = 0x2afe4; // FUN_231e_7e04 — clears the sprite/cursor slots, draws nothing

// --- the descriptor block (DS:0x6b8b..DS:0x6bbd) ---------------------------------
// Fields the compositor reads. Each is a u16 at a DS offset; the linear form is what loop.ts's
// rdWord()/`st.g` address space uses (DS + 0x10000 ... see re/state-format.md CORRECTION).
export const FIELDS = {
  arenaSeg: 0x16b9d,   // DS:0x6b9d — segment of the decoded record stream the walk runs over
  pageSeg: 0x16b9f,    // DS:0x6b9f — segment of the 320x200 background page (mode-1 strip source)
  panelDest: 0x16bb3,  // DS:0x6bb3 — VRAM offset of the 91x135 panel
};

// DS:0x6bb3 in the shipped image is 0x5224 = 65*320 + 228, i.e. col 228 / row 65. That is the only
// initialized value at that field and the field has no writer with a literal operand anywhere in the
// 21 KB of code (byte-scanned: the only references to 0x6bb3 are the two reads at 0x2b0a4/0x2b0c1),
// so the panel origin is a constant of the image. TODO_FIELDWRITER@0x6bb3 records that a runtime
// store through an indexed address cannot be excluded.
export const PANEL_DEST = 0x5224;

export const PANEL = {
  w: 0x5b,          // @0x2b0ae mov cx,0x5b  (blit columns)
  h: 0x87,          // @0x2b0ac mov ah,0x87  (blit rows)
  rowAdvance: 0xe5, // @0x2b0b3 add di,0xe5  — 0x140 - 0x5b, so the panel ends flush at col 319
  dest: PANEL_DEST,
  borderIndex: 0x8f, // @0x2b0c6 mov byte es:[di],0x8f
  borderRows: 0x6e,  // @0x2b0d0 cmp cl,0x6e  — 110 rows, starting at dest-1 (@0x2b0c3 dec di)
  borderStride: 0x140, // @0x2b0ca add di,0x140
};

export const BOX = {
  w: 93,             // @0x2b15a mov cl,0x5d
  h: 65,             // @0x2b15c mov ch,0x41
  dest: 0xe3,        // @0x2b164 mov si,0xe3 — col 227, row 0 (93 columns reach 319 exactly)
  rowAdvance: 0xe3,  // @0x2b175 add si,0xe3 — again a 320-byte row
  arenaOffset: 0x9871, // @0x2b157 mov di,0x9871 — BH_PAN record 4's pixels
};

export const STRIP = {
  x: 0xe2,        // @0x2b121/@0x2b124 mov si/di,0xe2 — col 226
  w: 0x5e,        // @0x2b127/@0x2b13d mov cx,0x5e — 94 columns (226..319)
  rows: 0xc8,     // @0x2b131 mov al,0xc8 — all 200 rows
  rowAdvance: 0xe2, // @0x2b135/@0x2b139 add di/si,0xe2
};

// @0x2b0ec..@0x2b119, inside the page-1 branch and gated on DS:0x3be6 == 1 (the cheat latch, set
// @0x23c81) and DS:0x3ade == 0: copies BH_PAN record 3 (90x24) as 45 words x 24 rows into
// DS:0xdce5. It reads arena pixels into a RAM buffer, so it moves no pixels onto the screen.
export const RECORD3 = { words: 0x2d, rows: 0x18, arenaOffset: 0x8fff, dest: 0x13ce5 };

// @0x2b053 `cmp byte ptr [0x0],0`, @0x2b05b `mov ax,2 / int 0x33`, @0x2b183..@0x2b18d
// `mov ax,1 / int 0x33`. The flag at DS:0 is written by the boot dispatcher from INT 33h AX=0
// (FUN_231e_c4cf: `int 0x33` -> `mov [0x0], al`), so it means "a mouse is installed". The port has
// no cursor sprite yet; the calls are recorded in the trace instead of drawn.
export const MOUSE_FIELD = 0x10000; // DS:0x0000

/** Which BH_PAN record a page id walks to: the walk at @0x2b074 decrements BL until it is 2. */
export function pageRecord(page: number) { return page - 2; }

export interface PageArt {
  /** BH_PAN's decoded records, in stream order (screens.js `kind: 'stream'` -> walkRecords). */
  records: { width: number; height: number; pixels: Uint8Array }[];
  /** The 320x200 background page held at [0x6b9f]; the last full frame the loaders decoded. */
  page: Uint8Array;
  /** DS:0x3c91 at the time of the call, which gates the box blit (@0x2b14a). */
  mode: number;
  /** loop.ts's sparse global mirror. When supplied, the compositor's tail (@0x2b18f) runs the
   *  bar-mirror half of FUN_231e_7e04 @0x2afe4, which is what makes the next FUN_231e_8043 pass
   *  repaint the engineering bars over the fresh art instead of diffing against a stale frame. */
  g?: Record<number, number | undefined>;
}

export interface PageResult {
  page: number;
  record: number | null;
  drew: string[];
}

/**
 * Transcribes FUN_231e_7e6d. `fb.vram` is A000:0000 and is written exactly as `rep movsb` /
 * `movsb` loops would: unconditionally, no transparency, so a page blit composites over whatever
 * is already on screen and a mode-1 strip erases the panel again.
 */
export function blitPage(fb: Framebuffer, page: number, art: PageArt): PageResult {
  const vram = fb.vram;
  const drew: string[] = [];

  if (page === 1) {
    // @0x2b11c: ES=0xA000, DS=[0x6b9f], 94 bytes x 200 rows from offset 0xe2 to offset 0xe2.
    for (let y = 0; y < STRIP.rows; y++) {
      const base = y * WIDTH + STRIP.x;
      vram.set(art.page.subarray(base, base + STRIP.w), base);
    }
    drew.push(`strip 94x200 @col 226 from page @0x2b11c`);
  } else {
    const rec = pageRecord(page);
    const record = art.records[rec];
    if (!record) {
      drew.push(`TODO_PAGE_RECORD@0x2b079: no BH_PAN record ${rec} (page ${page})`);
    } else {
      // @0x2b0ae: the walk's size constants, not the record header's (the header is read @0x2b079
      // only to advance DI, and AH is overwritten by the row counter at @0x2b0ac).
      for (let y = 0; y < PANEL.h; y++) {
        const src = y * PANEL.w;
        vram.set(record.pixels.subarray(src, src + PANEL.w), PANEL.dest + y * WIDTH);
      }
      drew.push(`pan[${rec}] 91x135 -> A000:0x${PANEL.dest.toString(16)} (col 228 row 65) @0x2b0ae`);
      // @0x2b0c3: `dec di` then 0x8f down one column for 110 rows — the panel's left border.
      for (let r = 0; r < PANEL.borderRows; r++) vram[PANEL.dest - 1 + r * PANEL.borderStride] = PANEL.borderIndex;
      drew.push(`border 0x8f col 227 rows 65..174 @0x2b0c6`);
    }
    if (art.mode !== 1) {
      const box = art.records[pageRecord(6)]; // record 4 = @0x2b157's ES:[0x9871]
      if (box) {
        for (let y = 0; y < BOX.h; y++) {
          const src = y * BOX.w;
          vram.set(box.pixels.subarray(src, src + BOX.w), BOX.dest + y * WIDTH);
        }
        drew.push(`pan[4] 93x65 -> A000:0xe3 (col 227 rows 0..64) @0x2b157`);
      }
    }
  }

  // @0x2b18f: FUN_231e_7e04 zeroes DS:0x5be0..0x5c18 (sprite/cursor slots), then @0x2b194 clears
  // DS:0x3c44. The 0x5c02..0x5c10 words it clears are the crew-stat bar mirrors: because this
  // compositor just overwrote the bar band with fresh art, zeroing them is what makes the next
  // FUN_231e_8043 pass repaint the bars in full rather than diff against the pre-blit frame.
  if (art.g) clearBarMirrors(art.g); // bars.ts, the bar half of @0x2afe4
  fb.dirty = true;
  return { page, record: page === 1 ? null : pageRecord(page), drew };
}
