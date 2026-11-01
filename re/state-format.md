# Solar Winds (1993) — GAME STATE blob format

Blob: `BH_START.DAT` ≡ `HSAV01.DAT`, 17,831 bytes (sha of both: identical, `cmp` clean).

## THE ANCHOR (settles the whole mapping)

`re/decomp/SOLAR1.c` → main menu/save routine `FUN_231e_99c2` @ linear 0x2cba2.

Save (linear 0x2cf5c):
```
02cf5c  b4 40       mov ah, 0x40          ; INT 21h write
02cf5e  8d 16 ad 00 lea dx, [0x00ad]      ; <- blob START = DS:0x00AD
02cf62  8d 0e 54 46 lea cx, [0x4654]      ; <- blob END   = DS:0x4654
02cf66  2b ca       sub cx, dx            ;    cx = 0x45A7 = 17831  == file size
```
Load (linear 0x2d0fb):
```
02d0fb  b4 3f       mov ah, 0x3f          ; INT 21h read
02d0fd  8d 16 ad 00 lea dx, [0x00ad]
02d101  8d 0e 54 46 lea cx, [0x4654]
02d105  2b ca       sub cx, dx
02d107  cd 21       int 0x21
02d114  3d bc 02    cmp ax, 0x2bc         ; reject reads shorter than 700 bytes
```

**Therefore the savegame is a raw image of the DS data segment from 0x00AD to 0x4653.**
No header, no checksum, no per-record framing. One address law:

| | |
|---|---|
| `blob offset i` | `= DS offset X − 0x00AD` |
| `DS offset X` | `= blob offset i + 0x00AD` |
| `linear byte addr` | `= DS offset X + 0x10190` (`= blob i + 0x1023D`) |
| `EXE file offset` | `= DS offset X + 0xFB90` (initial values in the image) |

The `linear = file + 0xf200` and `linear = DS + 0x10190` relations are both independently
verified by the name-table anchors in `re/loader_map.md` (BH_START.DAT: DS 0x688a ↔ linear 0x16a1a;
HSAV01.DAT: DS 0x4388 ↔ linear 0x14518).

