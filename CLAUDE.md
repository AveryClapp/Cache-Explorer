# CLAUDE.md - Cache Explorer Project Guide

## Current Status (January 7, 2026)

**Overall Completion: ~85%**

| Component | Status | Notes |
|-----------|--------|-------|
| LLVM Pass | ✅ Complete | Instruments loads/stores with file attribution |
| Runtime Library | ✅ Working | Thread-safe event capture to stdout |
| Cache Simulator | ✅ Complete | Full hierarchy with 5 eviction policies |
| Multi-Core Support | ✅ Complete | MESI coherence, 85 tests passing |
| Prefetching | ✅ Complete | 6 policies (none/next-line/stream/stride/adaptive/intel) |
| False Sharing Detection | ✅ Complete | Reports with padding suggestions |
| TLB Simulation | ✅ Complete | DTLB/ITLB with LRU replacement, displayed in UI |
| Timing Model | ✅ Complete | Configurable latencies per hardware preset (Intel/AMD/Apple) |
| CLI Tool | ✅ Working | JSON/text output, hardware presets |
| Backend - Multi-file | ✅ Complete | Accepts multiple files, compiles together |
| Frontend - Multi-file | ✅ Complete | Sends all files, displays results per-file |
| File Attribution UI | ✅ Complete | Results grouped by file with filtering |
| Assembly View Button | ⚠️ Attempted | Button positioned, CE URL encoding in progress |
| Web Frontend | ✅ Working | Dark/light modes, multi-file, TLB display, timing visualization |
| Web Backend | ✅ Working | Docker sandbox, WebSocket streaming, multi-file compilation |
| Testing | ✅ 85 tests | CacheLevel(22) + CacheSystem(25) + MESI(19) + Prefetch(19) |

**What's Working:**
```bash
# Full pipeline:
./backend/scripts/cache-explore examples/sequential.c --config intel --json

# With prefetching:
./backend/scripts/cache-explore mycode.c --config amd --prefetch stream

# Docker sandbox (production):
docker run -p 3001:3001 cache-explorer-sandbox:latest
```

---

## Quick Reference

### Build Commands

```bash
# Backend (cache simulator)
cd backend/cache-simulator && mkdir -p build && cd build
cmake .. -G Ninja && ninja

# LLVM pass
cd backend/llvm-pass && mkdir -p build && cd build
cmake .. -G Ninja -DLLVM_DIR=/opt/homebrew/opt/llvm/lib/cmake/llvm && ninja

# Runtime library
cd backend/runtime && mkdir -p build && cd build
cmake .. -G Ninja && ninja

# Frontend
cd frontend && npm install && npm run build

# Run tests
cd backend/cache-simulator/build && ./CacheLevelTest && ./CacheSystemTest
cd backend/cache-simulator/build && ./MESICoherenceTest && ./MultiCorePrefetchTest
```

### Key Files

**Cache Simulator:**
- `backend/cache-simulator/include/CacheLevel.hpp` - Single cache level with MESI
- `backend/cache-simulator/include/CacheSystem.hpp` - L1/L2/L3 hierarchy
- `backend/cache-simulator/include/MultiCoreCacheSystem.hpp` - Multi-core with coherence
- `backend/cache-simulator/include/Prefetcher.hpp` - 6 prefetch policies
- `backend/cache-simulator/include/CacheStats.hpp` - Stats with 3C miss breakdown

**LLVM Pass:**
- `backend/llvm-pass/CacheExplorerPass.cpp` - Instrumentation pass

**Runtime:**
- `backend/runtime/cache-explorer-rt.c` - Event capture functions

**Frontend:**
- `frontend/src/App.tsx` - Main React component
- `frontend/src/App.css` - Styling with dark/light themes

---

## Architecture

