// Solar Winds (1993) — the frame clock. Transcribed from SOLAR1.EXE, sha256
// 7e7484a4a5eee9c2a9243820e551db27ca57567abb640c12d379c95c9b7983df.
// Linear = EXE file offset + 0xf200. Far call `lcall 0x131e,OFF` -> 0x231e0 + OFF.
// Data globals are given as DS offsets; DS:0x1xxxx == linear 0x1xxxx, blob image DS:0x00AD..0x4653.
//
// ## What actually paces the game (closes TODO_TIMERS@0x23e9e)
//
// There is NO timer interrupt in this game. A full scan of the code segments 0x20000..0x31000 finds
// only these interrupt sites: int 21h x254, int 33h x110 (mouse), int 16h x59 (keyboard), int 10h
// x12, int 0h @0x10d78, int 0Ah @0x13766, int 0F9h @0x16279, and exactly ONE int 1Ah @0x23b7a,
// which is `mov ah,0 / int 0x1a / mov byte ptr [0x3e32],dl` — the boot-time SECONDS read used as an
// RNG seed, not a tick source. There is no int 8h, no int 1Ch, and no read of the BIOS counter at
// 0040:006C. The two vectors the game installs are int 24h (critical error, @0x239d1..@0x239ee) and
// int 9h (keyboard, saved @0x239f7..@0x23a09, installed @0x23ae1) — neither is a clock.
//
// The clock is a **polled Intel 8254 counter 2**. Every pass of the main loop calls the pump
// `FUN_231e_0bf6 @0x23dd6` (@0x23c1c `call 0x23dd6`), and the pump's first action is a wait:
//
//   @0x23dd9  b0 80     mov  al,0x80        ; counter 2, latch-for-read
//   @0x23ddb  e6 43     out  0x43,al
//   @0x23ddd  e4 42     in   al,0x42        ; latched LSB
//   @0x23ddf  8a d8     mov  bl,al
//   @0x23de1  e4 42     in   al,0x42        ; latched MSB
//   @0x23de3  8a f8     mov  bh,al
//   @0x23de5  81 fb 18 79  cmp bx,0x7918    ; has the count passed terminal and wrapped?
//   @0x23de9  77 02     ja   0x23ded        ; yes -> leave the wait
//   @0x23deb  eb ec     jmp  0x23dd9        ; no  -> re-latch and poll again  (SPIN)
//   @0x23ded  b0 b0     mov  al,0xb0        ; counter 2, write LSB-then-MSB, MODE 0
//   @0x23def  e6 43     out  0x43,al
//   @0x23df1  b8 18 79  mov  ax,0x7918      ; reload constant 31000
//   @0x23df4  e6 42     out  0x42,al
//   @0x23df6  8a c4     mov  al,ah
//   @0x23df8  e6 42     out  0x42,al
//   @0x23dfa  b0 01     mov  al,1           ; port 61h: bit0 = ch2 GATE on, bit1 = SPEAKER off
//   @0x23dfc  e6 61     out  0x61,al
//
// So one main-loop pass = one full period of 8254 channel 2 in mode 0 loaded with 31000 ticks of
// the 1.1931816666 MHz OSC/3 input = 25.98 ms = **38.49 Hz**. That is the game's frame rate.
//
// The keyboard is NOT the pacer: the default gatherer `FUN_231e_4b35 @0x27d15` polls with
// `mov ah,1 / int 16h` @0x28427..@0x28429 (test-only; ZF=0 means "no key") and only if a key is
// queued does it consume it with `mov ah,0 / int 16h` @0x28430..@0x28432. So the loop is bounded by
// the wait-for-tick, and input is drained once per tick — the port's "one frame per keypress" is
// exactly the missing pump wait.
//
// The `ja` against the constant that was just loaded is the 8254's mode-0 wrap: the counter counts
// DOWN 31000..0 and only becomes > 31000 once it has run past terminal count. Every wait site in
// the game uses the same shape, and the same sites appear with the *other* constant 0x8ca0 = 36000
// (30.17 ms = 33.14 Hz) inside the modal scene loops (0x2a0d4, 0x2a223, 0x2a451, 0x2a704, 0x2a9f8,
// 0x305f1). See re/frame-clock.md §4 for the mode-0/mode-3 question and how to falsify it.
//
// ## The speaker gate
//
// Port 61h is written with exactly three values by game code: 1 (arm counter 2, speaker silenced),
// 0 (freeze counter 2 with the gate low — the "stop" half of every mute site) and, in the int 9
// handler, the standard keyboard-acknowledge pair `in al,61h / or al,80h / out 61h / out 61h`
// (@0x23c9f..@0x23ca7) which leaves bits 0-1 untouched. **Bit 1 (the speaker enable) is never set
// anywhere in the image**: the game makes no PC-speaker tones at all. Counter 2 is a timer that
// happens to live on the sound channel. (Consistent with HELPME.DOC:59-67 — audio is Sound Blaster
// digital only, `SOLAR1 /NOSB`, no Adlib — and with the SB DSP I/O at FUN_231e_1e14/0x210-style
// `out dx,al` sites.)
//
// ## DS:0x13c16 / DS:0x13c18 (the block the port TODO'd)
//
//   @0x23e9e  83 3e 16 3c 00  cmp word[0x3c16],0 / @0x23ea3 je 0x23f07  ; dead timer -> skip all
//   @0x23ea5  83 3e 18 3c 00  cmp word[0x3c18],0 / @0x23eaa jne 0x23ecc ; PREV == 0 ...
//   @0x23eac  81 3e 16 3c f4 01 cmp word[0x3c16],0x1f4 / @0x23eb2 jne 0x23ecc ; ... and NOW == 500
//   @0x23eb4  80 3e de 3a 01  cmp byte[0x3ade],1 / @0x23eb9 je 0x23ecc  ; already in state 1 -> skip
//   @0x23ebb  80 3e 91 3c 01  cmp byte[0x3c91],1 / @0x23ec0 jne 0x23ecc  ; MODE == 1 only
//   @0x23ec2  c6 06 de 3a 01  mov byte[0x3ade],1
//   @0x23ec7  9a 08 37 1e 13  lcall 0x131e,0x3708  -> 0x268e8
//   @0x23ecc  a1 16 3c        mov ax,[0x3c16]
//   @0x23ecf  a3 18 3c        mov [0x3c18],ax      ; PREV = current
//   @0x23ed2  ff 0e 16 3c     dec word[0x3c16]     ; THE ONLY DECREMENT SITE IN THE IMAGE
//   @0x23ed6  83 3e 16 3c 00  cmp word[0x3c16],0 / @0x23edb jne 0x23f07 ; still running -> done
//   @0x23edd  c7 06 18 3c 00 00 mov word[0x3c18],0                     ; expired: PREV := 0
//   @0x23ee3  80 3e de 3a 00  cmp byte[0x3ade],0 / @0x23ee8 je 0x23efb
//   @0x23eea  80 3e 91 3c 01  cmp byte[0x3c91],1 / @0x23eef jne 0x23efb ; MODE == 1 only
//   @0x23ef1  c6 06 de 3a 00  mov byte[0x3ade],0
//   @0x23ef6  9a 08 37 1e 13  lcall 0x131e,0x3708  -> 0x268e8
//
// i.e. **DS:0x13c16 is a 500-tick countdown (500 x 25.98 ms = 12.99 s), decremented once per pump
// pass, and DS:0x13c18 is its previous value — a pure edge detector.** 0x13c18==0 && 0x13c16==500
// means "armed on this tick"; hitting 0 means "elapsed". Both edges, and only in mode 1, flip
// DS:0x13ade and call 0x268e8.
//
// CORRECTION to re/game-loop-modes.md:435 and to state.ts's `soundEnabled` name: `lcall
// 0x131e,0x3708` = FUN_231e_3708 @0x268e8 is NOT a sound re-init. Its body is
// `int 33h ax=2` (hide pointer) @0x268ef, then `mov ah,0x3d / mov al,2 / lea dx,[0x69f0]`
// @0x268f4..@0x268f8 with `cmp byte[0x3ade],1 / je 0x26907 / lea dx,[0x694b]` @0x268fc..@0x26903
// choosing the name, then `mov ah,0x3f / mov cx,0xc350` read into the [0x6ba3] scratch segment
// @0x26912..@0x26921, then the wind-RLE unpack at @0x26947..@0x2696b. Per re/loader_map.md §3 the
// two names are BH_WR.DAT (0x3ade==1) and PAGE.DAT (0x3ade==0). So the 500-tick timer swaps the
// displayed scene between the war report and PAGE, and DS:0x13ade is the scene flag that timer owns
// — which is why the same flag halves the per-frame movement delta at @0x242f2 (`cmp byte[0x3ade],1
// / jne / shr dx,1`), gates the state-1 digit arms @0x2e885, and gates a caption draw @0x2a1c8.
// It is not a sound flag; `xor byte[0x3ade],1 / lcall 0x131e,0x3708` on the 'n' arm @0x2e75f is a
// scene toggle.
//
// ## What arms it (all three reload the literal 0x1f4)
//
//   @0x268c4  in FUN_231e_3542 @0x26722 — called EVERY pump pass (@0x23e3c). Re-arms only if the
//             countdown is already running: `cmp byte[0x46ee],1 / je` @0x268a7, `cmp byte[0x4678],0
//             / jne` @0x268ae, `cmp word[0x3c16],0 / je` @0x268bd. Same routine sets
//             DS:0x13c52 = 13/19/30 from DS:0x13c94 (@0x268ca..@0x268de) and bumps DS:0x13c55.
//   @0x26b8d  in FUN_231e_38e3 @0x26ac3 (only caller 0x24b89 in FUN_231e_16fc @0x248dc) — arms
//             unconditionally, and first calls the overlay `lcall 0x2079,0x1e2` (@0x26b88) when the
//             countdown was 0 and DS:0x14679 == 0.
//   @0x2933f  in FUN_231e_5cb5 @0x28e95 (only caller 0x24a6a in FUN_231e_1ba4 @0x24d84) — same
//             shape: `cmp byte[0x5b8a],0 / je` @0x29325, overlay stop @0x2933a, then arm.
//
// ## The rest of the pump's timing tail (per pass, per N passes)
//
//   @0x23e6b  inc byte[0x54c4] / @0x23e6f cmp 5 / je -> mov 0 + lcall 0x131e,0x8de4 (0x2bfc4)
//             — divide-by-5 pass counter, 7.70 Hz.
//   @0x23f28  cmp byte[0x3be9],1 / je 0x23f34 / lcall 0x131e,0x7ad6 (0x2acb6) — per-pass.
//   @0x23f34  lea bx,[0x3ce]; mov ax,[bx+6] (= DS:0x13d4); cmp ax,[0x54c0]; je 0x23f49; else
//             store + lcall 0x131e,0x81e8 (0x2b3c8) — "changed" detector, not a timer.
//   @0x23f49  cmp byte[0x457b],2 / jne 0x23f67; mov byte[0x3c91],1; lcall 0x131e,0x7e6d — a
//             request to force mode 1 repaints and falls into the /8 divider below on the jne path.
//   @0x23f67  inc byte[0x5b09] / @0x23f6b cmp 7 / jne 0x23fbb -> mov 0 + lcall 0x131e,0xab0a
//             (0x2dcea) + the DS:0x13c5e..0x13c6c crew-sum — divide-by-8, 4.81 Hz.
//   @0x23fd4  cmp byte[0x3c46],0 / jg 0x23fe6 / lcall 0x131e,0x7bcc (0x2adac) / jmp 0x23dd9 —
//             a RE-PUMP: the whole rest of the pump body is skipped and a new tick is waited for.
//   @0x23fe6  cmp word[0x3bef],0 / je 0x24038 / dec word[0x3bef] / cmp 0 / jne 0x24038 — while
//             DS:0x13bef is non-zero the pump short-circuits to 0x24038, then decrements.
//   @0x24084  cmp byte[0x3c52],0 / je / dec byte[0x3c52]   ; per-pass byte timer, armed 13/19/30
//   @0x2408f  cmp byte[0x3c54],0 / je / dec byte[0x3c54]   ; per-pass byte timer
//   @0x2409a  cmp byte[0x5bb8],0 / je / inc / cmp 0x0f / jne / mov 0 ; the ASCII-event latch ages
//             out 1..15 -> 0 over 16 passes (@0x24502 sets it to 1, @0x244f3 clears it to 0)
//   @0x240b1  inc word[0x54b3] / cmp 0x3e8 / jb 0x24120 / mov 0 — divide-by-1000 pass counter
//             = 25.98 s: the game's TURN tick (dec word[0x3c5c], dec word[0x3c62], message @0x70fc).
//   @0x2433f  inc byte[0x4d63] / cmp 2 / jne -> lcall 0x131e,0x3add — divide-by-3.
//   @0x23e46  cmp word[0x3c98],0x26 / jg 0x26 / call 0x24544 — the scroll-offset guard, per pass.
//
// ## Scene loops (DS:0x14d64) — a second, faster-clocked clock
//
// The zone-1 loader FUN_231e_6db0 @0x29f90 does not return to the main loop while it animates; it
// runs its own bounded loops paced by the 0x8ca0 (36000 = 30.17 ms) wait:
//
//   @0x2a04a  di=0; @0x2a04d ax=0xa000 -> es; @0x2a058 si=0; @0x2a05b cx=0xfa00; @0x2a05e rep movsw
//             — blit the just-decoded MW1A frame to A000:0 (64000 B), then lcall 0x131e,0x7d10.
//   @0x2a066  bx=0; @0x2a069 mov word[0x4d64],0            ; frame counter := 0
//   @0x2a06f  cmp word[0x4d64],0x64 / jbe 0x2a0c4          ; nothing for frames 0..100
//   @0x2a076  cmp word[0x4d64],0xfb / ja  0x2a0c4          ; nothing after 251
//             -> the 151-frame pixel-pair shuffle 0x2a07e..@0x2a0c2 (re/FINDINGS.md's "XOR swap"):
//                0x56 (86) rows of 0x33 (51) swapped adjacent byte pairs, walking di down / si up
//                from es:0x47eb / es:47ee with `add di,0x173 / add si,0x10d` per row.
//   @0x2a0c4  inc word[0x4d64]
//   @0x2a0c8  PIT wait @ 0x8ca0, reload, gate on           ; 33.14 Hz
//   @0x2a0ed  jmp 0x2a0f7                                  ; SKIPS the int 16h below
//   @0x2a0f0  mov ah,0 / int 16h / jmp 0x2a102             ; blocking key -> early exit
//   @0x2a0f7  cmp word[0x4d64],0x10e / je 0x2a102 / jmp 0x2a06f
//   @0x2a102  open BH_MW1B, read 0xc350, wind-unpack @0x2a146, lcall 0x131e,0x7d92, blit @0x2a175
//   @0x2a18e  mov word[0x4d64],0 then a caption script keyed on frame number: 0x32/@0x570a,
//             0xaa/erase, 0xb4/@0x5742, 0x118/erase, 0x122/@0x5777, 0x172/… — each via
//             lcall 0x131e,0x31f1 (0x263d1) and lcall 0x131e,0x4af9 (0x27cd9).
//
// The frame alternation the brief calls "MW1A <-> MW1B" is therefore not two frames blitted in
// alternation: it is A blitted, held for 270 paced frames (270 x 30.17 ms = 8.15 s) while a
// 151-frame pixel shuffle runs inside, then B blitted and held with a caption track on top.
//
// ## Mapping to requestAnimationFrame
//
// The browser supplies ~60 Hz; the game supplies 38.49 Hz (main loop) and 33.14 Hz (scene loops).
// Run ONE accumulator against performance.now(); per rAF, drain whole periods:
//
//   const c = createClock();
//   function frame(now) { for (const ev of advance(c, now)) pump(ev.pass, hooks); raf(frame); }
//
//   * per rAF: nothing. rAF is only the drain trigger.
//   * per PASS (38.49 Hz, PUMP_PERIOD_MS): gatherer poll (int 16h ah=1 semantics = your key queue
//     peek), one mode-handler dispatch, and everything in "the rest of the pump's timing tail"
//     above, including the DS:0x13c16 decrement.
//   * every 3rd/5th/8th/16th/1000th PASS: the dividers in that same list. Do NOT drive these from
//     rAF counts — they are pass counts, and a 60 Hz rAF counter would make them 1.56x too fast.
//   * during a scene loop: switch the accumulator to SCENE_PERIOD_MS and drive [0x4d64] instead of
//     the pump body; the main loop is not running at all in the original there.
//
// Catch-up: the original spin burns CPU while waiting and never skips ticks, so a backgrounded tab
// must clamp (MAX_CATCHUP_TICKS) rather than emit thousands of passes — the turn timer DS:0x154b3
// and the 500-tick scene timer are both pass-counters and would otherwise fast-forward the game.

