// Solar Winds conversation VM — transcription of FUN_231e_1e14 @0x24ff4.
//
// This is not a conventional opcode VM. It combines three shipped data sources:
//   * BH_CONV.DAT: a node, prompt, choice-link, response and effect graph;
//   * BH_START.DAT DS:0x35e1: one persistent 64-byte control slot per script;
//   * BH_PEOP.DAT: <u16 length, stone-RLE payload> portrait records.
//
// The interpreter body is the cmp-chain at 0x251e2..0x2539f. Values 1..99 in a
// control slot expose choices, response blocks are selected by walking 0xff
// separators, and the bytes after a response's '$' rewrite the control slot.

import { decodeRLE, decodeRecords } from '../rle.ts';

export const SCRIPT_SLOT_STRIDE = 0x40; // mul cx with cx=0x40 @0x25071..@0x25076
export const SCRIPT_STATE_BASE = 0x35e1; // caller's `lea cx,[0x35e1]` @0x2d53b
export const NODE_TABLE = 0x521; // mov ax,[bx+0x521] after shl bx,1 @0x25079..@0x2507b
export const DOLLAR = 0x24;
export const EFFECT_END = 0xff;

export interface VmStateMemory {
  byteAt(dsOffset: number, value?: number): number;
}

export interface PortraitFrame {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface PortraitRecord {
  index: number;
  compressedLength: number;
  decodedLength: number;
  frames: PortraitFrame[];
  /** 1-based frame numbers from BH_CONV's portrait animation table. */
  animation?: number[];
}

export interface VmChoice {
  record: number;
  controlAddress: number;
  selector: number;
  label: string;
  target: number;
}

export interface VmView {
  scriptId: number;
  node: number;
  stage: number;
  prompt: string;
  choices: VmChoice[];
  response?: string;
  complete: boolean;
  aborted: boolean;
  portrait: PortraitRecord | null;
  alternatePortrait: PortraitRecord | null;
}

export interface VmTrace {
  addr: number;
  detail: string;
}

interface ChoiceRecord {
  record: number;
  label: string;
  target: number;
}

const u16 = (b: Uint8Array, o: number): number => {
  if (o < 0 || o + 1 >= b.length) throw new RangeError(`u16 outside data at 0x${o.toString(16)}`);
  return b[o] | (b[o + 1] << 8);
};

function text(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let p = start; p < end; p++) {
    const c = bytes[p];
    if (c === 0x01 || c === 0x0d || c === 0x0a) out += '\n';
    else if (c >= 0x20 && c < 0x7f) out += String.fromCharCode(c);
  }
  return out.trim();
}

function dollarEnd(bytes: Uint8Array, start: number): number {
  for (let p = start; p < bytes.length; p++) if (bytes[p] === DOLLAR) return p;
  throw new RangeError(`unterminated '$' string at 0x${start.toString(16)}`);
}

export function slotOffset(scriptNumber: number): number {
  if (!Number.isInteger(scriptNumber) || scriptNumber < 1) throw new RangeError(`invalid script id ${scriptNumber}`);
  return (scriptNumber - 1) * SCRIPT_SLOT_STRIDE;
}

export function slotAddress(scriptNumber: number): number {
  return SCRIPT_STATE_BASE + slotOffset(scriptNumber);
}

/** Read the Nth '$'-terminated prompt. `stage` is 1-based, like slot[0] at @0x251f8. */
export function promptAt(conv: Uint8Array, start: number, stage: number): string {
  let p = start;
  for (let n = Math.max(1, stage); n > 1; n--) p = dollarEnd(conv, p) + 1;
  const end = dollarEnd(conv, p);
  return text(conv, p, end);
}

/**
 * Parse `LABEL '$' <u16 target>` records. A final `LABEL '$' '$'` is the sentinel;
 * the original draws its own END COMMUNICATION string from DS:0x70ca and never follows
 * a target for that row (@0x2525d..@0x2526e), so it is excluded here.
 */
export function choiceRecords(conv: Uint8Array, start: number, max = 64): ChoiceRecord[] {
  const out: ChoiceRecord[] = [];
  let p = start;
  for (let record = 0; record < max; record++) {
    const end = dollarEnd(conv, p);
    if (conv[end + 1] === DOLLAR) return out;
    if (end + 2 >= conv.length) throw new RangeError(`choice link outside BH_CONV.DAT at 0x${end.toString(16)}`);
    out.push({ record, label: text(conv, p, end), target: u16(conv, end + 1) });
    p = end + 3; // add di,3 @0x252da
  }
  throw new RangeError(`choice block at 0x${start.toString(16)} exceeds ${max} records`);
}

