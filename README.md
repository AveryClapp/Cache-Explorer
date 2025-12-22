# Cache Explorer

**Interactive cache profiler - "Compiler Explorer for cache behavior"**

Paste your code, see cache hits/misses in real-time with source-level attribution. Understand performance, learn optimization, profile production code.

## Quick Start

### Web (Try Now)

Visit [cache-explorer.dev](https://cache-explorer.dev):

1. Paste C/C++/Rust code
2. Click "Run"
3. See cache behavior instantly

### CLI (Local)

```bash
cache-explorer compile mycode.c -O2
cache-explorer run ./a.out
cache-explorer report
```

## How It Works

**LLVM compiler instrumentation** (same tech as AddressSanitizer):

```
Your Code → Clang + CacheProfiler.so → Instrumented Binary (2-5x slower)
                                              ↓
                                Runtime lib tracks memory accesses
                                              ↓
                                 Cache simulator (L1/L2/L3)
                                              ↓
                               Visualization (web or terminal)
```

## Features

- **Fast**: 2-5x overhead (vs 50x cachegrind)
- **Accurate**: Source-level attribution
- **Visual**: Real-time cache state, timelines
- **Smart**: Detects false sharing, suggests fixes
- **Accessible**: Web UI + CLI tool
- **Open source**: MIT license

## Use Cases

**Learning:** Understand cache hierarchies interactively
**Debugging:** Find cache thrashing, false sharing
**Optimization:** Profile real apps, validate changes

## Examples

```c
// Bad: column-major (cache misses)
for (i = 0; i < N; i++)
    for (j = 0; j < M; j++)
        matrix[j][i] = 0;  // ❌ Cache miss rate: 87%

// Good: row-major (cache hits)
for (i = 0; i < N; i++)
    for (j = 0; j < M; j++)
        matrix[i][j] = 0;  // ✅ Cache miss rate: 3%
```

See `examples/` for more.

## Building

**Prerequisites:** LLVM 18+, CMake 3.20+, Ninja

```bash
git clone https://github.com/you/cache-explorer.git
cd cache-explorer
./scripts/setup.sh
./scripts/build.sh
```

## Testing Programs (Manual)

**Quick test with the LLVM pass:**

```bash
cd backend/llvm-pass

# 1. Build the pass
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build

# 2. Create a test program (test.c)
# 3. Instrument and run:
clang -O1 -g test.c -S -emit-llvm -o test.ll
opt -load-pass-plugin=./build/CacheProfiler.so -passes="function(cache-explorer)" test.ll -S -o test_instrumented.ll
llc test_instrumented.ll -o test_instrumented.s
clang test_instrumented.s ../runtime/cache-explorer-rt.c -o test_final
./test_final
```

**Output shows memory accesses:**
```
STORE: 0x16d62a438 [4 bytes] at test.c:8
LOAD: 0x16d62a43c [4 bytes] at test.c:13
```

## Architecture

**Project structure:**

```
backend/
├── llvm-pass/         # Compiler instrumentation
├── runtime/           # Event tracking library
├── cache-simulator/   # L1/L2/L3 model + MESI coherence
├── server/            # Web backend (WebSocket)
└── cli/               # Command-line tool

frontend/              # React + TypeScript
examples/              # Educational code samples
docs/                  # Architecture, guides
```

## Roadmap

**Phase 1 (Current):**

- LLVM pass instrumentation
- Basic cache simulator
- Web UI

**Phase 2:**

- Multi-threading + false sharing
- Optimization suggestions

**Phase 3:**

- Hardware validation (perf)
- GCC support (Intel Pin)
- TLB simulation

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)

Areas we need help:

- Cache models (ARM, RISC-V)
- Visualization improvements
- Documentation
- Example programs

## License

MIT - see [LICENSE](LICENSE)

---

_Making cache hierarchies understandable_