// --- the 8254 --------------------------------------------------------------------------------------------

/** PIT input clock: 1.1931816666 MHz (OSC 14.31818 MHz / 3). Standard, and the only frequency
 *  consistent with both reload constants below producing the documented 3000-cycles/ms DOSBox run. */
export const PIT_OSC_HZ = 1193181.6666;

/** The game's only counter-2 control bytes. 0x80 = counter 2 (SC=10) + latch-for-read (RW=00).
 *  0xB0 = counter 2 + write LSB-then-MSB (RW=11) + mode 000 = MODE 0 (terminal count, no reload). */
export const PIT_CTL_LATCH_C2 = 0x80;
export const PIT_CTL_C2_MODE0_WRITE = 0xb0;

/** Reload constant of the main-loop wait: `mov ax,0x7918` @0x23df1 (and @0x23de5's compare). */
export const PUMP_RELOAD = 0x7918; // 31000
/** Reload constant of every modal scene-loop wait: `mov ax,0x8ca0` @0x2a0e0 (compare @0x2a0d4,
 *  and the same pair at 0x2a22f/0x2a232, 0x2a45d, 0x2a710, 0x2aa04, 0x305fd). */
export const SCENE_RELOAD = 0x8ca0; // 36000
/** Boot-time load: `mov al,0xb0 / out 0x43 / mov ax,0 / out 0x42 x2` @0x23abf..@0x23aca, i.e.
 *  divisor 0 = 65536 (54.92 ms) — the free-running state the first pump wait is polled against. */
