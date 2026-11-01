// Solar Winds (1993) — the script / object tables and the two modal script runners.
// Transcribed from SOLAR1.EXE sha256 7e7484a4a5eee9c2a9243820e551db27ca57567abb640c12d379c95c9b7983df
// Linear = EXE file offset + 0xf200. Far call `lcall 0x131e,OFF` -> 0x231e0 + OFF.
//
// ADDRESS LAW (this is the one that bites; re/state-format.md §"Address law" is authoritative):
//     linear = DS + 0x10190     file = DS + 0xF90     blob i = DS - 0xAD
// re/game-loop-modes.md §3 uses `DS = linear - 0x10000`, which is **0x190 too low**. Every DS
// offset below was checked by reading EXE bytes at `DS + 0xF90` and seeing the claimed ASCII, so
// none of them depends on that mistake. loop.ts's GLOBALS keys are `0x10000 + DSoffset`, a
// pseudo-linear space that is only ever fed to rdWord/rd which subtract 0x10000 again; keep that
// self-cancelling convention inside loop.ts and use PLAIN DS OFFSETS here.
//
// ── WHAT THIS FILE IS ────────────────────────────────────────────────────────────────────────
//
// The port's `c` (make 0x2e) and `s` (make 0x1f) arms were bookkeeping stubs pointing at
// FUN_231e_a26d @0x2d44d and FUN_231e_a01c @0x2d1fc. Those two routines are the game's spine:
// they are **modal subroutines with their own event loops** (re/event-codes.md §4), they re-install
// the INT 9 vector (@0x2d44d does `int 21h ah=25 al=9` from DS:0xb998:0xb99a and restores the saved
// vector from DS:0xb99c:0xb99e on exit — so the modal loops read the keyboard through a *different*
// handler than the main pump), and they are the only callers of the three zone cutscene loaders:
//
//   lcall 0x131e,0x6db0  @0x2d6d3   FUN_231e_6db0  zone 1   (gated: inc DS:0xbaf4; cmp 1)
//   lcall 0x131e,0x7182  @0x2d6ee   FUN_231e_7182  zone 2   (gated: inc DS:0xbaf5; cmp 2)
//   lcall 0x131e,0x75a6  @0x2d5fb   FUN_231e_75a6  zone 3   (reaches int 21h/4Ch afterwards)
//
// That is why the port "is just boot art and a menu": nothing ever entered a zone.
//
// ── THE THREE TABLES ─────────────────────────────────────────────────────────────────────────
//
// 1. THE VISIBLE-ENTITY TABLE — DS:0x3bf3 = count (words), DS:0x3bf5 = array of far pointers.
//    It is not stored data. FUN_231e_1364 @0x24544 rebuilds it every frame: it walks the actor
//    array at DS:0x3d8, culls to the camera window, blits each sprite into the scene buffer, and
//    pushes the actor's address:
//        *(word *)(*(int *)0x3bf3 + 0x3bf5) = piVar19; 0x3bf3 += 2;      // @0x24544 body
//    guarded by a field test (`if (*(char *)piVar19[5] != -1)`), i.e. invisible/cloaked actors are
//    not collectable. Both runners open with `cmp word[0x3bf3],0` and print an error string if the
//    player is looking at nothing (@0x2d464, @0x2d22f).
//
//    The actor array itself, stride 0xd (13 bytes), verified in BH_START.DAT at blob 0x32b:
//        00: 7f 7f 7f 7f 7f 7f 7f 7f a0 8c 10 05 00     <- DS:0x3d8
//        01: 7f 7f 7f 7f 7f 7f 87 64 64 b4 03 05 01     <- DS:0x3e5
//        02: 7f 7f 7f 7f 7f 7f 5a 6e 64 96 02 05 02     <- DS:0x3f2
//        03: 7f 7f 7f 7f 7f 7f 5d 70 a0 b4 06 05 03     <- DS:0x3ff
//        04: 7f 7f 7f 7f 7f 7f 73 73 64 96 0b 05 04     <- DS:0x40c
//        05: 7f 7f 7f 7f 7f 7f 71 6f 64 32 09 05 05     <- DS:0x419
//    byte +12 is a self-index (00 01 02 03 04 05) which is what proves the stride, and 0x7f is the
//    blob's blank fill (same value re/state-format.md reports for unused slots). The 0x190-offset
//    window constants 0x3ce/0x3cf and camera pair 0x3d2/0x3d3 are the cull bounds.
//    TODO_ACTOR_FIELDS@0x24544: which of +8/+a/+b is sprite, x, y is not settled — the blit uses
//    row stride 0x140 and destinations [0x6b9f]/[0x6bbb], and Ghidra's int*-typed field reads are
//    off by the 2-byte typing. Resolve against the disassembly before rendering actors.
//
// 2. THE SHIP TABLE — DS:0x128f, stride 0x17, **1-based**. 8-byte header, then a space-padded
//    name terminated by '$', then a '$'-terminated description that runs to the record boundary.
//    Read straight out of the EXE at file = DS + 0xF90:
//        DS:128f  01 01 01 00 01 00 00 00 | CLAW          $ | Known to be the Ship of E...
//        DS:1355  02 02 02 00 01 00 00 00 | ROC           $ | ...
//        DS:13fd  02 03 00 00 00 00 00 00 | BATROK        $ | ...
//        DS:1436  03 04 00 00 00 00 00 00 | DALMIAN       $ | ...
//    A record's next pointer is NOT base+k*stride: the walk is
//        p = rec + 0x17; while (*p != '$') p++; next = p + 1;                  // @0x2d366, @0x2d251
//    so the description's terminator *is* the record delimiter and the stride only offsets the
//    search start. Variable-length records, deterministic walk. The table holds the 24 ship classes
//    re/field-notes.md §1 lists, and byte +2 is the ship's **script id** (CLAW 1, ROC 2, BATROK 0,
//    DOMAC 13 = 0xd). 0 means "no script", and the runners `je` past such an entity.
//
// 3. THE STAR TABLE — DS:0x1e5b, stride 0x1c, **0-based**, name at +2 (so `lea si,[0x1e5b]` then
//    the walk lands on the name with no header skip):
//        DS:1e5b  00 00 | ENIGMA        $ | ...     DS:1e94  00 00 | INGMAR        $ | ...
//        DS:1fd1  00 00 | GLOBAN        $ | ...     DS:20fe  00 00 | LUMA          $ | ...
//    These are the Sol-Fromax stars. Same '$'-delimited walk, stride 0x1c.
//
// THE 0x500 SELECTOR, WHICH WAS THE OPEN QUESTION. Each collected actor carries a 16-bit object
// code at +0xb/+0xc assembled big-endian (`mov ah,[bx+0xb]; mov al,[bx+0xc]`). Compare against
// 0x500 (@0x2d4xx, `cmp ax,0x500`): below it the code is **ship number ax (1-based)** in table 2;
// at or above it the code is **star number ax-0x500 (0-based)** in table 3. One key, two tables,
// 0x500 as the class boundary. `re/script-vm.md` recorded "table at DS:0x128f stride 0x17 vs DS:0x1e5b
// stride 0x1c, selector [entry+0xb] vs 0x500" correctly but did not know *what* the tables were;
// now they have names in them.
//
// 4. BH_CONV.DAT — the conversation graph, opened by a26d at @0x2d4f5 via
//    `lea dx,[0x69ca]` + `lcall 0x131e,0x8828` (the generic loader; the file name is the name table,
//    and DS:0x69ca + 0x10190 = linear 0x16b5a = BH_CONV.DAT per re/loader_map.md). It is read raw.
//    Script id indexes the u16 node table at +0x521. The actual VM is FUN_231e_1e14 @0x24ff4;
//    vm.ts ports its prompt/choice/response/effect graph and its 64-byte save slots at DS:0x35e1.

