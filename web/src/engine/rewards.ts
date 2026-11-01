// FUN_231e_a592 @0x2d772 — the campaign director. `lcall`ed at the tail of FUN_231e_a26d @0x2d44d
// (the `c` communicate routine) after the conversation-id switch, so it runs after EVERY talk.
//
// It is a *scanner*: it walks the persistent conversation control slots at DS:0x35e1 (the same
// 64-byte-per-script region vm.ts mutates — see re/script-vm.md §3) one byte at a time. A normal
// control byte is 0..0x63 (a visible choice selector, vm.ts's "1..99") or 0xff (an END marker, which
// decrements a 15-count stop guard). A byte in 0x64..0xfe is a *deferred world event*: the conversation
// effect cascade stored it there so the choice disappears AND the reward fires once, on return to the
// map. On the first such byte the routine applies it, zeroes the slot, and returns (one reward per call).
//
// This is where the shareware's economy lives: conversations hand you cargo, refill missile banks,
// raise the crew count (the AP budget DS:0x3c5c, see loop.ts tickStatPool), relocate the camera, and
// arm the zone cutscenes. Before this file the port implemented only the `in_BX == 3` fast-forward
// branch of it, so the cargo list, missile resupply and crew growth never advanced the game.
//
// ADDRESS LAW (re/state-format.md): blob index = DS - 0xAD; every DS offset below is written with
// State.byteAt/wordAt, which apply that. `linear` in a citation = 0x2d772 + (offset from the branch).

import type { State } from './state.ts';

/** cargo base = 0x3c7a, count word = DS:0x3c56 (loop.ts GLOBALS cargoCount). */
export const CARGO_BASE = 0x3c7a;
export const CARGO_COUNT = 0x3c56;
/** missile ammo words: DS:0x359b (bank A) and DS:0x35a1 (bank B). panels.ts reads the same table. */
const MISSILE_BANK_A = 0x359b;
const MISSILE_BANK_B = 0x35a1;

/** One literal `mov` from a branch: [DS offset, value, width]. */
export type RewardWrite = [number, number, 1 | 2];

export interface StoryReward {
  /** literal `mov` stores, in source order (the order matters where a branch re-reads, none here do) */
  writes?: RewardWrite[];
  /** `*(0x3c56 + 0x3c7a) = code; 0x3c56++` — append cargo of this type code */
  cargo?: number[];
  /** `*(int*)word += delta` on the missile banks */
  ammo?: Array<[number, number]>;
  /** `word[0x3c5c] += n` — crew / action-point budget growth */
  crew?: number;
  /** named routines the branch calls: rebuild the starfield / the world / re-init sound */
  calls?: Array<'starfield' | 'rebuild' | 'sound'>;
  /** a branch whose cargo effect is procedural (search/convert), not a plain append */
  special?: 'upgrade-scanner' | 'search-type-1-then-6' | 'indexed-0x224f';
  cite: string;
}