export const BOOT_RELOAD = 0; // 65536

export const PUMP_PERIOD_MS = (PUMP_RELOAD / PIT_OSC_HZ) * 1000; // 25.9809 ms -> 38.49 Hz
export const SCENE_PERIOD_MS = (SCENE_RELOAD / PIT_OSC_HZ) * 1000; // 30.1713 ms -> 33.14 Hz
/** One pass of the *original* main loop, @0x23c1c..@0x23c91. */
export const PUMP_HZ = 1000 / PUMP_PERIOD_MS;
export const SCENE_HZ = 1000 / SCENE_PERIOD_MS;

/** Port 61h values the game writes. bit0 = ch2 gate, bit1 = speaker enable.
 *  `mov al,1 / out 0x61` @0x23dfc, @0x2a0eb, @0x23ad0 — gate on, speaker off.
 *  `mov al,0 / out 0x61` @0x23e35, @0x23e64, @0x24837, @0x24b0d, @0x24ea8, @0x24f26 — gate off.
 *  Nothing anywhere sets bit1: no PC-speaker tones exist in this engine. */
export const PORT61_GATE_ON = 1;
export const PORT61_GATE_OFF = 0;

/** A faithful 8254 channel-2 mode-0 counter, so that scene-loop ports can express the real spin
 *  (`while (!(c2.readLatched() > RELOAD)) …`) instead of inventing a delay. elpased ms drives it. */
