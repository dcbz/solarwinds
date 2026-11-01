// FUN_231e_1364 @0x24544 — the live star-field renderer, transcribed.
//
// This replaces the session-9 "bridge", which read actor bytes +6/+7 as pixels. Those bytes are the
// CELL half of a 40-bit fixed-point axis, where one cell is 256 pixels: every star in BH_START.DAT
// shares the same cell bytes within a few counts of the camera, so treating them as pixels stacked
// the whole catalogue into a 30-pixel blob. That is the "bunch of planets in a cluster" symptom.
//
// Address law: linear = DS + 0x10190, file = DS + 0xF90.
//
// POSITION MODEL
//   Actor   X = bytes +0,+2,+4,+6,+8 (MSB..LSB)   Y = bytes +1,+3,+5,+7,+9
//           i.e. the 13-byte record interleaves the two axes byte by byte, five bytes each.
//   Camera  X = DS:0x3ce,0x3d0,0x3d2,0x3d4,0x3d6   Y = DS:0x3cf,0x3d1,0x3d3,0x3d5,0x3d7
//           Stride 2 for the same interleaving. The flight integrator carries LSB -> MSB at
//           SOLAR1.c:13575..13586 (subtract) and 13604..13615 (add), 0x3d6 first, then 0x3d4,
//           0x3d2, 0x3d0, 0x3ce — which is what proves the byte order.
//   Sector  @0x2455f..@0x24573: each of the three (X,Y) byte pairs at depths 4,3,2 must equal the
//           camera's, so (+0,+1)~(0x3ce,0x3cf), (+2,+3)~(0x3d0,0x3d1), (+4,+5)~(0x3d2,0x3d3).
//           Any mismatch jumps straight to the next actor (@0x24554). This is the TODO_ACTOR_CULL@0x245a9
//           the earlier notes could not place: it is a 3-deep sector key, not nine screen compares.
//   Window  @0x24592..@0x245ff: ax = word(+6,+7) = (X1,Y1) packed, cx = (camX1,camY1) packed from
//           DS:0x3d4/0x3d5, compared at the nine (cl±1, ch±1) combinations. colCell and rowCell are
//           each 0/1/2 and accumulate into dx and di as 0/0x100/0x200. No match -> next actor.
//   Pixels  @0x24616..@0x2464d:
//           dx = colCell*0x100 + actor(+8) - (camX0 + 0x100),  camX0 = DS:0x3d6
//           di = rowCell*0x100 + actor(+9) - (camY0 + 0x100),  camY0 = DS:0x3d7
//           which is exactly the signed 16-bit difference of the low two bytes: pixels.
//   Zoom    DS:0x3ade == 1 halves both deltas (@0x24643..@0x24649) and, in the blit, halves the
//           dimensions while doubling the source stride (@0x247be..@0x247cb) — pixel-doubled view.
//   Cull    -0x93 < dx < 0x93, -0x87 < di < 0x87 (@0x2464f..@0x24665). Type 0xff additionally needs
//           -0x79/+0x6e (@0x24676..@0x24688) and is then flagged collectable at +0xb.
//           @0x24667 also skips everything while word DS:0x3c98 > 0xff.
//   Dest    @0x2468f..@0x246b7: base = DS:0x6bbb = 0x7d71 = row 100 * 320 + col 113, so the view is
//           centred on column 113 — columns 228.. belong to the HUD, which is why the panels sit
//           where they do. offset = base + dx + 320 * di.
//
// SPRITE SELECTION — @0x2470c..@0x24726: al = type (+0xa); if type < 0xc8 then si = (type-1)*2 and
// the record pointer is the u16 at DS:0xb9a0 + si (`[si - 0x4660]` with the segment carried). That
// table is built at @0x3073c..@0x30759 by walking the stone-decoded BH_PLAN.DAT stream record by
// record, so **type N is the Nth sprite record** — not a modulo of the record count. 32 records ship
// (star classes 0x01..0x1b plus hulls), 11x10 through 65x53. type 0xff draws nothing, and
// type >= 0xc8 takes the object path at @0x248dc, whose art comes from DS:0xe0f + (code-1)*0x20
// indexed through DS:0xba68, with an extra terminator/0x1f shade test per pixel at @0x24a65.
//
// DEPTH MODEL — DS:[0x6b9f] is a depth/shade page, not a colour copy (@0x247d5 mov ds,[0x6b9f]).
// A sprite pixel is written only where the page byte is <= 2 (@0x247e9..@0x247f2): the colour index
// goes to A000 and the shade to the page. Each actor's stored shade at DS:0xae + index*4 + 3 is
// xored with 3 every pass (@0x247b0, @0x248c4), so an actor alternates between writing 0 and 3 —
// overlapping sprites dither across frames instead of one permanently occluding the other. The
// erase at @0x2483a..@0x24893 then clears the footprint recorded on the actor's PREVIOUS pass,
// matching on the previous shade. Both loops step 320 - width between rows (@0x24814).

