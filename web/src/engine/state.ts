// Solar Winds (1993) — GAME STATE blob, transcribed from re/state-format.md.
//
// A savegame IS a raw image of the DS data segment: BH_START.DAT (fresh game) and
// HSAV01.DAT (slot 1) are byte-identical, 17,831 bytes. Proof is the save/load pair
// in the main-menu routine FUN_231e_99c2 (re/state-format.md "THE ANCHOR"):
//   0x2cf5c mov ah,0x40 / 0x2cf5e lea dx,[0x00ad] / 0x2cf62 lea cx,[0x4654] / 0x2cf66 sub cx,dx
//   0x2d0fb mov ah,0x3f / 0x2d0fd lea dx,[0x00ad] / 0x2d101 lea cx,[0x4654] / 0x2d105 sub cx,dx
//   0x2d114 cmp ax,0x2bc    ; the engine itself rejects a load shorter than 700 bytes
// cx = 0x4654 - 0x00AD = 0x45A7 = 17831 = the file size, so there is no header, no
// checksum and no per-record framing: one flat image, DS:0x00AD..DS:0x4653 inclusive.
//
// Address law (all three legs re-verified against SOLAR1.EXE with re/work/x86.py):
//   blob offset i = DS offset X - 0x00AD
//   DS offset X   = EXE file offset + 0xF90          <-- CORRECTION, see below
//   linear byte   = DS offset X + 0x10190 = file offset + 0xF200
//
// CORRECTION 1 (applied here, still wrong in re/state-format.md's table row): the
// doc says `EXE file offset = DS + 0xFB90`. That is off by 0xEC00. Verified directly:
// the literal "HSAV01.DAT" sits at EXE file offset 0x5318, and the save path's name
// block is DS:0x4388 (0x2cf3e `lea dx,[0x4388]`); 0x5318 - 0x4388 = 0xF90. Cross-check:
// 0x14518 (linear, = 0x5318 + 0xF200) - 0x4388 = 0x10190, matching re/loader_map.md's
// name-table anchor. Behavioural check: the EXE image read at `DS + 0xF90` over the
// whole blob window matches BH_START.DAT in 17,325 of 17,831 bytes; at `DS + 0xFB90`
// only 722 do.
//
// CORRECTION 2 (affects re/game-loop-modes.md §3, not this file's offsets): that doc
// converts linear to DS with `DS = linear - 0x10000`, i.e. 0x190 too low, and derives
// the INT 9 keyboard hold-flags to "DS:0x321c..0x3224". Under the verified law those
// bytes sit in a `$`-delimited string table (blob 12655..12663 reads "abnormal"), so
// the flags are NOT in the blob — they live in the ISR's own CS-data page
// (runtime CS base linear 0x231e0 -> cs:[0x3c] = linear 0x2321c = DS 0x1308c, above
// DS_END). Tracked below as TODO_KEY_FLAGS rather than given an accessor.
//
// Consequence worth stating: every field below with DS >= 0x4654 is outside the blob
// and therefore NOT persisted; such globals are listed in TRANSIENT_GLOBALS, not given
// accessors. Fields whose DS offset is not proven are listed in TODO_FIELDS with the
// global address that must be confirmed. Nothing here is inferred from filenames.

// --- blob geometry ---------------------------------------------------------------
export const BLOB_LENGTH = 0x45a7; // 17831 = 0x4654 - 0x00ad, @0x2cf66 / @0x2d105
export const DS_START = 0x00ad; // lea dx,[0x00ad] @0x2cf5e (save), @0x2d0fd (load)
export const DS_END = 0x4654; // lea cx,[0x4654] @0x2cf62 / @0x2d101 — end MARKER, not a field
export const DS_FILE_DELTA = 0xf90; // file = DS + 0xF90 (CORRECTION 1; doc's 0xFB90 is wrong)
export const DS_LINEAR_DELTA = 0x10190; // linear = DS + 0x10190 (name-table anchors)
export const LINEAR_FILE_DELTA = 0xf200; // linear = file + 0xF200 (re/work/x86.py)
export const MIN_LOAD_BYTES = 0x2bc; // 700 — cmp ax,0x2bc @0x2d114

