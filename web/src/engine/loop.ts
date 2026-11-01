// Solar Winds — screen state machine, transcribed from re/game-loop-modes.md.
//
// One pass of the loop body 0x23c1c..0x23c91, now carrying the §2 draw rows and the §3 input
// evidence that re/game-loop-modes.md supplies:
//   * the installed INT 9 handler, linear 0x23c97..0x23dd5 (= CS:0xab7; old vector saved
//     @0x239ef, replacement installed @0x23ae1)
//   * the event pump FUN_231e_0bf6 @0x23dd6 (called every pass @0x23c1c), its epilogue
//     0x244b7..0x2450a, and its default gatherer FUN_231e_4b35 @0x27d15
//   * the state-1 handler FUN_231e_b509 @0x2e6e9 (body 0x2e6e9..0x2e9e8)
// Every row cites the address that proves it. Anything the doc marks UNCONFIRMED — or simply
// does not quote — stays a named TODO carrying that reason. Nothing here is invented.
//
// Address conventions (all three are used inside re/game-loop-modes.md itself):
//   code:  linear = EXE file offset + 0xf200
//   data:  linear = 0x10000 + DSoffset
//   far:   lcall 0x131e:off -> linear 0x231e0 + off

// The single 64 KiB framebuffer the §5.1 map rows stage through (screens.ts
// contract: .raw(), .seek(), .getU8(), .fill()).
import {
  TABLES, RUNNER, ZONE_SEEN, SCRIPT_DONE, recordAt, readRecord, classifyObject, collectVisible,
  decodeConv, CONV_EFFECTS, type RunnerHooks,
} from './script.ts';
import { applyStoryReward } from './rewards.ts';
import { TASKS, activeTasks, dataString, openHelp } from './textscreen.ts';
import { createConversationVm, type VmView } from './vm.ts';
import { integrate, stepFlight, type HeldFlags } from './flight.ts';
import { launchPlayerProjectile, tickWeaponCooldown, updateProjectiles } from './combat.ts';
import { updateEnemies } from './enemies.ts';
import { stepPlayerDeath } from './death.ts';
import type { State } from './state.ts';
import { MSG, poolString } from './messages.ts';
import { OPENING_STORY, stepIncomingHail, stepOpeningStory, updateHailTarget } from './story.ts';

export const fb = {
  buf: new Uint8Array(0x10000),
  pos: 0,
  raw(): Uint8Array { const b = this.buf.subarray(this.pos, this.pos + 0xfa00); this.pos += 0xfa00; return b; },
  seek(n: number): void { this.pos = n; },
  getU8(): number { return this.buf[this.pos++]; },
  fill(v: number): void { this.buf.fill(v, this.pos, this.pos + 0xfa00); this.pos += 0xfa00; },
};
const _f = (n: number) => (n >>> 0) & 0xff;

// --- MODE NUMBERING ---------------------------------------------------------------
// The doc opens with the heading "## mode 0 (0x2e6e9)" and then retracts it under "###
// correction: 0x2e6e9 is the state-1 handler, not state 0". Its verbatim chain is decisive:
//   cmp [0x3c91],1 @0x23c1f -> lcall 0x131e,0xb509 @0x23c26 -> 0x231e0 + 0xb509 = 0x2e6e9
//   cmp [0x3c91],2 @0x23c2e -> lcall 0x131e,0xb809 @0x23c35 -> 0x2e9e9
//   cmp [0x3c91],3 @0x23c3d -> lcall 0x131e,0xb9ac @0x23c44 -> 0x2eb8c
//   cmp [0x3c91],4 @0x23c4c -> lcall 0x131e,0xb8ad @0x23c53 -> 0x2ea8d
//   cmp [0x3c91],5 @0x23c5b -> `jne 0x23c62` @0x23c60 is `75 00`, a zero-length jump: no call
// So STATE_VALUES below is keyed 1..4 = 0x2e6e9 / 0x2e9e9 / 0x2eb8c / 0x2ea8d and modes 0 and 5
// dispatch nothing. A handler's mode write takes effect on the NEXT pass (the chain already
// ran), which is why 0x2e6ed loads 3 and 3's handler is 0x2eb8c.


// --- second numbering fix: cs:[0x42] is a scancode latch, not a tick counter -------
// An earlier revision read `cmp cs:[0x42],0x3c` / `,0x43` as a 60/67-tick timer, because the
// §4 "unemulated DOS/BIOS ints" section was empty. The INT 9 body answers the question
// differently: 0x23dce `mov byte ptr cs:[0x42], al` latches the LAST RAW SCANCODE of every
// interrupt, and 0x23c8b clears it so each press counts once. 0x3c and 0x43 are the scancodes
// of the "5" and "2" keys, and 0x23c62..0x23c81 is a two-key cheat sequence arming DS:0x13be6 —
// the flag the state-1 handler gates on at 0x2e79e/0x2e832/0x2e866. The old
// TICK_60/TICK_67/pending60/grace names are therefore gone.

// --- loop-body and callee anchors -------------------------------------------------

// --- state contract ---------------------------------------------------------------
export interface EventRec { code: number; flags?: Record<string, number>; cite?: number | string; note?: string; }
export type PumpEvent = number | EventRec;
export interface DrawRec { callee: number | number[]; site?: number; sites?: number[]; note?: string; [k: string]: any; }
export interface EventArm {
  /** The event code the arm compares, or 'tableA'/'tableB' where the match is a table walk
   *  rather than a single byte, or null for the handler's fall-through row. */
  code?: number | string | null;
  table?: any;
  key?: string; cite?: number | string; to?: number; modeWrite?: number;
  /** Arm payloads are heterogeneous evidence rows (site/callee/kind/g/eq/invert...);
   *  each consumer reads the keys its own cited row supplies. */
  calls?: any[]; writes?: any[]; toggles?: any[]; gate?: any; draws?: any[]; gathererStep?: any;
  todo?: string; note?: string; [k: string]: any;
}
/** A 16-bit DS read (linear DS:0x10000 == DS offset 0): persisted state first, then writable
 *  transient globals, then SOLAR1.EXE's initialized data for tables above the save window. */
export function tickStatPool(st: EngineState): boolean {
  const sv = st.sv as any;
  if (!sv) return false;
  st.g[0x15b09] = ((st.g[0x15b09] || 0) + 1) & 0xff;
  if (st.g[0x15b09] !== 7) return false;
  st.g[0x15b09] = 0;
  const sum = CREW_STATS.reduce((a: number, ds: number) => a + (sv.wordAt(ds) as number), 0);
  const budget = sv.wordAt(0x3c5c) as number;
  if (budget < sum) { sv.wordAt(0x3c5c, sum); sv.wordAt(0x3c70, 0); }
  else sv.wordAt(0x3c70, budget - sum);
  note(st, `pool re-derived every 7 pump passes (@0x23f67): budget ${sv.wordAt(0x3c5c)} - sum(stats) ${sum} -> pool ${sv.wordAt(0x3c70)}`);
  return true;
}

// --- FUN_231e_67b7 @0x29997: the crew-stat allocator -------------------------------------------
// Reached from state 1 before its cmp chain (lcall 0x131e,0x67b7 @0x2e6fa) and from state 2's tail
// (@0x2ea87). It takes AX, may move one point between the pool DS:0x3c70 and one of the eight stats
// DS:0x3c5e..0x3c6c, refreshes four byte mirrors, and ALWAYS returns AX unchanged - so the chain in
// the calling handler still sees the original code. That is why the doc calls it a sink.
export const CREW_STATS = Object.freeze([0x3c5e, 0x3c60, 0x3c62, 0x3c64, 0x3c66, 0x3c68, 0x3c6a, 0x3c6c]);
export const STAT_MAX = Object.freeze([0x4a, 0x4a, 0xde, 0x25, 0x6f, 0x6f, 0x6f, 0x6f]); // @0x299ad..@0x29a6e
const STAT_MIRROR: Array<[number, number]> = [[3, 0x3c72], [5, 0x3c74], [7, 0x3c73], [6, 0x3c75]];

export function fun_231e_67b7(st: EngineState, code: number, site: number): number {
  const sv = st.sv as any;
  if (!sv) { note(st, `TODO_MEMORY@${hex(site)}: no state blob, FUN_231e_67b7 cannot touch the stat words`); return code; }
  const pool = () => sv.wordAt(0x3c70) as number;
  const stat = (i: number) => sv.wordAt(CREW_STATS[i]) as number;
  let moved: string | null = null;
  // 0x13..0x1a = Ctrl+S..Ctrl+Z: take one point out of the pool, capped per stat.
  if (code >= 0x13 && code <= 0x1a) {
    const i = code - 0x13;
    if (pool() === 0) moved = `pool DS:0x13c70 is 0, so stat ${i} cannot take a point (@0x299a0)`;
    else if (stat(i) >= STAT_MAX[i]) moved = `stat ${i} is at its cap ${STAT_MAX[i]} (@0x299a0)`;
    else { sv.wordAt(0x3c70, pool() - 1); sv.wordAt(CREW_STATS[i], stat(i) + 1); moved = `pool -> stat ${i} (@0x299ad, @0x299b4)`; }
  }
  // 0x21..0x28 = Shift+1..Shift+8: give one point back.
  else if (code >= 0x21 && code <= 0x28) {
    const i = code - 0x21;
    if (stat(i) === 0) moved = `stat ${i} is 0, nothing to give back (@0x29a80)`;
    else { sv.wordAt(CREW_STATS[i], stat(i) - 1); sv.wordAt(0x3c70, pool() + 1); moved = `stat ${i} -> pool (@0x29a8d, @0x29abf)`; }
  }
  if (moved) {
    for (const [i, mirror] of STAT_MIRROR) {
      const v = (stat(i) >> 1) & 0xff; // `shr 1` per mirror, @0x29ad0..@0x29b12
      if (sv.byteAt ? sv.byteAt(mirror) !== v : true) {
        if (sv.byteAt) sv.byteAt(mirror, v); else sv.wordAt(mirror, v);
        st.g[0x15c1a] = 0xff; // the "redraw the panel" latch, set on any mirror change
        note(st, `mirror DS:${hex(mirror)} = stat${i}>>1 = ${v} (@0x29b15) -> redraw latch DS:0x15c1a=0xff`);
      }
    }
    note(st, `event ${hex(code)}: FUN_231e_67b7 @0x29997 (${moved}), AX returned unchanged (@0x2e6fa)`);
  }
  return code;
}

export function rdWord(st: EngineState, linearAddr: number, quiet = false): number {
  const ds = linearAddr - 0x10000;
  // The blob only images DS:0x00AD..0x4653 (state.ts BLOB_LENGTH @0x2cf66); anything at or above
  // DS:0x4654 is transient and lives in the sparse global mirror instead.
  if (ds >= 0x00ad && ds + 2 <= 0x4654) {
    const sv = st.sv as { wordAt: (ds: number) => number } | undefined;
    if (!sv) {
      note(st, `TODO_MEMORY@${hex(linearAddr)}: no state blob attached, so this table word cannot be read`);
      return 0;
    }
    return sv.wordAt(ds);
  }
  const v = st.g[linearAddr];
  if (v !== undefined) return v;
  // DOS loads SOLAR1.EXE's initialized data at the same DS offsets used by the handlers.  The
  // two state-4 key tables are above the persisted save window, but they are not uninitialized:
  // DS:0x5b90/0x5ba4 map to EXE file offsets DS+0xf90 and contain the ten make codes for each
  // weapon row.  Consult that immutable image after the writable sparse mirror.
  const image = st.exe as Uint8Array | undefined;
  const at = ds + 0xf90;
  if (image && at >= 0 && at + 1 < image.length) return image[at] | (image[at + 1] << 8);
  if (!quiet) note(st, `TODO_MEMORY@${hex(linearAddr)}: above the save-image bound DS:0x4654, with neither a runtime write nor initialized EXE data available`);
  return 0;
}

/** First-match-wins, the way the cmp chains are built: an exact code arm, else the first table arm
 *  whose key table matches (states 4, 0x2eac9 / 0x2eb3d), else the handler's documented else-row. */
function matchArm(st: EngineState, arms: EventArm[], code: number, handlerAddr: number): EventArm | null {
  const exact = arms.find((a: EventArm) => a.code === code);
  if (exact) return exact;
  for (const a of arms) {
    if (!a.table) continue;
    // A table walk reads every entry, so misses stay quiet; initialized tables above DS:0x4654
    // resolve through SOLAR1.EXE in rdWord().
    for (let i = 0; i < a.table.n; i++) {
      if (rdWord(st, a.table.keys + i * 2, true) === code && rdWord(st, a.table.pres + i * 2, true) !== 0) {
        note(st, `table arm ${a.code} matched entry ${i} of [${hex(a.table.keys)}] @${hex(a.table.site)}`);
        return { ...a, matchIndex: i };
      }
    }
  }
  return arms.find((a: EventArm) => a.code === null) ?? null;
}

/** Read a pump event's AL: a bare number is already a code, a record carries one. */
export function codeOf(e: PumpEvent | undefined | null): number | null {
  if (e === undefined || e === null) return null;
  if (typeof e === 'number') return e;
  return e.code === undefined || e.code === null ? null : e.code;
}
export interface ModeRow {
  mode: number; name: string; cmpAddr: number | null; dispatchSite: number;
  farTarget: string | null; handlerAddr: number | null;
  draws: DrawRec[]; input: string; arms: EventArm[] | null; armsTodo: string | null;
  [k: string]: any;
}
export interface EngineState {
  /** The mode global (DS:0x13c91). `null` until a state blob seeds it. */
  mode: number | null;
  /** Sparse mirror of the DS global window; addresses are the keys. */
  g: Record<number, number | undefined>;
  /** INT 9 held-key flags, written only by int9(). */
  held: Record<string, number>;
  /** Queue standing in for the BIOS type-ahead buffer (TODO_BUFFER@0x28429). */
  events: PumpEvent[];
  /** Draw rows that fired on this pass. */
  draws: DrawRec[];
  trace: string[];
  /** One-pass queue of original BH_VFD sound ids for the browser audio seam. */
  audioEvents?: number[];
  [k: string]: any;
}

export const STATE_GLOBAL = 0x13c91; // DS:0x3c91, the dispatch key
export const LOOP_BODY = { start: 0x23c1c, end: 0x23c91 }; // `jmp 0x23c1c` @0x23c91: no exit path
export const INIT_CALL = 0x23c12; // lcall 0x131e,0x458 -> FUN_231e_0458 @0x23638 (pre-loop init)
export const INPUT_PUMP = 0x23dd6; // FUN_231e_0bf6, called @0x23c1c
export const PUMP_REPUMP = 0x23dd9; // 0x24491 / 0x244f8 restart the pump without returning
export const PUMP_RET = 0x24507; // pop dx/cx/bx; ret @0x2450a -> 0x23c1f with AL = event code
export const FRAME_CLOCK = { wait: 0x23dd9, reload: 0x23df1, speakerGate: 0x23dfc }; // PIT ch2, count 0x7918
export const INT9_HANDLER = { start: 0x23c97, end: 0x23dd5, offset: 0xab7, saveSite: 0x239ef, installSite: 0x23ae1 };
export const TODO_ANCHOR_0x267f9 = 'FUN_231e_361d @ 0x267f9: role undocumented in re/game-loop-modes.md';