export class PitCounter2 {
  /** reload value last written; 0 means 65536 (mode 0 semantics) */
  hold = BOOT_RELOAD;
  gate = false; // port 61h bit0
  speaker = false; // port 61h bit1 — the game never sets it
  /** current count; counts DOWN while gate is high, stops at 0, wraps to 0xFFFF on the next clock */
  counter = 0x10000;
  latched: number | null = null;

  get divisor(): number { return this.hold === 0 ? 0x10000 : this.hold; }

  writeControl(b: number): void {
    if (b === PIT_CTL_LATCH_C2) this.latched = this.counter; // 0x80: freeze for read
    // 0xB0 selects mode 0 + "write LSB then MSB"; the mode itself needs no state here.
  }

  writeCount(b: number, which: 'lo' | 'hi'): void {
    if (which === 'lo') this.hold = (this.hold & 0xff00) | b;
    else {
      this.hold = (this.hold & 0x00ff) | (b << 8);
      this.counter = this.divisor; // full 16-bit transfer on the MSB write
    }
  }

  writePort61(v: number): void {
    this.gate = (v & 1) !== 0;
    this.speaker = (v & 2) !== 0;
  }

  /** advance by `ms`; the counter only moves while the gate is high */
  advance(ms: number): void {
    if (!this.gate) return;
    let ticks = Math.floor(ms * (PIT_OSC_HZ / 1000));
    while (ticks-- > 0) {
      this.counter = this.counter === 0 ? 0xffff : this.counter - 1; // mode-0 wrap
    }
  }