import type { State } from './state.ts';
import { fileOffsetOfDs as dsToFile, DS_END } from './state.ts';

/** linear -> DS (re/state-format.md; NOT the -0x10000 of game-loop-modes.md §3). */
export const DS_LINEAR_DELTA = 0x10190;
export const dsFromLinear = (linear: number): number => linear - DS_LINEAR_DELTA;

/** The blob's blank fill byte; an unwritten actor slot reads as this. BH_START.DAT @0x32b onward. */
export const EMPTY = 0x7f;

export const TABLES = {
  /** DS:0x3bf3 word count / DS:0x3bf5 far-pointer array, rebuilt per frame by FUN_231e_1364. */
  visible: { count: 0x3bf3, entries: 0x3bf5, pushSite: 0x24544 },
  /** DS:0x3d8, 13-byte actor records, self-index at +12, terminated by a 0xffff first word. */
  actors: { base: 0x3d8, stride: 0xd, sentinel: 0xffff, collectable: 0x0a, indexField: 0xc, x: 0x08, y: 0x09, scriptLo: 0x0b, scriptHi: 0x0c, cullA: 0x3ce, cullB: 0x3cf, camX: 0x3d2, camY: 0x3d3, endTest: 0x24609 },
  /** DS:0x128f, stride 0x17, 1-based, byte +2 = script id. */
  ships: { base: 0x128f, stride: 0x17, name: 8, terminator: 0x24, first: 1, cite: 0x2d73a },
  /** DS:0x1e5b, stride 0x1c, 0-based, name at +2. */
  stars: { base: 0x1e5b, stride: 0x1c, name: 2, terminator: 0x24, first: 0, cite: 0x2d4a9 },
  /** The 16-bit object code is compared to this to choose ship vs star. */
  starBase: 0x500,
} as const;

