# Binary hotspot workflow — Preview

Capture and analyze **locally**. These are modeled CPU cache outcomes, not
hardware counters, calibration, cycle-accurate simulation, or debugger stepping.
Only analyze programs you own or are authorized to inspect; protected/anti-cheat
processes are unsupported. No executable, PDB, trace, or source is uploaded.

## Capture → inspect → export

1. On Windows, follow the [Pin setup guide](../backend/pin-tool/README.md) to
   capture an existing PE32 EXE and its DLLs, or the
   [clang-cl guide](../docs/CMAKE_INTEGRATION.md) for rebuilt source.
2. Run the normalized trace through `cache-sim --config intel --json` and save
   the completed JSON output. Streaming NDJSON is not an import format.
3. Optionally enrich an EXE or DLL with its own PDB:

   ```powershell
   ./backend/scripts/hardware-explore-symbolize.ps1 -Result analysis.json `
     -Image game.exe -Pdb game.pdb -Output game-symbols.json
   ./backend/scripts/hardware-explore-symbolize.ps1 -Result game-symbols.json `
     -Image game-plugin.dll -Pdb game-plugin.pdb -Output profile.json
   ```

   Selection uses SHA-256, not the module's filename. Each pass preserves other
   images and metrics. Pin uses the exact instruction PC; clang-cl uses its
   return-PC-minus-one lookup. Source lines remain approximate.
4. Open **Binary profiles** in the app (`?view=binary`) and select the result.
   Import/filter/export run in the browser, including when the backend is
   offline. The page does not capture or execute programs. A new browser visit
   still requires the app assets; this is not a new offline installer.
5. Choose a module, expand a function, and export all or filtered sites. Without
   PDB symbols, functions are explicitly unresolved until a decompiler maps them.

The result is a **ranked subset**, currently the simulator's top 100 instruction
sites. Module/function sums cover only these sites, not complete program totals.
Sampling changes the modeled cache history; counts are not extrapolated.
Truncation, sampling and model confidence remain visible. Imported files are
bounded to 16 MiB, 4,096 images and 10,000 sites.

For command-line export (Node 22.18+ and `npm ci` in `frontend`):

```sh
node frontend/scripts/export-hotspots.mjs profile.json hardware-explorer-hotspots-v1.json
```

Exports are validated against `frontend/src/binary/hotspots.schema.json` and
semantic identity/metric constraints. They omit source paths, raw data addresses,
load addresses, raw timelines and arbitrary diagnostic strings. They **do contain
binary hashes, module names and optional function names**; review before sharing.

## Package the adapters

```sh
node frontend/scripts/package-decompilers.mjs /path/to/new/hardware-explorer-adapters
```

The destination must not exist. The package copies the canonical schema beside
each adapter. Nothing installs into Ghidra or IDA automatically. No SDKs or
decompilers are redistributed.

## Ghidra 12.1.3 script adapter

Add the packaged `ghidra` directory in **Window → Script Manager → Manage Script
Directories**. Open the exact PE32 EXE/DLL, let analysis finish, then run
`HardwareExplorer.java`. Select the exported hotspot bundle. A multi-image bundle
automatically selects the image matching the active program's imported-file
SHA-256. If CodeView metadata is included, GUID/age must also match. Mismatches
are blocked, with no unsafe override in this Preview.

The sortable/filterable table shows functions, original RVAs, misses, accesses,
miss rate, estimated stall cycles, and navigation confidence. Select a site and
choose **Open pseudocode** to activate the Decompiler at the closest token in its
containing function. Double-click currently navigates the instruction listing.
When pseudocode is unavailable the fallback is explicit; it is never represented
as original source. Ghidra's imported-file SHA identifies the original input;
do not use a subsequently patched database as evidence of unchanged code bytes.

Bookmarks are owned by the `Hardware Explorer Preview` category. Reimport
replaces only that category. Run the script with argument `clear` to remove its
bookmarks; user bookmarks and program bytes are untouched. Reimport after
rebasing while the table is open.

Verified: real PE32 import, token mapping, rebasing, mismatch rejection and
bookmark lifecycle in Ghidra 12.1.3 headless mode. **A headed UI smoke test is
still required before declaring GUI compatibility.** This is an installable
script adapter, not yet a separately packaged Ghidra extension/plugin.

## IDA / Hex-Rays — experimental adapter

Copy the packaged `ida/hardware_explorer.py` and `ida/hardware_explorer_support`
directory together into IDA's user plugins directory. Install
`ida/requirements.txt` using **IDA's Python interpreter**, then restart IDA.
Use **Edit → Plugins → Hardware Explorer (Preview)** with a PE32 database open.

The plugin verifies the IDB's original-input SHA-256, maps RVAs using its current
image base, annotates instruction comments without replacing user comments, and
opens a sortable chooser. When a bundle contains CodeView identity it asks you
to select the original PE for an additional local GUID/age check; it never opens
a path embedded in the bundle or downloads symbols. Selecting a row tries the
nearest mapped Hex-Rays ctree item in the same function; missing Hex-Rays or
mapping uses an explicitly reported function/instruction fallback.

**No IDA version is declared supported yet.** Schema, identity, rebasing,
annotation preservation and nearest-address logic have SDK-independent tests.
That is not a substitute for a licensed IDA/Hex-Rays run. SDK compatibility,
chooser behavior, annotation refresh/cleanup, and both with/without-Hex-Rays
smokes remain release gates. Use a copy of your IDB while this adapter is
experimental.

## Verification

```sh
cd frontend
npm ci
node scripts/test-binary-hotspots.mjs
npm run build
npm run lint
npm run tokens:check
npm run bundle:check
```

`frontend/scripts/smoke-binary.mjs` exercises desktop/mobile local import,
module/function navigation, filtering, download validation, no-upload behavior
and invalid-file preservation. Set `HARDWARE_EXPLORER_TEST_URL` to a running app
and `CACHE_EXPLORER_BROWSER` to a Chrome executable when needed.

`tests/binary-hotspots/HardwareExplorerSmoke.java` uses the repository-built PE32
fixture; `test_ida_core.py` covers the Python adapter's pure logic. Their fixture
metrics are deliberately synthetic test data, **never calibration evidence**.

Primary interface references: [Ghidra source and releases](https://github.com/NationalSecurityAgency/ghidra),
[IDAPython Hex-Rays interface](https://python.docs.hex-rays.com/ida_hexrays/index.html),
[IDA navigation interface](https://python.docs.hex-rays.com/ida_kernwin/index.html).