  readLatched(): number { return this.latched ?? this.counter; }
  clearLatch(): void { this.latched = null; }
}

// --- the clock accumulator ------------------------------------------------------------------------------

export interface Clock {
  /** PIT-frequency time accumulated from the host clock (ms). */
  accMs: number;
  /** pump passes emitted (DS:0x154b3 and friends count these). */
  passes: number;
  /** true while a modal scene loop owns the frame (see sceneFrames). */
  scene: boolean;
  /** the period currently being drained. */
  periodMs: number;
  /** last host timestamp seen, for the dt. */
  lastNow: number | null;
}

export function createClock(scene = false): Clock {
  return { accMs: 0, passes: 0, scene, periodMs: scene ? SCENE_PERIOD_MS : PUMP_PERIOD_MS, lastNow: null };
}

/** Never emit more than this many passes from one rAF (tab-restore / debugger pause guard).
 *  The original cannot skip ticks; this is the port's only deviation, and it is deliberate. */
export const MAX_CATCHUP_TICKS = 8;

/** Drain whole periods. Returns the pass numbers that must run now; one element per main-loop pass.
 *  `now` is any monotonic ms source (performance.now()); first call only establishes the origin. */
export function advance(c: Clock, now: number, budget = MAX_CATCHUP_TICKS): number[] {
  const out: number[] = [];
  if (c.lastNow === null) { c.lastNow = now; return out; }
  const dt = now - c.lastNow;
  c.lastNow = now;
  if (dt < 0) return out;
  c.accMs += dt;
  while (c.accMs >= c.periodMs && out.length < budget) {
    c.accMs -= c.periodMs;
    c.passes = (c.passes + 1) >>> 0;
    out.push(c.passes);
  }
  if (c.accMs >= c.periodMs) c.accMs = 0; // dropped the rest: see MAX_CATCHUP_TICKS above
  return out;
}

export function useScenePacing(c: Clock, scene: boolean): void {
  c.scene = scene;
  c.periodMs = scene ? SCENE_PERIOD_MS : PUMP_PERIOD_MS;
}

// --- the pump timer tail ---------------------------------------------------------------------------------

/** DS offsets, in the numbering re/state-format.md uses (DS:0x13c16 == word at DS offset 0x3c16). */
export const REG = Object.freeze({
  countdown: 0x3c16, // word — 500-tick countdown; dec @0x23ed2, reload 0x1f4 @0x268c4/@0x26b8d/@0x2933f
  countdownPrev: 0x3c18, // word — previous value @0x23ecf, cleared @0x23edd (edge detector only)
  sceneFlag: 0x3ade, // byte — the flag the countdown owns (NOT sound); see header
  mode: 0x3c91, // byte — dispatch mode, `cmp byte[0x3c91],1` @0x23c1f/@0x23ebb/@0x23eea
  byte_4679: 0x4679, // byte — gates the 0x2079 overlay calls @0x23efb/@0x23f07 and the arm @0x26b81
  div5: 0x54c4, // byte — /5 pass divider @0x23e6b
  div8: 0x5b09, // byte — /8 pass divider @0x23f67
  div3: 0x4d63, // byte — /3 pass divider @0x2433f
  turn: 0x54b3, // word — /1000 pass divider @0x240b1 (the TURN tick, ~26 s)
  asciiLatch: 0x5bb8, // byte — 1..15 aging of the ASCII event latch @0x2409a
  byteTimer1: 0x3c52, // byte — dec per pass @0x2408b; armed 13/19/30 @0x268de from DS:0x13c94
  byteTimer2: 0x3c54, // byte — dec per pass @0x24096
  skipCount: 0x3bef, // word — dec @0x23fed; while non-zero the pump short-circuits to 0x24038
  sceneFrame: 0x4d64, // word — the scene-loop frame counter, inc @0x2a0c4/@0x2a194/@0x2a441/@0x2a580/@0x2a91a/@0x301f8
  COUNTDOWN_RELOAD: 0x1f4, // 500 — the literal stored by all three arm sites
});

/** Divider periods, in passes, with the compare site that proves them. */
export const DIVIDERS = Object.freeze({
  by3: { every: 3, cmp: 0x24343, callee: 0x2691d /* lcall 0x131e,0x3add */ },
  by5: { every: 5, cmp: 0x23e6f, callee: 0x2bfc4 /* lcall 0x131e,0x8de4 */ },
  by8: { every: 8, cmp: 0x23f6b, callee: 0x2dcea /* lcall 0x131e,0xab0a */ },
  asciiAge: { every: 16, cmp: 0x240a5 },
  turn: { every: 1000, cmp: 0x240b5 }, // jb 0x24120 -> the 1000th pass runs the turn block
});