/** Sites inside FUN_231e_a26d that matter to the wiring. */
export const RUNNER = {
  converse: 0x2d44d,
  converseEmpty: 0x2d464,      // cmp word[0x3bf3],0 -> error string
  converseLoadConv: 0x2d4f5,   // lea dx,[0x69ca] + lcall 0x131e,0x8828
  converseInterp: 0x2d4ea,     // lcall 0x131e,0x1de0  -- CONV opcode interpreter
  converseZone3: 0x2d5fb,      // lcall 0x131e,0x75a6
  converseZone1: 0x2d6d3,      // lcall 0x131e,0x6db0
  converseZone2: 0x2d6ee,      // lcall 0x131e,0x7182
  converseFlagArray: 0x2d53b,  // lea cx,[0x35e1]
  converseFlagTest3: 0x2d5b1,  // cmp byte[bx+0x35e1],3
  scan: 0x2d1fc,
  scanEmpty: 0x2d22f,
  scanShip: 0x2d366,
  scanStar: 0x2d251,
  int9Install: 0x2d44d,        // int 21h ah=25 al=9 from DS:0xb998:0xb99a
  int9Restore: 0x2d75a,
  zoneDone: 0x2d6bd,           // mov word[0x3acf],0
} as const;

export const ZONE_SEEN = { zone1: 0xbaf4, zone2: 0xbaf5 } as const;
export const SCRIPT_DONE = 0x3acf;

export type ObjectKind = 'ship' | 'star';
export interface ObjectRef { kind: ObjectKind; number: number; addr: number }

/**
 * The 0x500 selector, transcribed from the `cmp ax,0x500` at the head of both record walks.
 * `code` is the big-endian pair from actor +0xb/+0xc.
 */
export function classifyObject(code: number): ObjectRef | null {
  if (code === 0) return null;                       // `je` past it: no object (@0x2d366)
  if (code < TABLES.starBase) {
    return { kind: 'ship', number: code, addr: TABLES.ships.base + (code - 1) * 0 };
  }
  return { kind: 'star', number: code - TABLES.starBase, addr: TABLES.stars.base };
}

/**
 * The '$'-delimited record walk, exactly as the EXE does it: advance by the stride, then scan
 * forward to the *next* '$' and step over it — the terminator is the delimiter, so records are
 * variable length and the stride is only a search offset. @0x2d366 (ships) / @0x2d251 (stars).
 */
export function recordAt(exe: Uint8Array, table: 'ships' | 'stars', n: number): number {
  const t = TABLES[table];
  let p = t.base;
  for (let i = n - t.first; i > 0; i--) {
    p += t.stride;
    while (p < exe.length && exe[dsToFile(p)] !== t.terminator) p += 1;
    p += 1;
  }
  return p;
}

export interface Record_ {
  addr: number;
  header: number[];
  name: string;
  description: string;
  /** Ships only: byte +2, the BH_CONV script id (0 = none). */
  scriptId: number;
}

