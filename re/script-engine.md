# The script engine, the object tables, and the zone cutscenes

Target `SOLAR1.EXE`, sha256 `7e7484a4a5eee9c2a9243820e551db27ca57567abb640c12d379c95c9b7983df`.
Linear = file + 0xf200. `lcall 0x131e,OFF` → 0x231e0 + OFF.

Ported in `web/src/engine/script.ts` (tables, selector, both runners) and
`web/src/engine/zones.ts` (the three cutscene players). Proof: `node web/tools/zoneshot.mjs`.

## 0. The address law, restated because it bit here

    linear = DS + 0x10190     file = DS + 0xF90     blob i = DS − 0xAD

`re/game-loop-modes.md` §3 uses `DS = linear − 0x10000`, which is **0x190 too low**
(`re/state-format.md` §"Address law" already corrects it; `web/src/engine/state.ts:44` carries the
right constant). Every DS offset below was checked by reading EXE bytes at `DS + 0xF90` and seeing
the claimed ASCII, so nothing here depends on that convention.

## 1. Why the port looked like "boot art and a menu"

The `c` (make 0x2e) and `s` (make 0x1f) rows in the state-1 chain are **not** leaf handlers. They are
modal subroutines with their own event loops:

| arm | routine | site | what it is |
|---|---|---|---|
| `s` | `FUN_231e_a01c` @0x2d1fc | @0x2e714 | scan: describe what is on screen |
| `c` | `FUN_231e_a26d` @0x2d44d | @0x2e753 | communicate: load BH_CONV.DAT and run the object's script |

`FUN_231e_a26d` opens by re-installing the keyboard: `int 21h ah=25 al=9` from `DS:0xb998:0xb99a`
(@0x2d461), restoring the vector saved at `DS:0xb99c:0xb99e` on the way out (@0x2d75a). So the modal
loops read keys through a **different INT 9 handler than the main pump**. That, plus
`int 16h` @0x2d60b inside it, is why these loops are not drivable from the pump's table.

And they are the *only* callers of the three zone loaders:

```
@0x2d6d3  lcall 0x131e,0x6db0   FUN_231e_6db0  zone 1   (inc DS:0xbaf4; cmp 1)
@0x2d6ee  lcall 0x131e,0x7182   FUN_231e_7182  zone 2   (inc DS:0xbaf5; cmp 2)
@0x2d5fb  lcall 0x131e,0x75a6   FUN_231e_75a6  zone 3   (int 21h/4Ch afterwards at @0x2d61b)
```

## 2. The three tables

### 2.1 The visible-entity table — DS:0x3bf3 count, DS:0x3bf5 pointer array

Not stored data. `FUN_231e_1364` @0x24544 rebuilds it every pass: walk the actor array, cull, blit
each sprite, and push the actor's address (`*(int *)(*(int*)0x3bf3 + 0x3bf5) = piVar19; 0x3bf3 += 2`).
Both runners test `cmp word[0x3bf3],0` at entry (@0x2d464, @0x2d22f) and print an error string when
the player is looking at nothing.

### 2.2 The actor array — DS:0x3d8, stride 0xd, **sentinel-terminated**

```
@0x24604  add bx,0xd
@0x24607  mov ax,[bx]
@0x24609  cmp ax,0xffff
@0x2460c  je  <end>
```

BH_START.DAT holds **201 records** (DS:0x3d8..0xe09, sentinel at DS:0xe0d):

```
0  7f 7f 7f 7f 7f 7f 7f 7f a0 8c 10 05 00
1  7f 7f 7f 7f 7f 7f 87 64 64 b4 03 05 01
2  7f 7f 7f 7f 7f 7f 5a 6e 64 96 02 05 02
3  7f 7f 7f 7f 7f 7f 5d 70 a0 b4 06 05 03
```

byte +12 is a self-index (which proves the stride), 0x7f is the blob's blank fill, and the 16-bit
object code is the big-endian pair `mov ah,[bx+0xb]; mov al,[bx+0xc]`. In a fresh game every actor
reads `+0xb = 0x05`, `+0xc = index` — **code 0x500|k, i.e. star number k = actor number**. So a
new-game `s` legitimately enumerates the star catalogue, and the collectable gate (word at +0x0a
≠ 0xffff) passes for 194 of them.

TODO_ACTOR_CULL@0x245a9: nine `cmp ax,cx / je` pairs screen-position each actor against the camera
pair DS:0x3d2/0x3d3 before the push; only the collectable test is ported, so the port's visible set
is a superset.

### 2.3 The two `$`-record tables, which the 0x500 selector splits

Read straight out of the EXE's data segment:

| table | DS | stride | base | layout |
|---|---|---|---|---|
| ships | 0x128f | 0x17 | 1-based | 8-byte header, space-padded name + `$`, description + `$` |
| stars | 0x1e5b | 0x1c | 0-based | 2-byte header, name at +2 + `$`, description + `$` |

```
DS:128f  01 01 01 00 01 00 00 00 | CLAW   $ Known to be the Ship of Emer Kane…
DS:1355  02 02 02 00 01 00 00 00 | ROC    $ …
DS:13fd  02 03 00 00 00 00 00 00 | BATROK $ …
DS:1e5b  00 00 | ENIGMA $ The star of this solar system.
DS:1e94  00 00 | INGMAR $ This desert planet has a thin and harsh, but livable atmosphere…
DS:1fd1  00 00 | GLOBAN $ Globan is the wealthiest planet in the solar system due to its control
                     of the ilimium deposits…
DS:20fe  00 00 | LUMA   $ A small moon devoid of life and atmosphere. A large mining colony…
```

**The walk is not `base + n*stride`.** From the record start: `p = rec + stride`, scan forward to the
next `$`, step over it — the description's terminator *is* the record delimiter (@0x2d366 ships,
@0x2d251 stars). Records are variable length; the stride only offsets the search start.

**The selector.** `cmp ax,0x500`: below → ship number ax (1-based); at or above → star number
ax − 0x500 (0-based). `re/script-vm.md` had the geometry right and the semantics unknown; the tables
have names in them now. Ship byte +2 is the **BH_CONV script id** (CLAW 1, ROC 2, BATROK 0 = none),
which is what `c` dispatches on.

## 3. BH_CONV.DAT — the script database

Opened by `c` at @0x2d4f5 (`lea dx,[0x69ca]`; DS:0x69ca + 0x10190 = linear 0x16b5a = BH_CONV.DAT per
`re/loader_map.md`) through the generic loader `lcall 0x131e,0x8828`. Decoded with the **stone**
variant, 34,012 bytes:

```
0x0000  53 4f 4c 41 52 20 57 49 4e 44 53 1a 1a 2d 00     "SOLAR WINDS\x1a\x1a-"
0x000f  u16 LE table, stride 2: 111, 177, 303, 369, 435, 541, 607, 673,
                           849, 915, 981, 1101, 1167, 1233, 1273
```

**15 scripts**, and the count is implicit — the table ends where the offsets stop increasing (the
next u16 is 31, then 1,2,3…, a different sub-table). Script *n* begins at index *n−1*; the bodies are
streams of u16 LE values (script 1 @111 = 31,1,2,3,1,2,1,3,4,…).

TODO_CONV_OPCODES@0x1de0: the interpreter that consumes those streams is reached from @0x2d4ea
(`lcall 0x131e,0x1de0`). Ported here: the file, the index, the count, and script-id resolution.
Not ported: the opcode language. This is now the single biggest gap in the game loop.

`DS:0x35e1` is a side table of per-script flags: `lea cx,[0x35e1]` @0x2d53b, then
`mov byte[bx+0x35e1], 1/2` (@0x2d55a/@0x2d565/@0x2d57c) and `cmp byte[bx+0x35e1],3`
(@0x2d5b1/@0x2d5cf) with bx ∈ {0xe, 0x1c, 0x100, 0x240, 0x280, 0x301}. 3 = already ran, and the zone
loaders sit behind those tests.

## 4. The zone loaders are cutscene players, not map views

Refuted: the claim (in `re/formats-modes.md` / `re/FINDINGS.md`) that MW2P/MW3A/MW3B are
"multi-record containers walked by INT 21h/42h seek". A byte scan for `b4 42` finds **two** lseek
sites in the entire EXE, 0x250b9 and 0x2515f, both inside the picture loader 0x24ff4. What looked
like a seek is the *next file's OPEN* (`0x2a4ee` = BH_MW2P, `0x2a84c` = BH_MW3B). The framing is in
the decoded buffer and the blits state it: `<u8 w><u8 h><w*h indices>`, step `2 + w*h`
(@0x2a312 skip, @0x2a328 paint).

Each loader is a self-contained, timed, modal sequence with its own DAC fade:

| zone | files | what the port renders |
|---|---|---|
| 1 @0x29f90 | BH_MP1 + BH_MW1A + BH_MW1B (wind, 0xc350 read, 64000 px each) | full-screen corridor/vault, "SOMEWHERE IN THE SOLARSYSTEM…" caption, then a **tear** effect (band rows 57..141, seam cols 172/173, @0x2a06f) |
| 2 @0x2a362 | BH_MP2 + BH_MW2A + BH_MW2B + BH_MW2P strips (start 0x1770) | full-screen frame swap MW2A→MW2B |
| 3 @0x2a786 | BH_MP3 + BH_MW3A[0..3] + BH_MW3B[0..3] (stone, read 0xffff) | planet animation, 110x93…116x88 records blitted to A000:0x3eb2 |