export const CALLEES: Record<string, number | number[]> = {
  blit: 0x2b04d, // FUN_231e_7e6d — the screen compositor, AL = the mode just written to DS:0x13c91; int 33h ax=1/2 around the copy when DS:0 (mouse installed) != 0. Transcribed in pages.ts: page 1 restores the 94-column background strip, pages 2/3/4 blit BH_PAN records 0/1/2 at DS:[0x6bb3] = 0x5224 and the 93x65 record 4 at A000:0xe3.
  scan: 0x2d1fc, // FUN_231e_a01c — the `s` arm: walks the per-frame visible-entity table (DS:0x13bf3/0x13bf5) and prints what is on screen. Ported in script.ts.
  converse: 0x2d44d, // FUN_231e_a26d — the `c` arm: loads BH_CONV.DAT, runs the object's script, and is the ONLY caller of the three zone cutscene loaders. Ported in script.ts.
  sink: 0x29997, // FUN_231e_67b7 — consumer for codes 0x13..0x1a (crew-stat increments against the DS:0x13c70 pool)
  menu: 0x2cba2, // FUN_231e_99c2 — shared in-game menu: writes DS:0x13c91 = 1 @0x2cbae, repaints page 1 (@0x2cbb5) and again on the way out (@0x2d14f)
  rebuild: [0x23638, 0x23225], // FUN_231e_0458 + FUN_231e_0045, the "rebuild/redraw everything" pair
  scroll: 0x234bd, // FUN_231e_02dd — the pump's arrow-scroll redraw
  message: 0x264be, // FUN_231e_32de — text/status printer, called as `lea bx,[0x58b2]` + lcall
  frameTick: 0x274c4, // FUN_231e_42e4 — per-frame animation/timer tick, lcall @0x23dfe
  gatherer: 0x27d15, // FUN_231e_4b35 — DS:0x13572 == 0 (default): the keyboard/mouse event source
  soundInit: 0x268e8, // FUN_231e_3708 — sound init / re-init
  msgCenter: 0x2b892, // FUN_231e_8bdc — message center: DI = a $-terminated string, AL=0, AH=0x3f
  textCursor: 0x25f4d, // FUN_231e_2f4d
  msgTail: 0x2bc72, // FUN_231e_8a92 — third call of the shared "5" arm
  nameWrite: 0x2a1c0, // FUN_231e_7fc0 — writes a string at DI into row AL of the screen buffer; skipped when DS:0x13ade == 0
  tableHit: 0x2c5d9, // call 0x2eaf2 — state 4, first table matched
  tableAfter: 0x2c646, // call 0x2eb24 — state 4, after the [0x3c94] cycle
  otherTable: 0x2c307, // lcall 0x131e,0x9127 — state 4, second table walk
  pageForward: 0x2ec35, // call 0x2ec1d — state 3 pager (prints [0x588e] when DS:0x13c56 == 0); its body FUN_231e_ba64 @0x2ec44 ends every tail with the @0x2b04d repaint
  pageBack: 0x2ed2b, // call 0x2ec2e, and the target of state 1's "=" arm @0x2e794
};

export const TODO_GATHERERS = {
  level1: 'UNCONFIRMED gatherer: FUN_231e_535c @0x2853c (called @0x23e11 when DS:0x13572 == 1). re/game-loop-modes.md says only "no INT 16h/33h, one INT 10h (0x28622)" — what it gathers is not stated, so no event code is produced.',
  level2plus: 'UNCONFIRMED gatherer: FUN_231e_56d9 @0x288b9 (called @0x23e19 when DS:0x13572 >= 2). re/game-loop-modes.md says only "no INT 16h/33h, one INT 10h (0x2897d)" — what it gathers is not stated, so no event code is produced.',
};

// --- DS globals, one row per address the loop / INT 9 / pump touch -----------------
export const GLOBALS: Record<string, { addr: number; meaning?: string; [k: string]: any }> = {
  mode: { addr: 0x13c91, set: [0x2e6ef, 0x2e705, 0x2e722, 0x2cbae], read: [0x23c1f, 0x23c2e, 0x23c3d, 0x23c4c, 0x23c5b, 0x23eb9, 0x244b7], meaning: 'the dispatch key; boot value undocumented -> TODO_BOOT@0x23c12' },
  flag_5c1a: { addr: 0x15c1a, set: [0x23c08, 0x2e7c7], meaning: 'TODO_GLOBAL@0x15c1a — written pre-loop and by the "," arm, no reader quoted' },
  count_3c92: { addr: 0x13c92, set: [0x23c0d, 0x2445f], meaning: 'TODO_GLOBAL@0x13c92 — pre-loop 0x16 @0x23c0d, then (CL?:0x20)-1 @0x2445b..0x2445f; CL has no documented source' },
  one_5bbb: { addr: 0x15bbb, set: [0x23c17], meaning: 'TODO_GLOBAL@0x15bbb — pre-loop write only; a different address from the pump ascii latch at 0x15bb8' },
  lastScancode: { addr: 0x13222, set: [0x23dce], read: [0x23c62, 0x23c79], clear: [0x23c8b], meaning: 'cs:[0x42] — last raw scancode (make or break), latched by the ISR, cleared once per pass' },
  fiveLatch: { addr: 0x146a5, set: [0x23c6a], read: [0x23c72], clear: [0x23c86], meaning: 'the previous pass ended with the "5" key (scancode 0x3c) latched' },
  cheatGate: { addr: 0x13be6, set: [0x23c81, 0x244d5], read: [0x2e79e, 0x2e832, 0x2e866], meaning: 'cheat arm: "5" then "2" (0x23c62..0x23c81) or the mode-2 "D"/"A" back door (0x244be..0x244d5)' },
  asciiLatch: { addr: 0x15bb8, set: [0x24502], clear: [0x244f3], read: [0x2e77c, 0x2e78d], meaning: '1 = the last event AL was ASCII (<= 0x7f); gates the "<" and "=" arms' },
  backdoorLatch: { addr: 0x146a7, set: [0x244c9], read: [0x244be], meaning: 'mode-2 back door: set by event 0x44 "D", arms the 0x41 "A" payload' },
  gathererSelect: { addr: 0x13572, set: [0x2e7b9], read: [0x23e03, 0x23e0a, 0x2e7b4, 0x2e7d1], meaning: 'picks which input gatherer the pump calls; cycled by the "," arm while < 2' },
  soundEnable: { addr: 0x13ade, xor: [0x2e75f], read: [0x23e9e], meaning: 'sound on/off, toggled by the "1" arm @0x2e75f and read by the pump countdown block 0x23e9e..0x23f07' },
  scrollOffset: { addr: 0x13c98, add: [0x24487], sub: [0x244aa], read: [0x24480, 0x244a3], meaning: 'DS:0x3c98 in the save image: the ship SPEED (flight.ts), which the pump moves +/-3 from the Up/Down hold flags, clamped to +/-0x22 — so the "scroll" the earlier note saw is the throttle' },
  debugWord: { addr: 0x13c95, set: [0x2e7a5], value: 1, width: 2, meaning: 'TODO_GLOBAL@0x13c95 — word; only writer is the cheat-gated "D" arm' },
  word_3c5c: { addr: 0x13c5c, set: [0x244da], value: 0x2bc, width: 2, meaning: 'TODO_GLOBAL@0x13c5c — word set by the mode-2 "A" back door' },
  slot_359b: { addr: 0x1359b, set: [0x244e3], value: 0x32, width: 2, meaning: 'TODO_GLOBAL@0x1359b — scheduler slot primed by the back door; also a cursor table per §2' },
  slot_35a1: { addr: 0x135a1, set: [0x244e9], value: 0x14, width: 2, meaning: 'TODO_GLOBAL@0x135a1 — scheduler slot primed by the back door' },
  repeatGate: { addr: 0x13c93, set: [0x24451], dec: [0x2446d], read: [0x2444a], meaning: 'TODO_GLOBAL@0x13c93 — Right-hold repeat gate (`cmp ..,0xff / jg`); producer undocumented' },
  autoScrollUp: { addr: 0x14d5b, read: [0x24471], meaning: 'TODO_GLOBAL@0x14d5b — == 1 skips the cs:[0x3c] test and scrolls Up regardless (0x24476)' },
  autoScrollDown: { addr: 0x14d5d, read: [0x24494], meaning: 'TODO_GLOBAL@0x14d5d — == 1 skips the cs:[0x3d] test and scrolls Down regardless (0x24499)' },
  countdown_13c16: { addr: 0x13c16, read: [0x23e9e], meaning: 'TODO_TIMERS@0x23e9e — countdown; no decrement site quoted' },
  countdown_13c18: { addr: 0x13c18, meaning: 'TODO_TIMERS@0x23e9e — the second countdown, named only as "DS:0x13c16 / DS:0x13c18"' },
  word_3c60: { addr: 0x13c60, read: [0x2e7db], meaning: 'TODO_GLOBAL@0x13c60 — word compared with 0x11 to gate the "," arm message blit' },
  memberSel: { addr: 0x13c4a, set: [0x2ea42, 0x2ea4a], meaning: 'state 2: the picked crew/member index (0-based), DS:0x13c4a' },
  tableSelA: { addr: 0x13c4b, set: [0x2eb27], meaning: 'state 4: index matched in the [0x5b90] table, DS:0x13c4b' },
  tableSelB: { addr: 0x13c4c, set: ['TODO_SITE@0x2eb38-walk'], meaning: 'state 4: index from the second table walk over [0x5ba4], DS:0x13c4c' },
  pageCount: { addr: 0x13c56, meaning: 'record/page count gating states 3 and its pagers, DS:0x13c56' },
  scrollIndex: { addr: 0x13c9a, set: [0x2e843, 0x2e86d], read: [0x2e83d, 0x2e85f, 0x2e839], meaning: 'state 1: the cheat-gated "=" / "-" scroller cursor, walked by @0x2e82e and @0x2e85b; it never leaves 0..[0x3c5a]' },
  scrollLimit: { addr: 0x13c5a, read: [0x2e83d], meaning: 'the upper bound of scrollIndex, compared as `cmp cx,[0x3c5a] / jae` @0x2e83d' },
  pageIndex: { addr: 0x13c8e, set: [0x2ebd5, 0x2ebe5, 0x2ebfd, 0x2ec0c], width: 2, meaning: 'state 3 pager cursor, DS:0x13c8e (wraps in 1..pageCount)' },
  pageCycle: { addr: 0x13c94, set: [0x2eb0c, 0x2eb17, 0x2eb1f], meaning: 'state 4: 1..4 cycle counter, DS:0x13c94' },
  actionPoints: { addr: 0x13c70, read: [0x29997], meaning: 'the action-point pool the sink FUN_231e_67b7 spends on codes 0x13..0x1a' },
};

// --- §3: the INT 9 handler, linear 0x23c97..0x23dd5 -------------------------------
// Written with the `cs:` override, so these bytes are NOT in the code image: CS 0x131e:0 is
// linear 0x131e0 = DS:0x31e0, hence cs:[0x3c] == linear 0x1321c (doc: "the flags live at linear
// 0x1321c..0x13224").
export const INT9_FLAGS: Record<string, number> = {
  up: 0x1321c, down: 0x1321d, f1: 0x1321e, space: 0x1321f, right: 0x13220,
  left: 0x13221, lastScancode: 0x13222, shift: 0x13223, ctrl: 0x13224,
};

// One row per scancode arm of the ISR. `cite` is that arm's `cmp al,N` where the doc quotes the
// bytes; the Down/Right arms live in the gap 0x23ce9..0x23d48 the doc does not disassemble, so
// they cite the doc's scancode table plus the flag address instead. Break = make | 0x80, the
// convention the doc's eight make/break pairs all follow.
export interface Int9Arm { scancode?: number | string; flags: Record<string, number>; cite?: number | string; todo?: string; [k: string]: any }
export const INT9_ARMS: Int9Arm[] = [
  { scancode: 0x48, cite: 0x23cb0, flags: { up: 1, down: 0 } },
  { scancode: 0xc8, cite: 0x23cc3, flags: { up: 0, down: 0 } },
  { scancode: 0x50, cite: 'INT 9 table -> cs:[0x3d] @0x1321d (arm bytes 0x23ce9..0x23d48 not quoted)', flags: { down: 1, up: 0 } },
  { scancode: 0xd0, cite: 'INT 9 table -> cs:[0x3c]+[0x3d] @0x1321c/0x1321d (arm bytes not quoted)', flags: { down: 0, up: 0 } },
  { scancode: 0x4d, cite: 'INT 9 table -> cs:[0x40] @0x13220 (arm bytes 0x23ce9..0x23d48 not quoted)', flags: { right: 1, left: 0 } },
  { scancode: 0xcd, cite: 'INT 9 table -> cs:[0x40]+[0x41] @0x13220/0x13221 (arm bytes not quoted)', flags: { right: 0, left: 0 } },
  { scancode: 0x4b, cite: 0x23cd6, flags: { left: 1, right: 0 } }, // arm head quoted, its body is in the gap
  { scancode: 0xcb, cite: 'INT 9 table -> cs:[0x40]+[0x41] @0x13220/0x13221 (arm bytes not quoted)', flags: { left: 0, right: 0 } },
  { scancode: 0x39, cite: 0x23d48, flags: { space: 1, up: 0, down: 0, right: 0, left: 0 } }, // 0x23d4c..0x23d6a clears all four arrows
  { scancode: 0xb9, cite: 0x23d73, flags: { space: 0 } },
  { scancode: 0x3b, cite: 0x23d80, flags: { f1: 1 } },
  { scancode: 0xbb, cite: 0x23d8d, flags: { f1: 0 } },
  { scancode: 0x1d, cite: 0x23d9a, flags: { ctrl: 1 } },
  { scancode: 0x9d, cite: 0x23da7, flags: { ctrl: 0 } },
  { scancode: 0x38, cite: 0x23db4, flags: { shift: 1 } },
  { scancode: 0xb8, cite: 0x23dc1, flags: { shift: 0 } },
];

// Every scancode, make or break alike, also latches cs:[0x42] @0x23dce before the iret @0x23dd5.
export const SCANKODE_FIVE = 0x3c; // "5" make, tested @0x23c62
export const SCANKODE_TWO = 0x43; // "2" make, tested @0x23c79

// --- §2 draw inventory, state-1 handler 0x2e6e9..0x2e986 --------------------------
export const STATE1_DRAWS = [
  { sites: [0x2e6f2, 0x2e708, 0x2e725], callee: CALLEES.blit, arg: 'AL = the mode just written to DS:0x13c91', note: 'the redraw-on-mode-change blit: page id == mode (all 21 lcall 0x131e,0x7e6d sites load AL from [0x3c91] or from the mode literal), art from the BH_PAN arena. See pages.ts.' },
  { sites: [0x2e7c2, 0x2e802], callee: CALLEES.rebuild, note: 'full-screen rebuild pair after a DS:[0x3572] change' },
  { sites: [0x2e7e6, 0x2e826], callee: CALLEES.message, note: 'text/status message blit: `lea bx,[0x58b2]` + lcall 0x131e,0x32de' },
  { sites: [0x2e8f1, 0x2e8f4], callee: [0x2c5d9, 0x2c646], note: 'panel/row redraws for the AL=5 / AL=3 cursor movers over the tables at DS:0x13573 / 0x1359b / 0x135af' },
  { sites: [0x2e92b], callee: 0x2c307, note: 'row redraw for the same cursor-mover family' },
];

