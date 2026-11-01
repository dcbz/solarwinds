// Opening encounter and incoming-hail timers from SOLAR1.EXE.
//
// FUN_231e_7ad6 @0x2acb6 is called once per live pump while DS:0x3be9 != 1.
// BH_START.DAT deliberately seeds its counter to 199, so the first pump takes the
// 200 branch: the UNKNOWN Rigian ship is uncloaked 80 pixels to the player's right.

import type { State } from './state.ts';
import { DS_FILE_DELTA } from './state.ts';
import { TABLES, recordAt } from './script.ts';

export const OPENING_STORY = Object.freeze({
  talkedToClaw: 0x3be7,
  done: 0x3be9,
  counter: 0x3bea,
  hailScanCounter: 0x3bec,
  hailPhase: 0x3c44,
  hailActive: 0x3c45,
  unknownActor: 0x0bf8,       // actor #160, ship code 6 / script 3 at boot
  unknownScript: 0x1478,      // mutable byte +2 in ship record 6
  incomingHailTimer: 0x154b6, // transient word; above the save-blob boundary
  sites: {
    scheduler: 0x2acb6,
    hailTarget: 0x2dc5d,
    hailPulse: 0x2dcea,
    hailMessage: 0x2dd34,
  },
});

/** Actual runtime DS pointers used by FUN_231e_7ad6/FUN_231e_ab0a. */
export const OPENING_MESSAGE = Object.freeze({
  vadium: 0x57fb,
  uncloaking: 0x5818,
  pressCommunicate: 0x6f65,
  cloaking: 0x5834,
  rendezvous: 0x57da,
  beingHailed: 0x599a,
});

export interface StoryMessage {
  ds: number;
  text: string;
  site: number;
}

export interface OpeningStoryStep {
  counter: number;
  messages: StoryMessage[];
  spawned: boolean;
  departed: boolean;
  finished: boolean;
}

/** Read a '$'-terminated string through the verified runtime law file = DS + 0xf90. */
export function runtimeString(exe: Uint8Array, ds: number): string {
  let p = ds + DS_FILE_DELTA;
  if (p < 0 || p >= exe.length) return '';
  let out = '';
  while (p < exe.length && exe[p] !== 0x24 && exe[p] !== 0x00) {
    out += String.fromCharCode(exe[p]);
    p += 1;
  }
  return out.replace(/\x01/g, '').replace(/\x60/g, "'");
}

function message(exe: Uint8Array, ds: number, site: number): StoryMessage {
  return { ds, text: runtimeString(exe, ds), site };
}

/** Copy camera cell/low coordinates to actor #160 with the original X displacement and carry. */
function placeUnknown(state: State, xOffset: number): void {
  const a = OPENING_STORY.unknownActor;
  const low = state.byteAt(0x3d6);
  state.byteAt(a + 8, low + xOffset);
  state.byteAt(a + 6, state.byteAt(0x3d4) + (low + xOffset > 0xff ? 1 : 0));
  state.byteAt(a + 9, state.byteAt(0x3d7));
  state.byteAt(a + 7, state.byteAt(0x3d5));
}

/** FUN_231e_7ad6 @0x2acb6, including every compare and write in the shipped routine. */
export function stepOpeningStory(state: State, exe: Uint8Array): OpeningStoryStep {
  if (state.byteAt(OPENING_STORY.done) === 1) {
    return { counter: state.wordAt(OPENING_STORY.counter), messages: [], spawned: false, departed: false, finished: true };
  }

  const counter = (state.wordAt(OPENING_STORY.counter) + 1) & 0xffff;
  state.wordAt(OPENING_STORY.counter, counter);
  const messages: StoryMessage[] = [];
  let spawned = false;
  let departed = false;

  if (counter === 100) {
    messages.push(message(exe, OPENING_MESSAGE.vadium, 0x2acc1));
  } else if (counter === 200) {
    messages.push(message(exe, OPENING_MESSAGE.uncloaking, 0x2acd5));
    const a = OPENING_STORY.unknownActor;
    state.byteAt(a, 0x7f);
    state.byteAt(a + 1, 0x7f);
    placeUnknown(state, 0x50);
    spawned = true;
  } else if (counter === 0x118) {
    messages.push(message(exe, OPENING_MESSAGE.pressCommunicate, 0x2ad1b));
  } else if (counter === 1000) {
    messages.push(message(exe, OPENING_MESSAGE.cloaking, 0x2ad2f));
  } else if (counter === 0x405) {
    placeUnknown(state, 0x87);
  } else if (counter === 0x406) {
    // Move the encounter out of the current sector and turn ship record 6 from
    // conversation 3 into conversation 15 for its later story appearance.
    const a = OPENING_STORY.unknownActor;
    state.byteAt(a + 4, 0x78);
    state.byteAt(a + 5, 0x7a);
    state.byteAt(OPENING_STORY.unknownScript, 0x0f);
    departed = true;
  } else if (counter === 2000) {
    if (state.byteAt(OPENING_STORY.talkedToClaw) !== 1) {
      messages.push(message(exe, OPENING_MESSAGE.rendezvous, 0x2ad9d));
    }
    state.byteAt(OPENING_STORY.done, 1);
  }

  return { counter, messages, spawned, departed, finished: state.byteAt(OPENING_STORY.done) === 1 };
}

/**
 * FUN_231e_aa7d @0x2dc5d: every byte-counter rollover, inspect the first visible
 * object's data-record hail flag and arm the animated incoming-message indicator.
 */
export function updateHailTarget(state: State, exe: Uint8Array, visible: number[]): boolean {
  const scan = (state.byteAt(OPENING_STORY.hailScanCounter) + 1) & 0xff;
  state.byteAt(OPENING_STORY.hailScanCounter, scan);
  if (scan !== 0 || state.byteAt(OPENING_STORY.hailActive) !== 0 || visible.length === 0) return false;

  const actor = visible[0];
  const code = (state.byteAt(actor + TABLES.actors.scriptLo) << 8) |
    state.byteAt(actor + TABLES.actors.scriptHi);
  if (code === 0) return false;
  let flag = 0;
  if (code < TABLES.starBase) {
    flag = state.byteAt(recordAt(exe, 'ships', code) + 4);
  } else {
    flag = state.byteAt(recordAt(exe, 'stars', code - TABLES.starBase) + 0x19);
  }
  if (flag === 0) return false;
  state.byteAt(OPENING_STORY.hailPhase, 0);
  state.byteAt(OPENING_STORY.hailActive, 1);
  return true;
}

/**
 * Message-producing part of FUN_231e_ab0a @0x2dcea. The caller invokes this on
 * the pump's seven-pass divider; framebuffer-only indicator shading stays in the renderer.
 */
export function stepIncomingHail(
  state: State,
  exe: Uint8Array,
  visible: number[],
  transient: Record<number, number | undefined>,
): StoryMessage | null {
  if (state.byteAt(0x3ade) === 1 || state.byteAt(0x3add) === 1) return null;
  if (visible.length === 0) state.byteAt(OPENING_STORY.hailActive, 0);
  if (state.byteAt(OPENING_STORY.hailActive) === 0) return null;

  const key = OPENING_STORY.incomingHailTimer;
  const timer = ((transient[key] ?? 0) + 1) & 0xffff;
  transient[key] = timer;
  if (timer !== 0x28) return null;
  transient[key] = 0;
  return message(exe, OPENING_MESSAGE.beingHailed, OPENING_STORY.sites.hailMessage);
}
