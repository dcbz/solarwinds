// Solar Winds — entry point: the seam between the browser and ./engine/loop.js.
//
// Route A: ?gallery=1 -> ./app.js, the phase-1 asset browser, unchanged.
// Route B: run the dispatcher's EPIC/title/story presentation, then load the real PAGE.DAT
//          cockpit, draw the BH_MS player craft and BH_PLAN actors, and run the ported
//          0x23c1c..0x23c91 loop at its PIT-derived cadence. Modal disk/conversation/cutscene
//          loops replace the main pass while active, as they do in the DOS executable.
//
// One session serves both worlds. Bytes arrive through an injected `read` (fetch in the page,
// node:fs in a check) and presentation is skipped when there is no canvas, so
// `node web/tools/integration_check.mjs` drives *this* file's wiring rather than a headless
// look-alike. rle.js and framebuffer.js are used as verified, not modified.

import { Framebuffer, WIDTH, HEIGHT } from './framebuffer.ts';
import { CALLEES, GLOBALS, STATE_GLOBAL, STATE_VALUES, advance, initialState, type EngineState } from './engine/loop.ts';
import { loadDispatcherResource, loadShipBanks, walkRecords } from './engine/screens.ts';
import { PAGE_BLIT, blitPage, pageRecord, type PageResult } from './engine/pages.ts';
import { fun_231e_8043 } from './engine/bars.ts';
import { fun_231e_8de4, fun_231e_6710, createSpin, resetSpin } from './engine/hud.ts';
import { State } from './engine/state.ts';
import { loadZoneAssets, createZonePlayer, ZONES } from './engine/zones.ts';
import { PUMP_PERIOD_MS, SCENE_PERIOD_MS, createClock, advance as clockAdvance } from './engine/clock.ts';
import { loadTextFont, drawWrapped, type TextFont } from './engine/text.ts';
import {
  CONVERSATION,
  conversationPages,
  drawConversationPortraits,
  drawConversationText,
  shadeConversationBackdrop,
  shadeIndex,
} from './engine/conversation.ts';
import { createWorldView, renderWorld as renderActors, type VisibleActor, type WorldView } from './engine/world.ts';
import { cameraPosition, computeVelocity } from './engine/flight.ts';
import { MENU_ITEMS, drawMenu, menuIndexForKey } from './engine/menu.ts';
import { drawTextScreen, helpChoose, openHelp, type TextScreen } from './engine/textscreen.ts';
import { createStartupPlayer } from './engine/startup.ts';
import { drawPlayerShip } from './engine/player.ts';
import { drawPlayerExplosion } from './engine/death.ts';
import { createStarfield, type Starfield } from './engine/starfield.ts';
import { drawSectorCoordinates, sectorCoordinates } from './engine/coordinates.ts';
import { drawPanelStatus } from './engine/panels.ts';
import { createGameAudio } from './engine/audio.ts';

const DOM = typeof document !== 'undefined' && typeof window !== 'undefined';
const hex = (n: number | string | null | undefined) => (typeof n === 'number' ? `0x${n.toString(16)}` : String(n));

// --- boot globals ---------------------------------------------------------------
// loop.js initialState() seeds only the three pre-loop writes it can cite (0x23c08, 0x23c0d,
// 0x23c17) and leaves every other global clear, because re/game-loop-modes.md does not say what
// INIT_CALL @0x23c12 leaves behind — TODO_BOOT@0x23c12. The dispatch key in particular stays
// `mode: null`, which is the "no compare matched" case, so no handler ever runs and no key can
// change the mode.
//
// The blob answers it instead of a guess. BH_START.DAT is a verbatim image of the DS data segment
// for a fresh game (re/state-format.md "THE ANCHOR": save/load is one 0x45a7-byte INT 21h/40h,3Fh
// pair, no header), and state.js exports the accessors that prove which byte is which global. Each
// row below is therefore a loop.js GLOBALS key paired with the state.js field that carries its
// fresh-game value; the arithmetic (blob offset = DS - 0x00AD) stays inside state.js, and the two
// address spaces are never mixed here.
const BOOT_GLOBALS = [
  ['mode', 'mode'],                       // DS:0x3c91 = 1 -> the state-1 handler 0x2e6e9 dispatches
  ['gathererSelect', 'inputGatherer'],    // DS:0x3572 = 0 -> the pump calls gatherer 0x27d15; any
                                          // other value silences every event (TODO_GATHERERS)
  ['scrollOffset', 'scrollPos'],          // DS:0x3c98 = 6, the ±3 pump scroll base (@0x24487/@0x244aa)
  ['soundEnable', 'soundEnabled'],         // DS:0x3ade = 0, xored by the "1" arm @0x2e75f
  ['cheatGate', 'cheatLatch'],            // DS:0x3be6 = 0, gates the "D"/0x0d/0x0c arms
  ['repeatGate', 'byte_3c93'],            // DS:0x3c93 = 0
  ['count_3c92', 'byte_3c92'],            // DS:0x3c92 = 0x16 — identical to the pre-loop write
                                          // @0x23c0d, which is the cross-check that this bridge
                                          // reads the byte it claims to
  ['debugWord', 'word_3c95'],             // DS:0x3c95 = 0
  ['word_3c5c', 'statBudget'],            // DS:0x3c5c = 0x41
  ['actionPoints', 'actionPoints'],       // DS:0x3c70 = 0
  ['countdown_13c16', 'countdownTimer'],  // DS:0x3c16 = 0
  ['countdown_13c18', 'countdownPrev'],   // DS:0x3c18 = 0
  ['slot_359b', 'schedulerSlot'],         // DS:0x359b = 5
];
// Deliberately absent: flag_5c1a 0x15c1a, asciiLatch 0x15bb8, one_5bbb 0x15bbb, fiveLatch 0x146a5,
// backdoorLatch 0x146a7, autoScrollUp/Down 0x14d5b/0x14d5d, slot_35a1 0x135a1, word_3c60 0x13c60.
// state.js lists the first group in TRANSIENT_GLOBALS (DS >= 0x4654, so a savegame cannot hold
// them) and has no proven offset for word_3c60; they keep loop.ts's cleared values.