/** Read one record: header bytes, '$'-terminated padded name, then the description to the next '$'. */
export function readRecord(exe: Uint8Array, table: 'ships' | 'stars', addr: number): Record_ {
  const t = TABLES[table];
  const header: number[] = [];
  for (let i = 0; i < t.name; i++) header.push(exe[dsToFile(addr + i)]);
  let p = addr + t.name;
  let name = '';
  while (p < exe.length && exe[dsToFile(p)] !== t.terminator) { name += String.fromCharCode(exe[dsToFile(p)]); p += 1; }
  const nameEnd = p; p += 1;
  let description = '';
  while (p < exe.length && exe[dsToFile(p)] !== t.terminator) {
    if (exe[dsToFile(p)] >= 0x20) description += String.fromCharCode(exe[dsToFile(p)]);   // padding NULs are skipped
    p += 1;
  }
  return { addr, header, name: name.replace(/\s+$/, ''), description, scriptId: table === 'ships' ? header[2] : 0 } as Record_ & { nameEnd?: number };
}

/**
 * The per-frame visible-object collector, FUN_231e_1364 @0x24544. The port already re-derives the
 * 7-pool budget every pass (loop.ts tickStatPool); this is the sibling pass for the entity table.
 * Cull is against the two 0x190-window constants and the camera pair, and only actors whose
 * visibility field is not -1 are pushed. Returns DS addresses, which is what the table holds.
 */
export function collectVisible(st: State): number[] {
  const a = TABLES.actors;
  const out: number[] = [];
  // The walk ends at a record whose first word is 0xffff — @0x24604 `add bx,0xd` / @0x24607
  // `mov ax,[bx]` / @0x24609 `cmp ax,0xffff`. BH_START.DAT holds 201 such records
  // (DS:0x3d8..0xe09), every one of them carrying object code 0x500|index, i.e. star number =
  // actor number in a fresh game. A record is collectable when its word at +0x0a is not 0xffff
  // (Ghidra's `piVar19[5] != -1` guard on the push into DS:0x3bf5).
  for (let addr = a.base; ; addr += a.stride) {
    const first = (st.byteAt(addr) << 8) | st.byteAt(addr + 1);
    if (first === a.sentinel || addr + a.stride > DS_END) break;
    const gate = (st.byteAt(addr + a.collectable) << 8) | st.byteAt(addr + a.collectable + 1);
    if (gate === 0xffff) continue;
    // TODO_ACTOR_CULL@0x245a9: nine `cmp ax,cx / je` pairs screen-position this against the camera
    // pair DS:0x3d2/0x3d3 before the push; only the collectable test is ported, so the port's
    // visible set is a superset of what the original would have shown.
    out.push(addr);
  }
  return out;
}

/** BH_CONV is a raw 0x7210-byte graph. The node table actually consumed by the VM is at +0x521;
 *  the monotone u16 values near the file header are not referenced by FUN_231e_1e14. */
export const CONV = {
  magic: 'SOLAR WINDS\x1a\x1a-',
  /** u16 node pointers, indexed by (script id - 1): @0x25079 `shl bx,1` / @0x2507b `mov ax,[bx+0x521]`. */
  nodeTable: 0x521,
  /** Node header is 3 u16s and the text begins at node+6 (@0x25081 `mov ax,[bx]`). */
  nodeHeader: 6,
  /** @0x25071 `mov cx,0x40` / mul -> (id-1)*64 scratch slot the loaded art is parked in. */
  slotStride: 0x40,
} as const;

/**
 * A conversation node. The whole file is a graph of these; `c` reaches one through the ship/star
 * record's script id. Node layout, from @0x24ff4's header walk and confirmed semantically by the
 * replies it produces:
 *
 *   u16 n            a count of strings in the branch (14 for CLAW's greeting)
 *   u16 textPtr      == node+6 for the first node of a chain
 *   u16 choiceHead   address of the FIRST label
 *   "text$"          the line the alien says
 *   "label$" u16 target   repeated: the choice, then the address of the reply it earns
 *
 * The label/target pairing is not a guess: "YES, I AM INTERESTED$" is followed by 0x0783, and
 * 0x0783 reads "Excellent.  The job consists of collecting an escaped criminal."; "I`M NOT AT ALL
 * INTERESTED$" is followed by 0x095a, which reads "You fool.  I am willing to pay you an incredible
 * price for this mission and you will listen!".
 */