// --- documented DS offsets (blob offset = DS - 0x00AD) ----------------------------
export const DS = Object.freeze({
  statBudget: 0x3c5c, // word — mov word [0x3c5c],0x2bc @0x244da
  crewStats: 0x3c5e, // word[8] stride 2 — cmp/add word [di+0x3c5e] @0x299a6/@0x299b4
  actionPoints: 0x3c70, // word — dec word [0x3c70] @0x299ad, inc @0x29abf
  countdownTimer: 0x3c16, // word — cmp/dec word [0x3c16] @0x23e9e/@0x23ed2
  countdownPrev: 0x3c18, // word — mov word [0x3c18],ax @0x23ecf
  inputGatherer: 0x3572, // byte 0/1/>=2 — cmp byte [0x3572],0 @0x23e03, inc @0x2e7b9; loop.js spells this GLOBALS.gathererSelect
  schedulerSlot: 0x359b, // word — mov word [di+0x359b],0x32 @0x244e3
  mode: 0x3c91, // byte 0..5 — cmp byte [0x3c91],1 @0x23c1f (loop.js STATE_GLOBAL calls this linear 0x13c91)
  byte_3c92: 0x3c92, // byte — mov byte [0x3c92],cl @0x2445f (meaning undocumented)
  byte_3c93: 0x3c93, // byte — cmp byte [0x3c93],0xff @0x2444a, dec @0x2446d
  word_3c95: 0x3c95, // word — mov word [0x3c95],1 @0x2e7a5
  scrollPos: 0x3c98, // word — add/sub word [0x3c98],3 @0x24487/@0x244aa
  soundEnabled: 0x3ade, // byte 0/1 — mov byte [0x3ade],1 @0x23ec2, cmp @0x23eb4/@0x23ee3
  cheatLatch: 0x3be6, // byte — mov byte [0x3be6],1 @0x23c81/@0x244d5, cmp @0x2e79e
  word_3ec5: 0x3ec5, // word — SOLAR1.c:13558 `*(int*)0x3ec5 += *(int*)0x3e39`
  int24VectorSeg: 0x4384, // word — mov word [0x4384],es @0x239d7
  int24VectorOfs: 0x4386, // word — mov word [0x4386],bx @0x239db
  slotNameTable: 0x4388, // 10 records x 0x24 B — lea dx,[0x4388] @0x2cf3e/@0x2d0e0
  saveSlot: 0x4552, // word — mov ax,[0x4552] @0x2cf36/@0x2d0d8; ALIASED by zone 3, see the note below the table
  listMax: 0x4559, // byte — upper row bound, doc gatherer §3 (cursor stays in [0x455a..0x4559])
  byte_455b: 0x455b, // byte — adjacent to the list bounds, undocumented
  listMin: 0x455a, // byte — mov dl,[0x455a] @0x28407
  listCursor: 0x455c, // byte — cmp dl,[0x455c] @0x2841b
  mapReadLength: 0x4577, // word — mov word [0x4577],ax @0x2a002 and @0x2a7ba (re/formats-maps.md:37)
});

// Alias note — one word, two documented lives. The save menu uses DS:0x4552 as the slot
// index (0x2cf36 `mov ax,[0x4552]` -> `mov bx,0x24` / `mul bx` / `lea dx,[0x4388]`), while
// the zone-3 loader uses the SAME word to stage a segment for `mov ds,dx`:
//   0x2a7d5 mov ax,[0x6b97]  ->  0x2a7d8 mov [0x4552],ax  ->  0x2a7f2 mov dx,[0x4552] / mov ds,dx
// BH_START.DAT holds 0x0000 there (= slot 0 = HSAV01.DAT), so the fresh-game reading is
// unambiguous; whether the two uses can collide in a mid-game save is an open question,
// recorded in re/state-format.md §"state.js field coverage".