// The state-1 compare chain in the order the doc quotes it (first match wins; every arm jumps to
// the shared `retf` at 0x2e986). `to` is the new value of DS:0x13c91, stored at `modeWrite`.
// --- states 2, 3 and 4: the arms transcribed from re/game-loop-modes.md APPENDIX C -----
// Every row cites the cmp site and, where the arm writes or calls, the site that does it. The
// first three arms are byte-for-byte the same shape in all three handlers (F1 -> shared menu,
// Esc -> mode 1 + the 0x2b04d blit, "5" -> the message trio), which is why they are built from
// one helper rather than typed out three times.
function sharedArms(a: { menu: number; escCmp: number; escMode: number; escBlit: number; fiveCmp: number; fiveStr: number; fiveTail: number; fiveMsg: number }) {
  return [
    { code: 0x3b, cite: a.menu, calls: [{ site: a.menu + 4, callee: CALLEES.menu }], to: 1, modeWrite: 0x2cbae, note: 'shared in-game menu @0x2cba2 -> DS:0x13c91 = 1 @0x2cbae' },
    { code: 0x01, cite: a.escCmp, writes: [{ g: 'mode', value: 1, site: a.escCmp + 6 }], draws: [{ site: a.escBlit, callee: CALLEES.blit }], to: 1, modeWrite: a.escMode, note: 'leaves the screen: mov [0x3c91],1 then lcall 0x131e,0x7e6d @0x2b04d with page 1, which restores the 94-column background strip (@0x2b11c) and so erases the panel. TODO_ART_SOURCE@0x2b04d is closed: the page id is the mode byte and the panel art is BH_PAN.DAT.' },
    { code: 0x35, cite: a.fiveCmp, calls: [{ site: a.fiveMsg, callee: [CALLEES.msgCenter, CALLEES.textCursor, CALLEES.msgTail] }], todo: 'TODO_MESSAGE@0x' + a.fiveStr.toString(16) + ': lea bx,[0x' + a.fiveStr.toString(16) + '] names the string this arm prints; the message center itself is documented (DI = $-terminated string, AL=0, AH=0x3f @0x2b896..@0x2b8ad), the text is not.' },
  ];
}

export const STATE2_ARMS: EventArm[] = [
  ...sharedArms({ menu: 0x2e9e9, escCmp: 0x2e9f5, escMode: 0x2e9fb, escBlit: 0x2e9fe, fiveCmp: 0x2ea06, fiveStr: 0xa690, fiveMsg: 0x2ea0e, fiveTail: 0x2ea18 }),
  // 0x2ea20 `cmp al,8 / ja 0x2ea87`: AL 1..8 picks a crew member out of the DS:0x135af presence
  // table. AL == 1 is already taken by the Escape arm above, so only 0x02..0x09 reach here.
  ...[2, 3, 4, 5, 6, 7, 8, 9].map((c) => ({
    code: c, cite: 0x2ea20,
    gate: { table: 0x135af, index: c - 2, site: 0x2ea2a, reason: 'cmp word ptr [bx+0x35af],0 @0x2ea2a -> a zero entry means the member is not present and the whole arm is skipped' },
    writes: [{ g: 'memberSel', value: c - 1, site: 0x2ea42 }],
    toggles: [],
    calls: [{ site: 0x2ea53, callee: CALLEES.rebuild }],
    note: 'rebuild pair FUN_231e_0458 @0x23638 + FUN_231e_0045 @0x23225 (the second only when al==1 or the previous pick < 2, 0x2ea3e..@0x2ea48), then lcall 0x131e,0x7fc0 @0x2a1c0 twice with al=0x1e/0x1d and di=[[0x3c4a]*2+0x35d3] (@0x2ea65, @0x2ea7b)',
  })),
  { code: null as any, cite: 0x2ea87, calls: [{ site: 0x2ea87, callee: CALLEES.sink }], todo: 'TODO_SINK_AL@0x29997: the doc says FUN_231e_67b7 returns AL "possibly unchanged"; every code outside 1..8 lands here' },
];

export const STATE3_ARMS: EventArm[] = [
  ...sharedArms({ menu: 0x2eb8c, escCmp: 0x2eb98, escMode: 0x2eb9e, escBlit: 0x2eba1, fiveCmp: 0x2eba9, fiveStr: 0xae6d, fiveMsg: 0x2ebb1, fiveTail: 0x2ebbb }),
  // The pager arms. All three are gated on DS:0x13c56 != 0 and DS:0x15bb8 == 1 (C.4). The body they
  // reach, FUN_231e_ba64 @0x2ec44, ends ALL THREE of its tails with `mov al,[0x3c91]` +
  // `lcall 0x131e,0x7e6d` (sites 0x2ec9c, 0x2ece9, 0x2ed0d), and the cursor-reset helper
  // FUN_231e_bc39 @0x2ee19 ends with a fourth (0x2ee3c) — so paging always repaints the current page.
  { code: 0x0d, cite: 0x2ebc3, gate: { g: 'asciiLatch', eq: 1, site: 0x2ebce, andWord: { addr: 0x13c56, nonzero: true, site: 0x2ebc7 } }, writes: [{ g: 'pageIndex', op: 'inc', site: 0x2ebd5, wrapSite: 0x2ebe5 }], draws: [{ site: 0x2ec9c, callee: CALLEES.blit, note: 'the pager body FUN_231e_ba64 @0x2ec44 repaints the current page from every tail (@0x2ec9c/@0x2ece9/@0x2ed0d); the port cannot say which tail its gate took — TODO_PAGER_TAIL@0x2ec44' }], note: 'page forward; wraps to 1 past DS:0x13c56. Event code 0x0d is the set-1 make for "=" and ASCII CR — re/event-codes.md proves the scancode reading, so the doc\'s "Ctrl+L/Enter" labels are the ASCII reading of the same byte.' },
  { code: 0x0c, cite: 0x2ebe9, gate: { g: 'asciiLatch', eq: 1, site: 0x2ebf6, andWord: { addr: 0x13c56, nonzero: true, site: 0x2ebef } }, writes: [{ g: 'pageIndex', op: 'dec', site: 0x2ebfd, wrapSite: 0x2ec09 }], draws: [{ site: 0x2ece9, callee: CALLEES.blit, note: 'same pager body, second tail (@0x2ece9); see TODO_PAGER_TAIL@0x2ec44 on the 0x0d arm' }], note: 'page back; wraps to pageCount' },
  { code: 0x14, cite: 0x2ec12, gate: { g: 'asciiLatch', eq: 1, site: 0x2ec16 }, calls: [{ site: 0x2ec1d, callee: CALLEES.pageForward }], note: 'thunk at 0x2ec35: when DS:0x13c56 == 0 it prints [0x588e] through FUN_231e_32de @0x28558, otherwise it pages' },
  { code: 0x16, cite: 0x2ec23, gate: { g: 'asciiLatch', eq: 1, site: 0x2ec27 }, calls: [{ site: 0x2ec2e, callee: CALLEES.pageBack }], note: 'the other pager direction (0x2ed2b), and the same target state 1 reaches via the "=" arm @0x2e794' },
];

export const STATE4_ARMS: EventArm[] = [
  ...sharedArms({ menu: 0x2ea8d, escCmp: 0x2ea99, escMode: 0x2ea9f, escBlit: 0x2eaa2, fiveCmp: 0x2eaaa, fiveStr: 0xace4, fiveMsg: 0x2eab2, fiveTail: 0x2eabc }),
  // 0x2eac4..0x2eb36: walk 10 words at DS:0x15b90 looking for a match on the whole event code,
  // gated per-entry by [si+0x3573] != 0 and globally by DS:0x15bb8 == 1.
  { code: 'tableA', cite: 0x2eac9, gate: { g: 'asciiLatch', eq: 1, site: 0x2ead6 }, table: { keys: 0x15b90, pres: 0x13573, ptrs: 0x13587, n: 10, site: 0x2eac9 }, calls: [{ site: 0x2eaed, callee: [CALLEES.nameWrite, CALLEES.tableHit] }, { site: 0x2eafb, callee: CALLEES.nameWrite }, { site: 0x2eb24, callee: CALLEES.tableAfter }] as any, note: 'DS:0x5b90 is initialized EXE data: 1–5/R–I select pulse banks; selecting the current bank cycles power 1..3.' },
  { code: 'tableB', cite: 0x2eb38, gate: { g: 'asciiLatch', eq: 1, site: 0x2eb38 }, table: { keys: 0x15ba4, pres: 0x1359b, ptrs: 0x1359b, n: 10, site: 0x2eb38 }, calls: [{ site: 0x2eb38, callee: CALLEES.otherTable }] as any, note: 'DS:0x5ba4 is initialized EXE data: F–K/V/B/N/M/, select a missile bank whose ammo word is non-zero.' },
  { code: null as any, cite: 0x2eb8b, todo: 'TODO_STATE4_FALLTHROUGH@0x2eac4: no table match -> the handler returns at the retf @0x2eb8b with nothing called. Unlike state 2 there is no sink call here.' },
];

export const STATE1_ARMS: EventArm[] = [
  // FUN_231e_b509 @0x2e6e9..@0x2e986, every `cmp al,imm8` in the chain, in first-match order.
  // The codes are raw set-1 make codes (re/event-codes.md), so the key labels below are the set-1
  // letters: 0x1e "a", 0x11 "w", 0x1f "s", 0x12 "e", 0x35 "/", 0x31 "n", 0x32 "m", 0x2c "z",
  // 0x2d "x", 0x2e "c", 0x20 "d", 0x0d "=", 0x0c "-", 0x02..0x05 = "1".."4", 0x3b F1, 0x3c F2,
  // 0x3d F3, 0x44 F10, 0x01 Escape.
  { code: 0x1e, key: 'a', cite: 0x2e6e9, to: 3, modeWrite: 0x2e6ef, draws: [{ site: 0x2e6f2, callee: CALLEES.blit }], note: 'first arm: tested before the sink call at 0x2e6fa, so AL is the pump value as-is; the compositor paints BH_PAN record 1, the CARGO panel' },
  { code: 0x11, key: 'w', cite: 0x2e6ff, to: 4, modeWrite: 0x2e705, draws: [{ site: 0x2e708, callee: CALLEES.blit }], note: 'paints BH_PAN record 2, the WEAPONS panel' },
  { code: 0x1f, key: 's', cite: 0x2e710, calls: [{ site: 0x2e714, callee: 0x2d1fc }], note: 'FUN_231e_a01c: walks the script table at [di+0x3bf5] (count DS:0x13bf3) and reads each entry\'s [bx+0xb]/[bx+0xc]; sub-screen, no mode change' },
  { code: 0x12, key: 'e', cite: 0x2e71c, to: 2, modeWrite: 0x2e722, draws: [{ site: 0x2e725, callee: CALLEES.blit }], note: 'paints BH_PAN record 0, the ENGINEERING panel' },
  { code: 0x35, key: '/', cite: 0x2e72d, calls: [{ site: 0x2e731, callee: 0x2dd9f }], note: 'the arm holding the int 16h / int 21 ah=25h block at 0x2ddba..0x2ded5' },
  { code: 0x3b, key: 'F1', cite: 0x2e737, calls: [{ site: 0x2e73b, callee: CALLEES.menu }], to: 1, modeWrite: 0x2cbae, note: 'shared in-game menu (present in all four handlers)' },
  { code: 0x01, key: 'Escape', cite: 0x2e743, calls: [{ site: 0x2e747, callee: CALLEES.menu }], to: 1, modeWrite: 0x2cbae, note: 'the same menu, not a "back" key: in state 1, Escape opens the menu (@0x2e743)' },
  { code: 0x2e, key: 'c', cite: 0x2e74f, calls: [{ site: 0x2e753, callee: 0x2d44d }], note: 'FUN_231e_a26d: re-installs the INT 9 vector first (int 21h ah=25 al=9 @0x2d461 from DS:0xb998/0xb99a), then walks the same script table; it holds an int 16h at 0x2d60b' },
  { code: 0x31, key: 'n', cite: 0x2e75b, toggles: [{ g: 'soundEnable', site: 0x2e75f }], calls: [{ site: 0x2e764, callee: CALLEES.soundInit }], note: 'xor DS:0x13ade then the sound init. DS:0x13ade == 1 is the gate the four digit arms sit behind (@0x2e885), so this key also turns them on and off' },
  { code: 0x32, key: 'm', cite: 0x2e76c, calls: [{ site: 0x2e770, callee: 0x26c61 }] },
  { code: 0x3c, key: 'F2', cite: 0x2e778, gate: { g: 'asciiLatch', eq: 1, site: 0x2e77c }, calls: [{ site: 0x2e783, callee: 0x2ed2b }], note: 'thunk_FUN_231e_bb5a; F2 is also the first half of the cheat latch @0x23c62' },
  { code: 0x3d, key: 'F3', cite: 0x2e789, gate: { g: 'asciiLatch', eq: 1, site: 0x2e78d }, calls: [{ site: 0x2e794, callee: 0x2ec35 }], note: 'thunk_FUN_231e_ba64 -> 0x2ec44' },
  { code: 0x44, key: 'F10', cite: 0x2e79a, gate: { g: 'cheatGate', eq: 0, site: 0x2e79e, invert: true }, writes: [{ g: 'debugWord', value: 1, site: 0x2e7a5 }] },
  { code: 0x2c, key: 'z', cite: 0x2e7ab, gathererStep: true },
  { code: 0x2d, key: 'x', cite: 0x2e7ee, gathererStep: -1 },
  { code: 0x0d, key: '=', cite: 0x2e82e, gate: { g: 'cheatGate', eq: 1, site: 0x2e832 }, scrollStep: { index: 'scrollIndex', limit: 'scrollLimit', op: 'inc', delta: 3, threshold: 0x25, site: 0x2e843, deltaSite: 0x2e84e, callSite: 0x2e853 } },
  { code: 0x0c, key: '-', cite: 0x2e85b, gate: { g: 'cheatGate', eq: 1, site: 0x2e866 }, scrollStep: { index: 'scrollIndex', limit: null, op: 'dec', delta: 3, threshold: 0x22, site: 0x2e86d, deltaSite: 0x2e878, callSite: 0x2e87d } },
  // The four digit arms sit behind @0x2e885 `cmp byte ptr [0x3ade],1 / je 0x2e88f / jmp retf`:
  // with DS:0x13ade != 1 the chain ends there and none of them run.
  { code: 0x02, key: '1', cite: 0x2e88f, gate: { g: 'soundEnable', eq: 1, site: 0x2e885 }, cursorScan: { cursor: 'tableSelA', table: 0x13573, end: 0x14, exhausted: 1, site: 0x2e89a, setSite: 0x2e8b4 } },
  { code: 0x03, key: '2', cite: 0x2e8cb, gate: { g: 'soundEnable', eq: 1, site: 0x2e8cf }, pageCycle: { g: 'pageCycle', site: 0x2e8d6 }, calls: [{ site: 0x2e8f1, callee: 0x2c5d9, di: 0xdcfa }, { site: 0x2e8f4, callee: 0x2c646 }], note: 'inc DS:0x13c94 with the 4 -> 1 reset @0x2e8e1, then mov di,0xdcfa @0x2e8ee and the two near calls' },
  { code: 0x04, key: '3', cite: 0x2e8fa, gate: { g: 'soundEnable', eq: 1, site: 0x2e8fe }, cursorScan: { cursor: 'tableSelB', table: 0x1359b, end: 0x14, exhausted: 0, extraPass: true, zeroKeepsFirst: true, site: 0x2e905, setSite: 0x2e927 }, calls: [{ site: 0x2e92b, callee: 0x2c307 }] },
  { code: 0x05, key: '4', cite: 0x2e94a, gate: { g: 'soundEnable', eq: 1, site: 0x2e8cf }, cursorScan: { cursor: 'memberSel', table: 0x135af, end: 0xe, exhausted: 1, site: 0x2e94e, setSite: 0x2e968 } },
  { code: 0x20, key: 'd', cite: 0x2e97f, calls: [{ site: 0x2e983, callee: 0x2e987 }], note: 'the last arm: walks [di+0x3bf5] for the next script event with [si+0xb] < 5, parking it in DS:0x13ae1' },
  // Closes TODO_ARM_ORDER@0x2e7db — 0x2e7dc..0x2e986 is now disassembled, so the whole first-match
  // order is known. Closes TODO_KEYMAP@0x2e76c: make 0x04 IS the "3" arm (memberSel over
  // DS:0x135af @0x2e94a); it sat past the quoted window, it was never unbound.
];

