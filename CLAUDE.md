# CLAUDE.md - Cache Explorer Project Guide

## Current Status (January 2026)

**Overall Completion: 100%**

| Component | Status | Notes |
|-----------|--------|-------|
| LLVM Pass | ✅ Complete | Instruments loads/stores with file attribution |
| Runtime Library | ✅ Complete | Thread-safe event capture to stdout |
| Cache Simulator | ✅ Complete | Full hierarchy with 5 eviction policies, optimized |
| Multi-Core Support | ✅ Complete | MESI coherence, per-core prefetching |
| Prefetching | ✅ Complete | 6 policies (none/next-line/stream/stride/adaptive/intel) |
| False Sharing Detection | ✅ Complete | Reports with padding suggestions |
| TLB Simulation | ✅ Complete | DTLB/ITLB with LRU replacement |
| Timing Model | ✅ Complete | Configurable latencies per hardware preset |
| Advanced Stats | ✅ Complete | Vector/SIMD, atomics, memcpy/memset tracking |
| Fast Mode | ✅ Complete | `--fast` disables 3C classification for ~3x speed |
| CLI Tool | ✅ Complete | JSON/text output, hardware presets |
| Web Frontend | ✅ Complete | Multi-file, dark/light modes, styled dropdowns, cancel button |
| Web Backend | ✅ Complete | Docker sandbox, WebSocket streaming |
| Testing | ✅ 123 tests | CacheLevel(22) + CacheSystem(25) + MESI(19) + Prefetch(18) + TLB(8) + Advanced(31) |

**What's Working:**
```bash
# Full pipeline:
./backend/scripts/cache-explore examples/sequential.c --config intel --json

# With prefetching:
./backend/scripts/cache-explore mycode.c --config amd --prefetch stream

# Fast mode (skips 3C miss classification for ~3x speedup):
./backend/scripts/cache-explore mycode.c --config intel --fast

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
cd backend/cache-simulator/build
./CacheLevelTest && ./CacheSystemTest && ./MESICoherenceTest
./MultiCorePrefetchTest && ./MultiCoreTLBTest && ./AdvancedInstrumentationTest
```

### After Making C++ Changes

**IMPORTANT:** There are TWO cache-sim binaries - changes won't take effect until both are updated:

```bash
# 1. Rebuild in the component directory
cd backend/cache-simulator/build && ninja

# 2. Copy to project root build (used by web server)
cp backend/cache-simulator/build/cache-sim build/backend/cache-simulator/cache-sim

# 3. Clear the server's result cache
rm -f backend/server/cache-explorer.db

# 4. Restart the backend server
lsof -ti:3001 | xargs kill -9; cd backend/server && node server.js &
```

Binary locations:
- `backend/cache-simulator/build/cache-sim` - Component build (use for development)
- `build/backend/cache-simulator/cache-sim` - Project root build (used by `cache-explore` script)

The `cache-explore` script checks the project root build first, so always sync both.

### Key Files

**Cache Simulator:**
- `backend/cache-simulator/include/CacheLevel.hpp` - Single cache level with MESI
- `backend/cache-simulator/include/CacheSystem.hpp` - L1/L2/L3 hierarchy
- `backend/cache-simulator/include/MultiCoreCacheSystem.hpp` - Multi-core with coherence
- `backend/cache-simulator/include/Prefetcher.hpp` - 6 prefetch policies
- `backend/cache-simulator/include/TLB.hpp` - TLB simulation
- `backend/cache-simulator/include/CacheStats.hpp` - Stats with 3C miss breakdown
- `backend/cache-simulator/include/AdvancedStats.hpp` - Vector/atomic/memcpy stats

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

### MESI State Machine

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
  "hotLines": [...],
  "falseSharing": [...],
  "suggestions": [...],
  "prefetch": {
    "policy": "stream",
    "accuracy": 0.90
  },
  "tlb": {
    "dtlb": { "hits": 50000, "misses": 10, "hitRate": 0.9998 }
  },
  "timing": {
    "totalCycles": 125000,
    "avgLatency": 5.2
  },
  "advancedStats": {
    "vector": { "loads": 100, "stores": 50, "bytesLoaded": 3200, "bytesStored": 1600, "crossLineAccesses": 5 },
    "atomic": { "loads": 10, "stores": 5, "rmw": 20, "cmpxchg": 2 },
    "memoryIntrinsics": { "memcpyCount": 5, "memcpyBytes": 4096, "memsetCount": 2, "memsetBytes": 1024 },
    "softwarePrefetch": { "issued": 50, "useful": 40, "accuracy": 0.80 }
  }
}
```

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

## Future Work

### Potential Enhancements
- **Intel Pin Integration** - Support tracing pre-compiled binaries without recompilation
- **NUMA Simulation** - Multi-socket memory architecture
- **Speculative Execution Modeling** - Branch prediction and speculative loads

## Known Limitations

- **No speculative execution** - All accesses are committed
- **Single-socket only** - No NUMA simulation
- **Simplified timing** - Fixed latencies per level

---

## Resources

**LLVM:**
- [Writing LLVM Passes](https://llvm.org/docs/WritingAnLLVMPass.html)

**Cache Architecture:**
- [What Every Programmer Should Know About Memory](https://people.freebsd.org/~lstewart/articles/cpumemory.pdf)
- [MESI Protocol](https://en.wikipedia.org/wiki/MESI_protocol)

**Reference:**
- [cachegrind](https://valgrind.org/docs/manual/cg-manual.html)

---

## Project Structure

```
cache-explorer/
├── backend/
│   ├── llvm-pass/           # LLVM instrumentation pass
│   ├── runtime/             # Event capture library
│   ├── cache-simulator/     # Core simulation engine
│   │   ├── include/         # Headers (.hpp)
│   │   ├── src/             # Implementation (.cpp)
│   │   └── tests/           # Unit tests
│   ├── server/              # Node.js WebSocket server
│   └── scripts/             # Build/run scripts
├── frontend/                # React + TypeScript
├── docker/                  # Container configs
├── tests/e2e/               # End-to-end tests
├── docs/                    # User documentation
└── CLAUDE.md                # This file
```

---

**Last Updated:** January 2026
**Project Phase:** Production Ready