import { HEIGHT, WIDTH, type Framebuffer } from '../framebuffer.ts';
import type { State } from './state.ts';
import { TABLES } from './script.ts';

export const ACTOR_STRIDE = 0xd;          // @0x24604 add bx,0xd
export const SENTINEL_WORD = 0xffff;      // @0x24609 cmp ax,0xffff
export const VIEW_CENTER = 0x7d71;        // DS:0x6bbb = row 100 * 320 + col 113
export const CULL_X = 0x93;               // @0x2464f
export const CULL_Y = 0x87;               // @0x2465b
export const NEAR_TYPE_CULL_X = 0x79;     // @0x24676 (type 0xff)
export const NEAR_TYPE_CULL_Y = 0x6e;     // @0x24680
export const CAM_BASE = 0x3ce;            // camera bytes, stride 2, MSB..LSB
export const PREV_TABLE = 0xae;           // 4 bytes per actor {u16 dest, u8 h, u8 shade}
export const ZOOM_FLAG = 0x3ade;          // @0x2463c
export const OBJECT_GATE = 0x3c98;        // @0x24667
export const OBJECT_TABLE = 0xe0f;        // @0x2490b, stride 0x20
export const OBJECT_PTR_TABLE = 0xba68;   // @0x2493b [si - 0x4598]
export const SPRITE_PTR_TABLE = 0xb9a0;   // @0x24720 [si - 0x4660]

export interface Sprite { width: number; height: number; pixels: Uint8Array }

export interface VisibleActor {
  address: number;
  index: number;
  type: number;
  code: number;
  dx: number;
  dy: number;
  dest: number;
  sprite: number;
  screenX: number;
  screenY: number;
}

export interface WorldView {
  depth: Uint8Array;
  sprites: Sprite[];
  /** Static object table from EXE DS:0xe0f, 36 entries of 0x20 bytes (@0x2490b). */
  objects?: Uint8Array;
  /** BH_SHIP outer banks, indexed by actor type - 0xc8 (@0x248ef). */
  shipBanks?: Sprite[][];
  /** BH_MIS raw records, indexed by projectile heading (@0x24bc6..@0x24bcc). */
  projectileSprites?: Sprite[];
  notes?: string[];
}

/** @param sprites BH_PLAN records, indexed type-1 (@0x24720).
 *  @param objects the static object table from EXE DS:0xe0f, 32 entries of 0x20 (@0x2490b). */
export function createWorldView(
  sprites: Sprite[], objects?: Uint8Array, shipBanks?: Sprite[][], projectileSprites?: Sprite[],
): WorldView {
  return { depth: new Uint8Array(WIDTH * HEIGHT), sprites, objects, shipBanks, projectileSprites };
}

const byte = (v: number): number => v & 0xff;
const s8 = (v: number): number => ((v & 0xff) << 24) >> 24;
const s16 = (v: number): number => ((v & 0xffff) << 16) >> 16;

/** The three shared sector bytes of one axis, MSB..(depth 2). @0x2455f */
function sectorBytes(state: State, address: number, off: number): number[] {
  return [0, 2, 4].map((k) => state.byteAt(address + off + k));
}

/** Camera equivalent of sectorBytes: DS:0x3ce/0x3d0/0x3d2 for X, +1 for Y. */
function cameraSector(state: State, off: number): number[] {
  return [0, 2, 4].map((k) => state.byteAt(CAM_BASE + off + k));
}

/** True when the actor is in the camera's sector on both axes. @0x2455f..@0x24573 */
export function inSector(state: State, address: number): boolean {
  const ax = sectorBytes(state, address, 0), ay = sectorBytes(state, address, 1);
  const cx = cameraSector(state, 0), cy = cameraSector(state, 1);
  return ax[0] === cx[0] && ay[0] === cy[0] && ax[1] === cx[1] && ay[1] === cy[1] &&
         ax[2] === cx[2] && ay[2] === cy[2];
}

/**
 * The nine-way packed cell compare of @0x245a9..@0x245ff. Both axis bytes are compared together, so
 * the pair (X1,Y1) must land in the 3x3 block around the camera's (camX1,camY1). Returns
 * [colCell, rowCell] in 0..2, or null when the actor is outside the window.
 */