/** Split one decoded BH_PEOP record into its [u8 width,u8 height,pixels] frames. */
export function portraitFrames(decoded: Uint8Array): PortraitFrame[] {
  const out: PortraitFrame[] = [];
  let p = 0;
  while (p + 2 <= decoded.length) {
    const width = decoded[p++];
    const height = decoded[p++];
    if (width === 0 || height === 0) break;
    const size = width * height;
    if (p + size > decoded.length) throw new RangeError(`portrait frame ${width}x${height} overruns decoded record`);
    out.push({ width, height, pixels: decoded.slice(p, p + size) });
    p += size;
  }
  return out;
}

/** BH_PEOP is the length-prefixed file opened through DS:0x7089 at @0x25092/@0x25138. */
export function decodePortraits(peopleDat: Uint8Array): PortraitRecord[] {
  return decodeRecords(peopleDat, 'stone').map((r, i) => {
    const decoded = decodeRLE(peopleDat.subarray(r.offset, r.offset + r.len), 'stone');
    return {
      index: i + 1,
      compressedLength: r.len,
      decodedLength: decoded.length,
      frames: portraitFrames(decoded),
    };
  });
}

/**
 * BH_CONV offsets 0x0d..0x2c are 16 pointers, one per BH_PEOP record. Each target is
 * `{u16 count, u16 frame[count-1]}`. FUN_231e_248f starts its cursor at one, reads
 * `[table + cursor*2]`, and returns when the incremented cursor equals count
 * (@0x256ba..@0x256d4, @0x257fc..@0x2580c).
 */
export function portraitAnimation(conv: Uint8Array, oneBased: number): number[] {
  if (!Number.isInteger(oneBased) || oneBased < 1 || oneBased > 16) return [];
  const pointerAt = 0x0d + (oneBased - 1) * 2;
  const table = u16(conv, pointerAt);
  const count = u16(conv, table);
  const sequence: number[] = [];
  for (let cursor = 1; cursor < count; cursor++) {
    const at = table + cursor * 2;
    if (at + 1 >= conv.length) throw new RangeError(`portrait ${oneBased} animation overruns BH_CONV.DAT`);
    sequence.push(u16(conv, at));
  }
  return sequence;
}

function portraitAt(records: PortraitRecord[] | undefined, oneBased: number): PortraitRecord | null {
  return records?.[oneBased - 1] ?? null;
}

/** Stateful instance of FUN_231e_1e14. It writes directly into the save blob. */
export class ConversationVm {
  readonly conv: Uint8Array;
  readonly state: VmStateMemory;
  readonly scriptId: number;
  readonly node: number;
  readonly promptHead: number;
  readonly choiceHead: number;
  readonly portraitIndex: number;
  readonly portraits?: PortraitRecord[];
  readonly alternatePortraitIndex: number;
  readonly trace: VmTrace[] = [];
  response: string | undefined;
  complete = false;
  aborted = false;

  constructor(conv: Uint8Array, state: VmStateMemory, scriptId: number, portraits?: PortraitRecord[], alternatePortraitIndex = 15) {
    this.conv = conv;
    this.state = state;
    this.scriptId = scriptId;
    // The decoded BH_PEOP frames are not played linearly. BH_CONV supplies a deliberately
    // non-linear talking/blinking sequence for each face; linear playback exposes transition
    // and mask frames as large black crops.
    this.portraits = portraits?.map((record) => ({
      ...record,
      animation: portraitAnimation(conv, record.index),
    }));
    this.alternatePortraitIndex = alternatePortraitIndex; // SI=15, or 9 for DI==1 @0x2512b..@0x25135
    const table = NODE_TABLE + (scriptId - 1) * 2;
    this.node = u16(conv, table);
    if (this.node < 6 || this.node + 5 >= conv.length) throw new RangeError(`script ${scriptId} has invalid node 0x${this.node.toString(16)}`);
    this.portraitIndex = u16(conv, this.node); // record[+0] -> [0x7064] @0x25081..@0x25083
    this.promptHead = u16(conv, this.node + 2);
    this.choiceHead = u16(conv, this.node + 4);
    this.trace.push({ addr: 0x2507b, detail: `script ${scriptId} -> node 0x${this.node.toString(16)}` });
  }