export const SLOT_COUNT = 10; // HSAV01..HSAV09,HSAV00 — 10 x 0x24 = 240 B = SAVLST.DAT size
export const SLOT_RECORD_BYTES = 0x24; // mov bx,0x24 / mul bx @0x2cf39/@0x2cf3c
export const SLOT_NAME_BYTES = 12; // "HSAV01.DAT" + 0x00 + '$' in the first 12 bytes
export const CREW_STAT_COUNT = 8; // di = 0,2,..,0xe @0x299a3..@0x29a99
export const CREW_STAT_CAPS = Object.freeze([0x4a, 0x4a, 0xde, 0x25, 0x6f, 0x6f, 0x6f, 0x6f]);
export const CREW_STAT_EVENTS = Object.freeze({ inc: [0x13, 0x1a], dec: [0x21, 0x28] });
export const SCROLL_STEP = 3; // add/sub word [0x3c98],3 @0x24487/@0x244aa

// --- globals the docs cite that a savegame CANNOT contain -------------------------
// Every one of these is DS >= 0x4654, i.e. above the blob's end marker, so its value
// is never written by @0x2cf5c nor restored by @0x2d0fb. Kept as data, not accessors.
export const TRANSIENT_GLOBALS = Object.freeze({
  global_4678: { ds: 0x4678, role: 'TODO_PERSISTED@DS:0x4678 — listed in re/state-format.md:40, meaning undocumented' },
  global_469c: { ds: 0x469c, role: 'TODO_PERSISTED@DS:0x469c — listed in re/state-format.md:40, meaning undocumented' },
  global_54b5: { ds: 0x54b5, role: 'TODO_PERSISTED@DS:0x54b5 — listed in re/state-format.md:40, meaning undocumented' },
  muNameTable: { ds: 0x6b8b, role: 'BH_MU1..13 index-derived name base, 14-byte stride (re/loader_map.md) — runtime pointer table' },
  frameLength: { ds: 0x7055, role: '2 bytes read from the picture file per record (re/FINDINGS.md:35) — loader scratch' },
  recordCount: { ds: 0x7058, role: 'per-table frame count [BX+4] (re/FINDINGS.md:34, re/script-vm.md:61)' },
  skipSelector: { ds: 0x70e1, role: '15 vs 9 second-stage skips (re/FINDINGS.md:37, re/script-vm.md:70)' },
  int9VectorSeg: { ds: 0xb998, role: 'saved INT 9 segment — mov [0xb998],dx @0x239f7 (re/game-loop-modes.md)' },
  paletteStaging: { ds: 0xb380, role: 'BSS palette staging buffer, 768 B, shr 1 x2 to DAC (re/formats-maps.md:61)' },
  global_4679: { ds: 0x4679, role: 'cmp byte [0x4679],0 @0x23efb — speaker/overlay gate' },
  tickLatch: { ds: 0x46a5, role: '60-tick latch, set @0x23c6a / cleared @0x23c86 (loop.js GLOBALS.pending60)' },
  cheatArmLatch: { ds: 0x46a7, role: "mode-2 'D' arming latch @0x244be/@0x244c9" },
  joyGateX: { ds: 0x4d5b, role: 'cmp word [0x4d5b],1 @0x24471 — pump axis gate' },
  joyGateY: { ds: 0x4d5d, role: 'cmp word [0x4d5d],1 @0x24494 — pump axis gate' },
  asciiLatch: { ds: 0x5bb8, role: '"AL is ASCII" latch @0x244f3/@0x24502 (loop.js GLOBALS.one_5bbb family)' },
  flag_5c1a: { ds: 0x5c1a, role: 'mov byte [0x5c1a],0xff @0x23c08/@0x2e7c7 (loop.js GLOBALS.flag_5c1a)' },
  slotNamePtr: { ds: 0x6b87, role: 'lea dx,[0x4388]+slot*0x24 parked here @0x2cf44/@0x2d0e6 before INT 21h/3Ch,3Dh' },
  mapSegmentScratch: { ds: 0x6b97, role: 'zone-3 loader: mov ax,[0x6b97] @0x2a7d5 is stored to DS:0x4552 and loaded into DS @0x2a7f2' },
  saveListBuffer: { ds: 0x6dd8, role: '240 B written to SAVLST.DAT: mov cx,0xf0 / lea dx,[0x6dd8] @0x2cf24/@0x2cf27' },
});