/** The register file the clock owns. Kept explicit (not a State) so the module is pure and the
 *  parent's integration decides how it maps onto DS. Field names say which address they mirror. */
export interface ClockRegs {
  countdown: number; // DS:0x13c16
  countdownPrev: number; // DS:0x13c18
  sceneFlag: number; // DS:0x13ade
  mode: number; // DS:0x13c91
  gate4679: number; // DS:0x14679
  div5: number; div8: number; div3: number;
  turn: number; asciiLatch: number;
  byteTimer1: number; byteTimer2: number; skipCount: number;
}

export const initialRegs = (): ClockRegs => ({
  countdown: 0, countdownPrev: 0, sceneFlag: 0, mode: 1, gate4679: 0,
  div5: 0, div8: 0, div3: 0, turn: 0, asciiLatch: 0,
  byteTimer1: 0, byteTimer2: 0, skipCount: 0,
});

/** The effects the tick tail can have. Every member is justified by a call site in the header; a
 *  port that has no equivalent passes a no-op, and NOTHING here has a fallback behaviour. */
export interface ClockHooks {
  /** `lcall 0x131e,0x3708` @0x268e8 with DS:0x13ade already updated: load + wind-decode
   *  BH_WR.DAT (flag 1) or PAGE.DAT (flag 0) and paint it. `flag` is the NEW DS:0x13ade. */
  loadScene(flag: number): void;
  /** `lcall 0x2079,0x1e2` = 0x20790+0x1e2 = 0x20972 (segment 0x2079, an overlay) @0x23f02/@0x26b88/@0x2933a */
  overlayStop(): void;
  /** `lcall 0x2079,0x21e` = 0x209ae, whose AX is tested against 0 @0x23f0e..@0x23f16. Return AX. */
  overlayQuery(): number;
  /** `lcall 0x131e,0x5950` = FUN_231e_5950 @0x28b30 with AL = 2 (idle) or 3 (countdown running)
   *  @0x23f18..@0x23f23 */
  intermission(al: number): void;
  /** per-N-pass dividers, by name so the callee identity stays with the caller */
  div5(pass: number): void;  // @0x23e7b -> 0x2bfc4
  div8(pass: number): void;  // @0x23f77 -> 0x2dcea
  div3(pass: number): void;  // @0x2434a -> 0x2691d
  turn(): void;              // @0x240c3..@0x24120
  /** @0x23f34 "DS:0x13d4 changed" detector */
  valueChanged(word: number): void;
  /** @0x23fd4 re-pump path: `lcall 0x131e,0x7bcc` (0x2adac) then `jmp 0x23dd9` (wait for a NEW
   *  tick without returning). Called with the pass number; the port must not run the rest of the
   *  body that pass. */
  repump(pass: number): boolean;
}

/**
 * One pump pass, from the wait (@0x23dd9) through the timer tail (@0x23e9e..@0x23f67).
 * Returns the pass's trace so a tool can assert on it. `regs` is mutated in place.
 *
 * Ordering note that matters: the countdown decrement is at @0x23ecc, i.e. AFTER the arm edge test,
 * and the whole block is skipped when DS:0x13c16 is already 0 (@0x23ea3) — an unarmed timer costs
 * one compare, and no arm/expiry hook fires.
 */
