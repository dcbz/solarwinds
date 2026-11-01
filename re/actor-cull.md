# Actor visibility / cull — `FUN_231e_1364 @0x24544`

Target `SOLAR1.EXE` sha256 `7e7484a4a5eee9c2a9243820e551db27ca57567abb640c12d379c95c9b7983df`.
All sites below are Observed: dumped with `re/work/x86.py` (capstone, DELTA `0xF200`), which is the
same disassembly path used for `re/loader_map.md`, and cross-checked against
`re/decomp/SOLAR1.c:13860..13900`.

## The rule (this is what "empty space" comes from)

The walk over the 0x20-byte-stride actor array at `DS:0x3d8` (`add bx,0xd` / `cmp ax,0xffff`
sentinel at `@0x24609`) gates each actor on position:

```
02455b  lea bx,[0x3d8]
02455f  mov ax,[bx+si]        ; si = 0,2,4  -> the actor's position words
024561  cmp al,[si+0x3ce]     ; vs camera byte pair (X:0x3ce,0x3d0,0x3d2 | Y:0x3cf,0x3d1,0x3d3)
024565  jne fail
024567  cmp ah,[si+0x3cf]
02456b  jne fail
02456d  add si,2 / cmp si,6 / jne 0x2455f     ; all THREE byte-pairs must be equal
```

That first test is the *same-cell* case only. When it fails, control reaches the 3x3 sweep:

```
024592  mov ax,[bx+si]        ; actor (X_msb, Y_msb)
024594  mov cl,[0x3ce] / mov ch,[0x3cf]       ; camera MSB pair
02459f  dec cl / 0245a1 dec ch                 ; start at (-1,-1)
0245a9  cmp cx,ax -> je match        dx=0x000 di=0x000
0245ad  inc cl / cmp ax,cx -> je     dx=0x100 di=0x000
0245b6  inc cl / cmp ax,cx -> je     dx=0x200 di=0x000
0245bf  sub cl,2 / inc ch  -> row +1, then the same three tests again
0245e3  inc ch                     -> row +2, three more tests
```

So an actor is visible when its **most-significant position byte pair lies within +/-1 of the
camera's** — nine cells. `dx`/`di` carry which column/row matched, as multiples of 0x100.

At the match (`@0x24616`) the engine folds that cell offset into the pixel delta:

```
024616  mov ax,[bx+si+2]      ; actor mid word (X_mid, Y_mid)
02461d  add dx,ax             ; dx = cellX*0x100 + actorX_mid
024621  add di,cx             ; di = cellY*0x100 + actorY_mid
024623  mov al,[si+0x3d0] / mov ah,[si+0x3d1]  ; camera mid pair
024635  add cx,0x100 / add ax,0x100            ; + one cell of bias
02463c  cmp byte[0x3ade],1 -> shr cx,1 / shr ax,1 / shr dx,1 / shr di,1   ; the zoom flag
02464b  sub dx,ax             ; final X delta
02464d  sub di,cx             ; final Y delta
```

then the +/-0x93 / +/-0x87 screen-window cull at `@0x2464f..@0x24665` (already ported as
`CULL_X`/`CULL_Y`), the type-0xff tightening (`NEAR_TYPE_CULL`), and the push of the actor **address**
into `DS:0x3bf5` / count `DS:0x3bf3` (`@0x246cd`) that `s` and `c` consume.

`DS:0x3ade` is the zoom/scene flag, *not* sound — see the correction in `re/game-loop-modes.md` /
`engine/clock.ts:87`.

## What the port does wrong

`web/src/engine/world.ts:122 inSector()` implements **only the exact three-byte-pair equality**
(`ax[0]==cx[0] && ax[1]==cx[1] && ax[2]==cx[2]` and the same for Y) and `renderWorld` `continue`s on
failure — so it admits the same cell and nothing else. `cellWindow()` (world.ts:134) already computes
the 3x3 offset but is **never called from the walk**. Consequences:

* Any ship/planet one cell away is invisible and unscannable, and `c` finds nobody. This is the
  "just flying around in empty space" symptom — not a missing story trigger.
* Because the port's pixel delta is derived without the `cellX*0x100` term, actors that *are* in the
  same cell are positioned by the mid/low bytes only. That part agrees with `@0x24616` only for the
  `dx=di=0` case.

## Fix, exactly