Pacing is PIT counter 2 reloaded with **0x8ca0 = 36000 counts = 30.17 ms** (@0x2a0d4, @0x2a451,
@0x2a704, @0x2a9f8), not the pump's 0x7918; fade is 64 passes (@0x2af1f `mov cx,0x40`) over 762 DAC
bytes (@0x2af12 `mov ax,0x2fa`), colours 0..253 (@0x2af38 `mov cx,0xfe`).

## 5. Frame clock — TODO_TIMERS@0x23e9e, closed

**There is no timer interrupt in this game.** Full interrupt census over the code segments
(0x20000..0x31000): int 21h ×254, int 33h ×110, int 16h ×59, int 10h ×12, int 0h @0x10d78,
int 0Ah @0x13766, int 0F9h @0x16279, and exactly **one** int 1Ah @0x23b7a
(`mov ah,0 / int 0x1a / mov byte[0x3e32],dl`) — the boot seconds read used as an RNG seed. No int 8h,
no int 1Ch, no read of the BIOS counter at 0040:006C. The two installed vectors are int 24h
(@0x239d1..@0x239ee) and int 9h (@0x239f7..@0x23a09 save, @0x23ae1 install). Neither is a clock.

The clock is a **polled 8254 counter 2**. The pump's first action every pass (@0x23c1c →
`FUN_231e_0bf6` @0x23dd6) is a spin:

```
@0x23dd9  mov al,0x80 / out 0x43,al     ; counter 2, latch for read
@0x23ddd  in al,0x42 / mov bl,al        ; LSB
@0x23de1  in al,0x42 / mov bh,al        ; MSB
@0x23de5  cmp bx,0x7918 / ja 0x23ded    ; wrapped past terminal?
@0x23deb  jmp 0x23dd9                   ; no → spin
@0x23ded  mov al,0xb0                   ; yes → counter 2, mode 0, reload
```

0x7918 = 31000 counts of 1.1931816 MHz = **25.98 ms → 38.49 loop passes per second**, which is what
`re/game-loop-modes.md` never pinned down: the loop body advances on the PIT, not on input.
Ported in `web/src/engine/clock.ts`; `main.ts` maps it onto `requestAnimationFrame` with a catch-up
cap of 8 passes.

## 6. Menu / new game (lane D died before writing)

Still open. What is known: Escape in state 1 goes to `FUN_231e_99c2` @0x2cba2, which writes mode 1 at
@0x2cbae and repaints through @0x2b04d (@0x2cbb5, @0x2d14f). The new-game path @0x2cba2's siblings
and modes 0/5 remain undocumented.

## 7. Text and glyphs (lane E died before writing)

Still open, and now the reason the scan output above is rendered as a status line rather than drawn
into the framebuffer: `FUN_231e_8bdc` @0x2b892 (message centre, DI = `$`-string, AL=0, AH=0x3f),
`FUN_231e_31f1` @0x263d1 (caption at a vram offset), `FUN_231e_2f4d` @0x25f4d (text cursor) and
`FUN_231e_7fc0` @0x2a1c0 (string → row of the screen buffer, skipped when DS:0x13ade == 0) are all
called with addresses and never implemented. BH_CHAR.DAT (14,232 B) is the glyph candidate.

---

## BH_CONV.DAT is a conversation graph (session 8)

Two earlier notes here were wrong and are retracted:

1. **"BH_CONV.DAT is stone-RLE, ~34012 bytes decoded."** No. @0x2d50b is a plain `int 21h/3Fh` of
   `0xEA60` into `arena:0` with **no decode call anywhere on the path**, and the shipped file is
   exactly `0x7210` = 29200 bytes whose first 14 bytes are the magic
   `SOLAR WINDS\x1a\x1a-`. The bytes are the image.
2. **"lcall 0x131e,0x1de0 runs a CONV opcode interpreter."** No. Linear `0x24fc0` is nine bytes:
   `push ds / mov ax,0xbf9 / mov ds,ax / mov ax,ds / pop ds / retf`. It returns the arena selector in
   AX so the caller can `int 21h/3Dh, al=2` open the file. Nothing in `0x20000..0x31200` reads offset
   `0xf` of the image at all (capstone sweep over every memory operand with disp == 0xf: zero hits),
   so the monotone u16 run at +15 (111, 177, 303 … 1273) is **not** a script index. It is the tail of
   the header region, nothing more.