// --- fields that must stay TODO --------------------------------------------------
// Accessible by name, with no offset guessed. `confirm` is the global address whose
// disassembly closes the item.
export const TODO_FIELDS = Object.freeze({
  TODO_KEY_FLAGS: {
    blobOffset: null,
    confirm: 'INT 9 ISR @0x23c97..@0x23dd5, cs-override stores @0x23cb4/@0x23cba/@0x23cc7/@0x23d4c',
    blocker:
      're/game-loop-modes.md §3 puts cs:[0x3c..0x44] at DS:0x321c..0x3224 by subtracting 0x10000; the ' +
      'verified law is DS = linear - 0x10190 and the ISR runs in the code segment (runtime CS base ' +
      'linear 0x231e0), so the flags are at DS 0x1308c..0x13094 — outside the blob. Confirm the runtime ' +
      'CS value before ever persisting them; blob 12655..12663 (the DS:0x321c the doc names) is string data.',
  },
  TODO_JOY_AXIS_DELTA: {
    blobOffset: null,
    confirm: 'DS:0x3e39 — read together with DS:0x3ec5 at SOLAR1.c:13558',
    blocker: 'DS:0x3ec5 is proven (word_3ec5 below exposes it); its partner DS:0x3e39 sits in the ' +
      'DS 0x3ec5..0x4010 region that differs between the EXE image and BH_START.DAT and is never ' +
      'referenced by direct addressing. Confirm which global is the axis delta.',
  },
  TODO_MOTION_COUNTER: {
    blobOffset: null,
    confirm: 'DS:0x3ce..0x3d6 — byte-at-a-time decrement chain in SOLAR1.c:13575-13584',
    blocker: 'Five words/bytes at DS:0x3ce,0x3d0,0x3d2,0x3d4,0x3d6 are adjusted as one multi-precision ' +
      'counter. Width and sign are unconfirmed, so no accessor is provided.',
  },
  TODO_RESOURCE_TABLE: {
    blobOffset: null,
    confirm: 'DS:0x3ae8 (18 words, stride 2) gated by DS:0x3b10 — loop at SOLAR1.c:13569-13573',
    blocker: 'The pair-nonzero test + ±bVar3 adjustment says "two parallel word tables, 0x24 bytes ' +
      'apart"; what the rows are is undocumented. Needs the writer site confirmed.',
  },
  TODO_SCRIPT_RECORD_TABLE: {
    blobOffset: null,
    confirm: 'the `mov bx,0xbf9` / `mov ds,bx` pair @0x24fff-@0x25002 that re-points DS before 0x2507b',
    blocker: 're/script-vm.md:32 annotates `mov ax,[bx+0x521]` @0x2507b as a table in DS, but the '
      + 'picture loader FUN_231e_1e14 has already switched DS to 0xbf9 (@0x25002), so that 0x521 is an '
      + 'offset inside the resource segment, not inside the save blob. The blob bytes at DS:0x0521 are '
      + 'unrelated 0x7f-padded 13-byte rows. No accessor is provided; confirm which segment is live first.',
  },
  TODO_CREW_ROSTER: {
    blobOffset: null,
    confirm: 'BH_PEOP consumer FUN_231e_3f87 @0x27167 and the [0x3573]/[0x35af] cursor tables (@0x2c5d9, @0x2c307)',
    blocker: 're/FINDINGS.md loads BH_PEOP but no DS offset in the blob is proven to hold the roster. ' +
      'DS:0x3573 and DS:0x35af are cited only as "tables" by re/game-loop-modes.md §2 with no stride.',
  },
  TODO_SAVE_SLOT_LIST: {
    blobOffset: null,
    confirm: 'DS:0x6dd8 (saveListBuffer above) vs the in-blob name block DS:0x4388',
    blocker: 'SAVLST.DAT is written from a buffer above DS_END @0x2cf27, yet the same 10 names live ' +
      'inside the blob. Confirm whether the engine regenerates 0x6dd8 from 0x4388 at the menu, or the ' +
      'two drift apart after a load.',
  },
});