// The `in_BX == 3` head of the function (a592 @0x2d777) is ported in loop.ts finishConversation,
// not here: it keys on the conversation id, not on a stored control byte.
export const STORY_REWARDS: Record<number, StoryReward> = {
  0x65: {
    // break, then `while (*(iVar2+0x3c7b) != 5) ...; *(iVar2+0x3c7b) = 8` — convert a held scanner
    // (type 5) into its upgraded form (type 8). Falls through to the script-1 reset below.
    writes: [[0x35e1, 3, 1], [0x35e2, 0, 1], [0x35e3, 0, 1], [0x35e4, 0, 1], [0x35e5, 0, 1],
      [0x35e6, 0, 1], [0x35e7, 0, 1], [0x35e8, 0, 1], [0x35e9, 0, 1], [0x35ea, 0, 1], [0x35eb, 0, 1],
      [0x35ec, 0, 1], [0x3ac9, 1, 2], [0x3ab9, 0, 2]],
    cite: '@0x2da3e bVar==0x65: cargo5->cargo8 then script-1 reset (@0x2da55..@0x2daf0)',
    special: 'upgrade-scanner',
  },
  0x66: {
    cargo: [8],
    writes: [[0x35e1, 3, 1], [0x35e2, 0, 1], [0x35e3, 0, 1], [0x35e4, 0, 1], [0x35e5, 0, 1],
      [0x35e6, 0, 1], [0x35e7, 0, 1], [0x35e8, 0, 1], [0x35e9, 0, 1], [0x35ea, 0, 1], [0x35eb, 0, 1],
      [0x35ec, 0, 1], [0x3ab9, 0, 2], [0x3ac9, 1, 2]],
    cite: '@0x2d7f2 bVar==0x66: give cargo 8; reset script-1 slot; 0x3ab9=0; 0x3ac9=1',
  },
  0x67: {
    cargo: [5],
    writes: [[0xe36, 2, 1], [0x1357, 0, 1], [0x1359, 0, 1], [0x35ea, 2, 1],
      [0x3ab9, 1, 2], [0x3abb, 1, 2], [0x3ab7, 0, 2]],
    cite: '@0x2d842 bVar==0x67: give cargo 5 (a scanner); DS:0xe36=2; 0x3ab9/0x3abb=1',
  },
  0x68: {
    writes: [[0xe36, 2, 1], [0x1357, 0, 1], [0x1359, 0, 1], [0x3ab7, 0, 2]],
    cite: '@0x2d89a bVar==0x68: DS:0xe36=2; clear the two 0x135x scan words; 0x3ab7=0',
  },
  0x69: {
    cargo: [0xc],
    writes: [[0x3abf, 1, 2], [0x3abd, 0, 2]],
    cite: '@0x2d8c4 bVar==0x69: give cargo 0xc; 0x3abf=1',
  },
  0x6a: {
    ammo: [[MISSILE_BANK_A, 15], [MISSILE_BANK_B, 5]],
    writes: [[0x2c93, 8, 1], [0x2c95, 1, 1], [0xc05, 0x7f, 1], [0xc06, 0x7f, 1], [0x3ac1, 0, 2]],
    cite: '@0x2d8ee bVar==0x6a: +15/+5 missile ammo; actor DS:0x2c93 type 8; 0x3ac1=0',
  },
  0x6b: {
    cargo: [1, 3],
    ammo: [[MISSILE_BANK_A, 5], [MISSILE_BANK_B, 3]],
    writes: [[0x35b3, 1, 2], [0x3577, 1, 2], [0x2c93, 0, 1], [0x2c95, 0, 1],
      [0x36e1, 5, 1], [0x36ea, 1, 1], [0x3ac5, 1, 2], [0x3ac3, 0, 2]],
    cite: '@0x2d936 bVar==0x6b: +5/+3 ammo, cargo 1 and 3, ship record 0x36e1=5',
  },
  0x6c: {
    // goto LAB_231e_a7dc: find a cargo row of type 1; if none, append one (count++, index+=2);
    // cargo[index] = 6 (install a tractor). Then configure the ship record 0x36e1.
    writes: [[0x36e1, 6, 1], [0x36e2, 0, 1], [0x36e3, 0, 1], [0x36e4, 0, 1], [0x36e5, 0, 1],
      [0x36e6, 0, 1], [0x36e7, 0, 1], [0x36e8, 0, 1], [0x36e9, 0, 1], [0x36ea, 0, 1],
      [0x224f, 7, 1], [0x2251, 1, 1], [0x3761, 1, 1], [0x3762, 1, 1], [0x3763, 1, 1],
      [0x3764, 1, 1], [0x3765, 1, 1], [0x3766, 1, 1], [0x3ac7, 1, 2], [0x3ac5, 0, 2]],
    cite: '@0x2da3e bVar==0x6c: goto cargo-search -> install tractor (type 6), ship 0x36e1=6',
    special: 'search-type-1-then-6',
  },
  0x6d: {
    crew: 200,
    writes: [[0x3be6, 1, 1], [0x3acb, 1, 2], [0x3ac7, 0, 2]],
    calls: ['sound'],
    cite: '@0x2d9a0 bVar==0x6d: 0x3be6=1, crew +200 (0x3c5c), FUN_231e_3708 sound re-init',
  },
  0x6e: {
    cargo: [0xd],
    writes: [[0x3821, 3, 1], [0x224f, 7, 1], [0x2251, 1, 1], [0x3761, 3, 1], [0x3769, 1, 1],
      [0x3762, 0, 1], [0x3763, 0, 1], [0x3764, 0, 1], [0x3765, 0, 1], [0x3766, 0, 1],
      [0x3767, 0, 1], [0x3768, 0, 1], [0x25dd, 0xc, 1], [0x3acf, 1, 2], [0x3acd, 0, 2]],
    cite: '@0x2d9d0 bVar==0x6e: cargo 0xd; ship record 0x3761=3; 0x25dd=0xc',
  },
  0x6f: {
    ammo: [[MISSILE_BANK_A, 10], [MISSILE_BANK_B, 5]],
    writes: [[0x35b7, 1, 2], [0x35b9, 1, 2], [0x3579, 1, 2], [0x357f, 1, 2]],
    cite: '@0x2da66 bVar==0x6f: +10/+5 missile ammo; four presence words = 1',
  },
  0x70: {
    writes: [[0x3c46, 0xff, 1], [0xc12, 0, 1], [0x5c1a, 0xff, 1]],
    calls: ['starfield', 'rebuild'],
    cite: '@0x2dab0 bVar==0x70: 0x3c46=0xff, starfield reset + world rebuild (FUN_231e_88f9/0458/0045)',
  },
  0x71: {
    writes: [[0xc12, 0, 1], [0x5c1a, 0xff, 1], [0x3ad5, 0, 2]],
    calls: ['starfield', 'rebuild'],
    cite: '@0x2dae2 bVar==0x71: rebuild; 0x3ad5=0',
  },
  0x72: {
    writes: [[0x3adf, 1, 2], [0x3acd, 1, 2], [0x3ac9, 0, 2]],
    cite: '@0x2db12 bVar==0x72: 0x3adf=1 (alternate portrait flag), 0x3acd=1',
  },
  0x73: {
    writes: [[0x3c46, 0xff, 1]],
    cite: '@0x2db34 bVar==0x73: 0x3c46=0xff',
  },
  0x74: {
    writes: [[0x3d2, 200, 1], [0x3d3, 200, 1], [0x3d4, 0x7f, 1], [0x3d5, 0x7f, 1],
      [0x3d6, 100, 1], [0x3d7, 100, 1], [0xc12, 0, 1], [0x5c1a, 0xff, 1]],
    calls: ['starfield', 'rebuild'],
    cite: '@0x2db4a bVar==0x74: move the camera (DS:0x3d2..0x3d7), rebuild',
  },
  0x75: {
    cargo: [2, 0xd],
    writes: [[0x3ad5, 1, 2], [0x3ad1, 0, 2]],
    cite: '@0x2dba2 bVar==0x75: cargo 2 and 0xd; 0x3ad5=1',
    special: 'indexed-0x224f',
  },
  0x95: {
    writes: [[0x3ac9, 1, 2]],
    cite: '@0x2dc1f bVar==0x95: 0x3ac9=1',
  },
  0x96: {
    writes: [[0x3ab7, 1, 2], [0x3ab5, 0, 2]],
    cite: '@0x2dc04 bVar==0x96: 0x3ab7=1, 0x3ab5=0',
  },
};

