# Status-message pool (EXE string block)

Evidence: `rea read-bytes SOLAR1.EXE 0x15a9d` -> `ev_eb620c8844abf5e1a21f9bc3fe1996f86bcd9be57f59ecb0fb6846d5c2e52758`

(sha256 of target `7e7484a4a5ee...`, authority `shipped-artifact`); byte identity with the local file at
offset `DS + 0xE00` was checked over 64 B, so every address below is reproducible without Ghidra.

The pool is `$`-delimited ASCII in the EXE image, referenced by `lea bx,[disp16]` (`8d 1e lo hi`).

**Attribution caveat (Observed vs. Inferred):** the `DS` column and the text are Observed (direct byte reads of
the shipped image). The routine column is **Inferred** — it names the closest `lea` site within 0x10 bytes of the
entry, not the site that actually loads this pointer; `-` means no `lea` into that entry was found. Per-entry
attribution needs a data-reference pass, which is the open item at the bottom of this file.

| DS | text | first referenced by |
|---|---|---|
| `5800` | tick and press a button. | FUN_231e_7ad6 @0x2acb6 |
| `581b` | Put the stick into the upper left corner and press a button. | FUN_231e_7ad6 @0x2acb6 |
| `585a` | Put the stick into the lower right corner and press a button. | FUN_231e_a26d @0x2d44d |
| `589a` | 'Someone is starting to interfere with our activities.' | FUN_231e_3542 @0x26722 |
| `58d2` | 'Make sure that this problem is taken care of soon.' | FUN_231e_a01c @0x2d1fc |
| `5907` | 'That is all.  You may leave.' | FUN_231e_a01c @0x2d1fc |
| `5926` | OBJECT MUST VISIBLE TO COMMUNICATE | FUN_231e_3a81 @0x26c61 |
| `5949` | OBJECT MUST BE ON SCREEN TO SCAN | FUN_231e_5a22 @0x28c02 |
| `596a` | *****  GO TO SECTOR -31,1  ***** | - |
| `598b` | VADIUM FIELD DETECTED NEARBY | FUN_231e_ab0a @0x2dcea |
| `59a8` | A SHIP IS UNCLOAKING NEARBY | FUN_231e_a01c @0x2d1fc |
| `59c4` | A SHIP IS CLOAKING NEARBY | FUN_231e_a01c @0x2d1fc |
| `59de` | NO RESPONSE ON ANY CHANNEL | FUN_231e_a01c @0x2d1fc |
| `59f9` | CLOAK HAS BEEN NULLED | FUN_231e_91ed @0x2c3cd |
| `5a0f` | NOTHING TO USE | FUN_231e_a01c @0x2d1fc |
| `5a1e` | NOTHING TO TRANSPORT | FUN_231e_ba64 @0x2ec44 |
| `5a33` | NO LASER POWER | FUN_231e_ba64 @0x2ec44 |
| `5a42` | INSUFFICIENT POWER TO SENSORS FOR DETAIL | FUN_231e_ba64 @0x2ec44 |
| `5a6b` | SCIENCE SCAN REPORTS NOTHING | FUN_231e_bb5a @0x2ed3a |
| `5a88` | SCIENCE SCAN OF LOCAL AREA PLANETS | FUN_231e_ba64 @0x2ec44 |
| `5aab` | PRESS A KEY | - |
| `5ac5` | SCIENCE SCAN OF LOCAL SPACECRAFT | - |
| `5ae7` | DANGER NEAR - CAN'T MAKE HYPERJUMP | - |
| `5b0a` | CAN'T MAKE HYPERJUMP: SPEED = 0 | - |
| `5b2a` | YOU ARE BEING HAILED | - |
| `5b3f` | SHIELD TYPE: UNKNOWN | - |
| `5b54` | SHIELD TYPE: | - |
| `5b61` | CANNON TYPE: UNKNOWN | - |
| `5b76` | CANNON TYPE: | - |
| `5b83` | NO MISSLES LEFT | - |
| `5b9a` | LIFE SUPPORT ENERGY IS LOW | - |
| `5bb5` | TRANSPORT SUCCESSFUL | - |
| `5bca` | ITEM EJECTED INTO SPACE | - |
| `5be2` | SHIP IS CLOAKED | - |
| `5bf2` | CLOAKING DEVICE IS NOW OFF | - |
| `5c0d` | NO REASON TO TRANSPORT THAT NOW | - |
| `5c6d` | DISTRESS SIGNAL DETECTED ON PLANET SURFACE. | - |

37 delimited entries in DS:0x5800..0x5d00; 202 `lea bx,[disp16]` sites in the block.

## Call-site detail (local disassembly, `re/work/x86.py`, DELTA 0xF200)

`FUN_231e_ba64 @0x2ec44` (state 3, `t`) and `FUN_231e_bb5a @0x2ed3a` (state 3, `u`) are the message
printers behind the `a`/`w`/`e` sub-screens. Each body is a chain on `AL`; every branch ends in
`lcall 0x131e,0x32de`:

| branch | gate | string site | pool entry printed |
|---|---|---|---|
| @0x2ec4f | `cmp si,0` -> bail | — | nothing, when the entity table is empty |
| @0x2ec59 | `al == 5` **and** `[si+0x3ce]==0x8d`, `[si+0x3cf]==0x72`, `[si+0x3cc]==[si+0x3cd]==0x7f` | @0x2eca1 `lea bx,[0x5a25]` | the DS:0x5a25 entry |
| @0x2ecad | `al == 0xc` **and** `[si+0x3ce]==0x85`, `[si+0x3cf]==0x8f`, `[si+0x3cd]==[si+0x3cc]==0x7f` | @0x2ecee `lea bx,[0x5a25]` | the DS:0x5a25 entry |
| @0x2ed03 | `al == 2` | @0x2ed12 `lea bx,[0x5a3a]` | the DS:0x5a3a entry |
| @0x2ed1e | fallthrough | @0x2ed1e `lea bx,[0x5a7d]` | the DS:0x5a7d entry |
| @0x2ed2e | `cmp word[0x3c56],0` (page count zero) | @0x2ed2e `lea bx,[0x587f]` | the DS:0x587f entry |

`[si+0x3ce..0x3cd]` are the five-byte camera axes ported in `flight.ts` (`CAM_X_MSB 0x3ce`,
`CAM_Y_MSB 0x3cf`), so the two "magic coordinate" branches are *position* gates: the engine prints
different text when the ship sits at two exact locations. What those locations are, and what the
payoff is, is unexamined — the open item.

**Address caution:** the `lea` displacements land *inside* the entries of the table above (e.g.
`0x5a25` vs the entry starting at `0x5a1e`). Both are Observed bytes of the same image; the
discrepancy is unresolved and probably means the printer at `FUN_231e_32de @0x264be` walks a
skipped prefix. Do not treat the two tables as independent confirmations of an address.

Ported: `web/src/engine/messages.ts` reads every entry out of the EXE image at runtime
(`file = DS + 0xE00`, verified against `ev_eb620c88…`), and the scan/communicate empty arms now
print the shipped strings. Two invented strings were removed: "NOTHING IN RANGE" and "UNABLE TO
COMMUNICATE", neither of which occurs anywhere in the image.