export function pumpPass(regs: ClockRegs, pass: number, hooks: ClockHooks, opts: { valueAtD4?: number } = {}): string[] {
  const trace: string[] = [];
  const w16 = (n: number) => n & 0xffff;

  // @0x23e6b  the /5 divider runs before the countdown block
  regs.div5 = (regs.div5 + 1) & 0xff;
  if (regs.div5 === DIVIDERS.by5.every) { // je @0x23e74
    regs.div5 = 0;
    hooks.div5(pass);
    trace.push('div5@0x23e7b');
  }

  // @0x23e9e  cmp word[0x3c16],0 / je 0x23f07
  if (regs.countdown !== 0) {
    // @0x23ea5..@0x23eb2  PREV == 0 && NOW == 500  -> armed on this very pass
    if (regs.countdownPrev === 0 && regs.countdown === REG.COUNTDOWN_RELOAD) {
      // @0x23eb4 cmp [0x3ade],1 / je ; @0x23ebb cmp [0x3c91],1 / jne
      if (regs.sceneFlag !== 1 && regs.mode === 1) {
        regs.sceneFlag = 1; // @0x23ec2
        hooks.loadScene(1); // @0x23ec7
        trace.push('arm->0x3ade=1@0x23ec2 loadScene(WR)@0x23ec7');
      }
    }
    // @0x23ecc  PREV := NOW ; NOW := NOW - 1
    regs.countdownPrev = w16(regs.countdown);
    regs.countdown = w16(regs.countdown - 1);
    trace.push(`dec@0x23ed2 -> ${regs.countdown}`);
    if (regs.countdown === 0) {
      regs.countdownPrev = 0; // @0x23edd
      if (regs.sceneFlag !== 0 && regs.mode === 1) { // @0x23ee3, @0x23eea
        regs.sceneFlag = 0; // @0x23ef1
        hooks.loadScene(0); // @0x23ef6 -> PAGE.DAT
        trace.push('expiry->0x3ade=0@0x23ef1 loadScene(PAGE)@0x23ef6');
      }
      // @0x23efb  cmp byte[0x4679],0 / jne 0x23f28
      if (regs.gate4679 === 0) { hooks.overlayStop(); trace.push('lcall 0x2079:0x1e2@0x23f02'); }
      else { return trace; } // jmp 0x23f28
    }
  }

  // @0x23f07  cmp byte[0x4679],0 / jne 0x23f28
  if (regs.gate4679 === 0) {
    const ax = hooks.overlayQuery(); // @0x23f0e lcall 0x2079:0x21e
    if (ax === 0) { // @0x23f13
      const al = regs.countdown === 0 ? 2 : 3; // @0x23f18..@0x23f21
      hooks.intermission(al); // @0x23f23 lcall 0x131e,0x5950
      trace.push(`intermission al=${al}@0x23f23`);
    }
  }

  // @0x23f28  cmp byte[0x3be9],1 / je 0x23f34 / lcall 0x131e,0x7ad6 — gated per-pass call.
  // (DS:0x13be9's writer is not in re/ yet; left as a hook below rather than guessed.)

  // @0x23f34  lea bx,[0x3ce]; mov ax,[bx+6] -> DS:0x13d4; cmp ax,[0x154c0]; je 0x23f49
  if (opts.valueAtD4 !== undefined) hooks.valueChanged(opts.valueAtD4);

  // @0x23f49  cmp byte[0x457b],2 / jne 0x23f67 — a forced mode-1 repaint lives in loop.ts, not here.

  // @0x23f67  the /8 divider (its crew-sum body is already modelled in loop.ts tickStatPool)
  regs.div8 = (regs.div8 + 1) & 0xff;
  if (regs.div8 === DIVIDERS.by8.every) { regs.div8 = 0; hooks.div8(pass); trace.push('div8@0x23f77'); }

  // @0x23fd4  cmp byte[0x3c46],0 / jg 0x23fe6 / lcall 0x131e,0x7bcc / jmp 0x23dd9
  if (hooks.repump(pass)) {
    trace.push(`repump@0x23fdb (skip to wait) pass=${pass}`);
    return trace;
  }

  // @0x23fe6  cmp word[0x3bef],0 / je 0x24038 / dec / cmp 0 / jne 0x24038
  const skipped = regs.skipCount !== 0;
  if (skipped) {
    regs.skipCount = w16(regs.skipCount - 1);
    trace.push(`skip->0x24038@0x23fed remain=${regs.skipCount}`);
  }

  // @0x24084/@0x2408f  per-pass byte timers (only on the non-skipped path — 0x24038 lands ahead of
  // them; TODO_PASS_PATH@0x24038 records that 0x24038..0x24084 was not transcribed in re/ yet)
  if (!skipped) {
    if (regs.byteTimer1 !== 0) { regs.byteTimer1 = (regs.byteTimer1 - 1) & 0xff; trace.push(`dec 0x13c52@0x2408b=${regs.byteTimer1}`); }
    if (regs.byteTimer2 !== 0) { regs.byteTimer2 = (regs.byteTimer2 - 1) & 0xff; trace.push(`dec 0x13c54@0x24096=${regs.byteTimer2}`); }
  }

  // @0x2409a  the ASCII-event latch ages 1..15 -> 0
  if (regs.asciiLatch !== 0) {
    regs.asciiLatch = (regs.asciiLatch + 1) & 0xff;
    if (regs.asciiLatch === DIVIDERS.asciiAge.every - 1) regs.asciiLatch = 0; // @0x240ac
  }

  // @0x240b1  the /1000 TURN tick
  regs.turn = w16(regs.turn + 1);
  if (regs.turn >= DIVIDERS.turn.every) { regs.turn = 0; hooks.turn(); trace.push('turn@0x240b1'); }

  // @0x2433f  the /3 divider (body is lcall 0x131e,0x3add; reached through the 0x242xx movement walk)
  regs.div3 = (regs.div3 + 1) & 0xff;
  if (regs.div3 === DIVIDERS.by3.every) { regs.div3 = 0; hooks.div3(pass); trace.push('div3@0x2434a'); }

  return trace;
}

/** Arm the 500-tick countdown exactly the way the three arm sites do. Two behaviours exist:
 *  FUN_231e_3542 @0x268c4 re-arms ONLY while already running (it never resurrects a dead timer),
 *  while @0x26b8d and @0x2933f arm unconditionally. Pick with `onlyIfRunning`. */
export function armCountdown(regs: ClockRegs, site: 0x268c4 | 0x26b8d | 0x2933f, hooks: Pick<ClockHooks, 'overlayStop'>, gate4679 = regs.gate4679): void {
  const onlyIfRunning = site === 0x268c4;
  if (onlyIfRunning) {
    if (regs.countdown === 0) return; // @0x268bd  cmp word[0x3c16],0 / je 0x268ca
  } else {
    if (regs.countdown === 0 && gate4679 === 0) hooks.overlayStop(); // @0x26b7a..@0x26b88, @0x2932c..@0x2933a
  }
  regs.countdown = REG.COUNTDOWN_RELOAD; // the literal 0x1f4 at @0x268c4 / @0x26b8d / @0x2933f
}

