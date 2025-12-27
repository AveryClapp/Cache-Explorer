# Cache Explorer: Industry-Standard Requirements Specification

**Version:** 1.0  
**Last Updated:** December 2024  
**Goal:** Define every requirement for Cache Explorer to become the industry-standard cache profiling tool — as essential as Compiler Explorer for assembly, as trusted as perf/VTune but with dramatically better UX.

---

## Executive Summary: Current Progress

| Component                   | Status           | Completion |
| --------------------------- | ---------------- | ---------- |
| **LLVM Pass**               | ✅ Complete      | 90%        |
| **Runtime Library**         | ✅ Working       | 70%        |
| **Cache Simulator**         | ✅ Working       | 90%        |
| **Multi-Core Support**      | ✅ Working       | 75%        |
| **False Sharing Detection** | ✅ Working       | 80%        |
| **CLI Tool**                | ✅ Working       | 70%        |
| **Web Frontend**            | 🔧 In Progress   | 40%        |
| **Web Backend**             | ✅ Working       | 75%        |
| **Documentation**           | 🔧 In Progress   | 40%        |
| **Hardware Presets**        | ✅ Started       | 40%        |
| **Testing**                 | ✅ Good coverage | 60%        |
| **Security (Sandbox)**      | ✅ Complete      | 90%        |

**Overall: ~65% complete for 1.0 release**

### What's Working Now

```bash
# Full pipeline works:
./backend/scripts/cache-explore examples/sequential.c --config educational
# Outputs: L1/L2/L3 hit rates, hottest lines, multi-core support, false sharing detection
```

### Critical Path to 1.0

1. ~~**WebSocket streaming**~~ ✅ Done (real-time streaming mode)
2. ~~**Docker sandbox**~~ ✅ Done (full container isolation)
3. **Cache visualization** (the killer feature)
4. ~~**Quick Start documentation**~~ ✅ Done (docs/QUICK_START.md)
5. **Hardware validation** (compare against `perf`)
6. **Better error messages** (compilation errors)

---

## Prioritized Roadmap

### 🔴 P0: Must Have for Public Beta (2-3 weeks)

| Task                              | Effort | Impact   | Notes                                               |
| --------------------------------- | ------ | -------- | --------------------------------------------------- |
| WebSocket real-time streaming     | 3 days | High     | Currently batch-only, users want live updates       |
| Docker sandbox for code execution | 3 days | Critical | **Security blocker** — can't go public without this |
| Better compilation error messages | 1 day  | Medium   | Currently cryptic errors                            |
| Quick Start documentation         | 1 day  | High     | Users need to get started fast                      |
| Hardware validation vs perf       | 2 days | High     | Need to prove accuracy claims                       |

### 🟡 P1: Should Have for 1.0 (4-6 weeks)

| Task                                  | Effort | Impact        | Notes                                |
| ------------------------------------- | ------ | ------------- | ------------------------------------ |
| Cache state visualization (grid view) | 1 week | **Very High** | The killer differentiator            |
| Access timeline visualization         | 1 week | High          | See patterns over time               |
| Source line annotations in editor     | 3 days | High          | Monaco decorations for hits/misses   |
| 6 more hardware presets               | 2 days | Medium        | Intel 14th gen, AMD Zen 3, ARM, etc. |
| Optimization suggestions              | 1 week | High          | "Consider loop tiling"               |
| RRIP replacement policy               | 2 days | Medium        | More realistic L3 simulation         |
| User guide documentation              | 3 days | High          | Complete usage documentation         |

### 🟢 P2: Nice to Have for 1.0 (if time permits)

| Task                        | Effort  | Impact | Notes                     |
| --------------------------- | ------- | ------ | ------------------------- |
| Step-through execution      | 3 days  | Medium | Educational feature       |
| Memory layout visualization | 1 week  | Medium | Stack/heap/struct layout  |
| Flamegraph output           | 2 days  | Medium | Alternative visualization |
| CI/CD integration examples  | 1 day   | Medium | GitHub Actions, GitLab    |
| Prefetcher simulation       | 1 week  | Low    | Accuracy improvement      |
| Dark mode                   | 2 hours | Low    | User request              |

### 🔵 P3: Post-1.0 Features

| Task                         | Notes                            |
| ---------------------------- | -------------------------------- |
| MOESI/MESIF protocols        | AMD/Intel specific coherence     |
| TLB simulation               | Separate concern, lower priority |
| GCC support via Intel Pin    | Binary instrumentation           |
| IDE plugins (VS Code, CLion) | Integration                      |
| GPU cache simulation         | Experimental                     |
| Rust/Swift frontend support  | Other LLVM languages             |

---

## Table of Contents