const DOLLAR = 0x24; // re/FINDINGS.md name-table delimiter

export function blobOffsetOf(dsOffset: number): number {
  if (dsOffset < DS_START || dsOffset >= DS_END) {
    throw new RangeError(`DS:0x${dsOffset.toString(16)} is outside the blob DS:0x00AD..0x4653 (@0x2cf5e/@0x2cf62)`);
  }
  return dsOffset - DS_START;
}

export function fileOffsetOfDs(dsOffset: number): number {
  return dsOffset + DS_FILE_DELTA;
}

export class State {
  /** The DS:0x00AD..0x4653 image, held as a blob-indexed Uint8Array. */
  bytes: Uint8Array;

  constructor(bytes?: Uint8Array | ArrayBuffer | ArrayLike<number>) {
    this.bytes = new Uint8Array(BLOB_LENGTH);
    if (bytes !== undefined) this.load(bytes);
  }

  // Accept the raw blob. Length must be exact: the engine reads precisely
  // 0x4654-0x00AD bytes into DS:0x00AD (@0x2d0fd/@0x2d101/@0x2d105) and only ever
  // rejects a read below MIN_LOAD_BYTES (@0x2d114), so a partial blob is not a
  // representable state here.
  load(bytes: Uint8Array | ArrayBuffer | ArrayLike<number>): this {
    const src = bytes instanceof Uint8Array
      ? bytes // covers a node Buffer
      : bytes instanceof ArrayBuffer
        ? new Uint8Array(bytes)
        : Uint8Array.from(bytes);
    if (src.length !== BLOB_LENGTH) {
      throw new RangeError(`state blob must be ${BLOB_LENGTH} bytes (DS:0x00AD..0x4653), got ${src.length}`);
    }
    this.bytes.set(src);
    return this;
  }

  // The file image, ready for INT 21h/40h at @0x2cf5c. A fresh game is
  // new State().load(BH_START.DAT).save() written to HSAVnn.DAT.
  save() {
    return this.bytes.slice();
  }

  // --- raw accessors: everything public below is sugar on these ------------------
  byteAt(dsOffset: number, value?: number): number {
    const i = blobOffsetOf(dsOffset);
    if (value === undefined) return this.bytes[i];
    this.bytes[i] = value & 0xff;
    return value & 0xff;
  }

  wordAt(dsOffset: number, value?: number): number {
    const i = blobOffsetOf(dsOffset);
    if (value === undefined) return this.bytes[i] | (this.bytes[i + 1] << 8);
    this.bytes[i] = value & 0xff;
    this.bytes[i + 1] = (value >> 8) & 0xff;
    return value & 0xffff;
  }

  region(dsOffset: number, length: number, value?: Uint8Array): Uint8Array {
    const i = blobOffsetOf(dsOffset);
    if (value === undefined) return this.bytes.subarray(i, i + length);
    this.bytes.set(value.subarray(0, length), i);
    return this.bytes.subarray(i, i + length);
  }