  get slot(): number { return slotAddress(this.scriptId); }
  get stage(): number { return this.state.byteAt(this.slot); }

  private control(record: number): number {
    return this.state.byteAt(this.slot + 1 + record);
  }

  view(): VmView {
    const choices: VmChoice[] = [];
    for (const row of choiceRecords(this.conv, this.choiceHead)) {
      const selector = this.control(row.record);
      // cmp al,0 / je; cmp al,0x64 / jae @0x25243..@0x25249
      if (selector !== 0 && selector < 0x64) {
        choices.push({ ...row, selector, controlAddress: this.slot + 1 + row.record });
      }
    }
    return {
      scriptId: this.scriptId,
      node: this.node,
      stage: this.stage,
      prompt: promptAt(this.conv, this.promptHead, this.stage),
      choices,
      response: this.response,
      complete: this.complete,
      aborted: this.aborted,
      portrait: portraitAt(this.portraits, this.portraitIndex),
      alternatePortrait: portraitAt(this.portraits, this.alternatePortraitIndex),
    };
  }

  /** Escape or the synthetic END COMMUNICATION item. */
  abort(): VmView {
    this.aborted = true;
    this.trace.push({ addr: 0x25286, detail: 'Escape/END COMMUNICATION -> exit 0x2539f' });
    return this.view();
  }

  /** Select a currently visible choice by zero-based display index. */
  choose(displayIndex: number): VmView {
    if (this.complete || this.aborted) return this.view();
    const visible = this.view().choices;
    const choice = visible[displayIndex];
    if (!choice) throw new RangeError(`choice ${displayIndex + 1} is not visible (have ${visible.length})`);

    // The control value selects the (selector-1)th 0xff-delimited response block
    // at @0x252f1..@0x2530c.
    let response = choice.target;
    for (let n = 1; n < choice.selector; n++) {
      while (response < this.conv.length && this.conv[response] !== EFFECT_END) response++;
      if (response >= this.conv.length) throw new RangeError(`response branch ${n + 1} outside BH_CONV.DAT`);
      response++;
    }
    const end = dollarEnd(this.conv, response);
    this.response = text(this.conv, response, end);
    this.trace.push({ addr: 0x252f1, detail: `choice ${displayIndex + 1} selector ${choice.selector} -> response 0x${response.toString(16)}` });

    // Effect cascade @0x25339..@0x2538f. Destination starts at slot+1.
    let src = end + 1;
    let dst = this.slot + 1;
    while (src < this.conv.length && this.conv[src] !== EFFECT_END) {
      const op = this.conv[src];
      if (op === 0x01 && this.conv[src + 1] === EFFECT_END) {
        this.state.byteAt(this.slot, (this.stage + 1) & 0xff);
        this.complete = true;
        this.trace.push({ addr: 0x2535f, detail: `terminal 01 ff: slot[0] -> ${this.stage}` });
        break;
      }
      if (op === 0x01) this.state.byteAt(dst, 0);
      else if (op === 0x02) this.state.byteAt(dst, 1);
      else if (op !== 0x00) this.state.byteAt(dst, op);
      this.trace.push({ addr: 0x25349, detail: `effect 0x${op.toString(16)} -> DS:0x${dst.toString(16)}=${this.state.byteAt(dst)}` });
      src++;
      dst++;
    }
    if (src >= this.conv.length) throw new RangeError(`unterminated effect at response 0x${response.toString(16)}`);
    return this.view();
  }
}

export function createConversationVm(
  conv: Uint8Array,
  state: VmStateMemory,
  scriptId: number,
  peopleDat?: Uint8Array,
  alternatePortraitIndex = 15,
): ConversationVm {
  return new ConversationVm(conv, state, scriptId, peopleDat ? decodePortraits(peopleDat) : undefined, alternatePortraitIndex);
}

// Compatibility probe retained for callers of the old stub.
export interface VmStep { addr: number; op: number; }
export interface VmResult { halted: string; si: number; op?: number; trace: VmStep[]; }
export function run(mem: Uint8Array, { base = 0, slot = 0, trace = [] as VmStep[] }: { base?: number; slot?: number; trace?: VmStep[] } = {}): VmResult {
  const si = base + slot;
  const op = mem[si];
  if (op === undefined) return { halted: 'unreadable', si, trace };
  trace.push({ addr: si, op });
  if (op === 0) return { halted: 'hidden', si, op, trace };
  if (op >= 0x64) return { halted: 'inert', si, op, trace };
  return { halted: 'selector', si, op, trace };
}
