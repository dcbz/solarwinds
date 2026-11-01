#!/bin/bash
export GHIDRA_INSTALL_DIR=/Users/unlink/tools/ghidra_12.1.4_PUBLIC
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
out="$1"; shift
npx -y rea-agents@6.7.0 "$@" --json > "re/work/$out" 2> "re/work/$out.err"
echo "exit=$? bytes=$(wc -c < re/work/$out) err=$(wc -c < re/work/$out.err)"