  // --- screen / loop state ------------------------------------------------------
  get mode() { return this.byteAt(DS.mode); } // 0..5, re/game-loop-modes.md dispatch chain
  set mode(v: number) { this.byteAt(DS.mode, v); }

  get inputGatherer() { return this.byteAt(DS.inputGatherer); } // 0 key/mouse, 1, >=2 — @0x23e03..@0x23e1e
  set inputGatherer(v: number) { this.byteAt(DS.inputGatherer, v); }

  get soundEnabled() { return this.byteAt(DS.soundEnabled); } // @0x23ec2/@0x23ef1 gate FUN_231e_3708
  set soundEnabled(v: number) { this.byteAt(DS.soundEnabled, v); }

  get cheatLatch() { return this.byteAt(DS.cheatLatch); } // the "52"/"DA" cheat gate read at @0x2e79e/@0x2e832/@0x2e866
  set cheatLatch(v: number) { this.byteAt(DS.cheatLatch, v); }

  get scrollPos() { return this.wordAt(DS.scrollPos); } // moves by SCROLL_STEP on arrow hold
  set scrollPos(v: number) { this.wordAt(DS.scrollPos, v); }

  get countdownTimer() { return this.wordAt(DS.countdownTimer); } // dec'd @0x23ed2, reset test @0x23eac
  set countdownTimer(v: number) { this.wordAt(DS.countdownTimer, v); }

  get countdownPrev() { return this.wordAt(DS.countdownPrev); } // copy of the previous tick @0x23ecf
  set countdownPrev(v: number) { this.wordAt(DS.countdownPrev, v); }

  get schedulerSlot() { return this.wordAt(DS.schedulerSlot); } // primed 0x32 @0x244e3
  set schedulerSlot(v: number) { this.wordAt(DS.schedulerSlot, v); }

  // Offsets proven, meaning not: these five are exactly what the pump writes at
  // 0x2444a..0x2446d, 0x2445f, 0x2e7a5 and SOLAR1.c:13558 — no semantic name is deserved yet.
  get byte_3c92() { return this.byteAt(DS.byte_3c92); } // TODO_MEANING@DS:0x3c92 — mov [0x3c92],cl @0x2445f
  set byte_3c92(v: number) { this.byteAt(DS.byte_3c92, v); }

  get byte_3c93() { return this.byteAt(DS.byte_3c93); } // TODO_MEANING@DS:0x3c93 — cmp 0xff @0x2444a, dec @0x2446d
  set byte_3c93(v: number) { this.byteAt(DS.byte_3c93, v); }

  get word_3c95() { return this.wordAt(DS.word_3c95); } // TODO_MEANING@DS:0x3c95 — mov 1 @0x2e7a5
  set word_3c95(v: number) { this.wordAt(DS.word_3c95, v); }

  get byte_455b() { return this.byteAt(DS.byte_455b); } // TODO_MEANING@DS:0x455b — neighbour of the list bounds
  set byte_455b(v: number) { this.byteAt(DS.byte_455b, v); }

  get word_3ec5() { return this.wordAt(DS.word_3ec5); } // TODO_JOY_AXIS_DELTA — += [0x3e39] (SOLAR1.c:13558)
  set word_3ec5(v: number) { this.wordAt(DS.word_3ec5, v); }

  // --- player progress ----------------------------------------------------------
  get actionPoints() { return this.wordAt(DS.actionPoints); } // dec @0x299ad..@0x29aa3, inc @0x29abf..@0x29b6e
  set actionPoints(v: number) { this.wordAt(DS.actionPoints, v); }

  get statBudget() { return this.wordAt(DS.statBudget); } // raised to the stat sum, SOLAR1.c:13440-13445
  set statBudget(v: number) { this.wordAt(DS.statBudget, v); }

  crewStat(index: number, value?: number): number {
    if (index < 0 || index >= CREW_STAT_COUNT) throw new RangeError(`crewStat index ${index} out of 0..${CREW_STAT_COUNT - 1} (di 0..0xe @0x29a99)`);
    return value === undefined ? this.wordAt(DS.crewStats + index * 2) : this.wordAt(DS.crewStats + index * 2, value);
  }

