# Cache Explorer

An interactive CPU cache simulator that shows you exactly which lines of your code cause cache misses.

<!-- TODO: Add screenshot/gif here -->
<!-- ![Cache Explorer Demo](docs/demo.gif) -->

## What It Does

Write C, C++, or Rust code and instantly see:
- **L1/L2/L3 hit rates** with miss breakdowns (compulsory, capacity, conflict)
- **Hot lines** - which source lines cause the most cache misses
- **Memory access timeline** - watch cache behavior as your code executes
- **False sharing detection** for multi-threaded code
- **Prefetcher simulation** (next-line, stride, stream, Intel DCU)

## Why LLVM Instead of Pin/DynamoRIO?

Cache Explorer uses LLVM instrumentation rather than binary instrumentation (Intel Pin, DynamoRIO) because **source attribution matters for education**. Pin gives you addresses; we give you `matrix.c:42`. When a student asks "why is my matrix multiply slow?", seeing that line 42 has a 40% miss rate is immediately actionable.

The tradeoff is requiring recompilation, but for learning cache behavior, that's acceptable.

## Quick Start

### Docker (Recommended)

```bash
git clone https://github.com/yourusername/cache-explorer.git
cd cache-explorer
docker build -t cache-explorer -f docker/Dockerfile .
docker run -p 3001:3001 cache-explorer
# Open http://localhost:3001
```

### Local Development

**Prerequisites:** LLVM 18, Node.js 18+, CMake, Ninja

```bash
# Build backend
cd backend/cache-simulator && mkdir build && cd build
cmake .. -G Ninja && ninja

cd ../../llvm-pass && mkdir build && cd build
cmake .. -G Ninja -DLLVM_DIR=$(llvm-config --cmakedir) && ninja

cd ../../runtime && mkdir build && cd build
cmake .. -G Ninja && ninja

# Start backend server
cd ../../server && npm install && node server.js &

# Start frontend
cd ../../frontend && npm install && npm run dev
```

## Features

| Feature | Description |
|---------|-------------|
| Multi-level Cache | L1D/L1I, L2, L3 with configurable sizes and associativity |
| MESI Coherence | Full Modified/Exclusive/Shared/Invalid protocol |
| 5 Eviction Policies | LRU, Pseudo-LRU, Random, SRRIP, BRRIP |
| 6 Prefetch Policies | None, Next-line, Stream, Stride, Adaptive, Intel |
| TLB Simulation | DTLB/ITLB with configurable entries |
| Hardware Presets | Intel 12th Gen, AMD Zen4, Apple M-series, Educational |
| 3C Classification | Compulsory, Capacity, Conflict miss breakdown |
| Source Attribution | See exactly which line caused each miss |

## Hardware Presets

- **Intel 12th Gen**: 48KB L1, 1.25MB L2, 30MB L3
- **AMD Zen4**: 32KB L1, 512KB L2, 32MB L3
- **Apple M-series**: 192KB L1, 12MB L2
- **Educational**: 4KB L1, 32KB L2, 256KB L3 (small caches to see misses easily)

## Supported Languages

- **C** - Full support
- **C++** - Full support
- **Rust** - Via LLVM bitcode pipeline (pinned to Rust 1.80 for LLVM 18 compatibility)

## Architecture

```
Source Code
    │
    ▼
┌─────────────────────────────────┐
│  LLVM Instrumentation Pass      │  Inserts callbacks at every load/store
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Runtime Library                │  Captures: address, size, file:line, thread
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Cache Simulator                │  MESI coherence, prefetching, TLB
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Web Frontend                   │  Real-time visualization via WebSocket
└─────────────────────────────────┘
```

## Limitations

- **Requires recompilation** - Can't trace arbitrary binaries (use Pin for that)
- **No speculative execution** - All memory accesses are treated as committed
- **Single socket** - No NUMA simulation
- **Rust 1.80** - Newer Rust versions use LLVM 19+ which is incompatible

## Running Tests

```bash
cd backend/cache-simulator/build
./CacheLevelTest        # 22 tests
./CacheSystemTest       # 25 tests
./MESICoherenceTest     # 19 tests
./MultiCorePrefetchTest # 18 tests
./MultiCoreTLBTest      # 8 tests
./AdvancedInstrumentationTest # 31 tests
```

## License

MIT

## Acknowledgments

Inspired by [Compiler Explorer](https://godbolt.org) and [Cachegrind](https://valgrind.org/docs/manual/cg-manual.html).