// --- §2 state table ---------------------------------------------------------------
// cmpAddr / dispatchSite / farTarget / handlerAddr are the chain at 0x23c1f..0x23c60 verbatim.
// `arms` is the transcribed event table, or null with armsTodo naming why there is none.
export const STATE_VALUES: Record<number, ModeRow> = {
  0: {
    mode: 0,
    name: 'no handler — the chain runs out of compares',
    cmpAddr: null, // there is no `cmp ...,0`: the chain starts at 1 @0x23c1f
    dispatchSite: 0x23c60,
    farTarget: null,
    handlerAddr: null,
    draws: [{ sites: [0x23dfe], callee: CALLEES.frameTick, note: 'pump-side animation tick only; no handler draws' }],
    input: 'the pump @0x23c1c still runs (PIT clock 0x23dd9, INT 9 hold flags 0x24442/0x24478/0x2449b, back door 0x244b7) but nothing is called, so mode 0 receives no key events at all through that path (0x244ef..0x24502)',
    arms: null,
    armsTodo: null, // documented: the chain calls nothing for mode 0
  },
  1: {
    mode: 1,
    name: 'FUN_231e_b509',
    cmpAddr: 0x23c1f,
    dispatchSite: 0x23c26,
    farTarget: '0x131e:0xb509',
    handlerAddr: 0x2e6e9, // 0x231e0 + 0xb509 — the doc's corrected numbering
    draws: STATE1_DRAWS,
    input: 'AL arrives from the pump (FUN_231e_0bf6 @0x23dd6, returned @0x24507). The handler holds no int 16h / int 33h of its own: no `cd 16` or `cd 33` byte exists in 0x2e6e9..0x2e9e8.',
    arms: STATE1_ARMS,
    armsTodo: null,
  },
  2: {
    mode: 2,
    name: 'FUN_231e_b809',
    cmpAddr: 0x23c2e,
    dispatchSite: 0x23c35,
    farTarget: '0x131e:0xb809',
    handlerAddr: 0x2e9e9, retAddr: 0x2ea8c, // 0x231e0 + 0xb809
    draws: [{ sites: [0x23dfe], callee: CALLEES.frameTick, note: 'frame tick only. Closes TODO_DRAWS@0x2e9e9 (Appendix C): the handler own draw is its Escape arm page-1 blit @0x2b04d; the art it runs on is BH_PAN record 0 - the ENGINEERING panel (POWER DIST. / REACTOR AVAILABLE / SHIELDS), 91x135 at col 228 row 65, composited when the state-1 e arm (@0x2e725) enters mode 2.' }],
    input: 'pump path as for mode 1, plus the mode-2-only back door in the epilogue (0x244b7..0x244e9: "D" then "A")',
    arms: STATE2_ARMS,
    armsTodo: null, // APPENDIX C.2
  },
  3: {
    mode: 3,
    name: 'FUN_231e_b9ac',
    cmpAddr: 0x23c3d,
    dispatchSite: 0x23c44,
    farTarget: '0x131e:0xb9ac',
    handlerAddr: 0x2eb8c, retAddr: 0x2ec34, // 0x231e0 + 0xb9ac
    draws: [{ sites: [0x23dfe], callee: CALLEES.frameTick, note: 'frame tick only. Closes TODO_DRAWS@0x2eb8c (Appendix C): the handler own draw is its Escape arm page-1 blit @0x2b04d; the art it runs on is BH_PAN record 1 - the CARGO panel (TRANSPORT / USE, with the arrow boxes the =/- pager arms @0x2ebc3/@0x2ebe9 move), 91x135 at col 228 row 65, composited when the state-1 a arm (@0x2e6f2) enters mode 3.' }],
    input: 'pump path as for mode 1',
    arms: STATE3_ARMS,
    armsTodo: null, // APPENDIX C.4
  },
  4: {
    mode: 4,
    name: 'FUN_231e_b8ad',
    cmpAddr: 0x23c4c,
    dispatchSite: 0x23c53,
    farTarget: '0x131e:0xb8ad',
    handlerAddr: 0x2ea8d, retAddr: 0x2eb8b, // 0x231e0 + 0xb8ad
    draws: [{ sites: [0x23dfe], callee: CALLEES.frameTick, note: 'frame tick only. Closes TODO_DRAWS@0x2ea8d (Appendix C): the handler own draw is its Escape arm page-1 blit @0x2b04d; the art it runs on is BH_PAN record 2 - the WEAPONS panel (PULSE CANNON / POWERED AT / MISSILES over the letter grid the state-4 table arms read), 91x135 at col 228 row 65, composited when the state-1 w arm (@0x2e708) enters mode 4.' }],
    input: 'pump path as for mode 1',
    arms: STATE4_ARMS,
    armsTodo: null, // APPENDIX C.3
  },
  5: {
    mode: 5,
    name: 'no handler — last compare matches and `jne 0x23c62` is 75 00',
    cmpAddr: 0x23c5b,
    dispatchSite: 0x23c5b,
    farTarget: null,
    handlerAddr: null,
    draws: [{ sites: [0x23dfe], callee: CALLEES.frameTick, note: 'pump-side animation tick only' }],
    input: 'same as mode 0: pump effects only, no event reaches a handler (0x23c60 is a zero-length jne, there is no lcall)',
    arms: null,
    armsTodo: null,
  },
};

// One pre-loop state, mirroring the bytes at 0x23c08..0x23c17 and the flag semantics of the ISR.
export function initialState(): EngineState {
  // TODO_BOOT@0x23c12 was the last unknown; now sourced from shipped data instead of guessed.
  // BH_START.DAT (17,831 B, byte-identical round-trip via state.js) holds mode = 1 at DS:0x3c91,
  // so the boot dispatch key is DATA, not a choice by us.
  return {
    mode: 1,
    g: {
      [GLOBALS.mode.addr]: 1, // DS:0x13c91 = 1, from BH_START.DAT
      [GLOBALS.flag_5c1a.addr]: 0xff, // @0x23c08
      [GLOBALS.count_3c92.addr]: 0x16, // @0x23c0d
      [GLOBALS.one_5bbb.addr]: 0x01, // @0x23c17
    },
    // INT 9 hold flags: 0 = released. Only the ISR writes them (0x23cb4..0x23dcb); the doc quotes
    // no init site, so the port starts them clear.
    held: { up: 0, down: 0, f1: 0, space: 0, right: 0, left: 0, shift: 0, ctrl: 0, lastScancode: 0 },
    events: [], // pending queue; stands in for the BIOS type-ahead buffer, whose address the doc does not give (TODO_BUFFER@0x28429)
    draws: [], // §2 draw rows that fired this pass
    trace: [],
    audioEvents: [],
  };
}

const hex = (n: number | string | null | undefined) => (typeof n === 'number' ? `0x${n.toString(16)}` : String(n));
const addrOf = (key: string | null | undefined) => GLOBALS[key as string].addr;
// A global that the save image covers (DS:0x00AD..0x4653, state.ts BLOB_LENGTH @0x2cf66) has a
// real boot value even before any documented writer runs, so `undefined` must fall through to the
// blob rather than read as clear. Globals above the bound keep the old behaviour.
const rd = (st: EngineState, key: string) => {
  const a = addrOf(key);
  if (st.g[a] !== undefined) return st.g[a] as number;
  const ds = a - 0x10000;
  if (st.sv && ds >= 0x00ad && ds < 0x4654) {
    const byte = (st.sv as { byteAt?: (ds: number) => number }).byteAt;
    return byte ? byte.call(st.sv, ds) : rdWord(st, a) & 0xff;
  }
  return 0; // undefined = no documented site has written it and the blob does not cover it
};
/** Read a DS global by plain DS offset (script.ts's convention) through the same two-tier lookup
 *  rd() uses: the sparse mirror first, then the save image for DS:0x00AD..0x4653. */
const rdDs = (st: EngineState, ds: number) => {
  const a = 0x10000 + ds;
  if (st.g[a] !== undefined) return st.g[a] as number;
  return rdWord(st, a, true) & 0xffff;
};
const wrDs = (st: EngineState, ds: number, value: number, cite: number) => {
  st.g[0x10000 + ds] = value;
  st.trace.push(`${hex(0x10000 + ds)}=${hex(value)} @${hex(cite)}`);
};

const wr = (st: EngineState, key: string, value: number, cite: any) => {
  const global = GLOBALS[key];
  const a = global.addr;
  const ds = a - 0x10000;
  const stored = global.width === 2 ? value & 0xffff : value & 0xff;
  if (st.sv && ds >= 0x00ad && ds < 0x4654) {
    if (global.width === 2) (st.sv as State).wordAt(ds, stored);
    else (st.sv as State).byteAt(ds, stored);
  }
  st.g[a] = stored;
  st.trace.push(`${hex(a)}=${hex(stored)} @${hex(cite)}`);
};
/** Write one persisted byte to the real state image and retain the sparse mirror used by the
 *  disassembly-facing trace layer.  Combat and saving read the blob, so panel selections cannot
 *  live only in `g`. */
const wrBlobByte = (st: EngineState, ds: number, value: number, cite: number) => {
  const byte = value & 0xff;
  if (st.sv) (st.sv as State).byteAt(ds, byte);
  st.g[0x10000 + ds] = byte;
  st.trace.push(`${hex(0x10000 + ds)}=${hex(byte)} @${hex(cite)} (save image)`);
};
const note = (st: EngineState, text: string) => st.trace.push(text);
// `mode` is a plain property in this file, but STATE_GLOBAL puts the real cell
// at DS:0x13c91 (glo_19712). Keep the two in step so the doc's own words
// (`st.mode`) and anything reading the global see the same value.
const getMode = (st: EngineState) => st.mode;
const setMode = (st: EngineState, v: number) => { st.mode = v; wr(st, 'mode', v, 'mode transition'); };
const fired = (st: EngineState, callee: number | number[], site: number) => {
  st.draws.push({ callee, site });
  st.trace.push(`draw ${Array.isArray(callee) ? callee.map(hex).join('+') : hex(callee)} @${hex(site)}`);
};

// --- port-side input adapter ------------------------------------------------------
// main.js feeds `key:<KeyboardEvent.key>` / `pointer:<x>,<y>` labels, and `keyup:<key>` for the
// INT 9 break codes. Each row cites the address that gives the key its meaning; `code` is the
// INT 16h AL a handler would see (documented only where the doc labels an arm with a character)
// and `scancode` the INT 9 make code. Keys with no documented row cannot be interpreted yet.
// Which byte the handlers compare. The pump loads it at 0x24372 `mov al, byte ptr cs:[0x42]` and
// reaches the four handlers at 0x23c1f..0x23c53 without touching AL again on the paths that do not
// `jmp 0x23dd9` (0x243aa `push ax` / 0x243af `pop ax` bracket a call, and the three exits at
// 0x243ed, 0x243fb and 0x244ef leave the latch value in place). cs:[0x42] is written by the game's
// own INT 9 handler at 0x23dce from the value it compared against make/break pairs 0x39/0xb9
// (space), 0x3b/0xbb (F1), 0x1d/0x9d (LCtrl), 0x38/0xb8 (LAlt) - raw set-1 scan codes. So the byte
// every cmp chain tests is a MAKE CODE, not ASCII: 0x1e/0x11/0x12 are the a/w/e keys, 0x13..0x1a
// are the top row r t y u i o p [ and 0x21..0x28 the home row f g h j k l ; ' (the two 8-key sets
// of the crew-stat allocator @0x29997), 0x0c/0x0d are '-' and '=', 0x3c/0x3d/0x44 are F2/F3/F10,
// and 0x01 is Escape. re/event-codes.md CORRECTION 3.
//
// A second, unrelated reader does exist at 0x28427/0x28430 (`int 16h` ah=1 then ah=0) and there AL
// really is ASCII with extended keys arriving as AL=0/AH=make (0x2843c `cmp ah,0x48` = Up). That
// routine is a dialog/menu poll - it also consumes the wheel counters [0x455a]/[0x455c] and treats
// 0x0d as Enter - and it is not what feeds FUN_231e_b509 and friends.
const SC = (name: string, code: number, cite: number, extra: Record<string, unknown> = {}) =>
  ({ code, cite, label: name, ...extra });

const INPUT_KEYS: Record<string, { scancode?: number; code?: number; cite?: number | string; flags?: Record<string, number>; todo?: string; [k: string]: any }> = {
  // --- mode switches, state 1 (FUN_231e_b509 @0x2e6e9) ---
  a: SC('a', 0x1e, 0x2e6ef, { to: 3 }),
  w: SC('w', 0x11, 0x2e705, { to: 4 }),
  e: SC('e', 0x12, 0x2e722, { to: 2 }),
  s: SC('s', 0x1f, 0x2e70e, { call: 0x2cd1c }), // FUN_231e_a01c, the zone/planet routine
  Escape: SC('Escape', 0x01, 0x2e741, { call: 0x2cba2 }), // also the documented way out of states 2..4
  F1: SC('F1', 0x3b, 0x2e737, { call: 0x2cba2 }), // the same code the pump injects @0x244ae
  // --- state 1's remaining arms, keyed by the set-1 make code of each glyph ---
  // (the old rows here took 0x31/0x32/0x35 as the digit keys "1"/"2"/"5": those are the ASCII
  //  values, and re/event-codes.md settled that the handlers compare make codes, where 0x31/0x32
  //  are the letters n/m and 0x35 is the slash. The digits live at 0x02..0x0b.)
  '/': SC('/', 0x35, 0x2e72d, { call: 0x2d8bf }),
  n: SC('n', 0x31, 0x2e75b),                     // xor DS:0x13ade, which also gates the four digit arms @0x2e885
  m: SC('m', 0x32, 0x2e76c, { call: 0x26c61 }),
  '1': SC('1', 0x02, 0x2e88f),                   // the cursor movers, all gated on DS:0x13ade == 1
  '2': SC('2', 0x03, 0x2e8cb),                   // DS:0x13c94 page cycle + the 0x2c5d9 / 0x2c646 pair
  '3': SC('3', 0x04, 0x2e8fa),                   // tableSelB over DS:0x1359b (closes TODO_KEYMAP@0x2e76c)
  '4': SC('4', 0x05, 0x2e94a),                   // memberSel over DS:0x135af
  '5': SC('5', 0x06, 0x2e986, { todo: 'TODO_EVENT_CODE@0x06: no arm in FUN_231e_b509 compares 0x06 (the whole chain @0x2e6e9..@0x2e986 is dumped), so state 1 consumes nothing; state 2\'s 1..8 crew picker does' }),
  '6': SC('6', 0x07, 0x2e986), '7': SC('7', 0x08, 0x2e986), '8': SC('8', 0x09, 0x2e986),
  '9': SC('9', 0x0a, 0x2e986), '0': SC('0', 0x0b, 0x2e986),
  F2: SC('F2', 0x3c, 0x2e778, { call: 0x2bb5a }), // and the first half of the cheat latch @0x23c62
  F3: SC('F3', 0x3d, 0x2e789, { call: 0x2ba64 }),
  F9: SC('F9', SCANKODE_TWO, 0x23c79), // no arm compares 0x43; it exists because the loop body pairs it with F2 to arm DS:0x13be6
  F10: SC('F10', 0x44, 0x2e79a),                 // the DS:0x13c95 debug word, gated on DS:0x13be6
  z: SC('z', 0x2c, 0x2e7ab),                     // the difficulty/gatherer stepper up
  x: SC('x', 0x2d, 0x2e7ee),                     // ... and back (@0x2e7f9 dec DS:0x13572)
  c: SC('c', 0x2e, 0x2e753, { call: 0x2cf6d }),
  d: SC('d', 0x20, 0x2e983, { call: 0x2e987 }),  // the next-script-event walk over [di+0x3bf5]
  '-': SC('-', 0x0c, 0x2ebe9),                   // state 3: page back, wrapping up to the count
  '=': SC('=', 0x0d, 0x2ebc3),                   // state 3: page forward, wrapping to 1
  t: SC('t', 0x14, 0x2ec12, { call: 0x2ec35 }),  // state 3 pagers; also a crew-stat spend key
  u: SC('u', 0x16, 0x2ec23, { call: 0x2ed2b }),
  ' ': SC('Space', 0x39, 0x243b0, { flags: { space: 1 } }), // the pump's own scroll test; INT 9 arms cs:[0x3f] @0x23d4c
  // --- the crew-stat allocator, FUN_231e_67b7 @0x29997, reached from state 1 (@0x2e6fa) and
  // --- state 2 (@0x2ea87): top row spends an AP into stat i, home row takes one back ---
  ...Object.fromEntries('rtyuiop['.split('').map((ch, i) => [ch, SC(ch, 0x13 + i, 0x299a0 + i * 0x15, { stat: i, dir: +1 })])),
  ...Object.fromEntries('fghjkli;\''.split('').slice(0, 0).concat(['f', 'g', 'h', 'j', 'k', 'l', ';', "'"]).map((ch, i) => [ch, SC(ch, 0x21 + i, 0x29a20 + i * 0x12, { stat: i, dir: -1 })])),
  // --- extended keys: arrows set the INT 9 flags and reach the handlers as their make codes ---
  ArrowUp: SC('ArrowUp', 0x48, 0x23cb0, { flags: { up: 1 } }),
  ArrowDown: SC('ArrowDown', 0x50, 0x23cd6, { flags: { down: 1 } }),
  ArrowRight: SC('ArrowRight', 0x4d, 0x23cf6, { flags: { right: 1 } }),
  ArrowLeft: SC('ArrowLeft', 0x4b, 0x23d16, { flags: { left: 1 } }),
  Control: { code: undefined, scancode: 0x1d, cite: 0x23d9e, todo: 'TODO_CONSUMER@0x13224: no reader of cs:[0x44] is quoted' },
  Shift: { code: undefined, scancode: 0x2a, cite: 0x23db8, todo: 'TODO_CONSUMER@0x13223: no reader of cs:[0x43] is quoted' },
  Tab: { code: 0x0f, cite: 'TODO_EVENT_CODE@0x23dd6: Tab (make 0x0f) matches no arm in any of the four handlers' },
};