function bootState(blob: State): EngineState {
  const st = initialState();
  // The handler tables (DS:0x135af presence, DS:0x13c56 page count, DS:0x15b90 match keys) are
  // savegame data, so loop.ts reads them through the blob rather than a made-up value.
  st.sv = blob;
  for (const [key, field] of BOOT_GLOBALS) {
    // Where both exist the pre-loop write wins, because 0x23c08..0x23c17 runs after the load.
    if (st.g[GLOBALS[key].addr] === undefined) st.g[GLOBALS[key].addr] = (blob as unknown as Record<string, number>)[field];
  }
  return seedMode(st);
}

// --- the mode global, and why it is mirrored -------------------------------------
// One byte, two spellings in the port: the documented address GLOBALS.mode.addr === STATE_GLOBAL
// === DS:0x13c91 as a key of state.g, and state.mode, which is the field loop.js actually compares
// in dispatch()/epilogue() and the one STATE1_ARMS[].to writes (`st.mode = arm.to` never touches
// st.g). state.g is canonical here; the mirror runs around every pass so either spelling can be
// seeded (the save blob above, or a test injecting a mode). The permanent fix is one `wr(st,
// 'mode', …)` at the two write sites inside loop.js — until that lands, it is bridged at the seam.
function readMode(st: EngineState) {
  return st.g[STATE_GLOBAL] !== undefined ? st.g[STATE_GLOBAL] : st.mode;
}

function seedMode(st: EngineState) {
  st.mode = readMode(st);
  return st;
}

// --- which art a mode repaints with ----------------------------------------------
// Empty by evidence, not by omission. RESOLVED: every one of the 21 `lcall 0x131e,0x7e6d` sites is
// preceded by `mov al,[0x3c91]` (or `mov al,<mode>` plus the store to [0x3c91] right before it), so
// the compositor's one argument IS the mode byte, and the arena arithmetic pins the art: BH_PAN.DAT
// (dispatcher slot 8, stone variant) decodes to five records whose 3rd/5th pixel offsets are the
// literals 0x8FFF and 0x9871 hard-coded in the routine, and whose first three are 91x135 — the
// blit's own cx=0x5b / ah=0x87. web/src/engine/pages.ts carries the whole proof.
//   mode 1 -> the 94-column background strip, i.e. the panel area is erased (@0x2b11c)
//   mode 2 -> BH_PAN record 0, 91x135 at col 228 row 65, plus the 93x65 record-4 box (@0x2b0ae)
//   mode 3 -> BH_PAN record 1, same geometry
//   mode 4 -> BH_PAN record 2, same geometry
const PAGE_LABEL: Record<number, string> = {
  1: 'strip 94x200 from the page buffer', 2: 'pan[0] 91x135', 3: 'pan[1] 91x135', 4: 'pan[2] 91x135',
};

// BH_TITLE.DAT + BH_PAL.DAT + the `wind` variant is dispatcher slot 15. It is one input to the
// staged title compositor in startup.ts; the actual first frame is slot 13, BH_EPIC + BH_EPAL.
const BOOT_FRAME = 'title';

// --- input adapter --------------------------------------------------------------
// Browser KeyboardEvent.key -> the name loop.ts's INPUT_KEYS table is keyed by, which is the row
// that carries the real INT 9 scancode and the INT 16h AL. Single characters are upper-cased
// because the documented arms compare ASCII bytes: 0x44 is "D" (@0x2e79a); the port does not bind
// lowercase 0x64 to it, because no arm for 0x64 is quoted. Multi-char names (ArrowUp, F1, Control,
// Shift) pass through in the DOM's own spelling.
export function keyName(event: { key?: unknown; ctrlKey?: boolean; shiftKey?: boolean }): string | undefined {
  const key = event && event.key;
  if (typeof key !== 'string' || key.length === 0) return undefined;
  // The value the handlers compare is the raw make code latched by the game's INT 9 (@0x24372 reads
  // cs:[0x42], and INT 9 itself compares 0x39/0xb9 space, 0x3b/0xbb F1, 0x1d/0x9d LCtrl @0x23d48..),
  // so a bare letter is the binding: 'a' is 0x1e -> mode 3 (@0x2e6ef). No modifier spelling applies.
  // Control/Shift only matter as their own make codes, which INPUT_KEYS carries.
  return key.length === 1 ? key.toLowerCase() : key;
}

const keydownLabel = (event: { key?: unknown; ctrlKey?: boolean; shiftKey?: boolean }) => `key:${keyName(event)}`;
const keyupLabel = (event: { key?: unknown; ctrlKey?: boolean; shiftKey?: boolean }) => `keyup:${keyName(event)}`;

// Mouse. INT 33h is programmed with ax=7 range 0..0x27e (638) and ax=8 range 0..0xc8 (200) for the
// 320x200 screen (re/FINDINGS.md:31), i.e. X is reported at 2:1 and Y 1:1. FUN_231e_bc89
// @0x2ee69 reads the button state with AX=3, halves X, and routes the click to the mode-2/3/4
// panel handlers; loop.ts owns those original hit boxes.
export function pointerLabel(screenX: number, screenY: number) {
  const x = Math.max(0, Math.min(638, Math.floor(screenX) * 2));
  const y = Math.max(0, Math.min(200, Math.floor(screenY)));
  return `pointer:${x},${y}`;
}