1. In the walk, replace `inSector(...)` with a nine-way test returning
   `[col, row] | null` (`cellWindow` already computes it from bytes `+6/+7` — **verify** the source
   bytes first: `@0x245a9` compares the **MSB pair at +0/+1 of the position block**, not +6/+7.
   Use `s8` on the byte pair and require the offset to be in {-1,0,+1}).
2. Compute `dx = (col-1)*0x100 + actorX_mid - (camX_mid + 0x100)` and the Y equivalent, applying
   `>>1` to all four when `DS:0x3ade == 1`, then the existing cull.
3. Keep the push condition `type != 0xff` (`@0x246cd`) so `s`/`c` see the same list as the renderer.

## Open

* Whether BH_START's fresh camera and the CLAW's record actually differ by 1 cell or 3 — the earlier
  note "camera cell (99,120), CLAW 3 cells away" used *coarse* cells. Needs the byte pair of each
  dumped from `BH_START.DAT` at `DS:0x3d8 + n*0xd` vs camera `DS:0x3ce..0x3d3`; if the offset is 2,
  the nine-cell window is not enough and the opening encounter is placed by the sector initializer
  in `re/decomp/SOLAR1.c:13552..13625`, which is still unported.
* The `+0.100` bias at `@0x24635/@0x24639` (one full cell added to the camera side) — its sign
  convention relative to `dx` needs one runtime screenshot to confirm.

## Root cause of "empty space" — measured, not theorised (2026-10-31)

`BH_START.DAT` is **DS-linear**: byte at DS offset `n` is file offset `n`. (The `+0xF90` mapping in
`re/state-format.md` is blob→*EXE* correspondence, not blob addressing; reading the blob with
`+0xF90` yields ASCII and looks like a text block. Do not repeat that mistake.)

With the correct reading:

```
camera  DS:0x3ce.. 8e 64 96 0a 05 0c 7f 7f 7f 7f     X = (8e,96,05) Y = (64,0a,0c)
actor#0 DS:0x3d8   7f 7f 8c a0 64 96 08 05 0d 7f 7f 7f 7f
actor#1 DS:0x3e5   7f 7f 8b a4 64 96 1a 05 0e ...
... every one of the 201 records carries MSB pair (7f,7f)
```

`0x7f` is this representation's zero (the same bias `coordinates.ts` subtracts as `0x7f7f7f7f`). So
**every actor's most-significant byte pair is the uninitialised placeholder**, while the camera's is
`(0x8e, 0x64)`. Neither the exact compare at `@0x2455f` nor the nine-cell sweep at `@0x245a9` can ever
match, so `DS:0x3bf3` stays 0, and `s`/`c` find nothing. That is the whole symptom.

Two separate defects, both real:
1. **Unported:** the pass that promotes the `7f` placeholders to the MSBs derived from each actor's
   mid bytes — `re/decomp/SOLAR1.c:13552..13625` (the five-byte inertia/carry model session 9 flagged).
2. **Mistranscribed:** `inSector()` implements only the exact three-byte-pair equality; the original is
   the nine-cell window with the `cell*0x100` term folded into the delta at `@0x24616`.

Fix order: (1) then (2). After (1) alone the same-cell actors appear; after (2) the neighbours do.

## Third correction, same session — the compare is NOT on the MSB pair

Re-reading `@0x2455f..@0x245a9` with the loop's live register values: `si` leaves the three-pair loop
at **6**, so

* exact test: actor words at `+0,+2,+4` vs camera `0x3ce..0x3d3` (the three HIGH pairs),
* cell test  `@0x24592`: actor word at **`+6,+7`** vs camera **`0x3d4/0x3d5`**, `cx` walking `-1,0,+1`
  in each half,
* pixel delta `@0x24616`: actor word at **`+8,+9`** vs camera `0x3d6/0x3d7`, plus `cell*0x100`.

So the nine-cell window is on the **fourth** byte pair, not the MSB pair. The "MSB (0x7f,0x7f)"
paragraph above is therefore wrong about which bytes matter, though the byte dump itself is right.

Measured fresh-state pairs:

```
camera  (8e,64) (96,0a) (05,0c) (7f,7f) (7f,7f)     high three pairs => sector (-28,7)
actor#0 (7f,7f) (8c,a0) (64,96) (08,05) (0d,7f)     high pair == the 0x7f placeholder
```

The actor array's HIGH pair is the placeholder for every record while the camera's high pairs encode
sector (-28,7). The exact three-pair test therefore rejects all 201 records before the cell test is
ever reached. Two possible readings, not yet separated:

1. BH_START's actor array is stale and a **runtime placer** rewrites the high pairs from BH_PLAN /
   BH_SHIP around the player. Nothing writes `DS:0x3d8` through a `disp16` literal — all five
   `d8 03` occurrences in code are reads (`lea bx,[0x3d8]` at @0x2455b, @0x2854d, @0x288ca), so a
   placer would address it through a computed pointer and needs a real Ghidra xref/data-ref pass,
   not a byte search.
2. The fresh camera is not what the original uses after the BH_SEQ intro finishes.

Decide with runtime evidence, not more static reading: boot under DOSBox Staging (already proven to
run — `re/README-dosbox.md`) and dump `DS:0x3d8..0x3e5` plus `DS:0x3ce..0x3d7` after the intro, via
the Staging debugger. If the actor high pairs are then real coordinates, reading (1) is correct and
the placer is the missing module; that placer, not the nine-cell test, is what makes a ship appear
close enough to hail.

Until that is settled, `world.ts:122 inSector()`'s exact-three-pair rule stands as a faithful
transcription of `@0x2455f`, and the nine-cell `+6/+7` test is genuinely unported.

## Flow check (matters for the fix order)

`@0x24565`/`@0x2456b` `jne 0x24554`, and `0x24554` is `jmp 0x24601` = next actor. So a mismatch in the
three HIGH pairs rejects the record **before** the nine-cell sweep at `@0x24592` is ever reached.
The cell sweep is therefore *not* an alternative acceptance path — it only refines position/delta for
actors that already match exactly. Which means: porting the nine-cell test changes nothing on its own,
and "fix (2)" in the earlier section is not the blocker. The blocker is solely that no record's HIGH
pairs ever equal the camera's, i.e. reading (1) or (2) above.

## Field offsets settled by statistics, not by reading (2026-10-31)

Histograms over the two ranges of the actor array in the untouched `BH_START.DAT`:

```
hostile DS:0xbb7..0xd8b (36 records)     star DS:0x3d8..0xbb7 (155 records)
  +6: 201..206 x14, 255 x10, 0 x3, 16      +6: 23 x42, 24 x44, 27 x35, 5/7/8/10/12/13/18/19/22/26/28/29/31, 201..206 x13
  +7: 0 x36, 22 x1                         +7: 0 x20, 5 x135
  +8: 1..36 each exactly once              +8: 17 x119, then 1..29 once each
  +a: 127 x22, 0 x11, {2,14,20}            +a: 127 x153, 0 x2
  +b: 127 x22                              +b: 127 x155
  +c: 127 x22                              +c: 127 x155
```

Consequences, all Observed:

1. **`+6` is the type byte.** Values 0xc9..0xce are precisely the BH_SHIP bank selector range
   (`0xc8..0xce`, session 11) and 0xff is the projectile type the renderer special-cases. So
   `world.ts`'s `type = byteAt(address + 0xa)` reads the wrong field — the 0xa/0xb/0c trio is 0x7f
   filler in the star range. `@0x24586`'s `mov al,[bx+si+4]` therefore runs with `si == 0`, not 6:
   the three-pair loop's `add si,2 / cmp si,6 / jne` exits via the `jne` at `si == 6` **only on the
   success path**, and the type read is on the *first* iteration's `si`. Retrace before "fixing".
2. **`+8` is the object index.** 1..36 exactly once each in the hostile range — that is the
   `code >= 1 && code <= 36` domain `world.ts` currently derives from `+0xb/+0xc`.
3. **`+7 == 5` for 135 of 155 star records.** Not a coordinate and not random; an unresolved field.

And the coordinates themselves: X = `+0,+2,+4`, Y = `+1,+3,+5` (interleaved, bias `0x7f` per byte,
consistent with the `0x7f7f7f7f` subtraction in `coordinates.ts`). Every star record's top pair is
`(0x7f,0x7f)` and its mid pair is the only non-placeholder content, so **in the shipped save all 155
stars sit at sector (0,0)** while the camera sits at X=(8e,96,05) Y=(64,0a,0c). The 36 hostile records
have distinct mid/low bytes but the same placeholder top byte.

Therefore the actor array in `BH_START.DAT` is a **template**, and an initializer that spreads records
into sectors is mandatory — with it, "nothing near the player" is correct behaviour for the raw blob;
without it, no amount of fixing the cull or the field offsets will put a ship on screen. That
initializer is the story blocker, and it is a *find-the-code* task (writes go through computed
pointers; the three `lea bx,[0x3d8]` sites are all reads), not a read-the-blob task.