**Consequence:** the task's known globals `0x4678, 0x469c, 0x54b5, 0x6b8b, 0x7055, 0x7058, 0x70e1,
0xb998, 0xb380` are all **above 0x4654 → outside the blob → NOT persisted** in a savegame. Only
`0x4654` is relevant, and it is the *end marker*, not a field. Fields must be sought at DS
`0x00AD..0x4653`.

Slot arithmetic (linear 0x2cf36 / 0x2d0d8): filename = `DS:0x4388 + 0x24 * slot` (the
`HSAV01..HSAV09,HSAV00.DAT` name block, itself inside the blob), slot index global = `DS:0x4552`
(also inside the blob).

## Offset table

| blob off | DS off | size | type | meaning | code global | evidence | conf |
|---|---|---|---|---|---|---|---|
| — | 0x00AD–0x4653 | 0x45A7 | raw DS image | whole game state | — | save 0x2cf5e / load 0x2d0fd | **Confirmed** |

## Unknown / to fill

(region 0x4654+ excluded, see above)

## state.js field coverage

Ported into `web/src/engine/state.js` (`node --check` clean; acceptance harness
`node re/work/state/roundtrip.mjs`). **Append-only section — nothing above this line was edited.**
Every cited field below was re-verified this pass by reading the operand bytes at the listed linear
address with `python3 re/work/x86.py <addr>`; nothing is named from a filename or a guess.

### Corrections applied in the port (the table above still carries the old constants)

1. **`EXE file offset = DS + 0xF90`, not `+0xFB90`** (row in the mapping table above is wrong by
   `0xEC00`; everything else in this file is right). Evidence:
   - the literal `HSAV01.DAT` sits at EXE file offset `0x5318`, and the save path's name block is
     `lea dx,[0x4388]` @0x2cf3e ⇒ `0x5318 − 0x4388 = 0xF90`;
   - `0x5318 + 0xF200 = 0x14518` (linear) and `0x14518 − 0x4388 = 0x10190`, so `linear = DS + 0x10190`
     (already used in this file) is self-consistent only with `+0xF90`;
   - whole-blob check: `BH_START.DAT` vs the EXE image read at `DS + 0xF90` (file `0x103D..0x55E3`)
     matches **17,325 / 17,831** bytes; at `DS + 0xFB90` only 722 do.
2. **`DS = linear − 0x10000` (used by `re/game-loop-modes.md` §3) is 0x190 too low.** It matters in
   exactly one place: that doc puts the INT 9 keyboard hold-flags at `DS:0x321c..0x3224`. Blob bytes
   there read `61 62 6e 6f 72 6d 61 6c 6c` = the string "abnormal" (blob 12655..12663, name-table
   data). The ISR runs in the code segment (runtime CS base linear `0x231e0`), so `cs:[0x3c]` is
   linear `0x2321c` = DS `0x1308c` — above `DS_END`, i.e. **not** persisted. Tracked as
   `TODO_FIELDS.TODO_KEY_FLAGS`.
3. **`re/script-vm.md:32`'s "word table at `DS:0x521`" is not a blob field.** `FUN_231e_1e14` @0x24ff4
   executes `mov ax,ds` / `mov bx,0xbf9` / `mov ds,bx` @0x24ffd-@0x25002 before `mov ax,[bx+0x521]`
   @0x2507b, so that 0x521 indexes the resource segment. Tracked as `TODO_FIELDS.TODO_SCRIPT_RECORD_TABLE`;
   no accessor is exported for it.

### Implemented — 24 fields, offset + width proven (blob offset = DS − 0x00AD)

| field (state.js) | DS | blob off | width / write site | BH_START.DAT value |
|---|---|---|---|---|
| `inputGatherer` | 0x3572 | 13509 | byte 0/1/≥2; cmp @0x23e03/@0x23e0a, inc @0x2e7b9 | 0x00 |
| `schedulerSlot` | 0x359b | 13550 | word; mov `[di+0x359b],0x32` @0x244e3, += 5/0xf/10 @0x2d772 | 0x0005 |
| `countdownTimer` | 0x3c16 | 15209 | word; cmp @0x23e9e, dec @0x23ed2 | 0x0000 |
| `countdownPrev` | 0x3c18 | 15211 | word; mov `[0x3c18],ax` @0x23ecf | 0x0000 |
| `statBudget` | 0x3c5c | 15279 | word; mov `[0x3c5c],0x2bc` @0x244da; raised to the stat sum, SOLAR1.c:13440-13445 | 0x0041 |
| `crewStats[0..7]` | 0x3c5e | 15281 | 8 words, stride 2; cmp/add `[di+0x3c5e]` @0x299a6-@0x29aaa; caps 0x4a,0x4a,0xde,0x25,0x6f,0x6f,0x6f,0x6f | 8 10 2 5 10 10 10 10 |
| `actionPoints` | 0x3c70 | 15299 | word; dec @0x299ad..@0x29aa3, inc @0x29abf..@0x29b72 | 0x0000 |
| `mode` | 0x3c91 | 15332 | byte 0..5; cmp chain @0x23c1f/@0x23c2e/@0x23c3d/@0x23c4c/@0x23c5b | 0x01 |
| `byte_3c92` | 0x3c92 | 15333 | byte; mov `[0x3c92],cl` @0x2445f — meaning TODO | 0x16 |
| `byte_3c93` | 0x3c93 | 15334 | byte; cmp 0xff @0x2444a, mov 1 @0x24451, dec @0x2446d — meaning TODO | 0x00 |
| `word_3c95` | 0x3c95 | 15336 | word; mov `[0x3c95],1` @0x2e7a5 — meaning TODO | 0x0000 |
| `scrollPos` | 0x3c98 | 15339 | word; add/sub 3 @0x24487/@0x244aa, bounds ±0x22 @0x24480/@0x244a3 | 0x0006 |
| `soundEnabled` | 0x3ade | 14897 | byte; mov 1 @0x23ec2, mov 0 @0x23ef1, cmp @0x23eb4 | 0x00 |
| `cheatLatch` | 0x3be6 | 15161 | byte; mov 1 @0x23c81/@0x244d5, cmp @0x2e79e | 0x00 |
| `word_3ec5` | 0x3ec5 | 15896 | word; `+= [0x3e39]` SOLAR1.c:13558 — meaning TODO | 0xff91 |
| `int24VectorSeg` | 0x4384 | 17111 | word; INT 21h/35h al=24 result stored @0x239d7 | 0x17f2 |
| `int24VectorOfs` | 0x4386 | 17113 | word; stored @0x239db | 0x0156 |
| `slotNameTable[0..9]` | 0x4388 | 17115 | 10 × 0x24 B records (12 B `name`+`00 24`, then 24 spaces); `lea dx,[0x4388]` @0x2cf3e/@0x2d0e0 after `mul 0x24` @0x2cf3c | HSAV01.DAT … HSAV00.DAT |
| `saveSlot` | 0x4552 | 17573 | word; mov ax,`[0x4552]` @0x2cf36/@0x2d0d8 — **also** used as a segment scratch by zone 3: `mov ax,[0x6b97]`/`mov [0x4552],ax`/`mov ds,[0x4552]` @0x2a7d5/@0x2a7d8/@0x2a7f2 | 0x0000 |
| `listMax` | 0x4559 | 17580 | byte; upper row bound of the `[0x455a..0x4559]` cursor range | 0x0a |
| `listMin` | 0x455a | 17581 | byte; mov dl,`[0x455a]` @0x28407 | 0x04 |
| `byte_455b` | 0x455b | 17582 | byte; undocumented neighbour of the bounds — meaning TODO | 0x07 |
| `listCursor` | 0x455c | 17583 | byte; cmp dl,`[0x455c]` @0x2841b/@0x28421 | 0x04 |
| `mapReadLength` | 0x4577 | 17610 | word; mov `[0x4577],ax` @0x2a002 and @0x2a7ba | 0x36da |

Cross-check that the table is coherent: `crewStats` summed (8+10+2+5+10+10+10+10 = 65 = 0x41) equals
`statBudget` exactly, which is what SOLAR1.c:13440-13445 computes. `saveSlot` = 0 pairs with
`slotNameTable[0]` = `HSAV01.DAT`, and `mode` = 1 matches the state-1 handler dispatch in
`re/game-loop-modes.md`.

### TODO — 7 fields exposed by name with no accessor (offset not proven)

| name in `state.js` | global address to confirm |
|---|---|
| `TODO_FIELDS.TODO_KEY_FLAGS` | INT 9 ISR stores @0x23cb4/@0x23cba/@0x23cc7/@0x23d4c — runtime CS value (correction 2 above) |
| `TODO_FIELDS.TODO_JOY_AXIS_DELTA` | `DS:0x3e39` (partner of the proven `DS:0x3ec5`) — never referenced by direct addressing |
| `TODO_FIELDS.TODO_MOTION_COUNTER` | `DS:0x3ce,0x3d0,0x3d2,0x3d4,0x3d6` — 5-step byte decrement chain, SOLAR1.c:13575-13584 |
| `TODO_FIELDS.TODO_RESOURCE_TABLE` | `DS:0x3ae8` (18 words) gated by `DS:0x3b10`, SOLAR1.c:13569-13573 |
| `TODO_FIELDS.TODO_SCRIPT_RECORD_TABLE` | `0xbf9` resource segment vs `DS:0x0521` — `mov ds,bx` @0x25002 |
| `TODO_FIELDS.TODO_CREW_ROSTER` | BH_PEOP consumer FUN_231e_3f87 @0x27167; the `[0x3573]`/`[0x35af]` tables at @0x2c5d9/@0x2c307 (no stride recorded) |
| `TODO_FIELDS.TODO_SAVE_SLOT_LIST` | `DS:0x6dd8` (240 B written to SAVLST.DAT @0x2cf27) vs the in-blob block at `DS:0x4388` |

### Not persisted — 19 globals the docs cite, all `DS ≥ 0x4654`

`TRANSIENT_GLOBALS` in `state.js` names them (so a caller cannot mistake them for blob fields):
the nine from the "Consequence" paragraph above (`0x4678`, `0x469c`, `0x54b5`, `0x6b8b`, `0x7055`,
`0x7058`, `0x70e1`, `0xb998`, `0xb380`) plus ten more with cited code sites: `0x4679` @0x23efb,
`0x46a5` @0x23c6a, `0x46a7` @0x244be, `0x4d5b` @0x24471, `0x4d5d` @0x24494, `0x5bb8` @0x244f3,
`0x5c1a` @0x23c08, `0x6b87` @0x2cf44, `0x6b97` @0x2a7d5, `0x6dd8` @0x2cf27.

### Regions where the blob differs from the EXE image (next pass's targets)

The 506 differing bytes form 16 runs; the wide ones are the un-mapped game data:
`DS:0x3c9a..0x3cdb` (66 B), `DS:0x3ce4..0x3d34` (81 B), `DS:0x3ec5..0x4010` (332 B, contains
`word_3ec5`), `DS:0x456f..0x457a` (12 B), `DS:0x4556..0x455d` (8 B), `DS:0x3bea..0x3bf0` (7 B),
`DS:0x3c72..0x3c75` (4 B), `DS:0x3c1a..0x3c1d` (4 B), `DS:0x4384..0x4387` (4 B, the INT 24h vector).

### Round-trip proof

`node re/work/state/roundtrip.mjs` (load a real blob, `save()` it, compare byte-for-byte; then
mutate and restore through the setters and re-compare):

```
BH_START.DAT: 17831 B in, 17831 B out, byte-identical=true
HSAV01.DAT: 17831 B in, 17831 B out, byte-identical=true
web/data/BH_START.DAT: 17831 B in, 17831 B out, byte-identical=true
  ok   mode DS:0x3c91: 1 (want 1)
  ok   saveSlot DS:0x4552: 0 (want 0)
  ok   slotName(0): HSAV01.DAT (want HSAV01.DAT)
  ok   slotName(9): HSAV00.DAT (want HSAV00.DAT)
  ok   slotNameAddress(3): 0x43f4 (want 0x43f4)
  ok   listMax DS:0x4559: 10 (want 10)
  ok   listCursor DS:0x455c: 4 (want 4)
  ok   int24VectorOfs DS:0x4386: 342 (want 342)
  ok   crewStat(0): 8 (want 8)
  ok   actionPoints DS:0x3c70: 0 (want 0)
  ok   crewStat sum == statBudget DS:0x3c5c: 65 (want 65)
  ok   fileOffsetOfDs(0x4388): 0x5318 (want 0x5318)
  ok   set/read-back drift: none
PASSED
```

`load()` requires exactly 17,831 bytes (the engine's own window @0x2d0fd-@0x2d105); the engine's
`cmp ax,0x2bc` short-read rejection @0x2d114 is exported as `MIN_LOAD_BYTES`, not enforced on the
JS side.