export function cellWindow(state: State, address: number): [number, number] | null {
  const x1 = state.byteAt(address + 6), y1 = state.byteAt(address + 7);
  const col = s8(x1 - state.byteAt(CAM_BASE + 6)) + 1;
  const row = s8(y1 - state.byteAt(CAM_BASE + 7)) + 1;
  return (col >= 0 && col <= 2 && row >= 0 && row <= 2) ? [col, row] : null;
}

/** Pixel delta from the view centre, exactly as @0x24616..@0x2464d computes dx/di. */
export function actorPixelDelta(state: State, address: number): { dx: number; dy: number } | null {
  if (!inSector(state, address)) return null;
  const win = cellWindow(state, address);
  if (!win) return null;
  let dx = win[0] * 0x100 + state.byteAt(address + 8) - (state.byteAt(CAM_BASE + 8) + 0x100);
  let dy = win[1] * 0x100 + state.byteAt(address + 9) - (state.byteAt(CAM_BASE + 9) + 0x100);
  if (state.byteAt(ZOOM_FLAG) === 1) { dx >>= 1; dy >>= 1; }
  return { dx, dy };
}

/** The frame's object list. Returns the same table `s`/`c` consume, the DS:0x3bf5 equivalent. */
export function renderWorld(
  fb: Framebuffer, state: State, view: WorldView,
  opts: { restore?: boolean; freshFrame?: boolean } = {},
): VisibleActor[] {
  const actors = TABLES.actors;
  const zoom = state.byteAt(ZOOM_FLAG) === 1;
  const gate = s16(state.byteAt(OBJECT_GATE) | (state.byteAt(OBJECT_GATE + 1) << 8));
  const visible: VisibleActor[] = [];
  const restore = opts.restore !== false;
  const freshFrame = opts.freshFrame === true;

  // The browser compositor restores PAGE.DAT before this walk. Its depth page
  // must begin equally clean; otherwise expired projectile footprints continue
  // to reject ship pixels and cut horizontal holes through moving hulls.
  if (freshFrame) view.depth.fill(0);

  for (let address = actors.base, index = 0; address + actors.stride <= 0x4654;
       address += actors.stride, index++) {
    if (state.byteAt(address) === 0xff && state.byteAt(address + 1) === 0xff) break;   // @0x24609
    if (!inSector(state, address)) continue;                                            // @0x24554

    let type = state.byteAt(address + 0xa);                                             // @0x24586
    if (type === 0xff) state.byteAt(address + 0xb, 0);

    const delta = actorPixelDelta(state, address);
    if (!delta) continue;                                                              // @0x24601
    const { dx, dy } = delta;
    if (dx >= CULL_X || dx <= -CULL_X || dy >= CULL_Y || dy <= -CULL_Y) continue;       // @0x2464f
    if (gate > 0xff) continue;                                                          // @0x24667
    if (type === 0xff) {
      if (dx >= NEAR_TYPE_CULL_X || dx <= -NEAR_TYPE_CULL_X ||
          dy >= NEAR_TYPE_CULL_Y || dy <= -NEAR_TYPE_CULL_Y) continue;                  // @0x24676
      state.byteAt(address + 0xb, 1);                                                   // @0x2468a
    }

    const code = (state.byteAt(address + 0xb) << 8) | state.byteAt(address + 0xc);
    const dest = VIEW_CENTER + dx + dy * WIDTH;                                         // @0x2468f

    // The shipped code appends the actor's ADDRESS to DS:0x3bf5 for every type != 0xff (@0x246cd),
    // which is the list scan/converse walk; the position is recovered from the record itself.
    const slot = PREV_TABLE + index * 4;
    const prevDest = s16(state.byteAt(slot) | (state.byteAt(slot + 1) << 8)) >>> 0;
    const prevHeight = state.byteAt(slot + 2);
    const prevShade = state.byteAt(slot + 3);
    const shade = (prevShade ^ 3) & 0xff;                                               // @0x247b0

    let spriteIndex = -1;
    let hullSprite: Sprite | undefined;
    if (type === 0xff) {
      // Projectile records retain type 0xff and a 1-based slot id at +0xc. FUN_231e_19c3 uses
      // that id to reach the eight-byte metadata row, then heading byte +0 indexes BH_MIS.
      const projectileSlot = state.byteAt(address + 0xc) - 1;
      const heading = projectileSlot >= 0 ? state.byteAt(0x1d9b + projectileSlot * 8) & 0x1f : -1;
      hullSprite = heading >= 0 ? view.projectileSprites?.[heading] : undefined;
      if (hullSprite) spriteIndex = -0x1000 - heading;
    } else if (type >= 0xc8) {
      // Ships and hulls. FUN_231e_6475 receives AL = type-0xc8 (@0x248ef), seeks that outer bank in
      // BH_SHIP.DAT, stone-decodes it, and builds 32 pointers at DS:0xba68 (@0x2979f..0x297cb).
      // The 0x20-byte object record at DS:0xe0f+(code-1)*0x20 supplies the directional selector in
      // byte zero (@0x24924). Thus object code and actor type select independent table dimensions.
      if (!view.shipBanks) {
      } else {
        // The loader seeds these records from the executable, but the AI mutates byte zero as its
        // current heading. Read the save image first so steering changes the rendered hull frame.
        const objectAt = OBJECT_TABLE + (code - 1) * 0x20;
        const sel = code >= 1 && code <= 36
          ? state.byteAt(objectAt)
          : view.objects?.[(code - 1) * 0x20];                                         // @0x24924
        const bank = view.shipBanks[type - 0xc8];                                      // @0x248ef
        hullSprite = sel === undefined ? undefined : bank?.[sel];                      // @0x2493b
        if (hullSprite) {
          // Negative namespace distinguishes BH_SHIP bank sprites from BH_PLAN indices in traces.
          spriteIndex = -1 - ((type - 0xc8) * 32 + (sel as number));
        }
      }
    } else {
      spriteIndex = type - 1;                                                            // @0x24720
    }
    const sprite = type >= 0xc8
      ? hullSprite
      : (spriteIndex >= 0 ? view.sprites[spriteIndex] : undefined);

    visible.push({
      address, index, type, code, dx, dy, dest, sprite: spriteIndex,
      screenX: VIEW_CENTER % WIDTH + dx, screenY: ((VIEW_CENTER / WIDTH) | 0) + dy,
    });

    // A missing bank remains in the frame-local interaction list but paints no footprint.
    if (!sprite) continue;
    const drawShade = type === 0xff
      ? state.byteAt(0x1da2 + (state.byteAt(address + 0xc) - 1) * 8)
      : shade;
    if (type === 0xff) {
      const shadeAt = 0x1da2 + (state.byteAt(address + 0xc) - 1) * 8;
      state.byteAt(shadeAt, drawShade ^ 1);                                  // @0x24bc0
    }
    drawSprite(fb, view, sprite, dest, drawShade, zoom, restore, type === 0xff ? 0x0b : 2);
    if (type === 0xff) continue;
    if (!freshFrame && prevDest > 0 && prevShade > 0) {
      eraseFootprint(fb, view, prevDest, prevShade, prevHeight,                          // @0x2483a
        zoom ? Math.max(1, sprite.width >> 1) : sprite.width, restore);
    }

    state.byteAt(slot, byte(dest)); state.byteAt(slot + 1, byte(dest >> 8));
    state.byteAt(slot + 2, zoom ? Math.max(1, sprite.height >> 1) : sprite.height);
    state.byteAt(slot + 3, shade);                                                      // @0x248cd
  }

  if (restore) fb.dirty = true;
  return visible;
}