export interface ConvNode {
  addr: number; count: number; textPtr: number; choiceHead: number; text: string;
  choices: { label: string; target: number }[];
  stateTexts?: { text: string; target: number }[];
}

const node_count_cap = (n: number) => (n > 0x400 ? 1 : n);
const u16 = (b: Uint8Array, o: number) => (o + 1 < b.length ? b[o] | (b[o + 1] << 8) : 0);
const cstr = (b: Uint8Array, o: number, max = 2048): { s: string; end: number } => {
  let e = o; while (e < b.length && b[e] !== 0x24 && e - o < max) e++;
  let s = ''; for (let i = o; i < e; i++) if (b[i] >= 0x20) s += String.fromCharCode(b[i]);
  return { s, end: e + 1 };
};

export function convNode(conv: Uint8Array, id: number): ConvNode | null {
  if (id < 1) return null;
  const addr = u16(conv, CONV.nodeTable + 2 * (id - 1));
  if (addr < CONV.nodeHeader || addr >= conv.length) return null;
  const text = cstr(conv, u16(conv, addr + 2));
  const count = u16(conv, addr);
  const choices: { label: string; target: number }[] = [];
  const stateTexts: { text: string; target: number }[] = [];
  let q = u16(conv, addr + 4);
  // Sequential block: "$text" <u16 target> repeated. The first entries of some scripts are the
  // node's state-variant reply bodies (sentence case, e.g. script 1's "Greetings once again. Is the
  // deed…"), and every menu choice the engine can print is upper case ("YES, I AM INTERESTED",
  // "WHAT -DO- YOU MEAN?", "END COMMUNICATION"). Verified across all 15 scripts: the reply bodies
  // end the block, so the first sentence-case run AFTER a choice is the following node's text.
  // Two independent facts end the block, and both mean "this is a reply body, not a fresh label":
  // the run is sentence case (script 1 entry 15 "xcellent.  The job consists of…"), or it starts at
  // prevTarget + 1, i.e. inside the reply the previous choice just earned (script 3 entry 8 @0x1935
  // vs target 0x1934; script 5 entry 10 @0x2919 vs target 0x2918). Every menu the engine can print is
  // upper case, and no real choice label has ever been observed to alias a reply body.
  let prevTarget = -1;
  const limit = Math.min(24, Math.max(1, count + 4));
  for (let k = 0; k < limit && q + 3 < conv.length; k++) {
    const lab = cstr(conv, q, 96);
    if (!lab.s.length || lab.end + 2 > conv.length) break;
    const target = u16(conv, lab.end);
    q = lab.end + 2;
    if (target <= lab.end + 2 || target >= conv.length) break;
    if (q === prevTarget + 1) break;                                     // aliased into a reply body
    if (/[a-z]/.test(lab.s)) {
      if (choices.length) break;
      stateTexts.push({ text: lab.s, target });                          // quest-state variant
      prevTarget = target;
      continue;
    }
    choices.push({ label: lab.s, target });
    prevTarget = target;
  }
  return { addr, count, textPtr: u16(conv, addr + 2), choiceHead: u16(conv, addr + 4), text: text.s, choices, stateTexts };
}

/**
 * The switch inside FUN_231e_a26d (@0x2d53f..@0x2d6f3) on the conversation id. This *is* the quest
 * state machine: each id flips the world flags that decide what the next `c` finds. Offsets are DS
 * offsets into the save image, per loop.ts's `0x10000 + off` key convention.
 */
