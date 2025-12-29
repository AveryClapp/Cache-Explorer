# Cache Explorer

**Interactive CPU cache profiler - "Compiler Explorer for cache behavior"**

Paste your C/C++/Rust code, instantly see cache hits and misses with source-level attribution. Understand performance bottlenecks, learn optimization techniques, profile production code.

![Cache Explorer Demo](docs/images/demo.png)

## Features

- **Real-time visualization** - Watch cache state update as code executes
- **Source attribution** - See exactly which lines cause cache misses
- **13 hardware presets** - Intel, AMD, Apple Silicon, ARM, embedded
- **False sharing detection** - Identifies multi-threaded performance bugs
- **Multiple eviction policies** - LRU, PLRU, Random, SRRIP, BRRIP
- **Prefetch simulation** - Next-line, stream, stride, adaptive
- **Fast** - 2-5x overhead (vs 50x cachegrind)
- **CLI + Web UI** - Terminal workflow or interactive browser

## Quick Start

### Web UI

```bash
# Clone and build
git clone https://github.com/youruser/cache-explorer.git
cd cache-explorer
./scripts/build.sh

# Start backend server
cd backend/server && npm install && npm start

# Start frontend (new terminal)
cd frontend && npm install && npm run dev

# Open http://localhost:5173
```

### CLI Tool

```bash
# Analyze a source file
./backend/scripts/cache-explore matrix.c

# With options
./backend/scripts/cache-explore matrix.c --config amd -O2 --json

# Compare across hardware configs
./backend/scripts/cache-explore compare matrix.c --configs intel,amd,apple

# Generate HTML report
./backend/scripts/cache-explore report matrix.c -o report.html

# Build system integration
./backend/scripts/cache-explore cmake /path/to/project
./backend/scripts/cache-explore make my_target --run ./my_binary
```

## Screenshots

| Web Interface | Cache Grid | False Sharing |
|--------------|------------|---------------|
| ![Web UI](docs/images/web-ui.png) | ![Cache Grid](docs/images/cache-grid.png) | ![False Sharing](docs/images/false-sharing.png) |

## How It Works

LLVM compiler instrumentation (same approach as AddressSanitizer):

```
Your Code → Clang + CacheProfiler.so → Instrumented Binary (2-5x overhead)
                                              ↓
                                    Runtime library tracks accesses
                                              ↓
                                    Cache simulator (L1d/L1i/L2/L3)
                                              ↓
                                    WebSocket → Real-time visualization
```

## Hardware Presets

| Vendor | Presets |
|--------|---------|
| Intel | 12th Gen, 14th Gen, Xeon |
| AMD | Zen 3, Zen 4, EPYC |
| Apple | M1, M2, M3 |
| ARM | AWS Graviton 3, Raspberry Pi 4, Embedded |
| Other | Educational (tiny caches), Custom |

## Example: Row vs Column Major

```c
// Bad: column-major access (cache unfriendly)
for (int j = 0; j < N; j++)
    for (int i = 0; i < N; i++)
        matrix[i][j] = 0;  // ❌ L1 hit rate: 87%

// Good: row-major access (cache friendly)
for (int i = 0; i < N; i++)
    for (int j = 0; j < N; j++)
        matrix[i][j] = 0;  // ✅ L1 hit rate: 99%
```

Cache Explorer shows you *why* this matters with real numbers.

## CLI Commands

| Command | Description |
|---------|-------------|
| `cache-explore <source>` | Compile and analyze a source file |
| `cache-explore run <binary>` | Analyze pre-built instrumented binary |
| `cache-explore compare <source>` | Compare across hardware configs |
| `cache-explore report <source> -o out.html` | Generate HTML report |
| `cache-explore cmake <path>` | Configure CMake project |
| `cache-explore make [target]` | Build with Makefile |
| `cache-explore cc` / `c++` | Drop-in compiler wrappers |

## Building from Source

**Prerequisites:**
- LLVM/Clang 18+ (with pass plugin support)
- CMake 3.20+
- Ninja
- Node.js 18+

```bash
# macOS
brew install llvm cmake ninja node

# Build everything
./scripts/build.sh

# Run tests
cd backend/cache-simulator/build && ctest
```

## Project Structure

```
cache-explorer/
├── backend/
│   ├── llvm-pass/          # LLVM instrumentation pass
│   ├── runtime/            # C runtime library
│   ├── cache-simulator/    # Cache model (C++)
│   ├── server/             # WebSocket server (Node.js)
│   └── scripts/            # CLI tools
├── frontend/               # React + TypeScript + Monaco
├── examples/               # Educational code samples
└── docs/                   # Documentation
```

## Use Cases

**Learning**: Understand how CPU caches work with visual feedback

**Debugging**: Find cache thrashing, false sharing, poor locality

**Optimization**: Profile before/after, validate improvements

**Teaching**: Interactive demos for computer architecture courses

## Documentation

- [Quick Start Guide](docs/QUICK_START.md)
- [How to Read Results](docs/HOW_TO_READ_RESULTS.md)
- [Cache Optimization Patterns](docs/OPTIMIZATION_PATTERNS.md)
- [Roadmap](ROADMAP.md)

## Contributing

We welcome contributions! Areas where help is needed:

- Additional hardware profiles (RISC-V, older architectures)
- Educational examples
- Documentation improvements
- Testing and bug reports

## Acknowledgments

Inspired by [Compiler Explorer](https://godbolt.org) and the need to make cache behavior as accessible as assembly output.

## License

MIT - see [LICENSE](LICENSE)

---

*Making CPU cache hierarchies understandable*
