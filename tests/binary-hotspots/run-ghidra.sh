#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd "$(dirname "$0")/../.." && pwd)
: "${GHIDRA_INSTALL_DIR:?Set GHIDRA_INSTALL_DIR to Ghidra 12.1.3}"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/hardware-explorer-decompiler.XXXXXX")
mkdir -p "$test_root/scripts" "$test_root/projects" "$test_root/symbols"
"${CLANG:-clang}" --target=i686-pc-windows-msvc -g -O1 -c "$repo_root/tests/binary-hotspots/fixture.c" -o "$test_root/fixture.obj"
"${LLD_LINK:-lld-link}" /entry:entry /subsystem:console /nodefaultlib /machine:x86 /debug "/out:$test_root/fixture.exe" "$test_root/fixture.obj"
# Keep debug identity but withhold PDB/source symbols from Ghidra analysis.
mv "$test_root/fixture.pdb" "$test_root/symbols/fixture.pdb"
node "$repo_root/frontend/scripts/make-decompiler-fixture.mjs" "$test_root/fixture.exe" "$test_root/hotspots.json"
cp "$repo_root/integrations/ghidra/HardwareExplorer.java" "$repo_root/integrations/ghidra/HardwareExplorerBundle.java" "$repo_root/tests/binary-hotspots/HardwareExplorerSmoke.java" "$test_root/scripts/"
"$GHIDRA_INSTALL_DIR/support/analyzeHeadless" "$test_root/projects" smoke -import "$test_root/fixture.exe" \
  -scriptPath "$test_root/scripts" -postScript HardwareExplorerSmoke.java "$test_root/hotspots.json" \
  "$repo_root/frontend/src/binary/hotspots.schema.json" -deleteProject 2>&1 | tee "$test_root/ghidra.log"
# Ghidra can return zero after a script compilation failure. Require explicit proof.
rg 'HARDWARE_EXPLORER_GHIDRA_SMOKE_PASS' "$test_root/ghidra.log"
"${PYTHON:-python3}" "$repo_root/tests/binary-hotspots/test_ida_core.py" "$test_root/hotspots.json"
echo "Decompiler evidence and repository-owned fixture: $test_root"
