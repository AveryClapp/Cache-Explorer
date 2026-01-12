# Cache Explorer

An interactive CPU cache simulator that shows you exactly which lines of your code cause cache misses.

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

### CLI Tool

The `cache-explore` command works with LLVM 17-21 and auto-detects your version:

```bash
# Add to PATH
export PATH="$PATH:/path/to/cache-explorer/backend/scripts"

# Analyze a C file
cache-explore mycode.c --config intel --json

# With prefetching simulation
cache-explore mycode.c --config amd --prefetch stream

# Fast mode (~3x speedup, skips 3C classification)
cache-explore mycode.c --fast

# Manage pass cache
cache-explore cache list    # Show cached passes
cache-explore cache clear   # Remove all cached passes
cache-explore cache size    # Show cache size
```

**First-run:** The CLI automatically downloads a pre-built LLVM pass for your version, or builds one locally if not available.

### Local Development (Web UI)

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
| Hardware Presets | 12 presets: Intel, AMD, Apple, ARM, Educational |
| 3C Classification | Compulsory, Capacity, Conflict miss breakdown |
| Source Attribution | See exactly which line caused each miss |

## Hardware Presets

| Preset | Config |
|--------|--------|
| **Intel** | 12th Gen (48KB/1.25MB/30MB), 14th Gen, Xeon |
| **AMD** | Zen 3, Zen 4 (32KB/1MB/32MB), EPYC |
| **Apple** | M1 (64KB/4MB/32MB SLC), M2, M3 |
| **ARM** | AWS Graviton 3, Raspberry Pi 4 |
| **Educational** | 4KB/32KB/256KB (small caches to see misses easily) |

## Supported Languages

- **C** - Full support (LLVM 17-21)
- **C++** - Full support (LLVM 17-21)
- **Rust** - Via LLVM bitcode pipeline

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
- **Web UI Rust** - Docker uses Rust 1.80 (LLVM 18). CLI supports LLVM 17-21

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
