# Windows x86 Binary Profiling and Decompiler Navigation

Status: In progress — clang-cl/PDB Preview plus experimental Pin IA-32 capture; remaining milestones below are gated.

Tracking issue: [#73](https://github.com/AveryClapp/Cache-Explorer/issues/73)  
Target: Hardware Explorer Preview

## 1. Summary

Hardware Explorer will profile 32-bit Windows programs through two paths:

1. `clang-cl` built-in SanitizerCoverage instrumentation for programs that can
   be rebuilt.
2. Intel Pin IA-32 dynamic instrumentation for existing PE executables and
   DLLs when source is unavailable.

Binary results will be attributed to stable code locations and exported in one
tool-neutral hotspot bundle. Ghidra and IDA/Hex-Rays adapters will import that
bundle, highlight costly functions or pseudocode, and navigate to the closest
known decompiler location. Assembly remains available as a fallback, not the
primary workflow.

Decompiler pseudocode is reconstructed rather than original source. Navigation
therefore carries an explicit confidence level and must never be presented as
exact source-line attribution when debug information is absent.

The clang-cl implementation covers one rebuilt, instrumented PE32 executable.
It emits portable SHA-256 + RVA code sites and modeled cache hotspots, with
batch/streaming analysis and legacy trace compatibility. An optional Windows
post-processing step resolves functions and approximate source lines using an
explicit, identity-matched PDB. A separate experimental Windows Pin CLI now
captures uninstrumented PE32 executables and loaded DLLs into the same trace
format. Pin results have image/RVA sites, but no PDB or decompiler mapping yet.
Instrumented clang-cl DLLs, named JIT attribution, exact statement/inline-stack
mapping, binary results UI, hotspot bundle export, and both decompiler adapters
are not implemented here.
The `clang-cl` site is an instrumentation return PC; it is not yet a verified
memory-instruction or pseudocode location. Without PDB lookup it remains
`unresolved`; a debug-line match is deliberately labeled `source-nearest`.

## 2. Goals

- Profile a 32-bit Windows executable without recompiling it.
- Support 32-bit programs on 64-bit Windows through the IA-32 Pin tool.
- Support source builds that target Win32 through `clang-cl` and CMake.
- Attribute each captured memory access to the instruction that issued it.
- Keep locations stable across ASLR and across repeated runs of the same image.
- Aggregate modeled cache behavior by image, function, basic block, and
  instruction site.
- Let users move from a Hardware Explorer hotspot to decompiled pseudocode in
  Ghidra or IDA/Hex-Rays without having to navigate raw assembly.
- Preserve the current trace format and `cache-explore` compatibility names.
- Keep capture, analysis, and decompiler use local and offline by default.

## 3. Non-goals

- Recovering the original source code or original statement boundaries from a
  stripped binary.
- Debugger-style stepping, breakpoints, or live process control.
- Bypassing DRM, anti-cheat, anti-tamper, or process-protection systems.
- Attaching to kernel code, drivers, consoles, or non-Windows x86 programs in
  the first release.
- Claiming measured hardware cache misses. The captured address stream is run
  through Hardware Explorer's modeled CPU profiles.
- Making Intel Pin or either decompiler available in the hosted product.

## 4. Supported Workflows

| Input | Capture path | Primary navigation | Initial status |
|---|---|---|---|
| Source built with `clang-cl` for Win32 | Built-in load/store instrumentation and Windows x86 runtime | Original file and line after PDB attribution | M1 capture, M2 attribution |
| PE32 executable with PDB | Intel Pin IA-32 | Image/RVA now; PDB and pseudocode navigation pending | Experimental CLI |
| PE32 executable without PDB | Intel Pin IA-32 | Image/RVA now; function/pseudocode navigation pending | Experimental CLI |
| Protected or anti-cheat process | None | None | Unsupported |
| 16-bit executable | None | None | Unsupported |

The two capture paths converge on the same trace-ingestion and analysis
modules. Results differ only in available attribution quality.

## 5. User Journey

```text
Choose executable and arguments
          |
          v
Preflight: PE32, supported Pin, writable output, no known protection
          |
          v
Run locally under IA-32 instrumentation
          |
          v
Analyze captured addresses with a selected modeled CPU profile
          |
          v
Hotspots: module -> function -> block -> instruction
          |
          +---------------------+
          |                     |
          v                     v
 Export for Ghidra       Export for IDA/Hex-Rays
          |                     |
          v                     v
 Highlight and navigate to decompiled pseudocode
```

The results page defaults to functions, not millions of individual accesses.
Selecting a function reveals its hottest basic blocks and instruction sites.
The user can then export the entire result or one selected hotspot set.

## 6. Domain Model

### Image identity

An **image** is the main executable or one loaded DLL. It is identified by:

- `sha256`: SHA-256 of the on-disk PE image when it can be read.
- `codeView`: PDB GUID and age when CodeView information exists.
- `name`: display-only basename.
- `preferredBase`: PE preferred image base.
- `loadedBase`: run-specific load address, retained only in capture provenance.
- `imageSize`: mapped image size.

`sha256` is the primary match key. `codeView` is a secondary symbol match key.
Path and PE timestamp are diagnostic metadata and must not be treated as strong
identity.

### Code location

A **code location** identifies the instruction responsible for an event:

```json
{
  "imageId": "sha256:...",
  "rva": "0x00012f40"
}
```

The relative virtual address is calculated as `instructionPointer -
loadedBase`. Absolute instruction pointers must not appear in portable hotspot
identity because ASLR changes them between runs.

### Data location

A **data location** is the memory address accessed by the instruction. It feeds
the cache simulator but is not a navigation target. Code and data addresses
must be named separately in every interface to avoid treating a heap address as
an executable location.

### Source location

A **source location** contains an optional file, line, and column recovered from
debug information or source instrumentation. A captured event may contain both
a code location and a source location.

### Hotspot

A **hotspot** is an aggregation keyed by a code location, basic block, or
function. It includes sampled access counts and modeled cache outcomes. The
first release ranks by modeled L1 data-cache misses, with accesses, miss rate,
read/write counts, and estimated memory-stall cycles available as alternatives.

### Navigation confidence

| Value | Meaning |
|---|---|
| `source-exact` | Debug information maps the instruction to an original source line. |
| `source-nearest` | Debug information maps the instrumentation call site to an approximate original source location; exact statement attribution is not verified. |
| `instruction-exact` | The PE image and RVA match exactly in the decompiler. |
| `function-exact` | The instruction maps to a known function but not a stable pseudocode item. |
| `pseudocode-nearest` | The adapter selected the nearest decompiler item containing the address. |
| `unresolved` | No safe navigation target was found. |

The UI must display this confidence and explain it on demand.

## 7. Module Design

### 7.1 Binary Capture module

Interface:

```text
hardware-explore-pin [capture options] -- program.exe [program arguments]
```

The module owns Pin discovery, IA-32 tool selection, child-process launch,
module-load tracking, sampling, event limits, raw trace creation, and cleanup.
Callers receive a capture bundle or a structured failure; they do not need to
understand Pin knobs or load addresses.

The current `cache-explore-pin` name remains a compatibility alias.

### 7.2 Trace Ingestion module

Interface:

```text
read trace stream -> TraceSession
```

The module accepts existing v1 source traces and new v2 binary traces. It owns
format detection, image and site tables, validation, bounded parsing, and error
reporting. The cache simulator consumes normalized events rather than parsing
Pin-specific records itself.

### 7.3 Location Identity module

Interface:

```text
normalize(image manifest, runtime instruction pointer) -> CodeLocation
```

The module owns ASLR normalization and image identity. This is the seam shared
by capture, hotspot aggregation, exports, and decompiler adapters. It must be
pure and testable with synthetic PE manifests.

### 7.4 Hotspot Analysis module

Interface:

```text
analyze(TraceSession, HardwareProfile, AnalysisOptions) -> AnalysisResult
```

The module owns simulation and attribution. It produces both source projections
and code projections when the trace supplies both. Existing `hotLines` output
remains intact; binary attribution is added as `codeHotspots`.

### 7.5 Hotspot Export module

Interface:

```text
export(AnalysisResult) -> hardware-explorer-hotspots-v1.json
```

The export is the single external seam for decompiler tooling. Its JSON Schema
is checked into the repository, and fixtures are validated in CI. Core code
does not load a decompiler SDK or emit tool-specific project files.

### 7.6 Decompiler adapters

Ghidra and IDA/Hex-Rays are two adapters at the hotspot-export seam:

- The Ghidra adapter is an installable extension.
- The IDA/Hex-Rays adapter is a plugin that uses IDAPython and Hex-Rays when the
  decompiler is available.

Both adapters validate image identity, map RVAs into the current program's
address space, create a sortable hotspot view, and navigate to the closest safe
decompiler location. Tool-specific behavior remains inside each adapter.

### 7.7 Local PDB attribution

Interface:

```text
hardware-explore-symbolize.ps1 -Result analysis.json -Image game.exe -Pdb game.pdb -Output profile.json
```

This post-processing module owns executable SHA-256 verification, explicit PDB
selection and GUID/age matching, bounded native lookup, failure handling, and
enrichment of code hotspots. The simulator does not acquire Windows-specific
dependencies or reinterpret a source path from a PDB as a file to execute/read.

The Windows-only helper uses [DbgHelp symbol loading](https://learn.microsoft.com/en-us/windows/win32/api/dbghelp/nf-dbghelp-symloadmoduleexw)
with the selected PDB rather than discovering symbols through the PE's embedded
path. It compares [CodeView/PDB identity information](https://learn.microsoft.com/en-us/windows/win32/api/dbghelp/nf-dbghelp-symsrvgetfileindexinfow)
and verifies the loaded PDB identity before returning results. Inherited symbol
server paths are ignored, and no automatic symbol downloads are enabled.

For clang-cl return-PC sites, lookup uses `rva - 1` while preserving the original
code identity. A containing function may be `function-exact`; a matching debug
line is `source-nearest`, because the instrumented memory instruction and exact
source statement have not been independently verified. Resolved hotspots carry
`attribution.lookupRva` and `attribution.method: return-pc-minus-one`. The
post-processor does not rewrite cache metrics or the existing `hotLines` view.

## 8. Trace Format v2

The current line-oriented event format remains valid. Binary capture adds a
version header, an image manifest, a compact code-site table, and an optional
site reference on each event. Existing readers continue to ignore metadata and
trailing fields.

Illustrative form:

```text
# hardware-explorer-trace 2
# capture clang-cl i686-pc-windows-msvc 32 1 2000000 false
# image 1 sha256:<digest> game.exe 0x00400000 0x006a0000
# site 7 1 0x00012f40
L 0x01f40020 4 unknown:0 T1 K7
S 0x01f40024 4 unknown:0 T1 K7
```

Requirements:

- `K<n>` refers to a previously declared code site.
- The capture record stores capture kind, target triple, address width, sample
  rate, event limit, and truncation state in that order.
- The event address remains the data address used for cache simulation.
- Site-table growth is bounded; the current parser/normalizer fails explicitly
  above one million sites rather than dropping attribution silently.
- Unknown images or sites are retained as unattributed events rather than
  silently assigned to the main executable.
- Parsers reject unsupported format versions and invalid numeric ranges.
- The parser bounds records to 16 KiB, images to 4,096, and memory accesses to
  1 MiB per event. v2 requires a location and thread, rejects signed/overflowing
  numeric fields, and validates access spans against the capture address width.
- v1 traces produce byte-for-byte compatible result fields.

The implementation may use a binary capture representation internally, but
the portable/debuggable interchange form above is normative for v2.

During capture, the Win32 `clang-cl` runtime appends process-local
`C0x<address>` (return PC), `B0x<address>` (loaded image base), and
`R0x<offset>` (RVA) tokens to each instrumented load/store event. These are raw
capture provenance, not a portable code identity. The trace normalizer verifies
`C - B == R`, checks the RVA against the PE image, hashes the image, and replaces
the raw fields with a `K<n>` reference. Raw `C` and `B` addresses must not appear
in exported hotspot bundles.

The capture wrapper preflights PE32/i386 and hashes the launched executable
before and after execution. It limits capture to two million events by default,
preserves raw files on failure, and does not publish a normalized trace when the
program exits unsuccessfully. The normalizer rejects mixed instrumented images;
the runtime deliberately withholds main-image attribution from DLL/JIT sites.
Offline normalization requires the caller to supply the exact captured image.

## 9. Analysis Result and Hotspot Bundle

`codeHotspots` is additive to the existing result. The example below describes
the target bundle after Pin/decompiler support; bare simulator output remains
unresolved. The optional PDB post-processor adds `symbol`, `source`, `codeView`,
and lookup provenance, but never labels a site `instruction-exact`:

```json
{
  "capture": {
    "kind": "intel-pin",
    "traceFormat": 2,
    "target": "i686-pc-windows-msvc",
    "addressWidth": 32,
    "sampleRate": 100,
    "eventLimit": 10000000,
    "truncated": false
  },
  "images": [
    {
      "id": "sha256:...",
      "name": "game.exe",
      "sha256": "...",
      "codeView": { "guid": "...", "age": 1 }
    }
  ],
  "codeHotspots": [
    {
      "location": { "imageId": "sha256:...", "rva": "0x00012f40" },
      "symbol": { "function": "update_world", "functionRva": "0x00012e90" },
      "navigationConfidence": "instruction-exact",
      "metrics": {
        "accesses": 4200,
        "reads": 3900,
        "writes": 300,
        "l1dHits": 3100,
        "l1dMisses": 1100,
        "l1dMissRate": 0.2619,
        "estimatedMemoryStallCycles": 18200
      }
    }
  ]
}
```

Sampled counts are labeled as sampled. Hardware Explorer must not extrapolate
them to exact totals unless a future estimator documents its method and error.
Model identity and confidence remain present in the enclosing analysis result.

The decompiler export contains only the capture manifest, selected model
metadata, code hotspots, and warnings. Raw data addresses are excluded by
default because adapters do not need them.

## 10. Intel Pin IA-32 Capture

The experimental Pin CLI and normalizer:

- Build an IA-32 tool against Pin 4.3.1 kit 99850 using clang-cl 15/16.
- Observe image loads and record a manifest entry for the main PE and DLLs.
- Record the instruction pointer for each instrumented memory operand.
- Normalize each instruction pointer to an image and RVA.
- Deduplicate code sites so events carry compact site identifiers.
- Preserve read/write type, data address, access width, and thread identity.
- Apply event limits and sampling before writing high-volume records.
- Emit a clear warning when instructions cannot be assigned to an image.

Initial process scope is the launched process and its loaded modules. Child
process following is deferred until process identity and multi-process traces
have an explicit model.

Commands and limits are documented in [the Pin integration guide](../backend/pin-tool/README.md).
The Windows adapter is separate from the old Linux tool. It hashes image files
at load time using Pin's isolated runtime, serializes recording/sampling/counts
under one lock, and stops recording at the requested event limit without
terminating the application. The bounded native normalizer requires a clean
completion record before writing output, canonicalizes reloads of identical
images, and keeps unknown/JIT sites unresolved. Captures that fail or time out
retain a `.partial.raw` diagnostic; they are not published as successful analyses.

The Pin PC is the memory instruction's address, not a clang-cl callback return
PC. Do **not** apply the clang-cl PDB lookup's `rva - 1` adjustment to Pin sites.
PDB enrichment for Pin and multi-image selection still require separate work.
Capture currently includes startup/system DLL traffic and normal pre-execution
memory operands; nonstandard operands fail closed. It is not yet a user-selectable
game capture window or a hardware retired-instruction measurement.
Pin's target-command-line reconstruction currently loses literal quotes and
can merge subsequent arguments. The Preview launcher rejects unsupported
argument forms before execution rather than silently changing the launch;
full Windows argument parity is still a stable-release gate.

## 11. Ghidra Adapter

The first decompiler adapter should be Ghidra because it can be developed and
tested in an open environment.

Required behavior:

- Import `hardware-explorer-hotspots-v1.json`.
- Compare the active program with the selected image using SHA-256 and CodeView
  identity.
- Block automatic navigation on a strong identity mismatch; permit an explicit
  user override with a persistent warning.
- Display functions and addresses ranked by misses, miss rate, accesses, or
  estimated stall cycles.
- Add bookmarks or markers with severity buckets.
- Double-click a hotspot to open the containing function in the Decompiler and
  navigate to the exact or nearest mapped address.
- Show navigation confidence and the original RVA.
- Remove or refresh imported markers without modifying program bytes.

Headless tests cover bundle parsing, identity matching, rebase handling, and
marker creation against a repository-built PE32 fixture. One manual smoke test
checks Decompiler navigation for each supported Ghidra release.

## 12. IDA/Hex-Rays Adapter

Required behavior mirrors the Ghidra adapter:

- Import the same hotspot bundle without conversion.
- Match the input image and account for the IDA image base.
- Provide a sortable hotspot chooser.
- Color or annotate matching functions and addresses without patching bytes.
- Jump to the matching disassembly address and, when Hex-Rays is available, the
  closest ctree item carrying that address.
- Fall back to the function entry or disassembly only when pseudocode mapping
  is unavailable, with the fallback shown explicitly.
- Work in IDA without Hex-Rays as a reduced-capability adapter.

Core bundle parsing and identity logic should be isolated from IDA SDK calls so
it can be tested without a licensed IDA installation. Supported IDA versions
will be declared only after the adapter is exercised against them.

## 13. Privacy and Safety

- Binary capture is local-only and unavailable to hosted runners.
- Hardware Explorer never uploads the executable, trace, PDB, or decompiler
  project unless a future feature obtains explicit user consent.
- Full local paths are redacted from portable exports by default.
- The bundle includes binary hashes and may reveal module names and function
  names; the export dialog warns users before sharing it.
- Capture requires an executable the user owns or is authorized to analyze.
- Hardware Explorer will not attempt to evade anti-debug, DRM, anti-cheat, or
  endpoint-security controls. If instrumentation is rejected, capture fails
  closed with an explanation.
- Program arguments are passed as an argument vector, never through shell
  interpolation.
- Output paths are created with restrictive user permissions where Windows
  permits them.

## 14. Performance and Failure Behavior

- Full instrumentation may be substantially slower than native execution.
- Default binary capture uses a bounded event count and presents sampling as an
  explicit control.
- The UI estimates trace size before launch and shows events captured, sampling
  rate, truncation state, and elapsed time afterward.
- A full or unwritable output location stops capture cleanly and preserves a
  diagnostic rather than a partially valid analysis.
- Process crashes retain a marked partial trace when its metadata is complete.
- Image hashing happens once per loaded image and is cached for the session.
- Decompiler import operates on aggregated hotspots, not raw event streams.

## 15. Compatibility

- `cache-explore-pin` and existing v1 trace records remain supported.
- `hardware-explore-pin` is the product-facing command.
- `CACHE_EXPLORER_*` variables remain aliases for corresponding
  `HARDWARE_EXPLORER_*` variables.
- `cache-explore-run-x86.ps1` and `cache-explore-normalize-trace.ps1` remain
  aliases for their `hardware-explore-*` names.
- Existing source-based `hotLines` and `sourceAnnotations` remain unchanged.
- New fields are additive until a separately announced major format change.
- Hotspot bundles declare `schemaVersion`; adapters reject newer incompatible
  major versions with an upgrade message.

## 16. Milestones and Acceptance Criteria

### M1 — Win32 `clang-cl` capture foundation

- Windows runtime builds for an i686 target.
- Stock `clang-cl` instruments loads and stores through its built-in
  SanitizerCoverage callbacks; no custom compiler or pass DLL is required.
- CMake integration selects the clang-cl instrumentation flags and emits PDB
  debug information for later attribution.
- A Win32 fixture compiles, executes, emits memory events, and is analyzed by
  `cache-sim` in Windows CI.
- macOS and Linux integrations remain green.

### M2 — Versioned binary attribution

- v2 trace parser accepts image, site, and event records.
- v1 parsing has regression coverage.
- Code locations remain identical across two ASLR-varied fixture runs.
- Results expose `codeHotspots` and capture provenance.
- Malformed, oversized, and unknown-version traces fail predictably.
- PDB/source attribution remains a separate release gate: code-site identity
  alone must not be marketed as original-source navigation.

The current optional PDB post-processor provides containing functions and
approximate source lines. Its tests cover identity mismatches, relocated/renamed
files, unchanged metrics/identities, and unresolved fallback. Exact statement
and inline-stack mapping remain outside this milestone's implemented slice.

### M3 — Windows IA-32 Pin capture

- A repository-built PE32 fixture is captured without source instrumentation.
- Main executable and DLL sites resolve to the correct image and RVA.
- Stripped and PDB-bearing fixtures both produce useful hotspots.
- Multithreaded capture, sampling, event limits, crashes, and paths containing
  spaces have automated coverage.
- No claim of Windows x86 support is published until this path passes on a real
  Windows runner.

### M4 — Hardware Explorer binary hotspot UX

- Results group by module and function before instruction sites.
- `unknown:0` is replaced by an explicit unresolved attribution state.
- Users can export a schema-validated hotspot bundle.
- Sampling, truncation, model confidence, and navigation confidence remain
  visible.

### M5 — Ghidra adapter

- Bundle identity verification, hotspot list, markers, and decompiler navigation
  work on the PE32 fixture.
- Rebased imports navigate correctly.
- Mismatched binaries do not receive silent annotations.

### M6 — IDA/Hex-Rays adapter

- Bundle identity verification, hotspot chooser, annotations, and address
  navigation work without Hex-Rays.
- Hex-Rays installations additionally navigate to the nearest mapped pseudocode
  item.
- Missing pseudocode mappings fall back visibly instead of failing silently.

## 17. Release Gate

The project may advertise **Windows x86 capture Preview** after M1 passes in
CI. It may advertise **source-attributed Windows x86 profiling** only after M2
and verified PDB/source mapping, and
**existing binary profiling** only after M2 through M4 pass. Ghidra and IDA
integrations are advertised separately after their respective milestones pass.

Until then, the documentation must describe each incomplete path as planned or
experimental. None of these milestones changes the modeled/calibrated status
of a hardware profile.

## 18. Decisions and Open Questions

Decisions:

- Use image hash plus RVA as the portable location identity.
- Keep data addresses separate from navigation addresses.
- Use one tool-neutral hotspot bundle and two decompiler adapters.
- Build Ghidra navigation before IDA/Hex-Rays navigation.
- Keep binary analysis local and offline.
- Use built-in SanitizerCoverage callbacks for stock clang-cl instead of
  requiring an LLVM build with Windows plugin exports enabled.
- Use Pin 4.3.1 kit 99850 and clang-cl 16.0.6 as the initial CI configuration.
- Keep the initial Pin process scope to the launched process and loaded DLLs.

Remaining questions for stable binary profiling:

- Should capture follow explicitly selected child processes in the first stable
  binary release?
- Which sampling preset provides a useful default for game workloads?
- Which Ghidra and IDA release ranges can be maintained in CI and manual smoke
  testing?
- Should function names from stripped binaries be stored in shared exports by
  default, or require an additional privacy opt-in?