1. [Vision & Success Criteria](#1-vision--success-criteria)
2. [Core Simulation Engine](#2-core-simulation-engine)
3. [Instrumentation Layer](#3-instrumentation-layer)
4. [Web Application](#4-web-application)
5. [CLI Tool](#5-cli-tool)
6. [Hardware Presets](#6-hardware-presets)
7. [Validation & Accuracy](#7-validation--accuracy)
8. [Educational Features](#8-educational-features)
9. [Production Features](#9-production-features)
10. [Documentation](#10-documentation)
11. [Testing](#11-testing)
12. [Security](#12-security)
13. [Performance](#13-performance)
14. [Deployment & Operations](#14-deployment--operations)
15. [Community & Ecosystem](#15-community--ecosystem)
16. [Release Checklist](#16-release-checklist)

---

## 1. Vision & Success Criteria

### 1.1 Mission Statement

Cache Explorer makes CPU cache behavior visible and understandable, transforming cache optimization from guesswork into direct observation. It serves both as an educational tool for students learning computer architecture and a production profiler for engineers optimizing real systems.

### 1.2 Success Metrics

| Metric                   | Target  | Notes                             |
| ------------------------ | ------- | --------------------------------- |
| Monthly Active Users     | 10,000+ | Within 12 months of launch        |
| GitHub Stars             | 5,000+  | Within 12 months                  |
| Simulation Accuracy      | >95%    | Validated against perf counters   |
| Instrumentation Overhead | <5x     | Competitive with AddressSanitizer |
| Page Load Time           | <2s     | For web application               |
| Time to First Result     | <5s     | From code paste to visualization  |

### 1.3 Competitive Positioning

| Tool              | Strengths                  | Cache Explorer Advantage                     |
| ----------------- | -------------------------- | -------------------------------------------- |
| perf/VTune        | Accurate, low overhead     | Better UX, source attribution, visualization |
| Cachegrind        | Accurate simulation        | Real-time, web-based, modern UI              |
| Compiler Explorer | Great UX, instant feedback | Cache-specific, execution-based              |

---

## 2. Core Simulation Engine

### 2.1 Cache Hierarchy Modeling

#### 2.1.1 Basic Structure

- [x] Configurable cache size (KB/MB)
- [x] Configurable line size (32B, 64B, 128B)
- [x] Configurable associativity (direct-mapped to 16+ way)
- [x] Separate L1 instruction and data caches
- [x] Unified L2 and L3 caches
- [x] Multi-level hierarchy (L1 → L2 → L3 → Memory)
- [ ] Configurable cache levels (support 2-level or 4-level hierarchies)
- [ ] Victim caches (small fully-associative buffer for evictions)
- [ ] Write buffers (coalescing write-back buffer)

#### 2.1.2 Address Decomposition

- [x] Tag extraction from address
- [x] Set index calculation
- [x] Byte offset within line
- [x] Support for 64-bit addresses
- [x] Configurable address space size
- [ ] Virtual vs physical address simulation
- [ ] Page coloring effects

### 2.2 Replacement Policies

#### 2.2.1 Implemented

- [x] True LRU (Least Recently Used)
- [x] Pseudo-LRU (tree-based) — `EvictionPolicy::PLRU`
- [x] Random replacement — `EvictionPolicy::RANDOM`
- [x] Policy selection per cache level (configured in `CacheConfig`)

#### 2.2.2 Required for Industry Standard

- [ ] RRIP (Re-Reference Interval Prediction) — Intel L3
- [ ] DRRIP (Dynamic RRIP) — adaptive version
- [ ] SRRIP (Static RRIP)
- [ ] NRU (Not Recently Used)
- [ ] FIFO (First In First Out)
- [ ] LFU (Least Frequently Used)
- [ ] ARC (Adaptive Replacement Cache) — for comparison

### 2.3 Write Policies

#### 2.3.1 Write-Hit Policies

- [x] Write-back (write to cache, mark dirty, writeback on eviction)
- [ ] Write-through (write to cache AND next level immediately)

#### 2.3.2 Write-Miss Policies

- [x] Write-allocate (load line into cache, then write)
- [ ] No-write-allocate (write directly to next level, don't cache)

#### 2.3.3 Write Buffer

- [ ] Coalescing write buffer (combine writes to same line)
- [ ] Write buffer depth configuration
- [ ] Write buffer stall simulation

### 2.4 Inclusion Policies

- [x] Inclusive (higher levels contain all data from lower levels)
- [x] Exclusive (data exists in only one level)
- [x] NINE (Non-Inclusive Non-Exclusive)
- [x] Back-invalidation on eviction (inclusive)
- [x] Victim migration on eviction (exclusive)
- [ ] Configurable inclusion policy per level pair

### 2.5 Cache Coherence (Multi-Threading)

#### 2.5.1 MESI Protocol

- [x] Modified state (dirty, exclusive) — tracked via dirty bit
- [x] Exclusive state (clean, exclusive)
- [x] Shared state (clean, possibly shared)
- [x] Invalid state
- [x] State transition diagram implementation — `CoherenceController.hpp`
- [x] Bus snooping simulation — `request_read()`, `request_exclusive()`
- [ ] Snoop filter / directory (for scalability) — basic directory exists

#### 2.5.2 Extended Protocols

- [ ] MOESI (adds Owned state) — AMD
- [ ] MESIF (adds Forward state) — Intel
- [ ] Protocol selection based on hardware preset

#### 2.5.3 Coherence Events

- [x] Read request (local/remote) — `request_read()`
- [x] Read-exclusive request (for writes) — `request_exclusive()`
- [x] Invalidation — implemented
- [x] Writeback — `get_line_for_writeback()`
- [ ] Intervention (forward data from another cache)
- [ ] Upgrade (S→M without data transfer)

#### 2.5.4 Multi-Core Topology

- [x] Per-core L1 caches — `MultiCoreCacheSystem`
- [x] Shared L2/L3
- [ ] Private vs shared L2 configuration
- [ ] NUMA awareness (multi-socket)
- [ ] Core-to-thread mapping (SMT/Hyperthreading) — basic round-robin exists

### 2.6 Prefetching

#### 2.6.1 Hardware Prefetchers

- [ ] Next-line prefetcher (simplest)
- [ ] Stride prefetcher (detect strided access patterns)
- [ ] Stream prefetcher (multiple concurrent streams)
- [ ] Spatial prefetcher (adjacent cache lines)
- [ ] Configurable prefetch distance
- [ ] Prefetch into L1 vs L2 vs L3

#### 2.6.2 Software Prefetch

- [ ] Recognize `__builtin_prefetch` / `_mm_prefetch`
- [ ] Prefetch hint types (T0, T1, T2, NTA)
- [ ] Prefetch effectiveness metrics

### 2.7 TLB Simulation (Optional but Valuable)

- [ ] Separate I-TLB and D-TLB
- [ ] L1 TLB (small, fully associative)
- [ ] L2 TLB (larger, set-associative)
- [ ] Page table walk simulation
- [ ] TLB miss penalty modeling
- [ ] Huge page support (2MB, 1GB)
- [ ] PCID/ASID tracking

### 2.8 Memory Access Patterns

#### 2.8.1 Access Size Handling

- [x] Single-byte accesses
- [x] Word-aligned accesses (4, 8 bytes)
- [x] Unaligned accesses
- [x] Cross-cache-line accesses (split into two) — `split_access_to_cache_lines()`
- [ ] Vector/SIMD accesses (16, 32, 64 bytes)
- [ ] Atomic operations (special coherence handling)

#### 2.8.2 Pattern Detection

- [ ] Sequential access detection
- [ ] Strided access detection
- [ ] Random access detection
- [ ] Working set estimation
- [ ] Reuse distance calculation
- [ ] Stack distance histogram

#### 2.8.3 False Sharing Detection — ✅ Implemented

- [x] Track per-thread access patterns per line — `LineAccess` struct
- [x] Detect different threads accessing same cache line — `track_access_for_false_sharing()`
- [x] Flag lines with multiple writers to different offsets
- [x] Generate false sharing reports — `get_false_sharing_reports()`

### 2.9 Timing Model (Optional)

- [ ] Hit latency per level (cycles)
- [ ] Miss penalty modeling
- [ ] Memory latency simulation
- [ ] Bandwidth saturation effects
- [ ] Queue delays
- [ ] Critical path analysis

---

## 3. Instrumentation Layer

### 3.1 LLVM Pass

#### 3.1.1 Core Functionality

- [x] Instrument LoadInst (memory reads) — `__tag_mem_load`
- [x] Instrument StoreInst (memory writes) — `__tag_mem_store`
- [x] Basic block entry tracking (I-cache) — `__tag_bb_entry`
- [x] Source location attribution (file, line) — via DebugLoc
- [x] Function name tracking
- [x] Skip system headers (STL, libc) — `isSystemHeader()`
- [x] Skip compiler-generated code — checks for DebugLoc
- [ ] Instrument atomic operations separately
- [ ] Instrument memory intrinsics (memcpy, memset, memmove)
- [ ] Instrument vector/SIMD operations
- [ ] Call stack tracking (optional, for attribution)

#### 3.1.2 Filtering & Sampling

- [x] System header filtering — `shouldInstrumentFunction()`
- [ ] Function whitelist/blacklist
- [ ] File whitelist/blacklist
- [ ] Sampling mode (1 in N accesses)
- [ ] Adaptive sampling (increase rate for hot code)
- [ ] Loop detection (sample once per iteration)

#### 3.1.3 Optimization

- [ ] Inline tracking functions (reduce call overhead)
- [ ] Batch multiple accesses per call
- [ ] Shadow memory for fast deduplication
- [ ] Hot/cold path differentiation

### 3.2 Runtime Library

#### 3.2.1 Event Capture

- [x] Lock-free ring buffer — ~1M events before flush
- [x] Source location storage (file, line)
- [x] Thread ID capture — via trace format `T<n>`
- [ ] Timestamp capture (rdtsc or clock_gettime)
- [ ] CPU core ID capture (sched_getcpu)
- [ ] Call stack capture (optional, libunwind)

#### 3.2.2 Event Format

```c
// Current trace format (text-based):
// L 0x7fff1234 4 main.c:10 T0    (Load, address, size, file:line, thread)
// S 0x7fff1234 4 main.c:12 T0    (Store)
// B 0x401000 15 main.c:5 T0      (Basic block entry, BB ID, instr count)

typedef struct {
    uint64_t address;      // Memory address
    uint32_t size;         // Access size in bytes
    uint32_t line;         // Source line number
    uint32_t thread_id;    // Thread identifier
    uint16_t file_id;      // Index into file string table
    uint8_t  access_type;  // Load, Store, Prefetch, Atomic
    uint8_t  flags;        // Instruction fetch, stack access, etc.
} CacheEvent;  // Target binary format
```

#### 3.2.3 Output Modes

- [x] Text trace to stdout — current implementation
- [x] Pipe to simulator — `./program | cache-sim`
- [ ] Binary trace file (more efficient)
- [ ] Streaming to simulator (socket)
- [ ] Shared memory ring buffer
- [ ] Direct simulator integration (in-process)
- [ ] Compressed trace output (zstd)

#### 3.2.4 Thread Safety

- [x] Thread ID tracking — parsed from trace
- [ ] Per-thread buffers (no contention)
- [ ] Lock-free flush mechanism
- [ ] Thread creation/destruction hooks
- [ ] Thread-to-core affinity tracking

### 3.3 Alternative Instrumentation (Phase 3+)

#### 3.3.1 Binary Instrumentation (GCC Support)

- [ ] Intel Pin integration
- [ ] DynamoRIO integration
- [ ] Frida integration (cross-platform)
- [ ] Source attribution via DWARF debug info

#### 3.3.2 Hardware Sampling

- [ ] perf_event integration
- [ ] PEBS (Precise Event-Based Sampling) support
- [ ] IBS (Instruction-Based Sampling) for AMD
- [ ] Hybrid mode (simulation + hardware validation)

---

## 4. Web Application

### 4.1 Frontend

#### 4.1.1 Code Editor

- [x] Monaco editor integration
- [x] Syntax highlighting (C, C++, Rust) — via Monaco
- [x] Line numbers
- [ ] Click-to-annotate (show hit/miss on line)
- [ ] Error/warning squiggles from compiler
- [ ] Auto-completion (basic)
- [ ] Multiple file tabs
- [x] Code templates/snippets — Examples dropdown
- [x] Keyboard shortcuts (run button)

#### 4.1.2 Cache Visualization

##### 4.1.2.1 Cache State View

- [ ] Visual grid showing cache sets and ways
- [ ] Color coding: valid/invalid, dirty/clean, MESI states
- [ ] Tag display on hover
- [ ] Animation on access (highlight hit/miss)
- [ ] Zoom in/out for large caches
- [ ] Filter by address range

##### 4.1.2.2 Access Timeline

- [ ] Scrollable timeline of memory accesses
- [ ] Color-coded by hit/miss level (L1/L2/L3/Memory)
- [ ] Click to jump to source line
- [ ] Filter by thread/function/file
- [ ] Aggregate view (heatmap over time)

##### 4.1.2.3 Statistics Dashboard

- [x] Hit rates per level (L1/L2/L3) — displayed in results
- [ ] Miss breakdown (compulsory/capacity/conflict)
- [ ] Bandwidth utilization
- [ ] Working set size over time
- [x] Top cache-missing lines (source attribution) — hottest lines
- [ ] Per-function statistics
- [ ] Comparison mode (before/after optimization)

##### 4.1.2.4 Memory Layout View

- [ ] Address space visualization
- [ ] Stack vs heap vs global regions
- [ ] Cache line boundaries overlay
- [ ] False sharing detection highlights
- [ ] Struct layout with padding

#### 4.1.3 Configuration Panel

- [x] Hardware preset selection — dropdown (Intel/AMD/Apple/Educational)
- [x] Optimization level selection — `-O0` to `-O3`
- [ ] Cache size sliders
- [ ] Associativity dropdown
- [ ] Replacement policy selection
- [x] Custom configuration option — `custom` in dropdown
- [ ] Custom configuration save/load
- [ ] Side-by-side config comparison

#### 4.1.4 Execution Controls

- [x] Run button
- [ ] Step (one memory access at a time)
- [ ] Step over (one source line)
- [ ] Continue to breakpoint
- [ ] Speed slider (events per second)
- [ ] Pause/Resume
- [ ] Reset

#### 4.1.5 User Experience

- [x] Responsive layout
- [ ] Dark mode
- [ ] Keyboard navigation
- [x] Shareable URLs (encode code + config) — share button
- [ ] Local storage for recent code
- [ ] Export results (JSON, CSV, PDF report)
- [ ] Undo/Redo for code changes

### 4.2 Backend

#### 4.2.1 Compilation Service

- [x] Clang compilation endpoint
- [ ] Rust compilation (rustc + LLVM)
- [ ] Compiler version selection
- [x] Optimization level selection (-O0 to -O3)
- [ ] Additional compiler flags input
- [ ] Compilation error formatting
- [ ] Warning display

#### 4.2.2 Execution Service

- [x] Docker sandbox for untrusted code
- [x] Resource limits (CPU time, memory, disk)
- [x] Network isolation
- [x] Execution timeout (configurable, default 30s)
- [ ] Input provision (stdin, command-line args)
- [ ] Output capture (stdout, stderr)

#### 4.2.3 Streaming

- [x] WebSocket connection — basic implementation
- [x] Real-time event streaming (streaming mode implemented)
- [ ] Backpressure handling (client can't keep up)
- [ ] Reconnection logic
- [x] Event batching (every 50 events)
- [ ] Binary protocol (efficiency)

#### 4.2.4 Session Management

- [x] Anonymous sessions (no login required)
- [ ] Session persistence (continue later)
- [ ] Rate limiting per IP
- [ ] Concurrent session limits
- [ ] Graceful degradation under load

### 4.3 API

#### 4.3.1 REST Endpoints

```
POST /api/compile     - Compile code, return binary ID
POST /api/run/{id}    - Execute binary, return trace ID
GET  /api/trace/{id}  - Get trace data (paginated)
GET  /api/stats/{id}  - Get summary statistics
GET  /api/presets     - List hardware presets
POST /api/config      - Validate custom config
```

#### 4.3.2 WebSocket Protocol

```
→ { type: "start", code: "...", config: {...} }
← { type: "compiling" }
← { type: "compiled", binary_id: "..." }
← { type: "running" }
← { type: "events", data: [...] }  // Batched
← { type: "stats", data: {...} }   // Periodic updates
← { type: "done", summary: {...} }
← { type: "error", message: "..." }
```

---

## 5. CLI Tool

### 5.1 Core Commands

```bash
# Current usage (via script)
./backend/scripts/cache-explore program.c --config intel

# Direct cache-sim usage
./cache-sim --config intel --verbose < trace.txt
./cache-sim --config amd --json < trace.txt
./cache-sim --config custom --l1-size 32768 --l1-assoc 8 < trace.txt
```

**Implemented options:**

- [x] `--config <name>` — intel|amd|apple|educational|custom
- [x] `--cores <n>` — number of cores for multi-core simulation
- [x] `--verbose` — print each cache event
- [x] `--json` — machine-readable JSON output
- [x] `--help` — usage information
- [x] Custom cache config flags (`--l1-size`, `--l1-assoc`, `--l2-size`, etc.)

**Target CLI interface:**

```bash
# Full pipeline (compile + instrument + run + simulate)
cache-explore run program.c                    # Compile and profile
cache-explore run ./binary                     # Profile existing binary
cache-explore run program.c -- arg1 arg2       # With arguments

# Analysis
cache-explore analyze trace.bin                # Analyze existing trace
cache-explore compare trace1.bin trace2.bin   # Compare two runs
cache-explore suggest trace.bin               # Optimization suggestions
```

### 5.2 Output Formats

#### 5.2.1 Summary Output — ✅ Implemented

```
Cache Explorer Results
======================
Program: matrix_multiply.c
Config:  Intel Core i9-13900K

L1 Data Cache (48KB, 12-way)
  Hits:     1,234,567 (94.2%)
  Misses:      76,543 (5.8%)

L2 Cache (2MB, 16-way)
  Hits:        45,678 (59.7%)
  Misses:      30,865 (40.3%)

L3 Cache (36MB, 12-way)
  Hits:        28,432 (92.1%)
  Misses:       2,433 (7.9%)

Hottest Cache-Missing Lines:
  1. matrix.c:45    12,345 misses (matrix[i][j] access)
  2. matrix.c:47     8,234 misses (matrix[j][i] access)
  3. util.c:123      2,100 misses (hash table lookup)
```

#### 5.2.2 JSON Output — ✅ Implemented

```json
{
  "config": "intel",
  "cores": 1,
  "levels": {
    "l1d": { "hits": 1234567, "misses": 76543, "hit_rate": 0.942 },
    "l2": { "hits": 45678, "misses": 30865, "hit_rate": 0.597 },
    "l3": { "hits": 28432, "misses": 2433, "hit_rate": 0.921 }
  },
  "hotspots": [{ "file": "matrix.c", "line": 45, "misses": 12345 }],
  "false_sharing": []
}
```

#### 5.2.3 Flamegraph Output

- [ ] Generate SVG flamegraph
- [ ] Stack-based attribution
- [ ] Color by cache level
- [ ] Interactive (click to zoom)

### 5.3 Features

- [x] Colored terminal output (basic)
- [ ] Progress bar for long runs
- [x] Quiet mode (default, use --verbose for details)
- [x] Verbose mode (--verbose)
- [ ] Config file support (~/.cache-explorer.toml)
- [ ] Environment variable configuration
- [ ] Shell completion (bash, zsh, fish)
- [ ] Man page

### 5.4 Integration

- [ ] Exit codes (0 = success, 1 = error, 2 = cache issues detected)
- [x] Machine-readable output for CI/CD (--json)
- [ ] Threshold-based pass/fail (--max-miss-rate 0.10)
- [ ] JUnit XML output for test frameworks
- [ ] GitHub Actions integration example
- [ ] GitLab CI integration example

---

## 6. Hardware Presets

### 6.1 Intel Configurations

#### 6.1.1 Desktop/Laptop

- [x] Intel 12th Gen (Alder Lake) — `make_intel_12th_gen_config()`
- [ ] Intel Core i9-14900K (Raptor Lake)
- [ ] Intel Core i7-13700K (Raptor Lake)
- [ ] Intel Core i9-11900K (Rocket Lake)
- [ ] Intel Core i7-10700K (Comet Lake)

#### 6.1.2 Server

- [ ] Intel Xeon Platinum 8480+ (Sapphire Rapids)
- [ ] Intel Xeon Gold 6348 (Ice Lake)
- [ ] Intel Xeon E-2388G (Rocket Lake)

#### 6.1.3 Low Power

- [ ] Intel Core Ultra 7 155H (Meteor Lake)
- [ ] Intel N100 (Alder Lake-N)

### 6.2 AMD Configurations

#### 6.2.1 Desktop

- [x] AMD Zen 4 (Ryzen 7000) — `make_amd_zen4_config()`
- [ ] AMD Ryzen 9 7950X (Zen 4) — specific variant
- [ ] AMD Ryzen 9 5950X (Zen 3)
- [ ] AMD Ryzen 5 5600X (Zen 3)

#### 6.2.2 Server

- [ ] AMD EPYC 9654 (Genoa)
- [ ] AMD EPYC 7763 (Milan)

### 6.3 Apple Silicon

- [x] Apple M-series (generic) — `make_apple_m_series_config()`
- [ ] Apple M3 Max (specific)
- [ ] Apple M3 Pro
- [ ] Apple M3
- [ ] Apple M2 Ultra
- [ ] Apple M1

### 6.4 ARM

- [ ] ARM Cortex-A78 (common in mobile)
- [ ] ARM Cortex-X3 (performance core)
- [ ] ARM Neoverse N2 (server)
- [ ] Qualcomm Snapdragon 8 Gen 3
- [ ] AWS Graviton 3

### 6.5 Educational/Simplified

- [x] Educational (tiny caches for learning) — `make_educational_config()`
- [x] Default/Test config — `make_default_config()`, `make_test_config()`
- [ ] "Minimal" (L1 only, no L2/L3)
- [ ] "Classic" (matches common textbook examples)

### 6.6 Preset Data Requirements

For each preset, document:

- [ ] Cache sizes (L1d, L1i, L2, L3)
- [ ] Associativity per level
- [ ] Line size
- [ ] Replacement policy per level
- [ ] Write policy
- [ ] Inclusion policy
- [ ] Prefetcher characteristics
- [ ] Latencies (cycles)
- [ ] Source/reference for data

---

## 7. Validation & Accuracy

### 7.1 Unit Test Coverage

- [ ] Address decomposition (tag/index/offset)
- [ ] Hit/miss detection (all associativities)
- [ ] LRU eviction correctness
- [ ] PLRU eviction correctness
- [ ] RRIP eviction correctness
- [ ] Dirty bit tracking
- [ ] Writeback generation
- [ ] Inclusion policy enforcement
- [ ] Exclusive policy victim migration
- [ ] Multi-level hierarchy traversal
- [ ] Cross-line access splitting
- [ ] Coherence state transitions (MESI)

### 7.2 Integration Tests

- [ ] Sequential array access (should have high hit rate)
- [ ] Random array access (should have low hit rate)
- [ ] Matrix row-major vs column-major
- [ ] Linked list traversal
- [ ] Binary search
- [ ] Hash table operations
- [ ] Producer-consumer (multi-threaded)
- [ ] False sharing scenario

### 7.3 Hardware Validation

#### 7.3.1 Methodology

- [ ] Run same program with Cache Explorer and perf
- [ ] Compare L1/L2/L3 miss counts
- [ ] Document acceptable variance (target: <5%)
- [ ] Automated validation test suite

#### 7.3.2 Validation Programs

- [ ] STREAM benchmark
- [ ] SPEC CPU subset
- [ ] LMbench
- [ ] Custom micro-benchmarks

#### 7.3.3 Known Limitations Document

- [ ] What we simulate vs what hardware does
- [ ] Expected divergence scenarios
- [ ] Prefetcher differences
- [ ] Speculative execution effects
- [ ] OS/kernel interference

### 7.4 Regression Testing

- [ ] Golden trace files for reference
- [ ] Automated comparison on CI
- [ ] Performance regression detection
- [ ] Accuracy regression detection

---

## 8. Educational Features

### 8.1 Example Programs

#### 8.1.1 Basic Patterns

- [ ] Sequential array access
- [ ] Strided array access
- [ ] Random array access
- [ ] Matrix row-major traversal
- [ ] Matrix column-major traversal
- [ ] Matrix transpose
- [ ] Linked list traversal
- [ ] Binary tree traversal

#### 8.1.2 Optimization Examples

- [ ] Loop tiling/blocking
- [ ] Cache-oblivious algorithms
- [ ] Struct padding for alignment
- [ ] Array of structs vs struct of arrays
- [ ] Prefetch insertion
- [ ] False sharing fix

#### 8.1.3 Real-World Scenarios

- [ ] Image processing (convolution)
- [ ] Sorting algorithms comparison
- [ ] Graph algorithms (BFS, DFS)
- [ ] Hash table implementations
- [ ] Memory allocator behavior
- [ ] Database index scan

### 8.2 Interactive Tutorials

- [ ] "What is a cache?" introduction
- [ ] "Why does cache line size matter?"
- [ ] "Understanding associativity"
- [ ] "Replacement policies explained"
- [ ] "Cache coherence basics"
- [ ] "Finding and fixing false sharing"
- [ ] "Optimizing matrix multiplication"

### 8.3 Guided Mode

- [ ] Step-by-step execution with explanations
- [ ] "What just happened?" button
- [ ] Prediction mode ("Will this hit or miss?")
- [ ] Quiz mode (test understanding)
- [ ] Progress tracking

### 8.4 Visualizations

- [ ] Cache line fill animation
- [ ] Eviction animation
- [ ] Memory hierarchy diagram
- [ ] Address breakdown visualization
- [ ] MESI state diagram (interactive)
- [ ] Timing diagram

---

## 9. Production Features

### 9.1 Optimization Suggestions

#### 9.1.1 Pattern Detection

- [ ] "Strided access detected — consider loop tiling"
- [ ] "Column-major access on row-major array — transpose or swap loops"
- [ ] "False sharing detected between threads"
- [ ] "Working set exceeds L2 — consider blocking"
- [ ] "High conflict misses — padding may help"
- [ ] "Random access pattern — consider cache-oblivious algorithm"

#### 9.1.2 Suggestion Format

```
SUGGESTION: Loop tiling recommended
Location:   matrix.c:45-52
Issue:      Working set (4MB) exceeds L2 cache (2MB)
Impact:     ~40% of L2 misses from this loop
Fix:        Tile loop with block size 64x64
Example:
  for (int ii = 0; ii < N; ii += 64)
    for (int jj = 0; jj < N; jj += 64)
      for (int i = ii; i < min(ii+64, N); i++)
        ...
```

### 9.2 Profiling Reports

- [ ] HTML report generation
- [ ] PDF report generation
- [ ] Executive summary section
- [ ] Detailed analysis section
- [ ] Recommendations section
- [ ] Appendix with raw data
- [ ] Graphs and charts

### 9.3 CI/CD Integration

- [ ] GitHub Actions workflow template
- [ ] GitLab CI template
- [ ] Jenkins plugin (or instructions)
- [ ] Cache regression detection
- [ ] Performance budgets
- [ ] PR comments with results
- [ ] Badge generation (cache score)

### 9.4 Build System Integration

- [ ] CMake integration (add_cache_profile target)
- [ ] Makefile snippets
- [ ] Cargo integration (Rust)
- [ ] Bazel rules

### 9.5 IDE Integration

- [ ] VS Code extension (future)
- [ ] CLion plugin (future)
- [ ] Source annotation import

---

## 10. Documentation

### 10.1 User Documentation

#### 10.1.1 Getting Started

- [ ] Quick start guide (5-minute tutorial)
- [ ] Installation instructions (all platforms)
- [ ] First profile walkthrough
- [ ] Common use cases

#### 10.1.2 User Guide

- [ ] Web interface guide
- [ ] CLI reference
- [ ] Configuration options
- [ ] Output interpretation
- [ ] Troubleshooting

#### 10.1.3 Concept Guides

- [ ] "How CPU caches work" primer
- [ ] "Understanding Cache Explorer results"
- [ ] "Cache optimization techniques"
- [ ] "Multi-threaded caching"

### 10.2 Technical Documentation

- [ ] Architecture overview
- [ ] Simulation algorithm details
- [ ] Instrumentation design
- [ ] API reference
- [ ] Protocol specifications
- [ ] Hardware preset sources

### 10.3 Developer Documentation

- [ ] Contributing guide
- [ ] Development setup
- [ ] Code style guide
- [ ] Testing guide
- [ ] Release process
- [ ] Architecture decision records (ADRs)

### 10.4 Documentation Infrastructure

- [ ] Documentation website (e.g., Docusaurus, MkDocs)
- [ ] API documentation generation
- [ ] Version-specific docs
- [ ] Search functionality
- [ ] Feedback mechanism

---

## 11. Testing

### 11.1 Test Categories

#### 11.1.1 Unit Tests

- [ ] Cache simulator logic
- [ ] Address parsing
- [ ] Replacement policies
- [ ] Coherence protocol
- [ ] Runtime library functions
- [ ] LLVM pass transformations

#### 11.1.2 Integration Tests

- [ ] End-to-end profiling pipeline
- [ ] Web API endpoints
- [ ] CLI commands
- [ ] WebSocket streaming
- [ ] Docker sandbox

#### 11.1.3 Performance Tests

- [ ] Instrumentation overhead benchmarks
- [ ] Simulation throughput benchmarks
- [ ] Web response time benchmarks
- [ ] Memory usage under load

#### 11.1.4 Fuzz Testing

- [ ] Random address sequences
- [ ] Malformed trace files
- [ ] Invalid configurations
- [ ] Malicious code input (security)

### 11.2 Test Infrastructure

- [ ] CI pipeline (GitHub Actions)
- [ ] Test coverage tracking
- [ ] Performance regression tracking
- [ ] Automated hardware validation
- [ ] Cross-platform testing (Linux, macOS, Windows)

### 11.3 Test Metrics

- [ ] Code coverage >80%
- [ ] All public APIs tested
- [ ] No regressions in accuracy
- [ ] Performance within budgets

---

## 12. Security

### 12.1 Web Application Security

#### 12.1.1 Input Validation

- [ ] Code size limits
- [ ] Filename sanitization
- [ ] Configuration validation
- [ ] Rate limiting

#### 12.1.2 Sandboxing

- [ ] Docker container isolation
- [ ] Seccomp filtering
- [ ] No network access for user code
- [ ] Filesystem isolation
- [ ] Resource limits (CPU, memory, disk, processes)
- [ ] Timeout enforcement

#### 12.1.3 Infrastructure

- [ ] HTTPS only
- [ ] CORS configuration
- [ ] CSP headers
- [ ] No sensitive data in logs
- [ ] Dependency vulnerability scanning

### 12.2 Supply Chain Security

- [ ] Signed releases
- [ ] SBOM (Software Bill of Materials)
- [ ] Dependency pinning
- [ ] Reproducible builds

### 12.3 Security Documentation

- [ ] Security policy (SECURITY.md)
- [ ] Responsible disclosure process
- [ ] Known limitations
- [ ] Threat model

---

## 13. Performance

### 13.1 Instrumentation Overhead

| Target      | Measurement  |
| ----------- | ------------ |
| Overhead    | <5x slowdown |
| Memory      | <2x baseline |
| Binary size | <2x baseline |

### 13.2 Simulation Performance

| Target     | Measurement          |
| ---------- | -------------------- |
| Throughput | >10M events/second   |
| Latency    | <1ms per 1000 events |
| Memory     | <1GB for 100M events |

### 13.3 Web Application Performance

| Target               | Measurement |
| -------------------- | ----------- |
| Page load            | <2s         |
| Time to first result | <5s         |
| Streaming latency    | <100ms      |
| Concurrent users     | 100+        |

### 13.4 CLI Performance

| Target        | Measurement |
| ------------- | ----------- |
| Startup time  | <100ms      |
| Small program | <1s total   |
| Large program | <5x runtime |

---

## 14. Deployment & Operations

### 14.1 Web Deployment

- [ ] Docker Compose setup
- [ ] Kubernetes manifests
- [ ] Terraform/Pulumi for cloud
- [ ] CDN for static assets
- [ ] Load balancer configuration
- [ ] Auto-scaling rules
- [ ] Health checks

### 14.2 Monitoring

- [ ] Request latency metrics
- [ ] Error rate tracking
- [ ] Resource utilization
- [ ] User analytics (privacy-respecting)
- [ ] Alerting rules
- [ ] Dashboard (Grafana or similar)

### 14.3 Logging

- [ ] Structured logging
- [ ] Log aggregation
- [ ] Log retention policy
- [ ] No PII in logs

### 14.4 Backup & Recovery

- [ ] Database backups (if applicable)
- [ ] Configuration backups
- [ ] Disaster recovery plan
- [ ] Incident response runbook

### 14.5 Release Process

- [ ] Semantic versioning
- [ ] Changelog maintenance
- [ ] Release notes
- [ ] Migration guides
- [ ] Deprecation policy

---

## 15. Community & Ecosystem

### 15.1 Open Source

- [ ] MIT or Apache 2.0 license
- [ ] CONTRIBUTING.md
- [ ] CODE_OF_CONDUCT.md
- [ ] Issue templates
- [ ] PR templates
- [ ] Good first issues labeled

### 15.2 Community Building

- [ ] Discord or Slack community
- [ ] GitHub Discussions enabled
- [ ] Twitter/social media presence
- [ ] Blog with technical posts
- [ ] Conference talks/presentations
- [ ] Academic paper (optional)

### 15.3 Ecosystem

- [ ] Plugin architecture (future)
- [ ] Custom visualization support
- [ ] Custom analysis scripts
- [ ] Integration guides
- [ ] Partner/integration directory

### 15.4 Outreach

- [ ] Hacker News launch
- [ ] Reddit announcement (r/programming, r/cpp)
- [ ] Lobsters post
- [ ] Matt Godbolt / Compiler Explorer community
- [ ] University outreach (CS courses)
- [ ] Conference submissions

---

## 16. Release Checklist

### 16.1 Alpha Release (Internal Testing) — ✅ CURRENT STATUS

**Core Functionality:**

- [x] LLVM pass instruments loads/stores correctly
- [x] Runtime captures events without crashes
- [x] Cache simulator produces correct hit/miss for basic tests
- [x] Web UI displays results (basic)
- [x] CLI produces output

**Quality:**

- [x] No critical bugs in core path
- [x] Basic documentation exists (README, CLAUDE.md)
- [x] Can profile example programs

**What's Working:**

- End-to-end pipeline: source → LLVM pass → runtime → trace → simulator → stats
- Multi-core simulation with coherence
- False sharing detection
- 4 hardware presets (Intel, AMD, Apple, Educational)
- JSON output for automation

### 16.2 Beta Release (Public Testing) — 🎯 NEXT TARGET

**Core Functionality:**

- [x] All Phase 1 simulation features complete
- [x] Multi-level hierarchy working
- [x] At least 3 hardware presets
- [x] WebSocket streaming working (real-time mode implemented)
- [x] CLI feature-complete (basic)

**Quality:**

- [x] 80%+ test coverage (34 tests passing)
- [ ] <5% divergence from perf counters (not validated yet)
- [ ] Performance within targets (not measured)
- [x] Security review complete (Docker sandbox implemented)

**Documentation:**

- [x] Quick start guide (docs/QUICK_START.md)
- [ ] User guide draft
- [ ] API documentation

**Infrastructure:**

- [x] CI/CD pipeline (basic)
- [ ] Staging environment
- [ ] Basic monitoring

**Estimated work remaining:** 2-3 weeks

### 16.3 1.0 Release (Production Ready)

**Core Functionality:**

- [x] All Phase 1-2 features complete
- [ ] 10+ hardware presets (currently 4)
- [ ] Optimization suggestions working
- [x] Multi-threading support (basic)

**Quality:**

- [ ] All tests passing
- [ ] Performance targets met
- [ ] Security audit passed
- [ ] Accessibility review
- [ ] Cross-browser testing

**Documentation:**

- [ ] Complete user documentation
- [ ] Technical documentation
- [ ] Video tutorials
- [ ] Example gallery (started)

**Operations:**

- [ ] Production deployment
- [ ] Monitoring and alerting
- [ ] On-call rotation
- [ ] Incident response plan

**Community:**

- [ ] Public repository
- [ ] Contributing guide
- [ ] Community channels
- [ ] Launch announcement prepared

**Estimated work remaining:** 6-8 weeks after Beta

### 16.4 Post-1.0 Roadmap

**1.1 - Multi-Threading:**

- [ ] Full MESI coherence
- [ ] False sharing detection
- [ ] Per-thread statistics

**1.2 - Advanced Analysis:**

- [ ] Prefetcher simulation
- [ ] Timing model
- [ ] Bandwidth analysis

**1.3 - Ecosystem:**

- [ ] IDE plugins
- [ ] Build system integrations
- [ ] CI/CD integrations

**2.0 - Platform Expansion:**

- [ ] GCC support (Intel Pin)
- [ ] Windows support
- [ ] ARM optimization
- [ ] GPU cache simulation (experimental)

---

## Appendix A: Technology Stack

### Backend

- **Language:** C++ (simulation), C (runtime)
- **Build:** CMake
- **Compiler:** Clang/LLVM 18+
- **Web Server:** Boost.Beast (HTTP/WebSocket)
- **Containerization:** Docker

### Frontend

- **Framework:** React + TypeScript
- **Editor:** Monaco
- **Visualization:** D3.js or Recharts
- **Styling:** Tailwind CSS

### Infrastructure

- **CI/CD:** GitHub Actions
- **Hosting:** AWS/GCP/self-hosted
- **Monitoring:** Prometheus + Grafana

---

## Appendix B: Glossary

| Term            | Definition                                                   |
| --------------- | ------------------------------------------------------------ |
| Associativity   | Number of cache lines per set                                |
| Cache line      | Minimum unit of data transfer (typically 64 bytes)           |
| Compulsory miss | First access to a line (cold miss)                           |
| Capacity miss   | Working set exceeds cache size                               |
| Conflict miss   | Set is full despite cache having space                       |
| Dirty bit       | Indicates line has been modified                             |
| False sharing   | Different threads modify different data on same line         |
| Inclusion       | Property that higher levels contain all lower-level data     |
| LRU             | Least Recently Used replacement policy                       |
| MESI            | Cache coherence protocol (Modified/Exclusive/Shared/Invalid) |
| Prefetcher      | Hardware that speculatively loads data                       |
| Set             | Group of cache lines with same index                         |
| Tag             | Address bits that identify a cache line                      |
| TLB             | Translation Lookaside Buffer (address translation cache)     |
| Way             | One cache line slot within a set                             |
| Working set     | Data actively used by program                                |
| Writeback       | Transfer dirty data to next level on eviction                |

---

## Appendix C: References

### Academic Papers

- "What Every Programmer Should Know About Memory" — Ulrich Drepper
- "A Primer on Memory Consistency and Cache Coherence" — Sorin, Hill, Wood

### Hardware Documentation

- Intel 64 and IA-32 Architectures Optimization Reference Manual
- AMD64 Architecture Programmer's Manual
- ARM Cortex Technical Reference Manuals

### Similar Tools

- Cachegrind (Valgrind)
- Intel VTune
- perf (Linux)
- Compiler Explorer (godbolt.org)

---

_Document Version: 1.0_  
_This is a living document. Update as requirements evolve._
