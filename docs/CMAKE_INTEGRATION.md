# Hardware Explorer Preview CMake Integration

Hardware Explorer integrates with existing CMake projects through the compatible
`cache-explore` command in two ways:

1. **Toolchain file** — zero changes to your `CMakeLists.txt`, works with CTest
2. **`find_package`** — per-target control, explicit in your build system

---

## Quick Start

```bash
# Configure your project with Hardware Explorer instrumentation
cache-explore cmake /path/to/your/project

# Build
cd build-cache-explorer && make

# Run your binary and analyze
./your_binary 2>&1 | cache-sim --json --config intel
```

---

## Using with CTest

This is the zero-modification path. It works by injecting the LLVM pass as a
compiler flag via a CMake toolchain file — your `CMakeLists.txt` is untouched.

```bash
# Step 1: Configure
cache-explore cmake /path/to/your/project --build-dir build-prof

# Step 2: Build
cd build-prof && make

# Step 3: Run your full CTest suite and collect combined trace
ctest 2>&1 | cache-sim --json --config intel

# Or run a single test binary directly for isolated analysis
./tests/my_test 2>&1 | cache-sim --json
```

> **Note:** `ctest` runs all tests sequentially; their traces are merged into one
> analysis. For per-test breakdown, run each test binary individually.

---

## `find_package` Integration

For per-target control, add Hardware Explorer to your `CMakeLists.txt`:

```cmake
cmake_minimum_required(VERSION 3.16)
project(MyProject C CXX)

find_package(CacheExplorer REQUIRED
  PATHS /path/to/cache-explorer/backend/integration/cmake
)

add_executable(my_app src/main.cpp)

# Profile a specific target
cache_explorer_enable_target(my_app)

# Or profile the whole project
# cache_explorer_enable_project()

# Add a `make analyze-my_app` target
cache_explorer_add_analysis(my_app CONFIG intel JSON)
```

Then configure and build (LLVM Clang required — see Troubleshooting):

```bash
cmake -B build \
  -DCMAKE_C_COMPILER=/opt/homebrew/opt/llvm/bin/clang \
  -DCMAKE_CXX_COMPILER=/opt/homebrew/opt/llvm/bin/clang++ \
  -DCACHE_EXPLORER_PATH=/path/to/cache-explorer/backend .
cmake --build build
cmake --build build --target analyze-my_app
```

---

## Options Reference

| CMake Variable | Default | Description |
|---|---|---|
| `CACHE_EXPLORER_ENABLED` | `ON` | Enable/disable profiling without removing from CMakeLists |
| `CACHE_EXPLORER_PATH` | auto-detected | Path to the Hardware Explorer `backend/` directory |
| `CACHE_EXPLORER_PASS` | auto-detected | Path to `CacheProfiler.so` |
| `CACHE_EXPLORER_RUNTIME` | auto-detected | Path to `libcache-explorer-rt.a` |
| `CACHE_EXPLORER_INCLUDE_STL` | `OFF` | Include STL internals in profiling (slower) |

---

## Troubleshooting

### "Clang not found" or pass plugin fails to load

Hardware Explorer requires LLVM Clang with `-fpass-plugin` support. The toolchain
file (`cache-explore cmake`) sets this automatically. For `find_package`, set
the compiler explicitly:

```bash
# macOS — install via Homebrew
brew install llvm

cmake -B build \
  -DCMAKE_C_COMPILER=/opt/homebrew/opt/llvm/bin/clang \
  -DCMAKE_CXX_COMPILER=/opt/homebrew/opt/llvm/bin/clang++ \
  ...
```

### "CacheProfiler.so not found"

Build the LLVM pass first:

```bash
cd /path/to/cache-explorer/backend/llvm-pass
mkdir -p build && cd build
cmake .. -G Ninja -DLLVM_DIR=/opt/homebrew/opt/llvm/lib/cmake/llvm
ninja
```

### "libcache-explorer-rt.a not found"

Build the runtime library:

```bash
cd /path/to/cache-explorer/backend/runtime
mkdir -p build && cd build
cmake .. -G Ninja && ninja
```

### Binary produces no trace output

The runtime writes to `stderr`. Make sure you're capturing it:

```bash
# Correct — capture stderr
./my_binary 2>&1 | cache-sim --json

# Wrong — stdout only, trace is lost
./my_binary | cache-sim --json
```

---

## Example: Integrating with an Existing CTest Suite

Given a project structured like:

```
my-project/
├── CMakeLists.txt
├── src/
│   └── mylib.c
└── tests/
    ├── CMakeLists.txt
    └── test_mylib.c
```

No changes to `CMakeLists.txt` are required:

```bash
cache-explore cmake my-project/
cd build-cache-explorer && make
ctest --output-on-failure 2>&1 | cache-sim --json --config intel | jq '.levels.l1d.hitRate'
```

See `tests/cmake-integration/sample-project/` for a working example.

## Windows x86 with `clang-cl` (Preview)

The Win32 path uses Clang's built-in SanitizerCoverage load/store
instrumentation and links a 32-bit `cache-explorer-rt.lib` into the target.
This avoids requiring a custom LLVM build: stock Windows LLVM distributions do
not support loadable pass plugins. Build the runtime and target from an x86
Visual Studio Developer PowerShell.

Prerequisites:

- Visual Studio C++ Build Tools
- LLVM/Clang with `clang-cl`
- Ninja and CMake 3.20+

Build the Win32 runtime:

```powershell
cmake -S backend/runtime -B backend/runtime/build -G Ninja `
  -DCMAKE_C_COMPILER=clang-cl `
  -DCMAKE_C_COMPILER_TARGET=i686-pc-windows-msvc
cmake --build backend/runtime/build
```