// One pre-loop state, mirroring the bytes at 0x23c08..0x23c17 and the flag semantics of the ISR.
function toRecord(input: any): InputRec {
  // Non-strings are already records (advance() re-normalises its own queue, and a caller may
  // inject { code: 0x1e } to exercise an arm whose key binding the doc does not give).
  if (typeof input !== 'string') return { label: 'event', kind: 'injected', scancode: undefined, code: null, ...input };
  const pointer = input.startsWith('pointer:');
  if (pointer) return { label: input, kind: 'pointer', code: null, cite: 0x2ee69 };
  const up = input.startsWith('keyup:');
  if (!up && !input.startsWith('key:')) return { label: input, kind: 'unknown', code: null, todo: `TODO_INPUT@0x23dd6: unrecognised port label "${input}"` };
  const name = input.slice(up ? 6 : 4);
  const row = INPUT_KEYS[name] ?? INPUT_KEYS[name.toUpperCase()] ?? INPUT_KEYS[name.toLowerCase()];
  if (!row) return { label: input, kind: 'key', name, code: null, scancode: undefined, todo: `TODO_EVENT_CODE@0x28432: neither an int 9 scancode nor an int 16h AL is documented for "${name}"` };
  const make = row.scancode ?? row.code; // the latch holds the make code, extended keys included
  return {
    label: input, kind: 'key', name,
    // cs:[0x42] holds the make code, so the same byte is both the INT 9 flag key and the value the
    // handler chain compares; a keyup is the break code, make | 0x80 (@0x23cc7 clears on 0xc8).
    scancode: up ? (make === undefined ? undefined : make | 0x80) : make,
    code: up ? null : make,
    cite: row.cite,
    todo: row.todo,
  };
}

// INT 9, linear 0x23c97..0x23dd5: the arm writes its flags, then 0x23dce latches cs:[0x42].
export interface InputRec {
  label: string; kind: 'key' | 'keyup' | 'pointer' | 'injected' | 'unknown';
  name?: string; scancode?: number | undefined; code?: number | null;
  cite?: number | string; todo?: string; [k: string]: any;
}
function int9(st: EngineState, rec: InputRec) {
  if (rec.scancode === undefined) return;
  const arm = INT9_ARMS.find((a: Int9Arm) => a.scancode === rec.scancode);
  if (!arm) {
    // The doc's table has one row for everything else: "anything -> 0x23dce mov cs:[0x42],al".
    note(st, `int9 ${hex(rec.scancode)}: no flag arm in the doc's scancode table, only the latch below (@0x23dce)`);
  } else {
    for (const [flag, value] of Object.entries(arm.flags)) {
      st.held[flag] = value;
      note(st, `int9 ${hex(arm.scancode)} -> ${flag}@${hex(INT9_FLAGS[flag])}=${value} @${typeof arm.cite === 'number' ? hex(arm.cite) : arm.cite}`);
    }
  }
  st.held.lastScancode = rec.scancode;
  note(st, `latch cs:[0x42]=${hex(rec.scancode)} @0x23dce`);
}

// FUN_231e_bc89 @0x2ee69 reads INT 33h AX=3, halves the driver's 0..638 X coordinate and routes
// a left-button edge to the active panel handler.  These hit boxes are the compares in
// FUN_231e_69f6 (engineering), FUN_231e_b2b2 (weapons) and FUN_231e_b413 (cargo).
function handlePanelPointer(st: EngineState, rec: InputRec) {
  const match = /^pointer:(\d+),(\d+)$/.exec(rec.label);
  if (!match) { note(st, `malformed pointer record ${JSON.stringify(rec.label)}`); return; }
  const x = Math.floor(Number(match[1]) / 2);
  const y = Number(match[2]);
  const mode = getMode(st);
  note(st, `FUN_231e_bc89@0x2ee69: left click raw (${match[1]},${match[2]}) -> panel (${x},${y}), mode ${mode}`);

  // Every panel's BACK stone occupies the same rectangle.
  if (mode !== 1 && x >= 231 && x <= 243 && y >= 72 && y <= 83) {
    setMode(st, 1);
    fired(st, CALLEES.blit, 0x2b04d);
    note(st, 'panel BACK -> mode 1');
    return;
  }

  if (mode === 2) {
    const index = Math.max(0, Math.ceil((x - 247) / 9));
    if (x >= 238 && x <= 310 && index >= 0 && index < CREW_STATS.length) {
      if (y >= 83 && y <= 108) {
        fun_231e_67b7(st, 0x13 + index, 0x29bd6);
        return;
      }
      if (y >= 113 && y <= 138) {
        fun_231e_67b7(st, 0x21 + index, 0x29c91);
        return;
      }
    }
  }

  if (mode === 4) {
    // Each inclusive 15-pixel cell advances by 14, so shared edge pixels belong to the earlier
    // cell (the loop tests before subtracting CX).
    const col = Math.max(0, Math.ceil((x - 251) / 14));
    if (x >= 237 && x <= 307 && col >= 0 && col < 5) {
      let table: 'tableA' | 'tableB' | null = null;
      let index = -1;
      if (y >= 98 && y <= 122) {
        table = 'tableA'; index = col + (y > 110 ? 5 : 0);
      } else if (y >= 144 && y <= 168) {
        table = 'tableB'; index = col + (y > 156 ? 5 : 0);
      }
      if (table && index >= 0) {
        const arm = STATE4_ARMS.find((a) => a.code === table)!;
        const available = rdWord(st, arm.table.pres + index * 2, true) !== 0;
        if (available) selectWeaponTable(st, table, index, arm);
        else note(st, `${table === 'tableA' ? 'pulse' : 'missile'} bank ${index + 1} is unavailable`);
        return;
      }
    }
  }

  if (mode === 3 && y >= 89 && y <= 115 && st.sv) {
    const direction = x >= 237 && x <= 251 ? 1 : x >= 301 && x <= 314 ? -1 : 0;
    if (direction !== 0) {
      const sv = st.sv as State;
      const count = sv.wordAt(0x3c56);
      if (count > 0) {
        let page = sv.wordAt(0x3c8e) || 1;
        page += direction;
        if (page > count) page = 1;
        if (page < 1) page = count;
        sv.wordAt(0x3c8e, page);
        st.g[0x13c8e] = page;
        fired(st, CALLEES.blit, direction > 0 ? 0x2ec9c : 0x2ece9);
        note(st, `cargo pointer ${direction > 0 ? 'forward' : 'back'} -> page ${page}/${count}`);
        return;
      }
    }
  }
  if (mode === 3 && x >= 229) {
    if (y >= 142 && y <= 152) { runCargoAction(st, 'use', 0x2e6b6); return; }
    if (y > 152 && y <= 162) { runCargoAction(st, 'transport', 0x2e6ce); return; }
  }
  note(st, `panel click (${x},${y}) has no control in mode ${mode}`);
}

// --- the pump, FUN_231e_0bf6 @0x23dd6 (called @0x23c1c, one iteration per pass) ----
function pump(st: EngineState) {
  note(st, `pump@${hex(INPUT_PUMP)}: the PIT ch2 frame clock at 0x23dd9..0x23dfc (count 0x7918, out 0x61,1) is not modelled — this port steps one pass per input event, so no pass is paced`);
  fired(st, CALLEES.frameTick, 0x23dfe);
  note(st, 'FUN_231e_42e4@0x274c4: the transient executable-defined backdrop is advanced at the presentation seam after this pump pass');

  // @0x23fd4: signed hull <= 0 enters the BH_EXPL destruction scheduler and jumps directly back
  // to the PIT wait. No input, flight, projectile, enemy, or mode-handler work occurs on this pass.
  if (st.sv) {
    const death = stepPlayerDeath(st.sv as State);
    if (death) {
      st.playerDeath = death;
      if (death.counter === 1) (st.audioEvents ||= []).push(6); // mov ax,6 + FUN_231e_2ec9 @0x2adc6
      if (death.done) {
        st.mode = 1;
        st.g[STATE_GLOBAL] = 1; // @0x23f50, on the pass after DS:0x457b reaches 2
      }
      note(st, `FUN_231e_7bcc@0x2adac: player destruction pass ${death.counter}, ` +
        `${death.frame === null ? 'ship erased' : `BH_EXPL frame ${death.frame}`}, phase ${death.phase}`);
      return { code: null, repump: true };
    }
    st.playerDeath = null;
  }

  // @0x2408f cooldown, then FUN_231e_91ed @0x2c3cd. DS:0x5bbe is rebuilt from the Ctrl ISR
  // latch and cs:[0x44] is cleared at @0x243a3, making one physical Ctrl make one launch attempt.
  if (st.sv && st.exe) {
    tickWeaponCooldown(st.sv as State);
    const shot = launchPlayerProjectile(st.sv as State, st.exe as Uint8Array, st.held.ctrl === 1);
    if (shot.fired) (st.audioEvents ||= []).push(3);             // mov al,3 + FUN_231e_2ec9 @0x2c5b0
    if (st.held.ctrl === 1) {
      note(st, shot.fired
        ? `FUN_231e_91ed@0x2c3cd: weapon ${shot.weapon} launched in slot ${shot.slot}, ammo ${shot.ammo}`
        : `FUN_231e_91ed@0x2c3cd: Ctrl launch rejected by ${shot.reason}`);
    }
    st.held.ctrl = 0;                                                    // @0x243a3
    const projectiles = updateProjectiles(st.sv as State, st.exe as Uint8Array);
    if (projectiles.active || projectiles.expired || projectiles.hits.length || projectiles.playerHits.length) {
      note(st, `FUN_231e_4dc7@0x27fa7: ${projectiles.moved}/${projectiles.active} projectile slots advanced, ${projectiles.expired} expired`);
      for (const hit of projectiles.hits) {
        (st.audioEvents ||= []).push(4);                         // collision impact path @0x291175
        note(st, `FUN_231e_420f@0x273ef: projectile ${hit.slot + 1} hit hostile object ${hit.objectCode}, ${hit.hullDamage} hull damage after shields`);
      }
      for (const hit of projectiles.playerHits) {
        (st.audioEvents ||= []).push(4);
        note(st, `FUN_231e_62b1@0x29491: hostile projectile ${hit.slot + 1} hit player shield ${hit.shield}, ${hit.shieldDamage} shield/${hit.hullDamage} hull damage`);
      }
    }
    const enemies = updateEnemies(st.sv as State, st.exe as Uint8Array);
    for (let i = 0; i < enemies.fired; i++) (st.audioEvents ||= []).push(3);
    if (enemies.considered) {
      note(st, `FUN_231e_bdc8@0x2efa8: ${enemies.considered} nearby ships, ${enemies.activated} activated, ${enemies.steered} steered, ${enemies.moved} moved, ${enemies.fired} fired`);
    }

    // @0x23e94 FUN_231e_aa7d periodically arms the incoming-hail indicator from the first
    // visible object's mutable data record. The renderer's previous pass is the browser-side
    // equivalent of DS:0x3bf3/0x3bf5 at this point in the DOS pump.
    const visible = Array.isArray(st.visibleActors) ? st.visibleActors as number[] : [];
    if (updateHailTarget(st.sv as State, st.exe as Uint8Array, visible)) {
      note(st, `FUN_231e_aa7d@${hex(OPENING_STORY.sites.hailTarget)}: visible object armed DS:0x3c45 incoming-hail indicator`);
    }

    // @0x23f28: the opening-story scheduler is a per-pass call, gated only by DS:0x3be9.
    const story = stepOpeningStory(st.sv as State, st.exe as Uint8Array);
    for (const msg of story.messages) {
      (st.scriptLog ||= []).push({ site: msg.site, text: msg.text, msgDs: msg.ds });
      note(st, `FUN_231e_7ad6@${hex(OPENING_STORY.sites.scheduler)}: counter ${story.counter} -> ${JSON.stringify(msg.text)}`);
    }
    if (story.spawned) note(st, `FUN_231e_7ad6: actor #160 DS:0xbf8 uncloaked at camera X+0x50 (UNKNOWN, conversation 3)`);
    if (story.departed) note(st, `FUN_231e_7ad6: actor #160 left the sector; mutable ship record DS:0x1478 now conversation 15`);

    // @0x23f67: every seventh pass calls FUN_231e_ab0a and re-derives the stat pool.
    if (tickStatPool(st)) {
      const hail = stepIncomingHail(st.sv as State, st.exe as Uint8Array, visible, st.g);
      if (hail) {
        (st.scriptLog ||= []).push({ site: hail.site, text: hail.text, msgDs: hail.ds });
        note(st, `FUN_231e_ab0a@${hex(OPENING_STORY.sites.hailPulse)}: ${JSON.stringify(hail.text)}`);
      }
    }
  }

  // 0x23e03..0x23e20 — the only input-gatherer selection in the pump.
  const level = rd(st, 'gathererSelect');
  if (level !== 0) {
    note(st, level === 1 ? TODO_GATHERERS.level1 : TODO_GATHERERS.level2plus);
    return { code: null, repump: false };
  }
  // The mouse path is independent of the BIOS keyboard buffer. Consume one button edge per pass,
  // just as FUN_231e_bc89 does, then allow the normal flight integrator and keyboard poll to run.
  const pointerIndex = st.events.findIndex((e: any) => e.kind === 'pointer');
  if (pointerIndex >= 0) handlePanelPointer(st, st.events.splice(pointerIndex, 1)[0] as InputRec);
  // FUN_231e_4b35 @0x27d15: int 16h ah=1 poll @0x28429, and only if a key is pending the
  // ah=0 get @0x28432 consumes it — one event code per pass.
  const i = st.events.findIndex((e: PumpEvent) => codeOf(e) !== null);
  const rec = i < 0 ? null : st.events.splice(i, 1)[0];

  // @0x24199..@0x2433f — the position integrator runs BEFORE the control arms, so the ship moves
  // with the velocity computed on an earlier pass and only then does Space/Up/Down/Left/Right adjust
  // it. FUN_231e_02dd @0x234bd turns DS:0x3c92 heading + DS:0x3c98 speed into the sub-pixel deltas at
  // DS:0x3e39/0x3e37 (256-amplitude cos/sin tables at DS:0x3e3f/0x3e7f, 32 steps of 11.25 degrees);
  // these accumulate into DS:0x3ec5/0x3ec7 and cross a 128-unit threshold, the five camera bytes per
  // axis (LSB DS:0x3d6/0x3d7, carrying down to DS:0x3ce/0x3cf) step by whole pixels. web/src/engine/
  // flight.ts transcribes all of it. See re/flight-model.md.
  if (st.sv) integrate(st.sv as State);

  // @0x243b0..@0x244b6 — brake, turn, thrust. Turning falls through to the thrust tests (@0x24438);
  // every arm that changes speed ends the pass with `lcall 0x131e,0x2dd / jmp 0x23dd9`, so the mode
  // handler sees nothing on that pass. This is the block the session-9 notes logged as
  // TODO_SCROLL_LEFT@0x24446: it is not scrolling, it is the flight controls, and DS:0x3c98 is the
  // ship's speed, not a map offset.
  if (st.sv && stepFlight(st.sv as State, codeOf(rec) ?? 0, st.held as HeldFlags) === 'ended') {
    fired(st, CALLEES.scroll, 0x2448c);
    note(st, `repump@${hex(PUMP_REPUMP)} @0x24491: the flight arm (brake/thrust) changed DS:0x13c98 speed, so the pump restarts its wait cycle and the mode handler is not called this pass`);
    if (rec) note(st, `event ${hex(codeOf(rec)!)} was taken by int 16h ah=0 @0x28432 but never returned`);
    return { code: null, repump: true };
  }

  // 0x23e9e..0x23f07 — countdown timers: when DS:0x13c16 reaches 0 with sound on and mode == 1
  // the pump re-inits sound. Not reachable here: no frame clock, and no decrement site quoted.
  note(st, 'TODO_TIMERS@0x23e9e: DS:0x13c16 / DS:0x13c18 countdowns and the mode==1 sound re-init at 0x23eb9 (callee FUN_231e_3708 @0x268e8) need the frame clock this port does not run; decrement sites are not documented');
  return { code: rec ? codeOf(rec) : null, repump: false };
}

