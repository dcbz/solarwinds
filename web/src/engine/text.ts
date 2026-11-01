// Solar Winds' indexed 8x8 proportional font.
//
// FUN_231e_31f1 @0x263d1 and the conversation-local copy @0x25a80 establish
// the complete format:
//   glyph address = character * 0x40                  @0x2641f..@0x26424
//   eight rows, eight-byte source stride              @0x2645b..@0x26463
//   visible columns = width[character]                DS:0xb300 @0x26428
//   zero pixels are transparent; non-zero indices are copied verbatim
//                                                      @0x26441..@0x26449
// BH_CHAR.DAT is loaded raw at boot (@0x23a24..@0x23a37), so no decoder or
// colour expansion belongs between the file and this renderer.

import { HEIGHT, WIDTH, type Framebuffer } from '../framebuffer.ts';

export const GLYPH_STRIDE = 0x40;
export const GLYPH_ROW_STRIDE = 8;
export const GLYPH_HEIGHT = 8;
export const WIDTH_TABLE_DS = 0xb300;
export const WIDTH_TABLE_FILE = WIDTH_TABLE_DS + 0xf90;
// DS:0x4562 contains bytes 00 0a, i.e. word 0x0a00. Text routines add it to
// a VRAM byte offset directly: 0x0a00 / 320 = 8 scanlines.
export const LINE_HEIGHT = 8; // added to DI/DX @0x2be49/@0x301cc
export const MESSAGE_WIDTH = 0xc4; // wrap compare @0x2be1b
export const MESSAGE_ORIGIN = 0x12cf; // DS:[0x6bb5] initial value: x=15,y=15

export interface TextFont {
  glyphs: Uint8Array;
  widths: Uint8Array;
}

/** Build the font from shipped bytes. The width table is immutable EXE data. */
export function loadTextFont(glyphs: Uint8Array, exe: Uint8Array): TextFont {
  if (glyphs.length < 0x86 * GLYPH_STRIDE) {
    throw new RangeError(`BH_CHAR.DAT is too short for glyph 0x85: ${glyphs.length}`);
  }
  if (exe.length < WIDTH_TABLE_FILE + 0x100) {
    throw new RangeError(`SOLAR1.EXE is too short for DS:0x${WIDTH_TABLE_DS.toString(16)} width table`);
  }
  return { glyphs, widths: exe.slice(WIDTH_TABLE_FILE, WIDTH_TABLE_FILE + 0x100) };
}

export function glyphWidth(font: TextFont, ch: number): number {
  return font.widths[ch & 0xff] || 0;
}

export function textWidth(font: TextFont, value: string): number {
  let width = 0;
  for (const c of value) {
    const ch = c.charCodeAt(0) & 0xff;
    if (ch === 0x24 || ch === 0x01 || ch === 0x0d || ch > 0x85) break;
    if (ch >= 0x1e) width += glyphWidth(font, ch);
  }
  return width;
}

/** Draw one glyph at a mode-13h byte offset. Returns the proportional advance. */
export function drawGlyph(fb: Framebuffer, font: TextFont, at: number, ch: number): number {
  const width = glyphWidth(font, ch);
  if (ch < 0x1e || ch > 0x85 || width === 0) return width;
  const src = ch * GLYPH_STRIDE;
  for (let row = 0; row < GLYPH_HEIGHT; row++) {
    const dst = at + row * WIDTH;
    if (dst >= fb.vram.length || dst + width <= 0) continue;
    for (let col = 0; col < width; col++) {
      const pixel = font.glyphs[src + row * GLYPH_ROW_STRIDE + col];
      const p = dst + col;
      if (pixel !== 0 && p >= 0 && p < fb.vram.length) fb.vram[p] = pixel;
    }
  }
  fb.dirty = true;
  return width;
}

