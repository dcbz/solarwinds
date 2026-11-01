// Framebuffer presentation for FUN_231e_1e14's modal conversation VM.
// The VM/state transitions live in vm.ts; this file transcribes its screen geometry.

import { WIDTH, type Framebuffer } from '../framebuffer.ts';
import type { PortraitRecord, VmView } from './vm.ts';
import { drawText, drawWrapped, LINE_HEIGHT, paginate, type TextFont } from './text.ts';

export const CONVERSATION = Object.freeze({
  // Overlay constants at DS 0xbf9:0x70e3..0x70e7. Their file-backed bytes are
  // 0f 0a c8 03 05 05; the width table immediately follows at 0x70e9.
  text: 0x0a0f,       // x=15,y=8
  portraitBase: 0x03c8,
  shade: 0x0505,      // x=5,y=4
  portraitDelta: 0x0505, // add in @0x256e2 -> x=13,y=7
  secondPane: 0x7580, // portrait is 94 scanlines lower, add si,0x7580 @0x256ed
  shadeWidth: 0xd8,   // 216 @0x253c8
  shadeHeight: 0xba,  // 186 @0x25c5b (two 93-line panes)
  paneHeight: 0x5d,   // 93 @0x253ca/@0x25506
  portraitSize: 0x32, // 50 @0x256f9/@0x2574a
  border: 0x87,
  indent: 0x38,       // 56 @0x25a91/@0x25a9c/@0x25aab
  topFullWidthAt: 64, // text+0x4600 threshold @0x25aa3
  secondTextY: 102,
  animationMs: 160,   // INT 21h/2Ch hundredths bit 0x10 toggle @0x25777..@0x257a9
});

const SHADE_LIMITS = [0x38, 0x3f, 0x57, 0x6f, 0x8f, 0x97, 0x9f, 0xbf, 0xdf, 0xfe];

/** The exact colour-index transform in @0x253ce..@0x2549c. */
export function shadeIndex(value: number): number {
  if (value === 0) return 0;
  if (value <= 0x1f) return value >> 1;
  for (const limit of SHADE_LIMITS) {
    if (value <= limit) return limit - ((limit - value) >> 1);
  }
  return value;
}

export function shadeConversationBackdrop(vram: Uint8Array): void {
  const x0 = CONVERSATION.shade % WIDTH;
  const y0 = Math.floor(CONVERSATION.shade / WIDTH);
  for (let y = 0; y < CONVERSATION.shadeHeight; y++) {
    const row = (y0 + y) * WIDTH + x0;
    for (let x = 0; x < CONVERSATION.shadeWidth; x++) vram[row + x] = shadeIndex(vram[row + x]);
  }
}

function border(fb: Framebuffer, at: number): void {
  const n = CONVERSATION.portraitSize;
  const x = at % WIDTH, y = Math.floor(at / WIDTH);
  for (let i = 0; i < n; i++) {
    fb.vram[(y - 1) * WIDTH + x + i] = CONVERSATION.border;
    fb.vram[(y + n) * WIDTH + x + i] = CONVERSATION.border;
    fb.vram[(y + i) * WIDTH + x - 1] = CONVERSATION.border;
    fb.vram[(y + i) * WIDTH + x + n] = CONVERSATION.border;
  }
}

export function drawPortrait(fb: Framebuffer, record: PortraitRecord | null, at: number, frameIndex: number): void {
  if (!record?.frames.length) return;
  const sequence = record.animation;
  const oneBased = sequence?.length
    ? sequence[frameIndex % sequence.length]
    : (frameIndex % record.frames.length) + 1;
  const frame = record.frames[oneBased - 1] ?? record.frames[0];
  border(fb, at);
  for (let y = 0; y < Math.min(CONVERSATION.portraitSize, frame.height); y++) {
    for (let x = 0; x < Math.min(CONVERSATION.portraitSize, frame.width); x++) {
      const p = frame.pixels[y * frame.width + x];
      if (p !== 0) fb.vram[at + y * WIDTH + x] = p;
    }
  }
  fb.dirty = true;
}

/**
 * Draw only the two animated faces. Zeroes in BH_PEOP are transparent: the
 * DOS blitter leaves the previous animation frame in A000 rather than
 * restoring the modal backdrop before every frame.
 */
export function drawConversationPortraits(fb: Framebuffer, view: VmView, frame: number): void {
  const portrait = CONVERSATION.portraitBase + CONVERSATION.portraitDelta;
  drawPortrait(fb, view.portrait, portrait, frame);
  drawPortrait(fb, view.alternatePortrait, portrait + CONVERSATION.secondPane, frame);
}

/** The top pane's text, split exactly as FUN_231e_2cf5 would page it (10 rows, 0x8c px). */
export function conversationPages(font: TextFont, view: VmView): string[][] {
  const speech = [view.response, view.prompt].filter(Boolean).join(' ');
  return paginate(font, speech, 0x8c, 10);
}

/** Draw the changing prompt/choice layer independently of the persistent faces. */
export function drawConversationText(
  fb: Framebuffer,
  font: TextFont,
  view: VmView,
  page = Number.MAX_SAFE_INTEGER,
): void {
  // FUN_231e_1e14 uses the top pane for the other party's current speech and
  // the lower pane for the player's visible response controls. The local line
  // renderer adds 0x38 while a portrait occupies the left edge (@0x25a80).
  const pages = conversationPages(font, view);
  const shown = pages[Math.min(page, pages.length - 1)];
  const x = CONVERSATION.text % WIDTH;
  const y = Math.floor(CONVERSATION.text / WIDTH);
  shown.forEach((line, i) => {
    const py = y + i * LINE_HEIGHT;
    const indent = py < CONVERSATION.topFullWidthAt ? CONVERSATION.indent : 0;
    drawText(fb, font, py * WIDTH + x + indent, line);
  });
  const last = page >= pages.length - 1;

  if (last) {
    const choices = [
      ...view.choices.map((c, i) => `${i + 1}. ${c.label}`),
      `${view.choices.length + 1}. END COMMUNICATION`,
    ].join('\x01');
    drawWrapped(fb, font, choices, {
      x,
      y: CONVERSATION.secondTextY,
      width: 0x8c,
      maxLines: 8,
      indent: CONVERSATION.indent,
      indentUntilY: 172,
    });
  }
}

/** Draw one VM view. Callers which animate should retain the portrait layer between frames. */
export function drawConversation(
  fb: Framebuffer,
  font: TextFont,
  view: VmView,
  elapsedMs = 0,
): void {
  drawConversationPortraits(fb, view, Math.floor(elapsedMs / CONVERSATION.animationMs));
  drawConversationText(fb, font, view);
}