  crewStatCap(index: number): number {
    return CREW_STAT_CAPS[index]; // per-stat caps as cmp immediates: 0x4a @0x299a6, 0xde @0x299ec, 0x25 @0x29a10, 0x6f @0x29a33..@0x29a9c
  }

  // --- list / menu cursor (gatherer FUN_231e_4b35 @0x27d15) ----------------------
  get listCursor() { return this.byteAt(DS.listCursor); } // cmp dl,[0x455c] @0x2841b
  set listCursor(v: number) { this.byteAt(DS.listCursor, v); }

  get listMin() { return this.byteAt(DS.listMin); } // mov dl,[0x455a] @0x28407
  set listMin(v: number) { this.byteAt(DS.listMin, v); }

  get listMax() { return this.byteAt(DS.listMax); } // doc: cursor bounded by [0x455a..0x4559]
  set listMax(v: number) { this.byteAt(DS.listMax, v); }

  // --- save slots ---------------------------------------------------------------
  get saveSlot() { return this.wordAt(DS.saveSlot); } // 0-based; mov ax,[0x4552] @0x2cf36/@0x2d0d8 — see the alias note above
  set saveSlot(v: number) { this.wordAt(DS.saveSlot, v); }

  slotNameAddress(slot: number): number {
    if (slot < 0 || slot >= SLOT_COUNT) throw new RangeError(`slot ${slot} out of 0..${SLOT_COUNT - 1}`);
    return DS.slotNameTable + slot * SLOT_RECORD_BYTES; // lea dx,[0x4388] / add dx,ax @0x2cf3e/@0x2cf42
  }

  slotName(slot: number, value?: string): string | number {
    const ds = this.slotNameAddress(slot);
    const field = this.region(ds, SLOT_NAME_BYTES);
    if (value === undefined) {
      const nul = field.indexOf(0), dollar = field.indexOf(DOLLAR); // record ends at whichever comes first
      const ends = [nul, dollar].filter((i) => i !== -1);
      const end = ends.length ? Math.min(...ends) : SLOT_NAME_BYTES;
      return new TextDecoder().decode(field.subarray(0, end));
    }
    const encoded = new TextEncoder().encode(value);
    if (encoded.length > SLOT_NAME_BYTES - 2) {
      throw new RangeError(`slot name "${value}" is ${encoded.length} B; the field is ${SLOT_NAME_BYTES - 2} B + 00 24 (@0x2cf3e stride 0x24)`);
    }
    field.fill(0);
    field.set(encoded, 0);
    field[encoded.length] = 0x00;
    field[encoded.length + 1] = DOLLAR; // "HSAV01.DAT" 00 24 + 24 spaces, blob 17115..
    return value;
  }

  slotNameRecord(slot: number): Uint8Array {
    return this.region(this.slotNameAddress(slot), SLOT_RECORD_BYTES); // +24 pad bytes, all 0x20 in BH_START
  }

  // --- DOS vectors restored by the blob (NOT re-installed by this class) ---------
  get int24VectorSeg() { return this.wordAt(DS.int24VectorSeg); } // mov [0x4384],es @0x239d7
  set int24VectorSeg(v: number) { this.wordAt(DS.int24VectorSeg, v); }

  get int24VectorOfs() { return this.wordAt(DS.int24VectorOfs); } // mov [0x4386],bx @0x239db
  set int24VectorOfs(v: number) { this.wordAt(DS.int24VectorOfs, v); }

  // --- loader scratch that happens to be inside the blob -------------------------
  get mapReadLength() { return this.wordAt(DS.mapReadLength); } // zone-1/zone-3 actual byte count @0x2a002 / @0x2a7ba
  set mapReadLength(v: number) { this.wordAt(DS.mapReadLength, v); }
}