/** @0x247dc..@0x2481e — per pixel: skip transparent, test depth <= 2, write colour and shade. */
function drawSprite(
  fb: Framebuffer, view: WorldView, sprite: Sprite, centre: number, shade: number,
  zoom: boolean, toVram: boolean, maxDepth = 2,
): void {
  const w = zoom ? Math.max(1, sprite.width >> 1) : sprite.width;
  const h = zoom ? Math.max(1, sprite.height >> 1) : sprite.height;
  const step = zoom ? 2 : 1;
  // @0x24733/@0x24748: back up half the UNSCALED width and (height>>1) rows to the top-left.
  let di = centre - (sprite.width >> 1) - (sprite.height >> 1) * WIDTH;
  if (di < -w || di >= view.depth.length) return;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      if (di >= 0 && di < view.depth.length) {
        const p = sprite.pixels[(row * step) * sprite.width + col * step];
        if (p !== 0 && view.depth[di] <= maxDepth) {                                    // @0x247ee/@0x24cxx
          view.depth[di] = shade;                                                       // @0x247f2
          if (toVram) fb.vram[di] = p;                                                  // @0x247f7
        }
      }
      di++;
    }
    di += WIDTH - w;                                                                    // @0x24814
  }
}

/** @0x2486b..@0x24893 — clear the previous pass' footprint wherever the page still holds its shade. */
function eraseFootprint(
  fb: Framebuffer, view: WorldView, dest: number, shade: number, rows: number,
  cols: number, toVram: boolean,
): void {
  let di = dest;
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (di >= 0 && di < view.depth.length && view.depth[di] === shade) {              // @0x2486c
        view.depth[di] = 0;                                                             // @0x24873
        if (toVram) fb.vram[di] = 0;                                                    // @0x24870
      }
      di++;
    }
    di += WIDTH - cols;                                                                 // @0x2488b
  }
}
