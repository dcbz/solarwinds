"""tools/mk_check_dist.py — regenerate tools/check_dist.mjs from integration_check.mjs.

Same assertions, pointed at the EMITTED web/dist/*.js instead of the .ts sources, so a passing
run proves the TypeScript build (not just node's type-stripping) carries the behavior.
"""
import pathlib, re
src = pathlib.Path('tools/integration_check.mjs').read_text()
out = src.replace('../src/', '../dist/')
out = re.sub(r"(\.\./dist/[A-Za-z0-9_/]+)\.ts", r"\1.js", out)
out = out.replace('// Same assertions against web/dist/*.js.', '')
pathlib.Path('tools/check_dist.mjs').write_text(out)
print('wrote tools/check_dist.mjs')
