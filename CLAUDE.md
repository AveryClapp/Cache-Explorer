# CLAUDE.md - Cache Explorer Project Guide

## Current Status (December 31, 2024)

**Overall Completion: ~80%**

| Component | Status | Notes |
|-----------|--------|-------|
| LLVM Pass | ✅ Complete | Instruments loads/stores with source attribution |
| Runtime Library | ✅ Working | Thread-safe event capture to stdout |
| Cache Simulator | ✅ Complete | Full hierarchy with 5 eviction policies |
| Multi-Core Support | ✅ Complete | MESI coherence, 85 tests passing |
| Prefetching | ✅ Complete | 6 policies (none/next-line/stream/stride/adaptive/intel) |
| False Sharing Detection | ✅ Complete | Reports with padding suggestions |
| CLI Tool | ✅ Working | JSON/text output, hardware presets |
| Web Frontend | ✅ Working | Dark mode, timeline, annotations |
| Web Backend | ✅ Working | Docker sandbox, WebSocket streaming |
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
- **Timeline Scrubber** - Step through cache events
- **Error Display** - Structured compiler error parsing
- **Examples Gallery** - 10+ built-in examples
- **Share URLs** - LZ-compressed code sharing

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

- **No TLB simulation** - Cache only, not virtual memory
- **No timing model** - Hit/miss counts, not cycles
- **No speculative execution** - All accesses are committed
- **Intel Pin not integrated** - GCC binaries need manual trace
- **Single-socket only** - No NUMA simulation

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

**Last Updated:** December 31, 2024
**Project Phase:** Beta (targeting 1.0 release)