export interface RewardResult {
  trigger: number;
  slotIndex: number;      // byte offset from DS:0x35e1
  cargo: number[];
  ammo: Array<[number, number]>;
  crew: number;
  calls: string[];
  /** DS writes at/above DS_END (0x4654): transient globals the save blob does not cover, e.g. the
   *  redraw latch DS:0x5c1a. loop.ts mirrors these into its sparse `g` layer. */
  latch: number[];
  note: string;
}

/** One cargo row: DS:0x3c79 + i is the "next free" writer, but a592 indexes 0x3c7a + count. */
function appendCargo(sv: State, code: number): void {
  const n = sv.wordAt(CARGO_COUNT);
  sv.byteAt(CARGO_BASE + n, code);
  sv.wordAt(CARGO_COUNT, n + 1);
}

/** The save blob spans DS:0x00AD..0x4653 (state.ts). Writes at or above DS_END are transient. */
const DS_END = 0x4654;

/**
 * Transcribe the a592 scan. Applies the FIRST deferred trigger found in the control-slot region and
 * returns it, exactly as the EXE returns after one branch. `slotBase` is DS:0x35e1.
 */
export function applyStoryReward(sv: State, slotBase = 0x35e1): RewardResult | null {
  let guard = 0xf;
  for (let i = 0; i < 0x280; i++) {
    if (guard === 0) return null;
    const b = sv.byteAt(slotBase + i);
    if (b === 0xff) { guard -= 1; continue; }
    if (b <= 0x63) continue;
    const reward = STORY_REWARDS[b];
    sv.byteAt(slotBase + i, 0); // every branch clears the trigger first (or in-line before returning)
    const res: RewardResult = {
      trigger: b, slotIndex: i,
      cargo: reward?.cargo ?? [],
      ammo: reward?.ammo ?? [],
      crew: reward?.crew ?? 0,
      calls: reward?.calls ?? [],
      latch: [],
      note: reward?.cite ?? `@0x2d772 a592: unhandled control byte 0x${b.toString(16)} (cleared, no effect transcribed)`,
    };
    if (!reward) return res;
    // Special procedural branches touch the cargo array in ways the declarative fields cannot say.
    if (reward.special === 'upgrade-scanner') {
      for (let k = 0; k + 1 < sv.wordAt(CARGO_COUNT); k++) {
        if (sv.byteAt(CARGO_BASE + k + 1) === 5) sv.byteAt(CARGO_BASE + k + 1, 8);
      }
    } else if (reward.special === 'search-type-1-then-6') {
      let idx = -1;
      const count = sv.wordAt(CARGO_COUNT);
      for (let k = 0; k < count; k++) if (sv.byteAt(CARGO_BASE + k) === 1) { idx = k; break; }
      if (idx < 0) { appendCargo(sv, 6); idx = sv.wordAt(CARGO_COUNT) - 1; }
      else sv.byteAt(CARGO_BASE + idx, 6);
    } else {
      for (const code of reward.cargo ?? []) appendCargo(sv, code);
    }
    for (const [addr, delta] of reward.ammo ?? []) sv.wordAt(addr, (sv.wordAt(addr) + delta) & 0xffff);
    if (reward.crew) sv.wordAt(0x3c5c, sv.wordAt(0x3c5c) + reward.crew);
    for (const [addr, value, width] of reward.writes ?? []) {
      if (addr >= DS_END) { res.latch.push(addr, value, width); continue; } // transient: 0x5c1a
      if (width === 1) sv.byteAt(addr, value); else sv.wordAt(addr, value);
    }
    return res;
  }
  return null;
}
