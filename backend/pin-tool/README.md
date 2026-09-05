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
Bare simulator sites remain `unresolved`. The optional PDB post-processor now
enriches an EXE or DLL independently using its SHA-256 and matching symbols.
The [local binary hotspot workflow](../../integrations/README.md) provides the
results page, validated export and decompiler adapters. Ghidra headed UI and
licensed IDA/Hex-Rays verification remain explicit release gates.

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
cmake -S backend/cache-simulator -B backend/cache-simulator/build -G Ninja -DCMAKE_BUILD_TYPE=Release
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
The target starts in its executable directory so relative game assets work;
`-WorkingDirectory` can explicitly select another existing directory.
Pin 4.3.1 does not preserve every Windows command-line argument form. This
Preview rejects empty arguments, literal double quotes, control characters,
and whitespace-containing arguments ending in a backslash **before launch**.
Ordinary spaced/Unicode arguments and option-like target arguments have smoke
coverage. Do not add manual shell quoting inside `-ArgumentList` values.

Capture defaults to one in every operand (`-SampleRate 1`) and at most
2,000,000 recorded operands (`-MaxEvents`). Reaching the limit stops recording,
not the target; `capture.truncated` is then true. Recording starts at the main
executable's PE entry point, excluding earlier OS loader traffic. CRT startup
and subsequent system-module traffic remain included; this is not yet a
user-selected gameplay/region-of-interest window.
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

`cache_profiler.cpp` and the Unix `backend/scripts/cache-explore-pin` wrapper
remain unchanged for compatibility. They are separate from the new Windows
adapter and are not covered by its verification.

This directory does not currently include the legacy makefile, so the former
`make PIN_ROOT=...` instructions are not a working fresh-install recipe.
The legacy recorder also needs its own concurrency/bounds review before stable
support can be claimed. Use Intel's tool-build documentation when evaluating it;
do not treat the legacy path as a supported alternative to the Windows Preview.

See [the binary profiling spec](../../docs/WINDOWS_X86_BINARY_PROFILING_SPEC.md)
for the remaining UI, symbolization, decompiler and release gates.
