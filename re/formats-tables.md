# Non-RLE data tables: BH_PIC / BH_CHAR / BH_SML / BH_SHD

Lane: "Narrow RE lane — structure of the four NON-RLE data files".
Target `SOLAR1.EXE` sha256 `7e7484a4a5eee9c2a9243820e551db27ca57567abb640c12d379c95c9b7983df`.
Corpus: `re/decomp/SOLAR1.c`, `re/work/*.asm`, `re/work/x86.py` (capstone 16-bit disassembler).
Status legend: **O** observed (byte dump / REA evidence) · **D** derived (arithmetic from code) ·
**I** inferred · **?** unknown.

## Plan (written before analysis, per time cap)

| file | size | first bytes | hypothesis to test |
|---|---|---|---|
| BH_PIC.DAT | 26086 | `8c 8c 8c 00 00 00` | fixed-stride records of 16-bit fields; stride divides 26086 → candidates 2, 7, 14, … |
| BH_CHAR.DAT | 14232 | all `00` | zero-init / palette-ish block, or sparse table; 14232 = 8·1779 |
| BH_SML.DAT | 2112 | `08 08 00 82 88 00` | 2112 = 32·66 = 64·33 = 16·132; ADPCMMONO "SML"? (sample bank) |
| BH_SHD.DAT | 14166 | `da 01 90 03 52 05 11 07 be 08 80 0a 3f 0c …` | **monotonic 16-bit table**. Diffs: `0x1da,0x390,0x552,0x711,0x8be,0xa80,0xc3f` deltas 470,450,447,429,434,451 → ~16-bit lookup table. 14166 = 2·7083 (7083 prime) ⇒ 7083 words, or a header + table. |

Known loaders (from `re/loader_map.md`): `0x29655 FUN_231e_6475` references **BH_SHD** + BH_IMP;
`0x23857 FUN_231e_0677` references **BH_CHAR** + BH_PAL. BH_PIC / BH_SML loaders not yet attributed.

## Findings

(to be filled in as each file is analysed)

## Unknown / open

(to be filled last)