```
User Code → Clang + CacheExplorerPass.so → Instrumented Binary
                                                ↓
                                     Runtime: __tag_mem_load/store
                                                ↓
                                     Trace: "L 0x7fff1234 4 main.c:10 T0"
                                                ↓
                                     cache-sim → JSON output
                                                ↓
                                     WebSocket → Frontend
```

### Cache Hierarchy Model

```
          Per-Core          Shared
       ┌─────────────┐   ┌─────────┐   ┌─────────┐
Core 0 │ L1D   L1I   │──▶│         │──▶│         │
       └─────────────┘   │   L2    │   │   L3    │──▶ Memory
       ┌─────────────┐   │         │   │         │
Core 1 │ L1D   L1I   │──▶│         │──▶│         │
       └─────────────┘   └─────────┘   └─────────┘
            │                              │
            └────── MESI Coherence ────────┘
```

### MESI State Machine (Implemented)

```
                    ┌──────────────┐
       Read Miss    │              │  Write Hit
    ┌──────────────▶│   Modified   │◀─────────────┐
    │               │              │              │
    │               └──────┬───────┘              │
    │                      │                      │
    │              Remote  │ Read                 │
    │                      ▼                      │
    │               ┌──────────────┐              │
    │               │              │              │
    │   ┌──────────▶│   Shared     │──────────────┤
    │   │           │              │ Write Hit    │
    │   │           └──────┬───────┘              │
    │   │                  │                      │
    │   │ Remote Read      │ Remote               │
    │   │                  │ Write                │
    │   │                  ▼                      │
┌───┴───┴───┐       ┌──────────────┐              │
│           │       │              │              │
│ Exclusive │◀──────│   Invalid    │──────────────┘
│           │ Read  │              │ Write Miss
└───────────┘ Miss  └──────────────┘
```

---

## Eviction Policies

| Policy | Description | Use Case |
|--------|-------------|----------|
| LRU | True Least Recently Used | Default, accurate |
| PLRU | Tree-based Pseudo-LRU | Faster, 8+ way caches |
| RANDOM | Random eviction | Baseline comparison |
| SRRIP | Static Re-reference Interval Prediction | L3 simulation |
| BRRIP | Bimodal RRIP | Scan-resistant workloads |

## Prefetch Policies

| Policy | Description |
|--------|-------------|
| NONE | No prefetching |
| NEXT_LINE | Prefetch N+1 on miss at N |
| STREAM | Detect streams, prefetch ahead |
| STRIDE | Detect stride patterns |
| ADAPTIVE | Combine stream + stride |
| INTEL | DCU + IP-stride prefetcher |

---

## Hardware Presets

```cpp
// In CacheConfig.hpp
make_intel_12th_gen_config()  // 48KB L1, 1.25MB L2, 30MB L3
make_amd_zen4_config()        // 32KB L1, 512KB L2, 32MB L3
make_apple_m_series_config()  // 192KB L1, 12MB L2, shared L3
make_educational_config()     // 4KB L1, 32KB L2, 256KB L3
```

---

## API Output Format

```json
{
  "config": "intel",
  "events": 12345,
  "multicore": true,
  "cores": 4,
  "levels": {
    "l1d": {
      "hits": 10000,
      "misses": 500,
      "hitRate": 0.952,
      "writebacks": 100,
      "compulsory": 50,
      "capacity": 300,
      "conflict": 150
    },
    "l2": { ... },
    "l3": { ... }
  },
  "coherence": {
    "invalidations": 42,
    "falseSharingEvents": 2
  },
  "hotLines": [
    {
      "file": "main.c",
      "line": 45,
      "hits": 1000,
      "misses": 200,
      "missRate": 0.167
    }
  ],
  "falseSharing": [...],
  "suggestions": [
    {
      "type": "false_sharing",
      "severity": "high",
      "location": "main.c:45",
      "message": "Multiple threads writing to same cache line",
      "fix": "Add 64 bytes padding between fields"
    }
  ],
  "prefetch": {
    "policy": "stream",
    "degree": 2,
    "issued": 500,
    "useful": 450,
    "accuracy": 0.90
  },
  "tlb": {
    "dtlb": { "hits": 50000, "misses": 10, "hitRate": 0.9998 },
    "itlb": { "hits": 25000, "misses": 5, "hitRate": 0.9998 }
  },
  "timing": {
    "totalCycles": 125000,
    "avgLatency": 5.2,
    "breakdown": {
      "l1HitCycles": 100000,
      "l2HitCycles": 5000,
      "l3HitCycles": 2000,
      "memoryCycles": 18000,
      "tlbMissCycles": 70
    },
    "latencyConfig": {
      "l1Hit": 5,
      "l2Hit": 14,
      "l3Hit": 50,
      "memory": 200,
      "tlbMissPenalty": 7
    }
  }
}
```