// --- scene loops ----------------------------------------------------------------------------------------

/** The zone-1 loop A window and length, from @0x2a06f/0x2a076 (effect frames 101..251) and the
 *  exit test `cmp word[0x4d64],0x10e / je` @0x2a0f7. */
export const SCENE = Object.freeze({
  shuffleFirstFrame: 0x64, // 101  @0x2a06f jbe
  shuffleLastFrame: 0xfb, // 251  @0x2a076 ja
  loopAExitFrame: 0x10e, // 270  @0x2a0f7
  /** the caption script @0x2a1ab..: [frame, kind, payload] — kind 'text' = lcall 0x131e,0x31f1 with
   *  BX pointing at a string; 'erase' = lcall 0x131e,0x4af9 with AX=0xff, DI=0xca3. */
  captions: [
    { frame: 0x32, kind: 'text', payload: 0x1570a, site: 0x2a1a6 }, // lea bx,[0x570a] @0x2a19f
    { frame: 0xaa, kind: 'erase', payload: 0xca3, site: 0x2a1b9 },
    { frame: 0xb4, kind: 'text', payload: 0x15742, site: 0x2a1cd },
    { frame: 0x118, kind: 'erase', payload: 0xca3, site: 0x2a1e0 },
    { frame: 0x122, kind: 'text', payload: 0x15777, site: 0x2a1f4 },
  ] as const,
  /** the pixel-pair shuffle geometry, @0x2a07f..@0x2a0bf: two cursors walking towards each other
   *  from es:0x47eb / es:0x47ee, 0x33 (51) pairs per row, 0x56 (86) rows, row advance +0x173/+0x10d */
  shuffle: { di0: 0x47eb, si0: 0x47ee, pairsPerRow: 0x33, rows: 0x56, diRowAdvance: 0x173, siRowAdvance: 0x10d },
});

export interface SceneHooks {
  /** paint one paced frame of a scene loop: `frame` is DS:0x14d64's value AFTER @0x2a0c4's inc */
  frame(frame: number): void;
  /** the 0x2a07e..@0x2a0c2 pixel-pair shuffle over the framebuffer */
  shuffle(): void;
  /** a caption event's callee (0x263d1 text / 0x27cd9 erase) with its BX/DI/AX arguments */
  caption(c: { kind: 'text' | 'erase'; payload: number; site: number }): void;
}

/**
 * Drive ONE frame of a scene loop (the @0x2a06f..@0x2a102 shape). Call this at SCENE_PERIOD_MS, not
 * at rAF rate. `frame` is the current DS:0x14d64 value; returns the next value, or null when the
 * loop has exited (frame == 0x10e @0x2a0f7) or a key was pressed (the @0x2a0f0 path — which the
 * shipped bytes reach only by a jump from outside 0x2a0ed's `jmp 0x2a0f7`; TODO_INT16_HOP@0x2a0f0).
 */
export function sceneFrame(frame: number, hooks: SceneHooks, keyPending = false): number | null {
  const next = (frame + 1) & 0xffff; // @0x2a0c4
  hooks.frame(next);
  if (next > SCENE.shuffleFirstFrame && next <= SCENE.shuffleLastFrame) {
    // @0x2a06f jbe / @0x2a076 ja -> the shuffle runs for frames 101..251 inclusive
    hooks.shuffle();
  }
  for (const c of SCENE.captions) if (c.frame === next) hooks.caption(c);
  if (keyPending) return null; // @0x2a0f0..@0x2a0f2
  if (next === SCENE.loopAExitFrame) return null; // @0x2a0f7/@0x2a0fd
  return next;
}

/** The pixel-pair shuffle of @0x2a07e..@0x2a0c2, expressed as a permutation of the 64,000-byte
 *  page so a tool can assert what the animation does. For each of 86 rows, 51 adjacent pairs
 *  starting at (0x47eb - i, 0x47ee + i) are exchanged; row i+1 starts 0x173 lower / 0x10d higher.
 *  Operates on the A000-segment byte image in place. */
export function shufflePairs(vram: Uint8Array): void {
  const s = SCENE.shuffle;
  let di = s.di0, si = s.si0;
  for (let row = 0; row < s.rows; row++) {
    for (let k = 0; k < s.pairsPerRow; k++) {
      // @0x2a088..@0x2a0a8: al = es[di+1], ah = es[si-1]; es[di+1]=es[si-1]=0;
      //                  cl = es[di], ch = es[si]; es[di]=al; es[si]=ah;  then di--, si++
      const t1 = vram[(di + 1) & 0xffff], t2 = vram[(si - 1) & 0xffff];
      const t3 = vram[di & 0xffff], t4 = vram[si & 0xffff];
      vram[(di + 1) & 0xffff] = t2;
      vram[(si - 1) & 0xffff] = 0;
      vram[di & 0xffff] = t1;
      vram[si & 0xffff] = t3;
      di = (di - 1) & 0xffff; // @0x2a0aa
      si = (si + 1) & 0xffff; // @0x2a0ab
      void t4;
    }
    di = (di + s.diRowAdvance) & 0xffff; // @0x2a0b3
    si = (si + s.siRowAdvance) & 0xffff; // @0x2a0b7
  }
}