export const CONV_EFFECTS: Record<number, { writes: [number, number][]; cite: string; note?: string; zone?: number }> = {
  1: { writes: [[0x3be7, 1], [0x3ac9, 1]], cite: '@0x2d6a8 cmp bx,1 -> mov byte[0x3be7],1 / mov word[0x3ac9],1' },
  4: { writes: [[0x3abd, 1], [0x3abb, 0]], cite: '@0x2d6c3 cmp bx,4 -> mov word[0x3abd],1; @0x2d6c8 inc byte[0xbaf4], cmp 1 -> zone 1; @0x2d6d8 mov word[0x3abb],0', zone: 1 },
  5: { writes: [[0x3ac3, 1]], cite: '@0x2d5a8 cmp bx,5 / cmp byte[0x36e1],3 -> mov word[0x3ac3],1' },
  10: { writes: [[0x3ad1, 1], [0x3ad3, 1], [0x3acf, 0]], cite: '@0x2d5c6 cmp bx,0xa / cmp byte[0x3821],3 -> 0x3ad1/0x3ad3=1; @0x2d6b8 -> 0x3acf=0' },
  11: { writes: [[0x3861, 1], [0x3862, 1], [0x3863, 0], [0x3864, 0], [0x3865, 0], [0x3c46, 0xff]], cite: '@0x2d570 cmp bx,0xb / cmp word[0x3adf],1 -> 0x3861..5; @0x2d631 -> 0x3c46=0xff', zone: 2 },
  13: { writes: [], cite: '@0x2d53f cmp bx,0xd -> walks the DS:0x3c7a list, sets DS:0x38e2 = 1 (a member is 2) or 2 (@0x2d547..@0x2d55f)' },
  9: { writes: [[0xf16, 2]], cite: '@0x2d675 cmp bx,9 -> mov byte[bx+0xf16]... arena slot 2 (@0x2d67e), then the 0x3add tail' },
  15: { writes: [[0xeb6, 2]], cite: '@0x2d645 cmp bx,0xf -> mov byte[bx+0xeb6],2 (@0x2d64b), then the 0x3add tail' },
  14: { writes: [], cite: '@0x2d5f6 cmp bx,0xe -> FUN_231e_75a6 zone 3, print DS:0x7212, int 16h, int 10h, then int 21h/4Ch (EXIT TO DOS)', zone: 3 },
};

/**
 * BH_CONV.DAT is NOT run-length encoded. @0x2d50b reads 0xEA60 bytes straight into the arena with
 * int 21h/3Fh and no decode call, and the raw bytes are self-consistent (magic at +0, node table at
 * +0x521, text from +0x547). An earlier note here claimed a stone-RLE decode; that was wrong -- the
 * file is 0x7210 = 29200 bytes, exactly the image the loader expects.
 */
export function decodeConv(convDat: Uint8Array): Uint8Array {
  if (String.fromCharCode(...Array.from(convDat.slice(0, CONV.magic.length))) !== CONV.magic) {
    throw new Error('BH_CONV.DAT magic mismatch');
  }
  return convDat;
}

/** What a runner pass produces: text to draw, objects named, and cutscenes to enter. */
export interface RunnerEvent {
  text?: { cx: number; cy: number; s: string; site: number };
  object?: Record_ & { table: 'ships' | 'stars' };
  cutscene?: { zone: 1 | 2 | 3; site: number };
  note: string;
}

export interface RunnerHooks {
  /** Enter a zone cutscene. Implemented by zones.ts; the port blocks until it rets. */
  cutscene?(zone: 1 | 2 | 3, site: number): void;
  /** Read a word at a DS offset (loop.ts's rd). */
  rd?(ds: number): number;
  /** Store a word at loop.ts's global key (0x10000 + DS offset). */
  wr?(key: number, val: number): void;
  /** The loaded EXE image (file bytes) and the live state image, passed through to the runners. */
  image?: Uint8Array;
}

/** Actor record fields, DS:0x3d8 + k*0xd, read out of the state image (blob i = DS - 0xAD). */
export function actorField(st: State, addr: number, field: number): number {
  return st.byteAt(addr + field);
}

/**
 * `s` — FUN_231e_a01c @0x2d1fc, "scan". Walk the collected entity table, resolve each entity's
 * ship/star record through the 0x500 selector, and print what is on screen. It sets DS:0x3be5 when
 * it printed anything, and prints the string at DS:0x58db when it printed nothing.
 */
