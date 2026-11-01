// Solar Winds boot presentation, transcribed from the straight-line tail of
// FUN_231e_c4cf @0x2fca1..0x30668.
//
// This is deliberately a presentation state machine rather than a synthetic
// menu.  The DOS executable shows BH_EPIC, assembles BH_TITLE/BH_PIC in-place,
// waits for input on the completed title, then plays BH_SEQ while timed strings
// from the executable tell the opening story.  Input during the story jumps to
// PAGE.DAT, exactly like the INT 16h check at @0x3063e.

import { WIDTH, type Framebuffer } from '../framebuffer.ts';
import { drawText, type TextFont } from './text.ts';

export type StartupPhase = 'epic' | 'title' | 'intro' | 'done';

export interface StartupFrame {
  pixels: Uint8Array;
  rgb: Uint8Array;
}

export interface StartupRecord {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface StartupAssets {
  epic: StartupFrame;
  title: StartupFrame;
  picture: Uint8Array;
  sequence: StartupFrame;
  sequenceRecords: StartupRecord[];
  font: TextFont;
  exe: Uint8Array;
}

// FUN_231e_87b0 uses INT 21h/AH=2Ch hundredths. These are the literal BX
// values surrounding the title copies: 1f4, 0f, 0f, 9b, 78, 96 and 96.
const TITLE_STAGE_MS = [5000, 150, 150, 1550, 1200, 1500, 1500] as const;
export const EPIC_HOLD_MS = 4000; // BX=0x190 @0x2fd14
export const INTRO_COUNTER_MS = (0x8ca0 / 1193182) * 1000 * 2; // counter increments every two PIT passes
export const INTRO_END_COUNTER = 0x5dc;

const EXE_DS_FILE_BIAS = 0xf90;

/** Read one of the executable's `$`-terminated strings by its DS address. */
export function startupString(exe: Uint8Array, ds: number): string {
  let at = ds + EXE_DS_FILE_BIAS;
  let end = at;
  while (end < exe.length && exe[end] !== 0x24 && exe[end] !== 0) end++;
  return new TextDecoder('windows-1252').decode(exe.subarray(at, end));
}

interface IntroLine { ds: number; at: number }
interface IntroCue { from: number; until: number; lines: IntroLine[] }

// Text sites and VRAM destinations are the literal LEA BX / MOV DI pairs at
// @0x301be..0x305a3. Erase calls establish each `until` boundary.
export const INTRO_CUES: IntroCue[] = [
  { from: 0x000, until: 0x096, lines: [
    { ds: 0x8a17, at: 0x0ca3 }, { ds: 0x8a48, at: 0x16a3 }, { ds: 0x8a7c, at: 0x20a3 },
  ] },
  { from: 0x096, until: 0x14d, lines: [
    { ds: 0x8a87, at: 0x0c9e }, { ds: 0x8abd, at: 0x169e }, { ds: 0x8af7, at: 0x209e },
  ] },
  { from: 0x14d, until: 0x21c, lines: [
    { ds: 0x8b30, at: 0x0ca3 }, { ds: 0x8b67, at: 0x16a3 }, { ds: 0x8b9b, at: 0x20a3 },
  ] },
  { from: 0x21c, until: 0x24e, lines: [{ ds: 0x8bb9, at: 0x1969 }] },
  { from: 0x2a8, until: 0x2e4, lines: [{ ds: 0x8bca, at: 0x12ff }] },
  { from: 0x2da, until: 0x320, lines: [
    { ds: 0x8be0, at: 0x2c38 }, { ds: 0x8bf9, at: 0x3638 },
  ] },
  { from: 0x320, until: 0x366, lines: [
    { ds: 0x8c14, at: 0x0cc1 }, { ds: 0x8c2c, at: 0x16c1 },
  ] },
  { from: 0x366, until: 0x3fc, lines: [
    { ds: 0x8c43, at: 0x1978 }, { ds: 0x8c5d, at: 0x2378 },
    { ds: 0x8c74, at: 0x2d78 }, { ds: 0x8c8b, at: 0x3778 },
  ] },
  { from: 0x3fc, until: 0x492, lines: [
    { ds: 0x8ca8, at: 0x1fb8 }, { ds: 0x8cc0, at: 0x29b8 }, { ds: 0x8cda, at: 0x33b8 },
  ] },
  { from: 0x492, until: 0x528, lines: [
    { ds: 0x8cf1, at: 0x1978 }, { ds: 0x8d08, at: 0x2378 },
    { ds: 0x8d24, at: 0x2d78 }, { ds: 0x8d41, at: 0x3778 },
  ] },
  { from: 0x52d, until: 0x591, lines: [{ ds: 0x8d5d, at: 0x0cc1 }] },
];

function transparentRect(
  dst: Uint8Array, src: Uint8Array, srcAt: number, dstAt: number,
  width: number, height: number,
): void {
  let s = srcAt;
  for (let y = 0; y < height; y++) {
    let d = dstAt + y * WIDTH;
    for (let x = 0; x < width; x++, s++, d++) if (src[s] !== 0) dst[d] = src[s];
  }
}

function copyClipped(dst: Uint8Array, src: Uint8Array, srcAt: number, dstAt: number, count: number): void {
  const n = Math.max(0, Math.min(count, src.length - srcAt, dst.length - dstAt));
  if (n) dst.set(src.subarray(srcAt, srcAt + n), dstAt);
}

export interface StartupView {
  phase: StartupPhase;
  titleStage: number;
  introCounter: number;
  elapsed: number;
}

export function createStartupPlayer(assets: StartupAssets) {
  let phase: StartupPhase = 'epic';
  let elapsed = 0;
  let titleStage = -1;
  let introCounter = 0;
  const titlePixels = new Uint8Array(WIDTH * 200);

  const enterTitle = () => {
    phase = 'title';
    elapsed = 0;
    titleStage = 0;
    titlePixels.fill(0);
    // @0x2fde4: decoded title [0,4380) -> A000:5799.
    copyClipped(titlePixels, assets.title.pixels, 0x0000, 0x5799, 0x4380);
  };

  const applyTitleStage = (stage: number) => {
    if (stage === 1) copyClipped(titlePixels, assets.title.pixels, 0x4380, 0x5c99, 0x3c00);
    if (stage === 2) copyClipped(titlePixels, assets.title.pixels, 0x7f80, 0x5b59, 0x3d40);
    if (stage === 3) copyClipped(titlePixels, assets.title.pixels, 0xbcc0, 0x5b59, 0x3c00);
    // BH_PIC's first two transparent rectangles, @0x2fed2 and @0x2ff15.
    if (stage === 4) transparentRect(titlePixels, assets.picture, 0x0000, 0x70ac, 0xf3, 9);
    if (stage === 5) transparentRect(titlePixels, assets.picture, 0x088b, 0xce9f, 0x83, 9);
    // The second title picture clears A000 and copies the rest of BH_PIC in two
    // contiguous pieces, @0x2ff52..0x2ffb5.
    if (stage === 6) {
      titlePixels.fill(0);
      copyClipped(titlePixels, assets.picture, 0x0d26, 0x44c0, 0x4d80);
    }
    if (stage === 7) copyClipped(titlePixels, assets.picture, 0x5aa6, 0x9240, 0x0b40);
  };

  const enterIntro = () => {
    phase = 'intro';
    elapsed = 0;
    introCounter = 0;
  };

  const finish = () => {
    phase = 'done';
    elapsed = 0;
  };

  const step = (ms: number) => {
    if (phase === 'done') return;
    elapsed += Math.max(0, ms);
    if (phase === 'epic') {
      if (elapsed >= EPIC_HOLD_MS) enterTitle();
      return;
    }
    if (phase === 'title') {
      // Stage 7 is the original title's input-driven animation loop. It has no
      // timeout, so do not advance into the story without an input event.
      while (titleStage < TITLE_STAGE_MS.length && elapsed >= TITLE_STAGE_MS[titleStage]) {
        elapsed -= TITLE_STAGE_MS[titleStage];
        titleStage++;
        applyTitleStage(titleStage);
      }
      return;
    }
    introCounter = Math.floor(elapsed / INTRO_COUNTER_MS);
    if (introCounter >= INTRO_END_COUNTER) finish();
  };

  const input = () => {
    if (phase === 'epic') enterTitle();       // FUN_87b0 consumes the key and ends its wait
    else if (phase === 'title') enterIntro(); // all title wait branches join @0x30008
    else if (phase === 'intro') finish();     // @0x3063e..0x3064b
  };

  const render = (fb: Framebuffer) => {
    if (phase === 'epic') {
      fb.loadPalette(assets.epic.rgb);
      fb.blt(assets.epic.pixels);
      return;
    }
    fb.loadPalette(phase === 'title' ? assets.title.rgb : assets.sequence.rgb);
    if (phase === 'title') {
      fb.blt(titlePixels);
      return;
    }
    if (phase === 'intro') {
      fb.blt(assets.sequence.pixels);
      for (const cue of INTRO_CUES) {
        if (introCounter < cue.from || introCounter >= cue.until) continue;
        for (const line of cue.lines) drawText(fb, assets.font, line.at, startupString(assets.exe, line.ds));
      }
    }
  };

  return {
    step, input, render, finish,
    get done() { return phase === 'done'; },
    get view(): StartupView { return { phase, titleStage, introCounter, elapsed }; },
    assets,
  };
}