---

## Testing

### Run All Tests
```bash
cd backend/cache-simulator/build
./CacheLevelTest      # 22 tests - single cache level
./CacheSystemTest     # 25 tests - hierarchy + false sharing
./MESICoherenceTest   # 19 tests - coherence protocol
./MultiCorePrefetchTest # 19 tests - per-core prefetching
```

### E2E Tests
```bash
./tests/e2e/run_tests.sh
```

---

## Frontend Features

- **Monaco Editor** - C/C++/Rust syntax highlighting
- **Dark/Light Mode** - Toggle with persistence
- **Source Annotations** - Inline miss counts with hover details
- **Error Display** - Structured compiler error parsing
- **Examples Gallery** - 10+ built-in examples (including multi-file)
- **Share URLs** - LZ-compressed code sharing
- **Multi-File Support** - Create and manage multiple source files

---

## Docker Deployment

```bash
# Build
docker build -t cache-explorer-sandbox:latest -f docker/Dockerfile.sandbox .

# Run
docker run -p 3001:3001 cache-explorer-sandbox:latest

# Access
open http://localhost:3001
```

---

## Common Tasks

### Add a New Eviction Policy
1. Add enum value to `EvictionPolicy` in `EvictionPolicy.hpp`
2. Implement `find_victim_<policy>()` in `CacheLevel.cpp`
3. Add case to `find_victim()` switch
4. Add test in `CacheLevelTest.cpp`

### Add a New Hardware Preset
1. Add function `make_<cpu>_config()` in `CacheConfig.hpp`
2. Add to preset map in `main.cpp`
3. Add to dropdown in `App.tsx`

### Add a New Prefetch Policy
1. Add enum value to `PrefetchPolicy` in `Prefetcher.hpp`
2. Implement logic in `Prefetcher::on_access()`
3. Add test in `MultiCorePrefetchTest.cpp`

---

## Known Limitations

- **No speculative execution** - All accesses are committed
- **Intel Pin not integrated** - GCC binaries need manual trace
- **Single-socket only** - No NUMA simulation
- **Simplified timing model** - Fixed latencies per level, no variable DRAM latency

---

## Resources