// 0x244b7..0x2450a — the pump epilogue: mode-2 back door, then the ASCII filter that decides
// whether a handler sees the event at all.
function epilogue(st: EngineState, code: number | null) {
  if (code === null || code === undefined) return null; // the gatherer was still waiting: no AL
  if (getMode(st) === 2) { // 0x244b7 `cmp byte ptr [0x3c91],2`
    if (rd(st, 'backdoorLatch') !== 1) { // 0x244be
      if (code === 0x44) wr(st, 'backdoorLatch', 1, 0x244c9); // 0x244c5 `cmp al,0x44`
    } else if (code === 0x41) { // 0x244d1 `cmp al,0x41`
      wr(st, 'cheatGate', 1, 0x244d5);
      wr(st, 'word_3c5c', 0x2bc, 0x244da);
      wr(st, 'slot_359b', 0x32, 0x244e3); // di = 0 @0x244e0
      wr(st, 'slot_35a1', 0x14, 0x244e9);
      note(st, 'mode-2 back door: DS:0x13be6 + DS:0x13c5c + scheduler slots primed (0x244d5..0x244e9)');
    }
  }
  if (code > 0x7f) { // 0x244ef `cmp al,0x7f / jbe 0x244fb`
    wr(st, 'asciiLatch', 0, 0x244f3);
    note(st, `repump@${hex(PUMP_REPUMP)}: event ${hex(code)} > 0x7f is a raw scancode, so no handler sees it (0x244f8 jumps back into the wait)`);
    return { repump: true };
  }
  wr(st, 'asciiLatch', 1, 0x24502);
  return { repump: false }; // 0x24507 pop dx/cx/bx; ret @0x2450a -> 0x23c1f with AL = code
}

// --- the dispatch chain 0x23c1f..0x23c60 ------------------------------------------
function dispatch(st: EngineState, code: number) {
  const mv = getMode(st) as number | undefined;
  const row = mv === undefined ? null : STATE_VALUES[mv];
  if (row === undefined) {
    note(st, `TODO_MODE_${mv}@0x23c1f: undocumented mode value — all five compares fail -> 0x23c62`);
    return;
  }
  if (row === null || row.handlerAddr === null) {
    note(st, `mode=${mv === undefined ? 'TODO_BOOT(0x13c91)' : mv}: no handler at ${hex(row ? row.dispatchSite : 0x23c60)} -> 0x23c62; ${row ? row.input : 'the chain fell through all five compares'}`);
    return;
  }
  if (!row.arms) {
    note(st, `mode=${row.mode} cmp@${hex(row.cmpAddr)} lcall ${row.farTarget} -> ${hex(row.handlerAddr)} (${row.name}): ${row.armsTodo}`);
    return;
  }
  note(st, `mode=${row.mode} cmp@${hex(row.cmpAddr)} lcall ${row.farTarget} -> ${hex(row.handlerAddr)} (${row.name}) with AL=${hex(code)}`);

  // The pre-arm sink is state-1-specific: `lcall 0x131e,0x67b7` @0x2e6fa runs before the second
  // compare of FUN_231e_b509 only. State 2 reaches the same callee at its own tail (0x2ea87, a
  // fall-through row), and states 3/4 never call it.
  if (row.mode === 1 && code !== 0x1e) {
    code = fun_231e_67b7(st, code, 0x2e6fa); // returns AX unchanged, so the chain below still sees it
  }
  const arm = matchArm(st, row.arms, code, row.handlerAddr as number);
  if (!arm && code === 0x2c && row.mode === 1) return runZStepper(st, row);
  if (!arm) {
    note(st, `no arm matched event ${hex(code)} in ${hex(row.handlerAddr)}; first-match chain exits to the retf @${hex(row.retAddr ?? 0x2e986)}`);
    return;
  }
  // FUN_231e_b8ad's two indexed arms need the matched table index, which cannot be represented by
  // the generic constant-write rows below.  The first table selects a pulse bank and cycles its
  // 1..3 power when selected again; the second selects a missile bank.  Both fields are persisted
  // because FUN_231e_91ed reads DS:0x3c4c directly when Ctrl fires.
  if (row.mode === 4 && arm.table && Number.isInteger(arm.matchIndex)) {
    if (rd(st, 'asciiLatch') !== 1) {
      note(st, `weapon table match ignored: ASCII latch DS:0x5bb8 is not set @${hex(arm.gate?.site)}`);
      return;
    }
    selectWeaponTable(st, arm.code as 'tableA' | 'tableB', arm.matchIndex as number, arm);
    return;
  }
  if (arm.todo) {
    // A fall-through row can carry both documented calls and a TODO for what re/ has not read yet.
    // State 2's tail is exactly that: `lcall FUN_231e_67b7` @0x2ea87 runs, and the TODO only says
    // the callee's AL-preservation is unverified for codes outside 1..8. Running the calls first
    // keeps the row honest instead of letting the TODO swallow real work.
    code = runCalls(st, arm, code);
    note(st, arm.todo);
    return;
  }
  if (arm.gate) {
    let hit = true;
    let why = '';
    if (arm.gate.g !== undefined) {
      const value = rd(st, arm.gate.g as string);
      hit = arm.gate.invert ? value !== arm.gate.eq : value === arm.gate.eq; // 0x2e79e `cmp [0x3be6],0 / je`
      why = `gate ${hex(addrOf(arm.gate.g as string))}=${hex(value)} @${hex(arm.gate.site as number)}`;
    } else if (arm.gate.table !== undefined) {
      // 0x2ea2a `cmp word ptr [bx+0x35af],0 / je` — presence of the picked member, straight out of
      // the state blob. With no blob attached the port cannot answer and says so.
      const w = rdWord(st, arm.gate.table);
      hit = w !== 0;
      why = `presence [${hex(arm.gate.table)}+${arm.gate.index * 2}]=${hex(w)} @${hex(arm.gate.site as number)}`;
      if (!hit) why += ` (${arm.gate.reason})`;
    }
    if (arm.gate.andWord !== undefined) {
      const w = rdWord(st, arm.gate.andWord.addr);
      hit = hit && (arm.gate.andWord.nonzero ? w !== 0 : w === arm.gate.andWord.value);
      why += ` && [${hex(arm.gate.andWord.addr)}]=${hex(w)} @${hex(arm.gate.andWord.site)}`;
    }
    note(st, `${why} -> ${hit ? 'arm runs' : 'arm skipped'}`);
    if (!hit) return;
  }
  for (const t of arm.toggles || []) {
    const value = rd(st, t.g as string) ^ 1;
    wr(st, t.g, value, t.site); // 0x2e75f `xor byte ptr [0x3ade],1`; BH_START.DAT seeds DS:0x3ade = 0
    note(st, `xor ${hex(addrOf(t.g))} @${hex(t.site)} -> ${hex(value)}`);
  }
  for (const w of arm.writes || []) {
    if (w.op === 'inc' || w.op === 'dec') { // 0x2ebd5 / 0x2ebfd `inc|dec word ptr [0x3c8e]`
      const a = addrOf(w.g);
      const cur = st.g[a] !== undefined ? (st.g[a] as number) : rdWord(st, a);
      let v = (cur + (w.op === 'inc' ? 1 : -1)) & 0xffff;
      const count = rdWord(st, 0x13c56); // DS:0x13c56 bounds the pager at both ends (@0x2ebdc, @0x2ec04)
      const wrapped = count > 0 && (v === 0 || v > count);
      if (wrapped) v = w.op === 'inc' ? 1 : count; // @0x2ebe5 mov 1 / @0x2ec09 mov ax,[0x3c56]
      wr(st, w.g, v, w.site);
      note(st, `${w.op} ${hex(a)} @${hex(w.site)}${wrapped ? ` then the wrap store @${hex(w.wrapSite)}` : ''} -> ${hex(v)} (pageCount=${hex(count)})`);
    } else if (w.op === 'cycle1_4') { // 0x2eb0c..@0x2eb1f: the 4-reset is inside the equality branch, modeled below
      const a = addrOf(w.g);
      const v = ((st.g[a] ?? 0) + 1) > 4 ? 1 : (st.g[a] ?? 1);
      wr(st, w.g, v, w.site);
      note(st, `cycle ${hex(a)} @${hex(w.site)} -> ${hex(v)}`);
    } else if (w.g !== undefined && w.value !== undefined) wr(st, w.g, w.value, w.site);
    else note(st, `write @${hex(w.site)}: ${JSON.stringify(w)} — the port models value/inc/dec/cycle writes only`);
  }
  code = runCalls(st, arm, code);
  if (arm.gathererStep) gathererStep(st, arm.gathererStep);
  if (arm.cursorScan) cursorScan(st, arm.cursorScan);
  if (arm.pageCycle) cyclePage(st, arm.pageCycle);
  if (arm.scrollStep) scrollStep(st, arm.scrollStep);
  if (arm.to !== undefined) {
    setMode(st, arm.to);
    note(st, `mode -> ${arm.to} (${hex(STATE_VALUES[arm.to as number].handlerAddr)} = ${STATE_VALUES[arm.to as number].name}) written @${hex(arm.modeWrite)}, effective next pass`);
  }
  for (const d of arm.draws || []) fired(st, d.callee as number, d.site as number);
  if (arm.note) note(st, `${hex(arm.cite)}: ${arm.note}`);
}

/** Indexed body of FUN_231e_b8ad @0x2ea8d after one of its EXE key tables matches. */
function selectWeaponTable(st: EngineState, table: 'tableA' | 'tableB', index: number, arm: EventArm) {
  const sv = st.sv as State | undefined;
  if (!sv) {
    note(st, `weapon ${table} entry ${index} cannot update without the save image`);
    return;
  }
  const selected = index + 1;
  if (table === 'tableA') {
    const previous = sv.byteAt(0x3c4b);
    let power = 1;
    if (selected === previous) {
      power = sv.byteAt(0x3c94) + 1;
      if (power >= 4) power = 1;
    }
    // @0x2eaed clears the old indicator, @0x2eafb highlights the new bank and @0x2eb24
    // redraws its power marker.  Keep those draw calls observable while the browser status layer
    // renders the same state from the canonical bytes.
    runCalls(st, arm, 0);
    wrBlobByte(st, 0x3c94, power, 0x2eb0c);
    wrBlobByte(st, 0x3c4b, selected, 0x2eb27);
    note(st, `pulse bank ${selected} selected from DS:0x5b90 entry ${index}; power ${power}${selected === previous ? ' (cycled)' : ' (reset)'}`);
  } else {
    runCalls(st, arm, 0);
    wrBlobByte(st, 0x3c4c, selected, 0x2eb7b);
    note(st, `missile bank ${selected} selected from DS:0x5ba4 entry ${index}; ammo ${sv.wordAt(0x359b + index * 2)}`);
  }
}

// 0x2e7ab..0x2e7e6 — the "z" arm (make 0x2c): the difficulty/level stepper that also picks which gatherer the
// NEXT pump pass calls (DS:0x13572, tested @0x23e03).
/**
 * The visible-object table, rebuilt every pass by FUN_231e_1364 @0x24544 (script.ts §1). The port
 * re-derives it from the actor array the same way rather than caching it, because both runners read
 * `cmp word[0x3bf3],0` fresh at entry (@0x2d464, @0x2d22f).
 */
function visibleNow(st: EngineState): number[] {
  // main.ts installs the addresses produced by the active world renderer. The
  // DOS build stores the same addresses in DS:0x3bf5 @0x246d2. Prefer that
  // frame-local table when present so scan/conversation target what is drawn.
  if (Array.isArray(st.visibleActors)) return st.visibleActors as number[];
  const sv = st.sv as { byteAt?: (ds: number) => number } | undefined;
  if (!sv || !sv.byteAt) { note(st, `TODO_MEMORY@${hex(RUNNER.converseEmpty)}: no state blob, so the actor array at DS:0x3d8 cannot be collected`); return []; }
  return collectVisible(sv as any);
}

/** One resolved object -> the lines the original would have printed, via FUN_231e_8bdc / 0x31f1. */
function describeObject(st: EngineState, table: 'ships' | 'stars', n: number, site: number): string | null {
  const exe = st.exe as Uint8Array | undefined;
  if (!exe) { note(st, `TODO_MEMORY@${hex(site)}: the EXE image is not attached, so DS:0x${(table === 'ships' ? TABLES.ships.base : TABLES.stars.base).toString(16)} records cannot be read`); return null; }
  const r = readRecord(exe, table, recordAt(exe, table, n));
  const out = `${r.name}${r.description ? ': ' + r.description : ''}`;
  // No msgDs: the per-entity scan label comes from the transient pointer table at
  // DS:0x5a9d, which nothing in re/ has a producer for (TODO_TABLE_SOURCE@0x15a9d).
  (st.scriptLog ||= []).push({ site, text: out });
  note(st, `@${hex(site)} -> ${table === 'ships' ? 'ship' : 'star'} ${n} @DS:0x${recordAt(exe, table, n).toString(16)} (lcall 0x131e,0x8bdc FUN_231e_8bdc prints it)`);
  return out;
}