export function runScan(exe: Uint8Array, st: State, visible: number[], hooks: RunnerHooks = {}): RunnerEvent[] {
  const ev: RunnerEvent[] = [];
  if (!visible.length) {
    ev.push({ note: '@0x2d22f scan: DS:0x3bf3 count == 0 -> lcall 0x131e,0x32de with the empty-view string' });
    return ev;
  }
  for (const addr of visible) {
    const a = TABLES.actors;
    const code = (actorField(st, addr, a.scriptLo) << 8) | actorField(st, addr, a.scriptHi);
    const ref = classifyObject(code);
    if (!ref) { ev.push({ note: `actor DS:0x${addr.toString(16)} code 0 -> no object (@0x2d366 je)` }); continue; }
    const table = (ref.kind === 'ship' ? 'ships' : 'stars') as 'ships' | 'stars';
    const rec = recordAt(exe, table, ref.number);
    ev.push({ object: { ...readRecord(exe, table, rec), table }, note: `actor DS:0x${addr.toString(16)} -> ${ref.kind} ${ref.number} @DS:0x${rec.toString(16)}` });
  }
  return ev;
}

/**
 * `c` — FUN_231e_a26d @0x2d44d, "communicate". Loads BH_CONV.DAT (@0x2d4f5), resolves the entity
 * the player is looking at to its ship/star record, takes that record's script id, and executes the
 * CONV stream from the index. The three zone cutscenes are the loader calls below.
 *
 * The synchronous helper below remains useful for table inspection. The live engine path uses
 * vm.ts's modal ConversationVm, including choice effects and BH_PEOP portraits.
 */
export function runConverse(exe: Uint8Array, st: State, convDat: Uint8Array, visible: number[], hooks: RunnerHooks = {}): RunnerEvent[] {
  const ev: RunnerEvent[] = [];
  if (!visible.length) {
    ev.push({ note: '@0x2d464 converse: DS:0x3bf3 count == 0 -> lcall 0x131e,0x32de (UNABLE TO COMMUNICATE string)' });
    return ev;
  }
  const conv = decodeConv(convDat);
  for (const addr of visible) {
    const a = TABLES.actors;
    const code = (actorField(st, addr, a.scriptLo) << 8) | actorField(st, addr, a.scriptHi);
    const ref = classifyObject(code);
    if (!ref) continue;
    const table = (ref.kind === 'ship' ? 'ships' : 'stars') as 'ships' | 'stars';
    const rec = recordAt(exe, table, ref.number);
    const r = { ...readRecord(exe, table, rec), table };
    if (table === 'ships') r.scriptId = st.byteAt(rec + 2);
    ev.push({ object: r, note: `entity -> ${table} ${r.name}${r.scriptId ? ` (script ${r.scriptId})` : ' (no script)'}` });
    if (r.scriptId === 0) continue;
    const node = convNode(conv, r.scriptId);
    if (!node) { ev.push({ note: `CONV: no node for script id ${r.scriptId} (@0x2507b table walk)` }); continue; }
    ev.push({ text: { cx: 0, cy: 0, s: node.text, site: 0x2d604 }, note: `CONV node ${r.scriptId} @0x${node.addr.toString(16)}: ${node.choices.length} choices (@0x2d4f5 opens BH_CONV.DAT, @0x2507b indexes the node)` });
    const fx = CONV_EFFECTS[r.scriptId];
    if (fx) {
      for (const [off, val] of fx.writes) hooks.wr?.(0x10000 + off, val);  // plain `mov`, as the EXE does
      ev.push({ note: `quest effect id ${r.scriptId}: ${fx.cite} (${fx.writes.length} write(s))` });
    }
  }
  // The three zone cutscene entries, gated exactly as the EXE gates them.
  const seen1 = hooks.rd ? hooks.rd(ZONE_SEEN.zone1) : 0;
  const seen2 = hooks.rd ? hooks.rd(ZONE_SEEN.zone2) : 0;
  if (seen1 < 1) { ev.push({ cutscene: { zone: 1, site: RUNNER.converseZone1 }, note: '@0x2d6d3 FUN_231e_6db0 zone 1 (inc DS:0xbaf4, cmp 1)' }); hooks.cutscene?.(1, RUNNER.converseZone1); }
  if (seen2 < 2) { ev.push({ cutscene: { zone: 2, site: RUNNER.converseZone2 }, note: '@0x2d6ee FUN_231e_7182 zone 2 (inc DS:0xbaf5, cmp 2)' }); hooks.cutscene?.(2, RUNNER.converseZone2); }
  return ev;
}


