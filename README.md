# Solar Winds — a web port, reverse-engineered from the DOS original

**Solar Winds** is a 1993 VGA/Sound Blaster space arcade-adventure by **Epic MegaGames**,
distributed as shareware. This repository holds an in-progress port of its engine to
TypeScript for the browser, plus the reverse-engineering record that the port's code cites.
It is not affiliated with or endorsed by Epic MegaGames.

The port has **no asset pipeline**: the browser decodes the shipped `.DAT` files directly, the
same RLE and palette formats the 16-bit engine used, so changing art or adding content is a data
edit rather than a compile.

```sh
npm --prefix web ci
npm --prefix web run build        # tsc, strict
npm --prefix web run check        # the assertion suite
python3 -m http.server 8000       # then open http://localhost:8000/web/
node tools/verify_dist.mjs        # proves the shipped distribution is unmodified
```

## What is actually done, and how it is known

Everything the port draws is transcribed from `SOLAR1.EXE`
(`sha256 7e7484a4a5eee9c2a9243820e551db27ca57567abb640c12d379c95c9b7983df`, dos-mz,
x86 LE 16-bit real mode) and each routine's file names the addresses it came from. A
multi-pass harness asserts the visible result, not just that code ran.

| Area | Module | Evidence |
|---|---|---|
| Frame model | `web/src/framebuffer.ts` | `A000:0000`, mode 13h, 320×200×8bpp — from `rep movsw` with `cx = 0xfa00` (`@0x2a05b`) and an independent DOSBox mode-13h log |
| Picture decode | `web/src/rle.ts` | two RLE variants one byte apart (`@0x25119` vs `@0x2a03e`); each screen decodes to exactly 64,001 bytes |
| Screen loading | `web/src/engine/screens.ts` | the dispatcher at `@0x2f6af` plus the per-family loaders, cross-indexed against the `$`-delimited resource-name table at `0x16995` |
| Engineering readout | `web/src/engine/bars.ts` | `FUN_231e_8043 @0x2b223`: eight bars, foot at col 239 row 128, 7 px wide, 37 units per column then a darker second column |
| Panel overlays | `web/src/engine/panels.ts` | `@0x2c5d9`/`@0x2c646` lamps, `@0x2c307` ammo strip, `@0x2b1a0` BH_SML blit, and the cell tables at `DS:0x3587`/`0x35bf`/`0x35d3` |
| Flight-screen HUD | `web/src/engine/hud.ts` | `FUN_231e_8de4 @0x2bfc4` numeric fields and icon cells; `FUN_231e_6710 @0x298f0` rolling digit meters |
| State | `web/src/engine/state.ts` | the 17,831-byte blob round-trips `BH_START.DAT` byte-identically; `file = DS + 0xF90` |
| Text | `web/src/engine/text.ts` | `BH_CHAR.DAT` glyphs at `character * 0x40` with proportional widths from `DS:0xb300` |
| Screen flow | `web/src/engine/loop.ts` | the state machine dispatch at `@0x23c1f`–`@0x23c5b` and the four handlers, with per-row address citations |
| Script engine | `web/src/engine/vm.ts`, `script.ts` | the slot/text interpreter at `@0x251e0`–`@0x2539f` and the `BH_CONV` offset table |

`re/FINDINGS.md` is the ledger — every claim with its Evidence ID, and an explicit
*Observed / Derived / Inferred / Unknown* split. `re/HANDOFF.md` is the session history.
`re/loader_map.md` assigns each shipped data file to the routine that opens it.

## Not finished

- **The economy is partly mapped.** Fuel, hull, credits and the mission tree come from the state
  blob and the script tables, and a number of fields are still named `TODO_FIELDS` in
  `state.ts` rather than transcribed.
- **The script VM is incomplete.** Its dispatch is proven and `BH_CONV` plays, but opcodes are
  added as they get confirmed against the `cmp` chain, and unimplemented ones halt rather than
  guess.
- **Cargo panel:** its per-page item list has no known writer; the panel prints a message string
  at `@0x2eca1` and that is what is reproduced.
- **`DS:0x5e5e`**, the 3×3 dither-pattern table the ammo pips and the scan gatherer read, is
  generated at runtime and its producer is still open. The ammo strip therefore paints its
  background index instead of a guessed pattern.
- **Palette cycling** is unmodelled, so the STONE title renders with a static table.
- **This shareware chapter is incomplete as shipped.** The binary references
  `BH_INT1..BH_INT11.DAT`, `BH_WIN.DAT` and `BH_IORD.DAT`, which are not in this distribution;
  the ending text points to the sequel. The port loads those paths as absent rather than
  assuming them.

## Distribution and licensing

`SOLAR1.EXE` and the `BH_*.DAT` files are **Solar Winds shareware, published by Epic
MegaGames**, and are included unmodified together with `solar.zip` (the original 1994
archive), `LICENSE.DOC`, `FILE_ID.DIZ` and the rest of the 65-file package.

Epic MegaGames' `LICENSE.DOC` clause 1 allows online distribution "as long as no files are
altered or removed", so `tools/verify_dist.mjs` checks that in bytes: every archive member
against the working tree, and every `web/data/` copy against the root file. It currently
reports 65 files, root identical to the archive, 51 data files byte-identical.

Clause 7D states the right to distribute is personal and includes **no right to sublicense**,
so this repository deliberately ships no `LICENSE` file: the port's own source is not offered
under any licence, and the game data remains Epic MegaGames' with all rights reserved.

## Layout

```
web/            the port. src/engine/ holds one module per transcribed subsystem,
                tools/ the assertion harness, data/ the assets it fetches
re/             the reverse-engineering record: FINDINGS.md (ledger), HANDOFF.md (sessions),
                formats-*.md, engine-*.md, loader_map.md, dosbox/ (runtime capture)
tools/          repo-level checks (verify_dist.mjs, domprobe.mjs)
```

`re/decomp/` and the disassembly under `re/work/` are generated and gitignored;
`re/make_corpus.sh` explains how to reproduce them and which citations depend on them.