// `s` — FUN_231e_a01c @0x2d1fc. Walk the collected entities, resolve each 16-bit object code
// through the 0x500 selector, print the record. Sets the "printed something" flag DS:0x13be5.
function runScanArm(st: EngineState, site: number) {
  const visible = visibleNow(st);
  note(st, `lcall 0x131e,0xa01c @${hex(site)} FUN_231e_a01c: ${visible.length} visible object(s) in DS:0x13bf3`);
  if (!visible.length) {
    // The shipped string is "OBJECT MUST BE ON SCREEN TO SCAN" at DS:0x5949 (re/messages-pool.md).
    note(st, `@${hex(RUNNER.scanEmpty)} count == 0 -> lcall 0x131e,0x32de with DS:0x5949`);
    (st.scriptLog ||= []).push({ site: RUNNER.scanEmpty, text: poolString(st.exe as Uint8Array, MSG.objectMustBeOnScreenToScan), msgDs: MSG.objectMustBeOnScreenToScan });
    return;
  }
  let printed = 0;
  for (const addr of visible) {
    const a = TABLES.actors;
    const sv = st.sv as { byteAt: (ds: number) => number };
    const code = (sv.byteAt(addr + a.scriptLo) << 8) | sv.byteAt(addr + a.scriptHi);
    const ref = classifyObject(code);
    if (!ref) { note(st, `actor DS:0x${addr.toString(16)} code 0 -> \`je\` @${hex(RUNNER.scanShip)}`); continue; }
    if (describeObject(st, ref.kind === 'ship' ? 'ships' : 'stars', ref.number, ref.kind === 'ship' ? RUNNER.scanShip : RUNNER.scanStar)) printed += 1;
  }
  if (printed) st.g[0x13be5] = 1; // `mov word[0x3be5],1` before each print
}

// `c` — FUN_231e_a26d @0x2d44d. Loads BH_CONV.DAT (@0x2d4f5), resolves the object, takes its script
// id, and runs the CONV stream. Its three cutscene entries are gated on DS:0x13baf4/0x13baf5.
function runConverseArm(st: EngineState, site: number) {
  note(st, `lcall 0x131e,0xa26d @${hex(site)} FUN_231e_a26d: re-installs INT 9 from DS:0xb998:0xb99a, loads BH_CONV.DAT @${hex(RUNNER.converseLoadConv)}`);
  const visible = visibleNow(st);
  if (!visible.length) {
    note(st, `@${hex(RUNNER.converseEmpty)} count == 0 -> UNABLE TO COMMUNICATE (lcall 0x131e,0x32de)`);
    (st.scriptLog ||= []).push({ site: RUNNER.converseEmpty, text: poolString(st.exe as Uint8Array, MSG.objectMustVisibleToCommunicate), msgDs: MSG.objectMustVisibleToCommunicate });
    return;
  }
  const conv = st.conv as Uint8Array | undefined;
  const stream = conv ? decodeConv(conv) : null;
  for (const addr of visible) {
    const a = TABLES.actors;
    const sv = st.sv as { byteAt: (ds: number) => number };
    const code = (sv.byteAt(addr + a.scriptLo) << 8) | sv.byteAt(addr + a.scriptHi);
    const ref = classifyObject(code);
    if (!ref) continue;
    const t2 = ref.kind === 'ship' ? 'ships' : 'stars';
    const text = describeObject(st, t2, ref.number, ref.kind === 'ship' ? RUNNER.scanShip : RUNNER.scanStar);
    if (text === null) continue;
    const exe = st.exe as Uint8Array;
    const scriptRecord = recordAt(exe, t2, ref.number);
    // The DOS data segment is writable and part of the save image. Opening-story code changes
    // ship 6's byte +2 from conversation 3 to 15 at @0x2ad86, so the blob—not the immutable
    // host EXE copy—is authoritative for live ship scripts.
    const scriptId = t2 === 'ships' ? sv.byteAt(scriptRecord + 2) : 0;
    if (!stream || scriptId === 0) {
      if (scriptId !== 0) note(st, `CONV: script ${scriptId} requested but BH_CONV.DAT is not attached`);
      continue;
    }
    const vm = createConversationVm(stream, sv, scriptId, st.people as Uint8Array | undefined,
      rdDs(st, 0x3adf) === 1 ? 9 : 15);
    const view = vm.view();
    note(st, `CONV id ${scriptId} node @0x${view.node.toString(16)} (@0x2507b): stage ${view.stage}, ${view.choices.length} visible choice(s), portrait record ${vm.portraitIndex}`);
    logConversationView(st, view);

    // FUN_231e_1e14 is modal. The quest switch at @0x2d53f..@0x2d6f3 and the write which clears
    // the object's script byte run only after it returns, so main.ts invokes finish exactly once
    // when the VM reaches 01 ff or the player chooses END/Escape.
    st.conversation = {
      vm,
      scriptId,
      site,
      scriptByteDs: recordAt(exe, t2, ref.number) + 2,
      finish: () => finishConversation(st, scriptId, site, recordAt(exe, t2, ref.number) + 2),
    };
    // Every branch of the switch lands on @0x2d6f6..@0x2d712 and then `goto LAB_231e_a57a`, i.e. it
    // returns. One conversation per keypress -- the object list is only scanned to *find* one.
    break;
  }
  // The unconditional path also runs the two gates the EXE tests after the switch (@0x2d6c8/@0x2d6eb
  // only fire from ids 4 and 0xb, so a first-ever `c` on any other script shows nothing -- matching
  // the EXE, which needs the right ship present).
}

function logConversationView(st: EngineState, view: VmView) {
  const body = [view.response, view.prompt].filter(Boolean).join('\n\n');
  (st.scriptLog ||= []).push({
    site: RUNNER.converseInterp,
    text: body + (view.choices.length ? '\n' + view.choices.map((c, i) => `${i + 1}. ${c.label}`).join('\n') : ''),
    choices: view.choices,
    stage: view.stage,
    complete: view.complete,
  });
}

/** Complete the caller-side work which follows FUN_231e_1e14's modal return. */
function finishConversation(st: EngineState, scriptId: number, site: number, scriptByteDs: number) {
  const modal = st.conversation as { finished?: boolean } | undefined;
  if (modal?.finished) return;
  if (modal) modal.finished = true;
  const fx = CONV_EFFECTS[scriptId];
  if (fx) {
    for (const [off, val] of fx.writes) wrDs(st, off, val, site);
    note(st, `quest effect id ${scriptId}: ${fx.cite}`);
    if (fx.zone === 1 && incGate(st, ZONE_SEEN.zone1, 1, site)) enterZoneCutscene(st, 1, RUNNER.converseZone1);
    if (fx.zone === 2 && incGate(st, ZONE_SEEN.zone2, 2, site)) enterZoneCutscene(st, 2, RUNNER.converseZone2);
    if (fx.zone === 3) enterZoneCutscene(st, 3, RUNNER.converseZone3 ?? 0x2d5fb);
  }
  // FUN_231e_a592 @0x2d772 is called after every conversation. Its id-3 branch fast-forwards
  // the opening Rigian encounter so the ship cloaks shortly after communication ends.
  if (scriptId === 3 && st.sv) {
    (st.sv as State).wordAt(OPENING_STORY.counter, 0x3b6);
    note(st, 'FUN_231e_a592@0x2d777: conversation 3 -> DS:0x3bea=0x3b6');
  }
  // The same routine's control-slot scan is the campaign director: deferred triggers (0x64..0xfe)
  // left by the VM's effect cascade grant cargo, refill missiles, grow the crew/AP budget and
  // reposition the world. One reward fires per call, exactly as the EXE returns after its first hit.
  if (st.sv) {
    const reward = applyStoryReward(st.sv as State);
    if (reward) {
      note(st, `FUN_231e_a592@0x2d772: deferred trigger 0x${reward.trigger.toString(16)} at slot byte DS:0x${(0x35e1 + reward.slotIndex).toString(16)} — ${reward.note}`);
      for (const c of reward.calls) {
        if (c === 'starfield') note(st, '  calls FUN_231e_88f9 (starfield reset) — handled by the next render pass');
        if (c === 'sound') note(st, '  calls FUN_231e_3708 (sound re-init)');
      }
      // Mirror any transient DS write (>= DS_END, e.g. the redraw latch DS:0x5c1a) into the globals.
      for (let k = 0; k + 2 < reward.latch.length; k += 3) {
        const [addr, value, width] = [reward.latch[k], reward.latch[k + 1], reward.latch[k + 2]];
        st.g[0x10000 + addr] = width === 2 ? value & 0xffff : value & 0xff;
      }
      fired(st, CALLEES.rebuild, 0x2d772); // the rebuild pair + redraw the branch implies
    }
  }
  // The same mutable DS byte is persisted in BH_START/HSAV. Keep it canonical as well as
  // mirroring the old host-EXE write below.
  if (st.sv) (st.sv as State).byteAt(scriptByteDs, 0);
  // `*(iVar2 + 2) = 0` after FUN_231e_a592: the executable's data image is writable in DOS.
  const image = st.exe as Uint8Array | undefined;
  const fileOffset = scriptByteDs + 0xf90; // re/state-format.md address law
  if (image && fileOffset >= 0 && fileOffset < image.length) image[fileOffset] = 0;
}

/** `inc byte[gate]` then `cmp byte[gate], want` -- @0x2d6c8 and @0x2d6eb. */
function incGate(st: EngineState, ds: number, want: number, site: number): boolean {
  const next = (rdDs(st, ds) + 1) & 0xff;
  wrDs(st, ds, next, site);
  return next === want;
}

function enterZoneCutscene(st: EngineState, zone: number, site: number) {
  note(st, `@${hex(site)} lcall 0x131e,${zone === 1 ? '0x6db0' : '0x7182'} -> FUN_231e_${zone === 1 ? '6db0' : '7182'}: zone ${zone} cutscene entered (zones.ts createZonePlayer; hook st.onZone sets the queue)`);
  wrDs(st, zone === 1 ? ZONE_SEEN.zone1 : ZONE_SEEN.zone2, zone === 1 ? 1 : 2, site);
  const cb = st.onZone as ((z: number, at: number) => void) | undefined;
  if (cb) cb(zone, site);
  else note(st, 'TODO_ZONE_WIRING@0x2d6d3: main.ts did not install an onZone hook, so the sequence has no player');
}

function cargoMessage(st: EngineState, ds: number, site: number) {
  const exe = st.exe as Uint8Array | undefined;
  // These handlers pass real DS offsets.  Unlike messages.ts's legacy linear-address labels,
  // initialized EXE data follows the verified state.ts law `file = DS + 0xf90`.
  let text = '';
  if (exe) {
    for (let at = ds + 0xf90; at < exe.length && exe[at] !== 0 && exe[at] !== 0x24; at++) {
      if (exe[at] > 0x1f) text += String.fromCharCode(exe[at] === 0x60 ? 0x27 : exe[at]);
    }
  }
  (st.scriptLog ||= []).push({ site, text, msgDs: ds });
  note(st, `cargo message DS:0x${ds.toString(16)} @${hex(site)}: ${JSON.stringify(text)}`);
}

/** FUN_231e_bc39 @0x2ee19: remove the selected cargo row by moving the last row into its slot. */
function removeSelectedCargo(st: EngineState) {
  const sv = st.sv as State;
  const count = sv.wordAt(0x3c56);
  if (count === 0) return;
  const selected = Math.max(0, Math.min(count - 1, (sv.wordAt(0x3c8e) || 1) - 1));
  if (count === 1) {
    sv.wordAt(0x3c56, 0);
    sv.byteAt(0x3c7a, 0);
  } else {
    sv.byteAt(0x3c7a + selected, sv.byteAt(0x3c7a + count - 1));
    sv.wordAt(0x3c56, count - 1);
    sv.byteAt(0x3c7a + count - 1, 0);
  }
  sv.wordAt(0x3c8e, 1);
  st.g[0x13c56] = sv.wordAt(0x3c56);
  st.g[0x13c8e] = 1;
  fired(st, CALLEES.blit, 0x2ee3c);
  note(st, `FUN_231e_bc39@0x2ee19: removed cargo row ${selected + 1}; ${count} -> ${sv.wordAt(0x3c56)}`);
}

/** Cargo USE/TRANSPORT actions, FUN_231e_ba64 @0x2ec44 and FUN_231e_bb5a @0x2ed3a. */
function runCargoAction(st: EngineState, action: 'use' | 'transport', site: number) {
  const sv = st.sv as State | undefined;
  if (!sv || sv.wordAt(0x3c56) === 0) {
    cargoMessage(st, action === 'use' ? 0x588e : 0x587f, site);
    return;
  }
  const row = Math.max(0, Math.min(sv.wordAt(0x3c56) - 1, (sv.wordAt(0x3c8e) || 1) - 1));
  const type = sv.byteAt(0x3c7a + row);
  note(st, `${action.toUpperCase()} cargo row ${row + 1}, type ${type}`);

  if (action === 'use') {
    const at = (ds: number, value: number) => sv.byteAt(ds) === value;
    if (type === 5 && at(0x3d4, 0x8d) && at(0x3d5, 0x72) && at(0x3d2, 0x7f) && at(0x3d3, 0x7f)) {
      wrBlobByte(st, 0x35ea, 1, 0x2ec7f);
      wrBlobByte(st, 0x25dd, 4, 0x2ec87);
      wrBlobByte(st, 0x25df, 1, 0x2ec8c);
      wrBlobByte(st, 0x2806, 1, 0x2ec91);
      removeSelectedCargo(st);
      cargoMessage(st, 0x5a25, 0x2eca5);
      return;
    }
    if (type === 0x0c && at(0x3d4, 0x85) && at(0x3d5, 0x8f) && at(0x3d3, 0x7f) && at(0x3d2, 0x7f)) {
      sv.wordAt(0x3abf, 0); st.g[0x13abf] = 0;
      wrBlobByte(st, 0x36e1, 3, 0x2ecd9);
      wrBlobByte(st, 0x36e9, 1, 0x2ecde);
      removeSelectedCargo(st);
      cargoMessage(st, 0x5a25, 0x2ecf2);
      sv.wordAt(0x3ac1, 1); st.g[0x13ac1] = 1;
      return;
    }
    if (type === 2) {
      removeSelectedCargo(st);
      cargoMessage(st, 0x5a3a, 0x2ed16);
      return;
    }
    cargoMessage(st, 0x5a7d, 0x2ed22);
    return;
  }

  if (type === 6) {
    const enabled = sv.byteAt(0x3add) === 0;
    wrBlobByte(st, 0x3add, enabled ? 1 : 0, enabled ? 0x2ed7a : 0x2ed5a);
    cargoMessage(st, enabled ? 0x5a52 : 0x5a62, enabled ? 0x2ed83 : 0x2ed63);
    fired(st, CALLEES.rebuild, enabled ? 0x2ed88 : 0x2ed68);
    st.g[0x15c1a] = 0xff;
    return;
  }
  if (type === 8) {
    const enabled = sv.byteAt(0x3ae5) === 0;
    wrBlobByte(st, 0x3ae5, enabled ? 1 : 0, enabled ? 0x2edbb : 0x2eda5);
    cargoMessage(st, enabled ? 0x6fb7 : 0x6f9b, enabled ? 0x2edc4 : 0x2edae);
    wr(st, 'asciiLatch', 1, enabled ? 0x2edc9 : 0x2edb3);
    return;
  }
  if (type === 0x0d || type === 3) {
    const amount = type === 0x0d ? 0xbe : 0x14;
    sv.wordAt(0x3c5c, (sv.wordAt(0x3c5c) + amount) & 0xffff);
    st.g[0x13c5c] = sv.wordAt(0x3c5c);
    removeSelectedCargo(st);
    cargoMessage(st, type === 0x0d ? 0x6fd2 : 0x6ff5, type === 0x0d ? 0x2ede2 : 0x2edff);
    wr(st, 'asciiLatch', 1, type === 0x0d ? 0x2ede7 : 0x2ee04);
    return;
  }
  cargoMessage(st, 0x7015, 0x2ee10);
}

