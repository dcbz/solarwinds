# Solar Winds — DATA TABLES (BH_PLAN / OBJ / MIS / CHAR / IMP / SHD / SML / VFD / MS)

Target `SOLAR1.EXE` sha256 `7e7484a4a5eee9c2a9243820e551db27ca57567abb640c12d379c95c9b7983df`.
Method: structure transcribed from the code that reads each file — `re/decomp/SOLAR1.c`, local
capstone disassembly via `re/work/x86.py` (linear = file offset + 0xf200), `re/work/*.asm`.
Nothing here is guessed from filenames; every stride/width cites an address.
Status legend: **O** observed (REA Evidence or raw bytes) · **D** derived (arithmetic from code) ·
**I** inferred · **?** unknown.

Progress skeleton — being filled in by edit, top to bottom.

| file | size | record stride | selector | consumer | status |
|---|---|---|---|---|---|
| BH_PLAN.DAT | 30728 | ? | ? | ? | ? |
| BH_OBJ.DAT | 15072 | ? | ? | ? | ? |
| BH_MIS.DAT | 3646 | ? | ? | text | ? |
| BH_CHAR.DAT | 14232 | ? | ? | ? | ? |
| BH_IMP.DAT | 95960 | ? | ? | ? | ? |
| BH_SHD.DAT | 14166 | ? | ? | ? | ? |
| BH_SML.DAT | 2112 | ? | ? | ? | ? |
| BH_VFD.DAT | 15257 | ? | ? | ? | ? |
| BH_MS.DAT | 15928 (task said 8410) | ? | ? | ? | ? |

## 1. Loaders / read sites

## 2. Per-file structure

## 3. Text & ASCII encodings

## 4. Feeds: drawing vs economy vs text

## 5. Unknown / open