Then configure a Win32 project with the toolchain file:

```powershell
cmake -S . -B build-hardware-explorer -G Ninja `
  -DCMAKE_TOOLCHAIN_FILE=C:\path\to\Cache-Explorer\backend\integration\cmake\CacheExplorerToolchain.cmake `
  -DCACHE_EXPLORER_PATH=C:\path\to\Cache-Explorer\backend `
  -DCMAKE_C_COMPILER_TARGET=i686-pc-windows-msvc `
  -DCMAKE_CXX_COMPILER_TARGET=i686-pc-windows-msvc
cmake --build build-hardware-explorer
```

For direct compiler invocations, use
`backend\scripts\hardware-explore-clang-cl.ps1`; the
`cache-explore-clang-cl.ps1` compatibility name remains available.

Run an instrumented PE32 target through the capture wrapper to produce a
portable v2 trace. Application stdout remains separate from the trace:

```powershell
.\backend\scripts\hardware-explore-run-x86.ps1 `
  -Program .\build-hardware-explorer\game.exe `
  -ArgumentList @('-windowed') `
  -Output .\game-trace-v2.txt

Get-Content .\game-trace-v2.txt | .\backend\cache-simulator\build\cache-sim.exe `
  --config intel --json
```

`cache-explore-run-x86.ps1` and `cache-explore-normalize-trace.ps1` remain
compatibility aliases. The runtime accepts both `HARDWARE_EXPLORER_*` and
`CACHE_EXPLORER_*` capture settings; `HARDWARE_EXPLORER_TRACE` and
`CACHE_EXPLORER_TRACE` select an isolated text trace file.

The wrapper validates an x86 PE32 executable before launch and verifies that
its SHA-256 did not change during the run. Only the instrumented main executable
is supported: instrumented DLL/JIT sites cause normalization to fail rather
than being assigned to the wrong image. Calls into uninstrumented DLLs are not
captured. Use only trusted local programs; the wrapper is not a sandbox.

`-MaxEvents` defaults to 2,000,000 (the simulator limit) and accepts 1–2,000,000.
`-SampleRate` defaults to 1 and accepts positive signed 32-bit values. Reaching
the event limit sets `capture.truncated` conservatively, even if the program
happened to stop at exactly that count. A nonzero target exit or failed
normalization preserves the raw capture and leaves the requested output alone.
The wrapper restores the calling process's capture environment settings.

Offline normalization is also available with `hardware-explore-normalize-trace.ps1
-RawTrace <raw-file> -Image <exact-executable> -Output <trace-file>`. Supply the
exact executable used for capture; an arbitrary offline file's identity cannot
be verified against an already captured process. `-ExpectedImageSha256` can
enforce a separately recorded pre-capture hash.

The current Preview preserves stable executable SHA-256 + RVA identities
and reports modeled `codeHotspots`. The captured PC is the instrumentation
callback's return address, not a verified memory-instruction or source location.
The simulator leaves `navigationConfidence` as `unresolved`; the optional local
PDB step below adds function and approximate source attribution. Existing PE32
binary capture without rebuilding, and Ghidra/IDA navigation, are specified in
[Windows x86 Binary Profiling and Decompiler Navigation](WINDOWS_X86_BINARY_PROFILING_SPEC.md)
and remain experimental until their separate release gates pass.

### Optional local PDB attribution (Windows Preview)

Use PowerShell 7.2 or later and the exact executable and PDB from the captured
build. Build the helper in the same native Windows CMake build as `cache-sim`:

```powershell
cmake --build .\backend\cache-simulator\build --target hardware-explorer-symbolize-pdb
Get-Content .\game-trace-v2.txt | .\backend\cache-simulator\build\cache-sim.exe `
  --config intel --json | Set-Content -Encoding utf8 .\game-analysis.json

.\backend\scripts\hardware-explore-symbolize.ps1 `
  -Result .\game-analysis.json -Image .\build\game.exe -Pdb .\build\game.pdb `
  -Output .\game-profile.json
```

For a non-default CMake build directory, pass `-Symbolizer <path-to-hardware-explorer-symbolize-pdb.exe>`.
`cache-explore-symbolize.ps1` is a compatibility alias. The input is one completed
analysis JSON object, not a trace or a stream of progress messages.

The post-processor checks the executable SHA-256 against the analysis and the
PDB GUID/age against the executable, then rechecks both file hashes after lookup.
It opens only the selected local files: no target execution, source downloads,
symbol servers, or automatic use of the embedded PDB path. The Windows helper
uses DbgHelp; no separately installed DIA SDK or decompiler is needed.

Results preserve the original code identities and modeled metrics. They add
`images[].codeView`, `codeHotspots[].symbol`, optional `codeHotspots[].source`,
lookup provenance, and a `symbolization` summary. Existing `hotLines` are not
rewritten. PDB source paths are metadata, not proof that the current source file
matches the build; the tool neither reads nor executes those paths.

The lookup uses the byte preceding the instrumentation return PC. A containing
function is labeled `function-exact`; a debug-line match is `source-nearest`,
not exact source-statement attribution. Optimized/inlined code may map coarsely;
inline stacks and pseudocode navigation are not implemented. Unmapped sites
remain `unresolved` without stale function/source fields.

Missing/mismatched PDBs, changed images, invalid RVAs, timeouts, and malformed
results fail without publishing partial output. Inputs are bounded to 16 MiB
and 10,000 hotspots; the default lookup timeout is 60 seconds. The output must
be separate from the input result, executable, PDB, and helper. Only one
instrumented main PE32 executable from `clang-cl` capture is supported.