function runCalls(st: EngineState, arm: EventArm, code: number): number {
  for (const c of arm.calls || []) {
    // The one callee that is not a leaf primitive: FUN_231e_67b7 both consumes and re-returns the
    // code, so states 1 (pre-arm, @0x2e6fa) and 2 (tail, @0x2ea87) share its 16 stat arms.
    const target = Array.isArray(c.callee) ? c.callee[0] : c.callee;
    if (target === CALLEES.sink) {
      code = fun_231e_67b7(st, code, c.site);
      continue;
    }
    if (target === CALLEES.scan) { runScanArm(st, c.site); continue; }
    if (target === CALLEES.converse) { runConverseArm(st, c.site); continue; }
    if (target === CALLEES.pageForward) { runCargoAction(st, 'use', c.site); continue; }
    if (target === CALLEES.pageBack) { runCargoAction(st, 'transport', c.site); continue; }
    // FUN_231e_3a81 @0x26c61: the `m` task list.
    if (c.callee === 0x26c61) { runTasksScreen(st, c.site); continue; }
    // FUN_231e_5a22 @0x28c02 and the help block @0x2dd9f: the `/` help topics.
    if (c.callee === 0x2dd9f) { runHelpScreen(st, c.site); continue; }
    // @0x2e987: the `d` "track next interest" arm — cycles DS:0x3ae1.
    if (c.callee === 0x2e987) { runTrackNext(st, c.site); continue; }
    fired(st, c.callee, c.site);
  }
  return code;
}

// --- FUN_231e_3a81 @0x26c61: `m`, the task list. -----------------------------------------------
// The quest words DS:0x3ab5 + i*2 gate each parallel task string at DS:0x4a34; 0xffff terminates the
// walk and 0 hides a row. Header/footer are `$`-strings in the EXE image (file = DS + 0xF90).
function runTasksScreen(st: EngineState, site: number): void {
  const exe = st.exe as Uint8Array | undefined;
  const sv = st.sv as State | undefined;
  if (!exe || !sv) { note(st, `TODO_MEMORY@${hex(site)}: the task list needs both the EXE and the state image`); return; }
  const tasks = activeTasks(exe, sv);
  st.textScreen = {
    title: dataString(exe, TASKS.header),
    body: tasks.map((t) => t.text), // the EXE prints each active string verbatim (@0x26c84), no numbering
    footer: dataString(exe, TASKS.footer),
    site,
  };
  note(st, `${TASKS.cite} @${hex(site)}: ${tasks.length} active task(s) from the quest-word list`);
}

// --- @0x2dd9f: `/`, the help topics (INT 9 is re-armed by the caller before this runs). ---------
function runHelpScreen(st: EngineState, site: number): void {
  const exe = st.exe as Uint8Array | undefined;
  if (!exe) { note(st, `TODO_MEMORY@${hex(site)}: the help block needs the EXE image`); return; }
  st.textScreen = openHelp(exe, st.sv as State, site);
  note(st, `@${hex(site)}: MAIN HELP MENU topic list from DS:0x83ae (@0x2ddd3 FUN_231e_5133, al=7)`);
}


// --- @0x2e987: `d`, "track next interest". ------------------------------------------------------
// Walks the visible table DS:0x3bf5 (count DS:0x3bf3) for the next actor whose record byte +0xb is
// below 5, stores its address in DS:0x3ae1, and prints "NOTHING TO TRACK" (DS:0x49a3) on exhaustion.
function runTrackNext(st: EngineState, site: number): void {
  const sv = st.sv as State | undefined;
  if (!sv) { note(st, `TODO_MEMORY@${hex(site)}: tracking needs the visible table DS:0x3bf3/0x3bf5`); return; }
  // FUN_231e_1364 @0x24544 rebuilds DS:0x3bf5 each frame; the port's equivalent is the frame-local
  // actor list main.ts installs in st.visibleActors (world.ts renderActors). Fall back to collectVisible.
  const visible: number[] = (Array.isArray(st.visibleActors) && st.visibleActors.length)
    ? st.visibleActors as number[] : collectVisible(sv);
  const current = st.g[0x13ae1] !== undefined ? (st.g[0x13ae1] as number) : sv.wordAt(0x3ae1);
  const trackable = (addr: number) => sv.byteAt(addr + 0xb) < 5; // record byte +0xb is the class selector
  if (!visible.length) {
    (st.scriptLog ||= []).push({ site, text: st.exe ? dataString(st.exe as Uint8Array, 0x49a3) : 'NOTHING TO TRACK', msgDs: 0x49a3 });
    note(st, `@${hex(site)}: visible list empty -> NOTHING TO TRACK (DS:0x49a3)`);
    return;
  }
  // Walk from just after the current target, wrapping, for the first trackable actor (@0x2e9ad..@0x2e9e6).
  const start = Math.max(0, visible.indexOf(current));
  for (let n = 1; n <= visible.length; n++) {
    const addr = visible[(start + n) % visible.length];
    if (addr !== current && trackable(addr)) {
      st.g[0x13ae1] = addr; sv.wordAt(0x3ae1, addr);
      note(st, `@${hex(site)}: track DS:0x${addr.toString(16)} (class ${sv.byteAt(addr + 0xb)}) from DS:0x3ae1=0x${current.toString(16)}`);
      fired(st, CALLEES.rebuild, site);
      return;
    }
  }
  if (current && trackable(current)) return; // a lone trackable target stays put
  (st.scriptLog ||= []).push({ site, text: st.exe ? dataString(st.exe as Uint8Array, 0x49a3) : 'NOTHING TO TRACK', msgDs: 0x49a3 });
  note(st, `@${hex(site)}: no later trackable actor -> NOTHING TO TRACK`);
}

// The 0x2c arm is a real row of FUN_231e_b509 (@0x2e7ab) but lives in the section of the compare
// chain this port has not tabulated, so it falls through matchArm. Rather than lose the documented
// work (step DS:0x13572, then the gatherer select), drive it from here.
function runZStepper(st: EngineState, row: ModeRow) {
  note(st, `mode=1 cmp@${hex(row.cmpAddr)} lcall ${row.farTarget} -> ${hex(row.handlerAddr)} (FUN_231e_b509) with AL=0x2c -> the stepper arm @0x2e7ab`);
  gathererStep(st);
}

function gathererStep(st: EngineState, dir: number | true = 1) {
  const step = dir === true ? 1 : dir;
  const level = rd(st, 'gathererSelect');
  if (step > 0 && level >= 2) { // 0x2e7b4 `cmp byte ptr [0x3572],2 / jb 0x2e7b9`, else 0x2e7b6 `jmp 0x2e82e`
    note(st, 'the "z" arm steps no further once DS:0x13572 reaches 2: @0x2e7b6 jumps to 0x2e82e, which is the "=" arm of the same chain, so the step falls through to that compare (@0x2e82e `cmp al,0xd`) and 0x2c matches nothing there. Closing TODO_LEVEL2PLUS@0x2e82e.');
    return;
  }
  if (step < 0 && level === 0) { // 0x2e7f2 `cmp byte ptr [0x3572],0 / je 0x2e82e`
    note(st, 'the "x" arm cannot step below 0: @0x2e7f7 jumps to the same 0x2e82e fall-through (@0x2e82e `cmp al,0xd`)');
    return;
  }
  wr(st, 'gathererSelect', level + step, step > 0 ? 0x2e7b9 : 0x2e7f9); // `inc|dec byte ptr [0x3572]`
  fired(st, 0x2bad9, 0x2e7bd); // FUN_231e_88f9
  fired(st, CALLEES.rebuild, 0x2e7c2); // FUN_231e_0458 (+ FUN_231e_0045 @0x2e7cc), the full rebuild
  wr(st, 'flag_5c1a', 0xff, step > 0 ? 0x2e7c7 : 0x2e807);
  if (rd(st, 'gathererSelect') === 1) { // 0x2e7d1 / 0x2e811 `cmp byte ptr [0x3572],1 / jne`
    const counter = st.g[addrOf('word_3c60')];
    if (counter === undefined) {
      note(st, 'TODO_GLOBAL@0x13c60: `cmp word ptr [si+0x3c60],0x11` @0x2e7db gates the message blit and no documented site ever writes DS:0x13c60, so the port cannot evaluate it');
    } else if (counter <= 0x11) {
      fired(st, CALLEES.message, step > 0 ? 0x2e7e6 : 0x2e826); // `lea bx,[0x58b2]` + lcall 0x131e,0x32de
    }
  }
}

// @0x2e89a..@0x2e8c3 (and its two siblings @0x2e905..@0x2e942, @0x2e94e..@0x2e977): move a cursor
// to the NEXT entry whose presence word is non-zero, wrapping to a fixed value at the table end.
// The arithmetic is the instruction sequence verbatim: `mov bl,[cursor] / mov bh,0 / dec bx /
// shl bx,1 / mov si,bx / add si,2`, test `word [si+base]`, accept with `shr si,1 / inc si`,
// advance with `add si,2` while `cmp si,end / jb`.
function cursorScan(st: EngineState, s: any) {
  const v0 = rd(st, s.cursor) as number;
  const bx = s.zeroKeepsFirst && v0 === 0 ? 0 : (v0 - 1) & 0xffff; // @0x2e90b `cmp bx,0 / je` skips the dec
  let si = ((bx << 1) + 2) & 0xffff;
  let pass = 0;
  for (let guard = 0; guard < 64; guard++) {
    if (rdWord(st, s.table + si) !== 0) {
      const idx = ((si >> 1) + 1) & 0xff;
      wr(st, s.cursor, idx, s.setSite);
      note(st, `cursor scan @${hex(s.site)}: the entry at ${hex(s.table)}+${hex(si)} is non-zero -> ${hex(addrOf(s.cursor))}=${hex(idx)} (pass ${pass})`);
      return;
    }
    si = (si + 2) & 0xffff;
    if (si < s.end) continue;
    if (s.extraPass && pass === 0) { // @0x2e939 `mov si,0 / inc di / cmp di,1 / je 0x2e91b`
      pass = 1; si = 0; continue;
    }
    wr(st, s.cursor, s.exhausted, s.site); // @0x2e8c3 mov 1 / @0x2e942 mov 0 / @0x2e977 mov 1
    note(st, `cursor scan @${hex(s.site)}: no non-zero entry below ${hex(s.end)} (pass ${pass}) -> ${hex(addrOf(s.cursor))}=${hex(s.exhausted)}`);
    return;
  }
  note(st, `cursor scan @${hex(s.site)}: the walk did not terminate in 64 steps — the port stops and records nothing`);
}

// @0x2e8d6..@0x2e8e9 — the "2" arm's page counter: `inc byte [0x3c94]`, and when it reaches 4 the
// arm at @0x2e8e1 resets it to 1. (The 4-reset sits inside the equality branch, unlike state 4's
// cycle at @0x2eb0c..@0x2eb1f.)
function cyclePage(st: EngineState, s: any) {
  const next = ((rd(st, s.g) as number) + 1) & 0xff;
  if (next === 4) { wr(st, s.g, 1, 0x2e8e1); note(st, `inc ${hex(addrOf(s.g))} @${hex(s.site)} wrapped 4 -> 1 @0x2e8e1`); }
  else wr(st, s.g, next, s.site);
}

// @0x2e82e..@0x2e87d — the cheat-gated "=" / "-" scroller. The cursor DS:0x13c9a moves by one, the
// "=" arm only while it is below DS:0x13c5a; the "-" arm only while it is above 0. When the pixel
// offset DS:0x13c98 has run past its threshold (0x25 forwards, 0x22 back) it steps by 3 and the
// scroll callee runs.
function scrollStep(st: EngineState, s: any) {
  const cur = rd(st, s.index) as number;
  if (s.op === 'inc') {
    const limit = rd(st, s.limit) as number;
    if (cur >= limit) { note(st, `the "=" arm finds ${hex(addrOf(s.index))}=${hex(cur)} already at the bound ${hex(addrOf(s.limit!))} @0x2e83d -> nothing moves`); return; }
    wr(st, s.index, cur + 1, s.site);
  } else {
    if (cur === 0) { note(st, `the "-" arm finds ${hex(addrOf(s.index))}=0 @0x2e85f -> nothing moves`); return; }
    wr(st, s.index, cur - 1, s.site);
  }
  // DS:0x13c98 is the save image's own word at DS:0x3c98, and FUN_231e_0bf6's flight block uses it as
  // the ship's SPEED (web/src/engine/flight.ts), so the "=" / "-" arms read and write the blob: a
  // mirror in st.g would let the two writers disagree about where the ship is going.
  const svw = st.sv as unknown as { scrollPos: number };
  const pos = (st.g[addrOf('scrollOffset')] as number | undefined) ?? (svw ? svw.scrollPos : rd(st, 'scrollOffset'));
  if (pos > s.threshold) { // BOTH arms skip with a `jle`: @0x2e847 cmp 0x25 (inc) / @0x2e871 cmp 0x22 (dec)
    const next = (pos + (s.op === 'inc' ? s.delta : -s.delta)) & 0xffff;
    if (svw) svw.scrollPos = next;
    wr(st, 'scrollOffset', next, s.deltaSite);
    fired(st, CALLEES.scroll, s.callSite); // @0x2e853 / @0x2e87d lcall 0x131e,0x2dd
    note(st, `scroll: DS:0x13c98 ${hex(pos)} ${s.op === 'inc' ? '+' : '-'} 3 -> ${hex(next)} then the scroll callee`);
  } else {
    note(st, `DS:0x13c98=${hex(pos)} is not past ${hex(s.threshold)} @${hex(s.deltaSite - 1)} -> no pixel step, no scroll`);
  }
}

// 0x23c62..0x23c8b — the scancode tail; runs for every mode, including 0 and 5.
function timingTail(st: EngineState) {
  if (st.held.lastScancode === SCANKODE_FIVE) { // 0x23c62 `cmp byte ptr cs:[0x42],0x3c`
    wr(st, 'fiveLatch', 1, 0x23c6a);
    note(st, 'jmp 0x23c8b @0x23c6f — the latch clear at 0x23c86 is skipped on this pass');
  } else {
    if (rd(st, 'fiveLatch') === 1 && st.held.lastScancode === SCANKODE_TWO) { // 0x23c72 / 0x23c79
      wr(st, 'cheatGate', 1, 0x23c81);
      note(st, 'cheat sequence F2 (0x3c) then F9 (0x43) -> DS:0x13be6 armed (gate for the "D"/0x0d/0x0c arms)');
    }
    wr(st, 'fiveLatch', 0, 0x23c86);
  }
  st.held.lastScancode = 0; // 0x23c8b — each press is consumed once
}

// One iteration of the loop body (0x23c1c..0x23c91). The `jmp 0x23c1c` @0x23c91 is the caller's
// job: this runs once per input event, never from a timer.
export function advance(state: EngineState, input: any = {}) {
  const incoming = (input.events || []).map(toRecord);
  const st = {
    ...state,
    g: { ...state.g },
    held: { ...state.held },
    events: [...state.events, ...incoming],
    draws: [],
    trace: [],
    audioEvents: [],
  };

  // The INT 9 handler is asynchronous on real hardware; the port serialises it into the pass in
  // which the key arrives, so flags and cs:[0x42] are set before the pump looks at them.
  for (const rec of incoming) {
    if (rec.scancode !== undefined) int9(st, rec);
    if (rec.todo) note(st, rec.todo); // keys the doc gives no code for stay queued, with the reason
  }

  const { code, repump } = pump(st);

  // A key with a scancode but no event code was consumed by the INT 9 flags alone; one with no
  // documented interpretation at all (pointer, unknown key) stays queued.
  const flagOnly = st.events.filter((e: any) => e.kind === 'key' && e.scancode !== undefined && (e.code === null || e.code === undefined));
  for (const e of flagOnly) note(st, e.todo || `scancode-only input ${e.label}: consumed by the INT 9 flags (@0x23dce), int 16h ah=1 @0x28429 found nothing to return`);
  st.events = st.events.filter((e: any) => !(e.kind === 'key' && e.scancode !== undefined && (e.code === null || e.code === undefined)));

  let delivered = null;
  if (!repump) {
    const ep = epilogue(st, code === undefined ? null : code);
    if (ep !== null && !ep.repump) delivered = code;
  }
  if (delivered !== null) dispatch(st, delivered);

  timingTail(st);
  note(st, `jmp ${hex(LOOP_BODY.end)} -> ${hex(LOOP_BODY.start)}`);
  return st;
}