/** FUN_231e_31f1: draw a single `$`/control-terminated line at a VRAM offset. */
export function drawText(fb: Framebuffer, font: TextFont, at: number, value: string): number {
  let dst = at;
  let i = 0;
  // A leading byte 0..15 is a colour/control selector. The observed copy loop
  // still writes BH_CHAR's non-zero indexed pixels verbatim, so it changes no
  // pixels in this representation; only consume it (@0x263f3..@0x26405).
  if (value.length && value.charCodeAt(0) <= 0x0f) i++;
  for (; i < value.length; i++) {
    const ch = value.charCodeAt(i) & 0xff;
    if (ch === 0x24 || ch === 0x01 || ch === 0x0d || ch > 0x85) break;
    if (ch < 0x1e) continue;
    dst += drawGlyph(fb, font, dst, ch);
  }
  return dst;
}

export interface WrappedLine { text: string; x: number; y: number; width: number }

/** Word wrapping used by FUN_231e_8bdc, without its destructive `$` insertion. */
export function wrapText(font: TextFont, value: string, maxWidth = MESSAGE_WIDTH): string[] {
  const logical = value.replace(/\r\n?/g, '\n').replace(/\x01/g, '\n').split('\n');
  const out: string[] = [];
  for (const paragraph of logical) {
    if (paragraph.length === 0) { out.push(''); continue; }
    const words = paragraph.trim().split(/\s+/);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && textWidth(font, candidate) >= maxWidth) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export function drawWrapped(
  fb: Framebuffer,
  font: TextFont,
  value: string,
  options: { x?: number; y?: number; width?: number; maxLines?: number; lineHeight?: number; indentUntilY?: number; indent?: number } = {},
): WrappedLine[] {
  const x = options.x ?? (MESSAGE_ORIGIN % WIDTH);
  const y = options.y ?? Math.floor(MESSAGE_ORIGIN / WIDTH);
  const width = options.width ?? MESSAGE_WIDTH;
  const maxLines = options.maxLines ?? Math.max(0, Math.floor((HEIGHT - y) / (options.lineHeight ?? LINE_HEIGHT)));
  const lineHeight = options.lineHeight ?? LINE_HEIGHT;
  const rows: WrappedLine[] = [];
  let py = y;
  for (const line of wrapText(font, value, width).slice(0, maxLines)) {
    const indent = options.indentUntilY !== undefined && py < options.indentUntilY ? (options.indent ?? 0) : 0;
    drawText(fb, font, py * WIDTH + x + indent, line);
    rows.push({ text: line, x: x + indent, y: py, width: textWidth(font, line) });
    py += lineHeight;
  }
  return rows;
}

/**
 * FUN_231e_2cf5's page unit: wrap at a pixel width, break every ten rows.
 *
 *   @0x25efa  cmp [0x70a8],[0x70e3]+0xcd00 / mov byte [0x70af],0xc4 / 0x8c below it
 *   @0x25f5c  cmp byte ptr [0x70a5],0xa
 *   @0x25f61  jne -> next row; else call 0x25623 (INT 16h/00h + INT 33h button wait),
 *              call 0x25d1f (row-band restore), [0x70a5]=0, cursor <- [0x70e3].
 *
 * So long text is never clipped: it pages, one keypress or click per page. The
 * destructive `$` insertion at @0x25f3d (last space before the wrap point) is
 * represented here by the word split in wrapText rather than by mutating data.
 */
export function paginate(font: TextFont, value: string, width: number, rowsPerPage = 10): string[][] {
  const lines = wrapText(font, value, width);
  const pages: string[][] = [];
  for (let p = 0; p < lines.length; p += rowsPerPage) pages.push(lines.slice(p, p + rowsPerPage));
  return pages.length ? pages : [['']];
}

export function drawCentered(fb: Framebuffer, font: TextFont, y: number, value: string, centerX = 160): number {
  const w = textWidth(font, value);
  const x = Math.max(0, Math.floor(centerX - w / 2));
  drawText(fb, font, y * WIDTH + x, value);
  return x;
}
