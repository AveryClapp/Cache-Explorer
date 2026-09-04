# Hardware Explorer — Intel Pin capture (experimental)

Local dynamic instrumentation for modeled CPU cache analysis. This is not a
hardware-counter profiler, debugger, or cycle-accurate simulator. Compatibility
depends on the binary, operating system and Pin kit; protected software is not
supported. Nothing here enables binary capture in the hosted product.

## Windows IA-32 Preview

The new Windows CLI captures an existing **PE32/i386 executable and loaded DLLs
without source instrumentation or PDBs**. It records memory operands, issuing
instruction PCs, thread IDs and load-time file hashes. The normalizer converts
PCs to stable image SHA-256 + RVA sites in trace v2, including DLL reloads.
Code hotspots remain `unresolved` for source/decompiler navigation: the current
PDB post-processor only accepts clang-cl instrumentation traces, and Ghidra/
IDA adapters and binary hotspot UI/export are still pending.

Prerequisites:

- A local Windows 10 22H2+/Server 2022+ Intel host compatible with Pin. See
  [Intel's system requirements](https://software.intel.com/sites/landingpage/pintool/docs/99850/Pin/doc/README.md).
- [Intel Pin 4.3.1, kit 99850](https://www.intel.com/content/www/us/en/developer/articles/tool/pin-a-binary-instrumentation-tool-downloads.html),
  extracted locally. Intel's license applies; the kit is not bundled here.
- clang-cl **15 or 16** and lld-link for the Pintool, as required by this Pin kit.
  The captured application can have been built with a different compiler.
- Visual Studio C++ build tools, CMake 3.20+, Ninja, and PowerShell 7.2+.

From an x86 Visual Studio developer shell, build the capture tool. Pass explicit
`-Compiler` and `-Linker` paths when clang-cl 16 is not the default:

```powershell
.\backend\pin-tool\build-windows.ps1 -PinRoot C:\Tools\pin
```

Build the normalizer and simulator separately in an x64 developer shell:

```powershell
cmake -S backend/cache-simulator -B backend/cache-simulator/build -G Ninja
cmake --build backend/cache-simulator/build --target hardware-explorer-normalize-pin cache-sim
```

Capture a program you own or are authorized to profile, then close it normally:

```powershell
.\backend\scripts\hardware-explore-pin.ps1 `
  -PinRoot C:\Tools\pin -Program 'C:\Games\Old Game\game.exe' `
  -ArgumentList @('-windowed') -Output .\game-trace.txt
Get-Content .\game-trace.txt | .\backend\cache-simulator\build\cache-sim.exe --config intel --json
```

`cache-explore-pin.ps1` is a compatibility alias. `-PinTool` and `-Normalizer`
override the default build locations. The existing Unix `cache-explore-pin`
script is unchanged and is **not** the Windows entry point.

Capture defaults to one in every operand (`-SampleRate 1`) and at most
2,000,000 recorded operands (`-MaxEvents`). Reaching the limit stops recording,
not the target; `capture.truncated` is then true. Initial capture includes
startup/system-module traffic, so this is not yet a game-specific capture window.
Sampling changes the modeled access sequence and can substantially change
cache results. Instrumentation slows execution; no fixed overhead is promised.

`-TimeoutSeconds N` opts into killing the capture process tree after N seconds;
the default is 0 (wait for normal exit). A target failure, timeout, invalid
manifest, or missing completion marker leaves a `.partial.raw` diagnostic file
and does not replace the requested output. Partial files are not valid analyses.
Successful normalization removes the raw intermediate.

Limitations and data handling:

- One launched process and its loaded modules only; no attach or child following.
- No DRM, anti-cheat, anti-tamper or protection bypass. Do not disable security
  controls to make a capture work. Unsupported targets must fail normally.
- Normal memory operands only. Gather/scatter and other nonstandard operands
  fail closed. Events describe pre-execution accesses, not guaranteed retired
  instructions; faulting and conditional writes can differ from hardware events.
- No instruction-fetch, branch-direction, or hardware-counter capture here.
- Anonymous/JIT or unhashable image code retains data accesses without a site
  and emits an unattributed-code warning. No invented module mapping.
- Load-time image hashing reads each file once per load, with a 512 MiB file
  bound. At most 4,096 image loads, 1,000,000 unique sites, 16 KiB per raw record,
  and 256 MiB per raw capture are accepted.
- Normalized traces include data addresses and image load ranges, but only
  module basenames, not local paths. Keep traces private; they are not redacted
  decompiler bundles. No executables, symbols, source, or traces are uploaded.
- Actual game compatibility and stable release readiness remain unverified.

The Windows CI fixture builds a plain PE32 EXE and DLL without instrumentation,
then checks hashes, per-image hotspots, multiple threads, DLL reloads, spaced/
Unicode paths, argument forwarding, sampling, limits and failure preservation.
The portable normalizer has separate Linux and macOS coverage.

## Legacy Linux x86-64 path

The older source below and Unix wrapper are separate from the new Windows path.
Their build/compatibility matrix has not been revalidated by the Windows work.

## Prerequisites

1. **Download Intel Pin** from [Intel's website](https://www.intel.com/content/www/us/en/developer/articles/tool/pin-a-binary-instrumentation-tool-downloads.html)

2. **Set PIN_ROOT**:
   ```bash
   export PIN_ROOT=/path/to/pin
   ```

3. **Build the Pin tool**:
   ```bash
   cd backend/pin-tool
   make PIN_ROOT=$PIN_ROOT
   ```

## Usage

### Quick Start
```bash
# Profile any binary
cache-explore-pin ./my_gcc_binary

# With options
cache-explore-pin --config amd --json ./my_binary > results.json
```

### Direct Pin Usage
```bash
# Run Pin manually
$PIN_ROOT/pin -t obj-intel64/cache_profiler.so -- ./your_binary

# Analyze the trace
cat cache_trace.txt | cache-sim --json
```

### Options

| Option | Description |
|--------|-------------|
| `--config <name>` | Cache config: intel, amd, apple, educational |
| `--json` | Output JSON format |
| `--max <n>` | Maximum events to trace (default: 10M) |
| `--sample <n>` | Sample rate: 1=all, 100=1% |
| `--output <file>` | Trace output file |
| `--keep-trace` | Keep trace file after analysis |

## Pin Tool Options

When using Pin directly:

```bash
$PIN_ROOT/pin -t cache_profiler.so [options] -- ./binary

Options:
  -o <file>     Output trace file (default: cache_trace.txt)
  -l <0|1>      Trace loads (default: 1)
  -s <0|1>      Trace stores (default: 1)
  -max <n>      Max events (default: 10000000)
  -sample <n>   Sample rate (default: 1)
```

## How It Works

1. **Instrumentation**: Pin intercepts every memory access instruction
2. **Recording**: Each load/store is logged with address, size, and source location
3. **Analysis**: The trace is piped to `cache-sim` for simulation

## Performance

- **Overhead**: 10-50x slowdown (typical for dynamic instrumentation)
- **Sampling**: Use `-sample 100` to reduce overhead to ~2x
- **Max events**: Use `-max 1000000` to limit trace size

## Limitations

- **Current integration**: Linux x86-64 only
- **Windows x86**: Use the experimental workflow above; see
  [issue #73](https://github.com/AveryClapp/Cache-Explorer/issues/73); see the
  [binary profiling spec](../../docs/WINDOWS_X86_BINARY_PROFILING_SPEC.md)
- **macOS**: Limited support, may require older Pin versions
- **Debug info**: Source attribution requires `-g` compiled binaries

## Comparison with LLVM Pass

| Feature | LLVM Pass | Pin Tool |
|---------|-----------|----------|
| Requires source | Yes | No |
| Compiler | Clang only | Any |
| Overhead | 2-5x | 10-50x |
| Cache metrics | Modeled | Modeled |
| Source attribution | Excellent | Limited |

## Troubleshooting

### "Pin not found"
```bash
export PIN_ROOT=/path/to/pin
```

### "Pin tool not built"
```bash
cd backend/pin-tool
make PIN_ROOT=$PIN_ROOT
```

### High overhead
Use sampling:
```bash
cache-explore-pin --sample 100 ./my_binary
```

### No source info
Compile your binary with debug info:
```bash
gcc -g -o my_binary my_source.c
```