### The real layout

```
+0x0000  "SOLAR WINDS\x1a\x1a-"            magic, 14 bytes
+0x000e  u16 count                          (=14 for CLAW's node: the node's own string count)
+0x0010  u16 n                              (31, 61, 51, ... an opcode-ish run follows; unreferenced)
+0x0521  u16 nodeTable[]                    indexed by (script id - 1)
            @0x25079 `shl bx,1` / @0x2507b `mov ax,[bx+0x521]`
+0x541   node                               one per reachable id
   +0  u16 n        number of "$"-strings in this node's block (CLAW: 14)
   +2  u16 textPtr  == node+6
   +4  u16 head     address of the FIRST choice label
   +6  "the line the alien says$"
        "label0$" u16 target0 "label1$" u16 target1 "label2$" ...
```

The `label$` **then** `u16 target` pairing is established semantically, not by position, and it is
what proves the grammar: CLAW's `head` = `0x67b` holds `"YES, I AM INTERESTED$"` immediately followed
by `83 07` = `0x0783`, and `0x0783` reads *"Excellent.  The job consists of collecting an escaped
criminal. …"*. The next label, `"I`M NOT AT ALL INTERESTED$"`, is followed by `5a 09` = `0x095a`,
which reads *"You fool.  I am willing to pay you an incredible price for this mission and you will
listen!"*. A wrong pairing could not produce two coherent question/answer pairs in a row.

### `c` is the quest state machine, not a text dump

`FUN_231e_a26d` @0x2d44d walks the visible list, and for the first object whose record carries a
non-zero **script id** (ships: byte `+2` at `@0x2d4c9`; stars: `+0x17` per the C's `pcVar4 + 0x17`) it
opens BH_CONV, indexes the node, and then falls through a compare chain on that id —
`@0x2d53f` `cmp bx,0xd` through `@0x2d6f3` — writing world flags:

| id | effect (addresses from the switch) |
|---|---|
| 1  | `DS:0x3be7 = 1`, `DS:0x3ac9 = 1` (@0x2d6a8) — CLAW, the opening hiring pitch |
| 2  | node only (11 choices) — ROC's "WAIT!!! WAIT!!! Don't shoot." |
| 3  | node only (9 choices) |
| 4  | `DS:0x3abd = 1`; `inc byte[0xbaf4]`, and if it becomes 1 → `FUN_231e_6db0` **zone 1**, then `DS:0x3abb = 0` (@0x2d6c8) |
| 5  | if `DS:0x36e1 == 3` → `DS:0x3ac3 = 1` (@0x2d5a8) |
| 9  | `DS:0xf16 = 2` then the `0x3add` tail (@0x2d675) |
| 10 | if `DS:0x3821 == 3` → `DS:0x3ad1 = DS:0x3ad3 = 1`; also `DS:0x3acf = 0` (@0x2d6b8) |
| 11 | `DS:0x3861..0x3865 = 1,1,0,0,0` when `DS:0x3adf != 1`; `inc byte[0xbaf5]`, if it becomes 2 → `FUN_231e_7182` **zone 2** (@0x2d6eb); late `DS:0x3c46 = 0xff` |
| 13 | walks the `DS:0x3c7a` list for the value 2, writing `DS:0x38e2 = 1` or `2` (@0x2d547..@0x2d55f) |
| 14 | `FUN_231e_75a6` **zone 3**, print `DS:0x7212`, `int 16h`, `int 10h`, then `int 21h/4Ch` — it quits to DOS (@0x2d5f6) |
| 15 | `DS:0xeb6 = 2` then the `0x3add` tail (@0x2d645) |

After the switch every path runs `FUN_231e_1e14(id)` (the 64-byte-slot art loader at @0x24ff4),
`FUN_231e_a592()`, `DS:0x4383 = DS:0x5c1a = 0xff`, then clears the record's own script byte
(`*(uVar3+2) = 0`) so **the same ship never repeats its conversation** — which is why the shipped
shareware only ever shows each alien once.

### Which ids the shipped data actually uses

Sweeping the tables: ships 1..9 carry ids **1 (CLAW), 2 (ROC), 3 (ship 6), 13 (DOMAC), 9 (PHOENIX)**
and all 201 stars carry id 0. The zone-gate ids 4, 11 and 14 sit on **no** static record, so the three
cutscenes are entered by ids assigned at runtime by whatever scenario code sets them — still open.
(Ship records past #6 drift into garbage under the `$`-walk, so the table's real extent is also
unresolved; recorded rather than papered over.)