// --- data access ----------------------------------------------------------------
async function fetchRead(name: string) {
  // PAGE.DAT is part of the shipped game but intentionally remains at the
  // repository root. A repo-root static server therefore needs this fallback.
  let r = await fetch(`data/${name}`);
  if (!r.ok) r = await fetch(`../${name}`);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function fsRead(name: string) {
  const { readFile } = await import('node:fs/promises');
  try {
    return new Uint8Array(await readFile(new URL(name, new URL('../data/', import.meta.url))));
  } catch {
    return new Uint8Array(await readFile(new URL(name, new URL('../../', import.meta.url))));
  }
}

// --- the session ----------------------------------------------------------------
export interface SessionOptions {
  read?: (name: string) => Promise<Uint8Array>;
  canvas?: HTMLCanvasElement | null;
  statusEl?: HTMLElement | null;
  /** Run the executable's EPIC -> TITLE -> SEQ boot presentation. Browser sessions default true. */
  playStartup?: boolean;
}

export async function createSession({
  read = DOM ? fetchRead : fsRead,
  canvas = null,
  statusEl = null,
  playStartup = DOM,
}: SessionOptions = {}) {
  const fb = new Framebuffer();
  // Data can preload immediately; AudioContext creation waits for a browser
  // input so autoplay policy does not discard the first notes or effect.
  const audioPromise = createGameAudio(read);
  const ctx = canvas ? canvas.getContext('2d') : null;
  if (ctx && canvas) {
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    ctx.imageSmoothingEnabled = false; // the original let the CRTC scale A000:0000
  }

  const startBytes = await read('BH_START.DAT');
  const blob = new State(startBytes);
  const frames = new Map<string | number, { file: string; decoded: number; pixels: Uint8Array; rgb: Uint8Array }>();

  // The compositor's two inputs, both preloaded so paint() stays synchronous.
  //   pan     — BH_PAN.DAT's records: three 91x135 panels plus the 93x65 and 90x24 boxes.
  //   pageBuf — the 320x200 background page addressed through DS:[0x6b9f]. The loaders `rep movsw`
  //             a decoded frame to A000:0 out of it, so it tracks the last full frame.
  const [pan, planets, cockpit, playerSprites, shipBanks, missiles, explosions] = await Promise.all([
    loadDispatcherResource('pan', read),
    loadDispatcherResource('plan', read),
    loadDispatcherResource('page', read),
    loadDispatcherResource('ms', read),
    loadShipBanks(read),
    loadDispatcherResource('mis', read),
    loadDispatcherResource('expl', read),
  ]);
  const mainPalette = await loadDispatcherResource(cockpit.paletteSlot || 'pal', read);
  const audio = await audioPromise;

  // The EXE's own data segment, needed by script.ts: the ship table at DS:0x128f and the star table
  // at DS:0x1e5b live in the executable (file = DS + 0xF90), not in a .DAT. BH_CONV.DAT is the
  // script database that FUN_231e_a26d opens at @0x2d4f5.
  let exeImage: Uint8Array | null = null;
  let convImage: Uint8Array | null = null;
  let peopleImage: Uint8Array | null = null;
  let charImage: Uint8Array | null = null;
  let smlImage: Uint8Array | null = null;
  // panels.ts rebuilds the selection markers from the selector globals; this holds the previous
  // pass's values so the 0x1e "mark left behind" lands where DOS leaves it (@0x2ea65/@0x2eae6).
  const panelPrev: Record<string, number> = {};
  // FUN_231e_6710 mutates A000 in place in DOS; the shadow holds that accumulation across the
  // port's per-pass re-composite, and resetSpin stands in for the page-1 compositor call.
  const spinState = createSpin();
  try { exeImage = await read('SOLAR1.EXE'); } catch { /* checks may not ship the EXE */ }
  try { convImage = await read('BH_CONV.DAT'); } catch { /* likewise */ }
  try { peopleImage = await read('BH_PEOP.DAT'); } catch { /* portrait animation is optional */ }
  try { charImage = await read('BH_CHAR.DAT'); } catch { /* status text remains optional */ }
  try { smlImage = await read('BH_SML.DAT'); } catch { /* panel markers remain optional */ }
  const font: TextFont | null = exeImage && charImage ? loadTextFont(charImage, exeImage) : null;
  const pageBuf = cockpit.pixels.slice();
  const cockpitPixels = cockpit.pixels.slice();

  // Frames are resolved through screens.js, which owns the file -> palette -> variant mapping via
  // DISPATCH (`paletteSlot` is why BH_TITLE.DAT draws with BH_PAL.DAT, not BH_EPAL.DAT).
  const loadFrame = async (id: string | number) => {
    if (!frames.has(id)) {
      const res = await loadDispatcherResource(id, read);
      const pal = await loadDispatcherResource(res.paletteSlot || 'pal', read);
      frames.set(id, { file: res.file, decoded: res.decoded, pixels: res.pixels, rgb: pal.rgb });
    }
    return frames.get(id) as { file: string; decoded: number; pixels: Uint8Array; rgb: Uint8Array };
  };

  const blit = (id: string | number) => {
    const f = frames.get(id) as { file: string; decoded: number; pixels: Uint8Array; rgb: Uint8Array };
    fb.loadPalette(f.rgb);
    fb.blt(f.pixels, 0);
    pageBuf.set(fb.vram); // the frame lives in the page buffer as well as on screen
  };

  const title = await loadFrame(BOOT_FRAME);
  const epic = playStartup ? await loadFrame('epic') : null;
  const sequence = playStartup ? await loadFrame('seq') : null;
  const picture = playStartup ? await loadDispatcherResource('pic', read) : null;
  const sequenceRecords = playStartup ? await loadDispatcherResource('seq2', read) : null;
  let state = bootState(blob);
  if (exeImage) state.exe = exeImage;
  if (convImage) state.conv = convImage;
  if (peopleImage) state.people = peopleImage;
  // FUN_231e_1364 @0x24544 reads actor positions as 40-bit fixed-point pairs and indexes BH_PLAN by
  // the type byte at +0xa, so the sprite list is the record list in stream order (world.ts).
  // 32 entries of 0x20 at EXE DS:0xe0f (@0x2490b, base confirmed by `lea ax,[0xe0f]` @0x24941).
  const worldView: WorldView = createWorldView(
    planets.records,
    // DS:0xe0f..0x128e is exactly 36 records * 0x20; DS:0x128f begins the separate ship-name table.
    exeImage ? exeImage.subarray(0xe0f + 0xf90, 0x128f + 0xf90) : undefined,
    shipBanks.map((bank) => bank.records),
    walkRecords(missiles.bytes),
  );
  const explosionRecords = walkRecords(explosions.bytes);
  // FUN_231e_88f9 @0x2bad9 creates this transient backdrop after every new/load. It is not part of
  // BH_START.DAT and therefore cannot be recovered by the persistent actor walk in world.ts.
  let starfield: Starfield | null = exeImage ? createStarfield(blob, exeImage) : null;
  let backdropPixels = 0;
  let visibleActors: number[] = [];
  let visibleSprite = -1;
  let playerShip: { heading: number; dest: number; painted: number } | null = null;
  let messageTicks = 0;
  let logLength = 0;
  let modalVm: any = null;
  let modalShaded: Uint8Array | null = null;
  let modalPortraits: Uint8Array | null = null;
  let modalPortraitFrame = -1;
  let modalElapsed = 0;
  let activeMenu = false;
  let menuSelected = 0;
  let menuNote = '';
  let memorySave: Uint8Array | null = null;

  // @0x2fca1..0x30668 belongs to the resource dispatcher itself: the game does
  // not return from boot immediately after loading the files. It presents the
  // EPIC logo, assembled title and BH_SEQ story before PAGE.DAT becomes live.
  const startup = playStartup && font && exeImage && epic && sequence && picture && sequenceRecords
    ? createStartupPlayer({
        epic,
        title,
        picture: picture.bytes,
        sequence,
        sequenceRecords: sequenceRecords.records,
        font,
        exe: exeImage,
      })
    : null;

  // ── the zone cutscene players ────────────────────────────────────────────────────────────
  // FUN_231e_6db0 / 0x7182 / 0x75a6 are modal, PIT-paced sequences entered only from the `c` arm
  // (@0x2d6d3 / @0x2d6ee / @0x2d5fb). While one runs, the main loop body does not execute: the
  // loader's own loop paces at count 0x8ca0 (30.17 ms), not the pump's 0x7918 (25.98 ms).
  const zonePlayers = new Map<number, { assets: any; player: any; traces: string[] }>();
  let activeZone: number | null = null;
  const enterZone = async (n: number, site: number) => {
    if (zonePlayers.has(n)) { activeZone = n; return zonePlayers.get(n)!; }
    try {
      const assets = await loadZoneAssets(n, async (file: string) => await read(file));
      const player = createZonePlayer(assets, fb.vram, {
        caption: (rec: string, off: number) => { (state.scriptLog ||= []).push({ site, text: rec }); },
      });
      const entry = { assets, player, traces: [] as string[] };
      zonePlayers.set(n, entry);
      activeZone = n;
      note0(`zone ${n} player built from ${assets.frames.map((f: any) => f.file).join('+')} + ${assets.records.length} record stream(s)`);
      return entry;
    } catch (err) {
      note0(`zone ${n} load failed: ${(err as Error).message}`);
      return null;
    }
  };
  const note0 = (s: string) => state.trace.push(s);
  state.onZone = (n: number, site: number) => { void enterZone(n, site); };
  let paints = 0;
  let lastPage: PageResult | null = null;

  // FUN_231e_8043 @0x2b223, from the pump's animation block (0x23e66..0x23e9e). It paints the eight
  // crew-stat bars straight into A000 and only touches the delta since its last pass; because
  // blitPage above runs the compositor's tail (@0x2b18f) and zeroes the mirrors, the pass right
  // after a page blit repaints the whole set.
  const paintBars = () => {
    if (!state.sv) return;
    const mode = readMode(state);
    if (typeof mode !== 'number') return;
    const r = fun_231e_8043(fb, state.g, state.sv as State, mode, !!state.g[GLOBALS.soundEnable.addr]);
    if (r && r.painted.length) (state.trace ||= []).push(`FUN_231e_8043@0x2b223: ${r.painted.join(', ')}`);
  };

  // FUN_231e_7e6d runs when a draw row for it fired this pass — the port's stand-in for the
  // `lcall 0x131e,0x7e6d` inside the arm that changed the mode. The page id is the mode byte, as at
  // every one of the 21 call sites.
  const repaint = () => {
    const mode = readMode(state);
    const fired = (state.draws || []).some((d: { callee: number | number[] }) =>
      (Array.isArray(d.callee) ? d.callee[0] : d.callee) === PAGE_BLIT);
    lastPage = fired && typeof mode === 'number' && mode >= 1
      ? blitPage(fb, mode, { records: pan.records, page: pageBuf, mode, g: state.g })
      : null;
    if (lastPage && state.sv && typeof mode === 'number' && mode >= 2 && mode <= 4) {
      drawPanelStatus(fb, state.sv as State, mode, smlImage ?? undefined, panelPrev);
    }
    paintBars();
    return mode;
  };

  const renderWorld = () => {
    // The shipped pump paints the background page before the actor walk, then the walk writes colour
    // and shade through it (world.ts). Panels come after, which is why the HUD is never occluded.
    fb.vram.set(cockpitPixels);
    starfield?.update();
    backdropPixels = starfield?.draw(fb) ?? 0;
    const visible = renderActors(fb, state.sv as any, worldView, { freshFrame: true });
    visibleActors = visible.filter((v: VisibleActor) => v.type !== 0xff).map((v: VisibleActor) => v.address);
    state.visibleActors = visibleActors;
    const firstWorldActor = visible.find((v: VisibleActor) => v.type !== 0xff);
    visibleSprite = firstWorldActor ? firstWorldActor.sprite : -1;
    // FUN_231e_0458 draws the player's BH_MS heading frame around viewport
    // centre DS:[0x6bbb]. It is not an actor and therefore never appears in the
    // BH_PLAN walk above.
    const death = state.playerDeath;
    if (death?.active) {
      playerShip = null;
      const frame = death.frame === null ? undefined : explosionRecords[death.frame];
      if (frame) drawPlayerExplosion(fb, frame);
    } else {
      playerShip = exeImage ? drawPlayerShip(fb, state.sv as any, playerSprites.records, exeImage) : null;
    }
    // FUN_231e_81e8 @0x2b3c8: the opening story's rendezvous is sector -31,1, and these two
    // readouts are how the shipped game lets the player navigate there.
    if (font) drawSectorCoordinates(fb, font, state.sv as any);
    // FUN_231e_8de4 @0x2bfc4, the flight screen's own overlay (credits, and the AP/icon/lamp strip
    // when DS:0x3ade is set). The pump runs it every fifth pass; the port re-composites the world
    // every pass, so it re-runs every pass — the routine's mirror words at DS:0x5c00/0x5c14/0x5c16
    // and 0x5c18 make each unchanged field a no-op, which is the same visible result.
    if (font && state.sv && readMode(state) === 1) {
      const hud = fun_231e_8de4({
        fb, font, state: state.sv as State, g: state.g, sml: smlImage ?? undefined, mode: 1,
        stripOn: (state.sv as State).byteAt(0x3ade) === 1,
        cheatLatch: (state.sv as State).byteAt(0x3be6),
      });
      if (hud && hud.drew.length) (state.trace ||= []).push(`FUN_231e_8de4@0x2bfc4: ${hud.drew.join(', ')}`);
      // FUN_231e_6710 @0x298f0 rolls the digit glyphs in the two meter strips, /4 passes, same gate.
      const spin = fun_231e_6710(fb, state.g, 1, (state.sv as State).byteAt(0x3ade) === 1, spinState);
      if (spin) (state.trace ||= []).push(`FUN_231e_6710@0x298f0: ${spin.join(' + ')}`);
    }
    // A panel remains on screen between input passes. `draws` records when the
    // DOS compositor was called; this redraw reproduces its persistent result
    // after the host-side PAGE double-buffer restore above.
    const mode = readMode(state);
    if (typeof mode === 'number' && mode >= 2 && mode <= 4) {
      lastPage = blitPage(fb, mode, { records: pan.records, page: pageBuf, mode, g: state.g });
      if (mode === 1) resetSpin(spinState); // @0x2b11c restores the 94-column strip the spinner lives in
      if (state.sv) drawPanelStatus(fb, state.sv as State, mode, smlImage ?? undefined, panelPrev);
    }
    paintBars();
    if (font && messageTicks > 0 && !state.conversation?.vm) {
      const entry = state.scriptLog?.[state.scriptLog.length - 1];
      if (entry?.text) drawWrapped(fb, font, entry.text, { x: 15, y: 15, width: 196, maxLines: 15 });
    }
  };

  const renderOverlay = () => {
    const vm = state.conversation?.vm;
    if (!vm || !font) {
      modalVm = null;
      modalShaded = null;
      modalPortraits = null;
      modalPortraitFrame = -1;
      modalElapsed = 0;
      if (activeMenu && font) {
        renderWorld();
        drawMenu(fb, font, menuSelected, menuNote);
        return true;
      }
      if (state.textScreen && font) {
        renderWorld();
        drawTextScreen(fb, font, state.textScreen, shadeIndex);
        return true;
      }
      return false;
    }
    if (modalVm !== vm || !modalShaded || !modalPortraits) {
      renderWorld();
      modalShaded = fb.vram.slice();
      shadeConversationBackdrop(modalShaded);
      modalPortraits = modalShaded.slice();
      modalPortraitFrame = -1;
      modalVm = vm;
      modalElapsed = 0;
    }
    const frame = Math.floor(modalElapsed / CONVERSATION.animationMs);
    if (frame < modalPortraitFrame) {
      modalPortraits.set(modalShaded);
      modalPortraitFrame = -1;
    }
    if (frame > modalPortraitFrame) {
      fb.vram.set(modalPortraits);
      // A slow host paint may cross more than one DOS animation interval. Apply
      // every skipped transparent frame so the composite is deterministic.
      for (let n = modalPortraitFrame + 1; n <= frame; n++) {
        drawConversationPortraits(fb, vm.view(), n);
      }
      modalPortraits.set(fb.vram);
      modalPortraitFrame = frame;
    }
    fb.vram.set(modalPortraits);
    drawConversationText(fb, font, vm.view(), state.conversation?.page ?? 0);
    fb.dirty = true;
    return true;
  };

  const encodeSave = (bytes: Uint8Array) => {
    let out = '';
    for (const value of bytes) out += value.toString(16).padStart(2, '0');
    return out;
  };
  const decodeSave = (value: string) => {
    if (value.length !== startBytes.length * 2) throw new RangeError('saved game has the wrong length');
    const out = new Uint8Array(startBytes.length);
    for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
    return out;
  };
  const storedSave = (): Uint8Array | null => {
    if (DOM) {
      const value = localStorage.getItem('solarwinds.hsav01');
      if (value) return decodeSave(value);
    }
    return memorySave?.slice() ?? null;
  };
  const installBlobState = (bytes: Uint8Array) => {
    blob.load(bytes);
    state = bootState(blob);
    if (exeImage) state.exe = exeImage;
    if (convImage) state.conv = convImage;
    if (peopleImage) state.people = peopleImage;
    state.onZone = (n: number, site: number) => { void enterZone(n, site); };
    computeVelocity(blob);   // FUN_231e_02dd @0x234bd: the loaded heading/speed need their deltas
    starfield = exeImage ? createStarfield(blob, exeImage) : null;
    backdropPixels = 0;
    logLength = 0;
    messageTicks = 0;
  };
  const runMenuAction = (index: number) => {
    const item = MENU_ITEMS[index];
    if (!item) return;
    menuSelected = index;
    if (item.action === 'return') { activeMenu = false; menuNote = ''; return; }
    if (item.action === 'save') {
      memorySave = blob.save();
      if (DOM) localStorage.setItem('solarwinds.hsav01', encodeSave(memorySave));
      menuNote = 'GAME SAVED IN SLOT 1';
      return;
    }
    if (item.action === 'load') {
      const saved = storedSave();
      if (!saved) { menuNote = 'NO SAVED GAME IN SLOT 1'; return; }
      installBlobState(saved);
      activeMenu = false;
      return;
    }
    if (item.action === 'new') {
      installBlobState(startBytes);
      activeMenu = false;
      return;
    }
    if (item.action === 'order') {
      menuNote = 'SOLAR WINDS: THE ESCAPE — EPIC MEGAGAMES 1993';
      return;
    }
    // A browser page cannot terminate its host process. Keep the menu modal
    // and make the exact limitation visible instead of silently discarding it.
    menuNote = 'QUIT: CLOSE THIS BROWSER TAB';
  };

  const paint = () => {
    if (startup && !startup.done) {
      startup.render(fb);
      if (ctx) fb.present(ctx, canvas);
      paints += 1;
      if (statusEl) {
        const v = startup.view;
        statusEl.textContent = `320x200 | startup ${v.phase}` +
          (v.phase === 'title' ? ` stage ${v.titleStage} — press any key for the story` : '') +
          (v.phase === 'intro' ? ` ${v.introCounter.toString(16)}/${0x5dc.toString(16)} — press any key to skip` : '');
      }
      return;
    }
    const mode = readMode(state);
    if (!renderOverlay()) {
      renderWorld();
      repaint();
    }
    if (ctx) fb.present(ctx, canvas);
    paints += 1;
    if (statusEl) statusEl.textContent = statusLine(mode);
  };

  // The words the pump re-derives every 7 passes (@0x23f67). Rendered as text because the glyphs the
  // engine draws over BH_PAN's records come from the still-unported text/VM layer.
  const hud = () => {
    const sv = state.sv as any;
    if (!sv) return 'no blob';
    const stats = [0x3c5e, 0x3c60, 0x3c62, 0x3c64, 0x3c66, 0x3c68, 0x3c6a, 0x3c6c].map((ds: number) => sv.wordAt(ds));
    return `AP ${sv.wordAt(0x3c70)}/${sv.wordAt(0x3c5c)}  sys ${stats.join(',')}`;
  };
  const statusLine = (mode: number | null) => {
    const row = mode === null || mode === undefined ? undefined : STATE_VALUES[mode];
    const art = lastPage
      ? `page ${lastPage.page} = ${PAGE_LABEL[lastPage.page] ?? `pan[${pageRecord(lastPage.page)}]`} · ${lastPage.drew.join(' + ')}`
      : `no @0x2b04d call this pass (${PAGE_LABEL[mode as number] ?? 'undocumented'} when one fires)`;
    const vm = state.conversation?.vm?.view?.();
    const pageOf = state.conversation?.page ?? 0;
    const pagesOf = vm && font ? conversationPages(font, vm).length : 1;
    const conversation = vm
      ? `COMM ${vm.scriptId}.${vm.stage} p${pageOf + 1}/${pagesOf}: ${(vm.response ? vm.response + ' / ' : '') + vm.prompt}  ` +
        (pageOf + 1 >= pagesOf
          ? `${vm.choices.map((c: any, i: number) => `${i + 1}:${c.label}`).join(' · ')} · ${vm.choices.length + 1}:END`
          : 'any key/click turns the page (@0x25f64)')
      : null;
    const coordinates = sectorCoordinates(state.sv as any);
    return [
      `${WIDTH}x${HEIGHT}  ${title.file} ${(title.decoded / 1024).toFixed(1)} KiB  ${title.decoded} decoded`,
      `mode ${mode === null ? 'TODO_BOOT' : mode} = ${row ? `${row.name} @${hex(row.handlerAddr)}` : 'undocumented'}` +
        `  (DS:${hex(STATE_GLOBAL)}, boot ${blob.mode})`,
      art,
      `pending ${state.events.length}`,
      hud(),
      `sector ${coordinates.x},${coordinates.y}` +
        ((state.g[0x3be7] ?? 0) === 0 ? ' · rendezvous from intro: -31,1' : ''),
      `draws ${state.draws.map((d: any) => `${hex(Array.isArray(d.callee) ? d.callee[0] : d.callee)}@${hex(d.site)}`).join(' ') || '—'}`,
      conversation,
      'keys arrows fly · Ctrl fire · s scan · c communicate · e engineering · w weapons · a cargo · F1/Escape menu · -/= page',
    ].filter(Boolean).join('  |  ');
  };

  // One input batch == one pass of the loop body. `events` holds keydown/keyup/pointer labels or
  // raw { code } records for arms whose key binding the docs never give.
  const step = (events: unknown[]) => {
    if (startup && !startup.done) {
      const label = typeof events[0] === 'string' ? events[0] as string : '';
      if (label.startsWith('key:') || label.startsWith('pointer:')) startup.input();
      else if (events.length === 0) startup.step(PUMP_PERIOD_MS);
      if (startup.done) fb.loadPalette(mainPalette.rgb);
      paint();
      return state;
    }
    // The task/help screens end on FUN_231e_2f4d's INT 16h/01h+00h wait (@0x26cb0): the next key
    // dismisses them and nothing else runs, exactly like the DOS modal. The HELP modal is two-level:
    // the topic list (@0x2ddd3 FUN_231e_5133) turns 1..7 into a page, and a page re-arms the list.
    if (state.textScreen && events.length) {
      const label = typeof events[0] === 'string' ? events[0] as string : '';
      const screen = state.textScreen as TextScreen;
      const digit = /^key:([0-9])$/.exec(label);
      if (screen.options && digit) {
        const next = helpChoose(screen, Number(digit[1]) - 1, exeImage as Uint8Array, state.sv as State);
        state.textScreen = next;
      } else if (screen.returnToHelp) {
        state.textScreen = openHelp(exeImage as Uint8Array, state.sv as State, 0x2ddc0);
      } else {
        state.textScreen = null;
      }
      paint();
      return state;
    }
    if (activeMenu) {
      const label = typeof events[0] === 'string' ? events[0] as string : '';
      const key = label.startsWith('key:') ? label.slice(4) : '';
      if (key === 'ArrowUp') menuSelected = (menuSelected + MENU_ITEMS.length - 1) % MENU_ITEMS.length;
      else if (key === 'ArrowDown') menuSelected = (menuSelected + 1) % MENU_ITEMS.length;
      else if (key === 'Escape') { activeMenu = false; menuNote = ''; }
      else if (key === 'Enter') runMenuAction(menuSelected);
      else {
        const index = menuIndexForKey(key);
        if (index >= 0) runMenuAction(index);
      }
      paint();
      return state;
    }
    // FUN_231e_1e14 owns its own INT 16h/mouse loop. While it is active, numeric keys select the
    // visible 1..99 control rows and the synthetic final row exits; nothing reaches the main pump.
    const modal = state.conversation;
    if (modal?.vm) {
      const vm = modal.vm;
      const label = typeof events[0] === 'string' ? events[0] as string : '';
      const finish = () => {
        modal.finish?.();
        state.conversation = null;
      };
      // FUN_231e_2cf5 pages long text at ten rows: @0x25f5c `cmp byte ptr [0x70a5],0xa`,
      // then @0x25f64 `call 0x25623` waits for INT 16h/00h or an INT 33h button. That wait
      // consumes the key verbatim -- even Escape only turns the page -- so while pages
      // remain, every input advances instead of reaching the choice dispatch.
      if (modal.page === undefined) modal.page = 0;
      const pages = font ? conversationPages(font, vm.view()) : [[]];
      if (modal.page < pages.length - 1) {
        if (events.length) modal.page += 1;
        modalElapsed += PUMP_PERIOD_MS;
        paint();
        return state;
      }
      if (vm.complete) {
        if (events.length) finish(); // terminal 01 ff waits for one key @0x25399..@0x2539c
      } else if (label === 'key:Escape') {
        vm.abort();
        finish();
      } else {
        const m = /^key:([0-9])$/.exec(label);
        if (m) {
          const picked = m[1] === '0' ? 9 : Number(m[1]) - 1;
          const before = vm.view();
          if (picked === before.choices.length) {
            vm.abort(); // the count itself is END COMMUNICATION @0x25297..@0x2529b
            finish();
          } else if (picked >= 0 && picked < before.choices.length) {
            const view = vm.choose(picked);
            modal.page = 0; // the reply re-enters FUN_231e_2cf5's paging loop
            const body = [view.response, view.prompt].filter(Boolean).join('\n\n');
            (state.scriptLog ||= []).push({
              site: 0x24ff4,
              text: body + '\n' + view.choices.map((c: any, i: number) => `${i + 1}. ${c.label}`).join('\n'),
              choices: view.choices,
              stage: view.stage,
              complete: view.complete,
            });
          }
        }
      }
      modalElapsed += PUMP_PERIOD_MS;
      paint();
      return state;
    }
    // FUN_231e_6db0/7182/75a6 are modal: while a cutscene plays, the loop body is not executing, so
    // its keys are swallowed by the loader's own int 16h/@0x2d60b reads. The port mirrors that — a
    // queued zone replaces the pass instead of layering panel art on top of it.
    if (activeZone !== null && zonePlayers.get(activeZone)?.player) {
      const e = zonePlayers.get(activeZone)!;
      const tr = e.player.step();
      for (const t of tr) e.traces.push(`${hex(t.addr)} ${t.op} ${t.detail}`);
      fb.loadPalette(e.assets.paletteRgb);           // BH_MPn.DAT (@0x29fb9 mov cx,0xc350)
      if (tr.length) fb.dirty = true;                // the loader wrote vram behind present()'s flag
      if (e.player.done !== undefined && e.player.done) activeZone = null;
      paintZone();
      return state;
    }
    // Flight is no longer synthesised here: the pump runs FUN_231e_0bf6's integrator (@0x24199) and
    // the brake/turn/thrust block (@0x243b0..@0x244b6) on every pass, moving the five camera bytes per
    // axis from DS:0x3c92 heading and DS:0x3c98 speed. web/src/engine/flight.ts.
    state = advance(seedMode(state), { events });
    if (state.mode !== null && state.mode !== undefined) state.g[STATE_GLOBAL] = state.mode;
    // The `z`/`x` gatherer step calls FUN_231e_88f9, which clears the viewport and rebuilds all
    // transient star entries with a gatherer-dependent shape mask.
    if ((state.draws || []).some((d: any) => {
      const target = Array.isArray(d.callee) ? d.callee[0] : d.callee;
      return target === 0x2bad9;
    })) starfield?.reset();
    if ((state.scriptLog?.length || 0) > logLength) {
      logLength = state.scriptLog.length;
      messageTicks = 120;
    } else if (messageTicks > 0) messageTicks -= 1;
    if ((state.draws || []).some((d: any) => {
      const target = Array.isArray(d.callee) ? d.callee[0] : d.callee;
      return target === CALLEES.menu;
    })) {
      activeMenu = true;
      menuNote = '';
    }
    paint();
    return state;
  };

  const paintZone = () => {
    if (ctx) fb.present(ctx as any, canvas);
    paints += 1;
    if (statusEl) statusEl.textContent = statusLine(null);
  };

  // PAGE.DAT is already decoded because it is also the first live back buffer,
  // but it is not presented until the startup state reaches @0x30668.
  fb.loadPalette(startup ? epic!.rgb : mainPalette.rgb);
  paint();
  return {
    fb,
    title,
    get state() { return state; },
    get mode() { return readMode(state); },
    get paints() { return paints; },
    get page() { return lastPage; },
    get pageBuf() { return pageBuf; },
    get camera() { return cameraPosition(state.sv as any); },
    get sector() { return sectorCoordinates(state.sv as any); },
    get visibleActors() { return visibleActors.slice(); },
    get visibleSprite() { return visibleSprite; },
    get backgroundStars() { return starfield?.stars.map((star) => ({ ...star })) ?? []; },
    get backdropPixels() { return backdropPixels; },
    get playerShip() { return playerShip ? { ...playerShip } : null; },
    get startup() { return startup && !startup.done ? startup.view : null; },
    get pending() { return state.events.length; },
    keydown: (event: { key?: unknown }) => step([keydownLabel(event)]),
    keyup: (event: { key?: unknown }) => step([keyupLabel(event)]),
    pointer: (x: number, y: number) => step([pointerLabel(x, y)]),
    inject: (code: number) => step([{ code }]),
    /** One pass of the loop body with no input — what the original executes every 0x7918 PIT counts. */
    tick: () => step([]),
    /** Step an active zone cutscene one 0x8ca0-count pass and present it. */
    stepZone: () => {
      if (activeZone === null) return null;
      const e = zonePlayers.get(activeZone);
      if (!e) return null;
      const tr = e.player.step();
      for (const t of tr) e.traces.push(`${hex(t.addr)} ${t.op} ${t.detail}`);
      fb.loadPalette(e.assets.paletteRgb); // BH_MPn.DAT, 768 B as read (@0x29fb9 `mov cx,0xc350`)
      // The loader wrote straight into fb.vram, which does not trip the framebuffer's own dirty
      // flag; present() would otherwise skip the frame and the cutscene would never reach a pixel.
      if (tr.length) fb.dirty = true;
      if (ctx) fb.present(ctx as any, canvas);
      if (e.player.done !== undefined && e.player.done) activeZone = null;
      return tr;
    },
    get activeZone() { return activeZone; },
    get conversation() { return state.conversation?.vm?.view?.() ?? null; },
    /** The response's @0x25f5c ten-row paging cursor: {page, pages}. */
    get conversationPage() {
      if (!state.conversation?.vm) return null;
      return { page: state.conversation.page ?? 0, pages: font ? conversationPages(font, state.conversation.vm.view()).length : 1 };
    },
    get menu() { return activeMenu ? { selected: menuSelected, note: menuNote } : null; },
    get zoneCount() { return zonePlayers.size; },
    // Reads the cached compositor result. Never repaint: the blit belongs to the pass that called
    // FUN_231e_7e6d, and re-running it from a status line would draw outside an event handler.
    status: () => statusLine(readMode(state)),
  };
}

// --- route ----------------------------------------------------------------------
if (DOM) {
  const params = new URLSearchParams(location.search);
  if (params.get('gallery') === '1') {
    await import('./app.ts');
  } else {
    await startEngine().catch((err: Error) => {
      const el = document.getElementById('status');
      if (el) el.textContent = `boot failed: ${err.message}` +
        ' — serve the repo over HTTP (python3 -m http.server 8000)';
    });
  }
}

async function startEngine() {
  const canvas = document.getElementById('screen') as HTMLCanvasElement | null;
  const session = await createSession({ canvas, statusEl: document.getElementById('status') });

  if (!canvas) return;
  addEventListener('keydown', (e: KeyboardEvent) => session.keydown(e));
  // Auto-repeat is deliberately passed through as another make: on real hardware the BIOS types
  // ahead and the pump consumes one int 16h event per pass, so a held key earns a pass.
  addEventListener('keyup', (e: KeyboardEvent) => session.keyup(e)); // break codes: closes TODO_KEYUP@0x23cc7
  // ── the frame clock ──────────────────────────────────────────────────────────────────────
  // re/frame-clock (web/src/engine/clock.ts) settled TODO_TIMERS@0x23e9e: there is no timer
  // interrupt in this game. The only interrupt anywhere is one int 1Ah @0x23b7a used as an RNG
  // seed. Each pass of the loop body *spin-waits* on PIT counter 2 —
  //   @0x23dd9 mov al,0x80 / out 0x43,al / in al,0x42 x2 / cmp bx,0x7918 / ja —
  // then reloads it with 0x7918 = 31000 counts = 25.98 ms (@0x23df1). So the game runs at 38.49
  // passes per second whether or not a key is pressed: that is the animation everyone could not
  // find. Zone cutscenes reload 0x8ca0 = 36000 = 30.17 ms instead. The DOS box also spins the
  // whole CPU; in a browser requestAnimationFrame is the honest equivalent, with the PIT period
  // deciding how many passes elapse.
  const clock = createClock(false);
  let raf = 0;
  // rAF where it exists; otherwise a 16 ms timer. The clock is monotonic either way, so a host
  // without rAF still gets ~38 passes per second instead of throwing on boot.
  const nowMs = (): number => (typeof performance === 'object' && performance.now ? performance.now() : Date.now());
  const schedule: (fn: (t: number) => void) => number =
    typeof requestAnimationFrame === 'function'
      ? (fn) => requestAnimationFrame(fn)
      : (fn) => (setTimeout(() => fn(nowMs()), 16) as unknown as number);
  const frame = (now: number) => {
    const passes = clockAdvance(clock, now);
    if (session.activeZone !== null) {
      for (const _ of passes) session.stepZone();
      if (session.activeZone === null && session.zoneCount) clock.scene = false;
    } else {
      for (const _ of passes) session.tick();
    }
    raf = schedule(frame);
  };
  raf = schedule(frame);
  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    session.pointer(((e.clientX - box.left) / box.width) * WIDTH, ((e.clientY - box.top) / box.height) * HEIGHT);
  });
}