**LLVM:**
- [Writing LLVM Passes](https://llvm.org/docs/WritingAnLLVMPass.html)
- [AddressSanitizer design](https://github.com/google/sanitizers/wiki/AddressSanitizerAlgorithm)

**Cache Architecture:**
- [What Every Programmer Should Know About Memory](https://people.freebsd.org/~lstewart/articles/cpumemory.pdf)
- [MESI Protocol](https://en.wikipedia.org/wiki/MESI_protocol)

**Reference:**
- [cachegrind](https://valgrind.org/docs/manual/cg-manual.html)
- [Compiler Explorer](https://github.com/compiler-explorer/compiler-explorer)

---

## Project Structure

```
cache-explorer/
├── backend/
│   ├── llvm-pass/           # LLVM instrumentation pass
│   ├── runtime/             # Event capture library
│   ├── cache-simulator/     # Core simulation engine
│   │   ├── include/         # Headers
│   │   │   ├── CacheLevel.hpp
│   │   │   ├── CacheSystem.hpp
│   │   │   ├── MultiCoreCacheSystem.hpp
│   │   │   ├── Prefetcher.hpp
│   │   │   └── ...
│   │   ├── src/             # Implementation
│   │   └── tests/           # Unit tests
│   ├── server/              # Node.js WebSocket server
│   └── scripts/             # Build/run scripts
├── frontend/                # React + TypeScript
│   ├── src/
│   │   ├── App.tsx          # Main component
│   │   └── App.css          # Styling
│   └── package.json
├── docker/                  # Container configs
├── tests/e2e/               # End-to-end tests
├── docs/                    # Documentation
├── CLAUDE.md                # This file
├── PROJECT_REQUIREMENTS.md  # Full requirements spec
└── README.md                # User docs
```

---

---

## Recent Work Summary (January 7, 2026)

### Completed in This Session

**Timeline Feature Removal:**
- Removed timeline/scrubber feature from frontend for simplification
- Cleaned up ~500 lines of timeline-related code
- Removed unused components: AccessTimelineDisplay, InteractiveCacheGridDisplay, CacheHierarchyVisualization
- Cleaned up hooks and types referencing timeline
- Frontend builds cleanly with no TypeScript errors

**Bug Fixes:**
- Fixed inclusive cache back-invalidation bug (added `had_eviction` tracking)
- Clean evictions now properly trigger L1/L2 invalidation in inclusive mode
- All 85 cache simulator tests passing

**Multi-File Examples:**
- Added C multi-file example (matrix operations with header)
- Added C++ multi-file example (vector container template)
- Examples load correctly via command palette

**E2E Tests for Multi-File:**
- Added `test_multifile_c` - tests C multi-file compilation
- Added `test_multifile_cpp` - tests C++ multi-file compilation
- Added `test_multifile_attribution` - tests hot line file attribution

### Previous Session (January 4, 2026)

**Multi-File Support:**
- ✅ Backend: Accept multiple files via `/api/analyze` endpoint
- ✅ Backend: Compile all files together, track file attribution
- ✅ Frontend: Send all files in analysis request
- ✅ Frontend: Display results grouped by file with filtering
- ✅ Hot lines show source file attribution

**UI Improvements:**
- ✅ Light theme colors modernized (better WCAG AA contrast)
- ✅ Component CSS updated to use CSS variables for theming

**Known Issues:**
- ⚠️ Compiler Explorer integration: URL encoding/state format not working

**TLB and Timing Implementation (This Session):**
- ✅ TLB results now displayed in frontend (Data TLB and Instruction TLB under Details)
- ✅ Added `LatencyConfig` struct with hardware-specific latency presets
  - Intel: L1=5, L2=14, L3=50, Memory=200 cycles
  - AMD: L1=4, L2=14, L3=46, Memory=190 cycles
  - Apple: L1=3, L2=15, L3=0 (SLC), Memory=100 cycles (unified)
  - Educational: L1=1, L2=10, L3=30, Memory=100 cycles (round numbers)
- ✅ Added `TimingStats` tracking total cycles and breakdown by cache level
- ✅ Modified `CacheSystem::access_hierarchy()` to calculate cycles per access
- ✅ JSON output now includes `timing` object with totalCycles, avgLatency, breakdown, latencyConfig
- ✅ Frontend displays timing with visual breakdown bar (L1/L2/L3/Memory percentages)
- ✅ Fixed two build locations (component build and top-level build)

### What Still Needs Work

1. **Compiler Explorer Fix** - Need to determine correct state serialization format
2. **Multi-core timing** - Timing only works in single-core mode currently

---

**Last Updated:** January 7, 2026
**Project Phase:** Beta (TLB display + timing model complete)
**Recent Focus:** TLB UI + Timing model with configurable latencies
