# Cache Explorer: Quick Start Guide

Get up and running with Cache Explorer in 5 minutes.

## Prerequisites

- **macOS** (ARM64/Intel) or **Linux** (x86_64)
- **LLVM/Clang 15+** (`brew install llvm` on macOS)
- **CMake 3.20+**
- **Node.js 18+** (for web UI)

## Installation

```bash
# Clone the repository
git clone https://github.com/you/cache-explorer.git
cd cache-explorer

# Build everything
./scripts/build.sh
```

This builds:
- `backend/llvm-pass/build/CacheProfiler.so` - LLVM instrumentation pass
- `backend/runtime/build/libcache-explorer-rt.a` - Runtime library
- `backend/cache-simulator/build/cache-sim` - Cache simulator

## CLI Usage

### Basic Usage

```bash
# Analyze a C file
./backend/scripts/cache-explore your_code.c

# With optimization level
./backend/scripts/cache-explore your_code.c -O2

# C++ files
./backend/scripts/cache-explore your_code.cpp
```

### Output Example

```
=== Cache Simulation Results ===
Config: intel
Events: 1523

Level     Hits       Misses     Hit Rate   Writebacks
-------   --------   --------   --------   ----------
L1d       1489       34         97.8%      12
L1i       502        3          99.4%      0
L2        10         27         27.0%      5
L3        8          19         29.6%      0

=== Hottest Lines ===
matrix.c:15 - 18 misses
matrix.c:12 - 9 misses
matrix.c:8 - 7 misses
```

### JSON Output

```bash
# Get JSON for programmatic use
./backend/scripts/cache-explore your_code.c --json
```

### Real-Time Streaming

```bash
# Stream events as they happen (for integration)
./backend/scripts/cache-explore your_code.c --stream
```

### Hardware Presets

Each preset includes vendor-accurate cache specs and prefetch behavior:

```bash
# Intel 12th Gen (default)
./backend/scripts/cache-explore code.c --config intel

# Intel Xeon (validated against real hardware)
./backend/scripts/cache-explore code.c --config xeon8488c

# AMD Zen 4
./backend/scripts/cache-explore code.c --config zen4

# Apple M-Series (with DMP - data-dependent prefetch)
./backend/scripts/cache-explore code.c --config apple

# Educational (smaller caches, easier to understand)
./backend/scripts/cache-explore code.c --config educational
```

14+ presets available: `intel`, `intel12`, `intel14`, `xeon`, `xeon8488c`, `amd`, `zen3`, `zen4`, `epyc`, `apple`, `apple_m2`, `apple_m3`, `graviton3`, `rpi4`, `embedded`, `educational`

### Preprocessor Defines

```bash
# Define constants
./backend/scripts/cache-explore matrix.c -D N=1000 -D M=1000
```

### Performance Options

For large programs, use sampling and limits to prevent timeouts:

```bash
# Sample 1% of events (100x faster)
./backend/scripts/cache-explore large_program.c --sample 100

# Limit to 1 million events max
./backend/scripts/cache-explore large_program.c --limit 1000000

# Both together for very large programs
./backend/scripts/cache-explore large_program.c --sample 100 --limit 100000
```

### Hardware Prefetching

Simulate different prefetching strategies:

```bash
# No prefetching (shows raw cache behavior)
./backend/scripts/cache-explore code.c --prefetch none

# Next-line prefetcher (simple)
./backend/scripts/cache-explore code.c --prefetch next

# Stream prefetcher (Intel-style)
./backend/scripts/cache-explore code.c --prefetch stream

# Stride prefetcher
./backend/scripts/cache-explore code.c --prefetch stride

# Adaptive (combines stream + stride)
./backend/scripts/cache-explore code.c --prefetch adaptive
```

## Web UI Usage

### Start the Server

```bash
# Terminal 1: Start backend
cd backend/server
npm install
npm start
# Server runs at http://localhost:3001

# Terminal 2: Start frontend
cd frontend
npm install
npm run dev
# UI runs at http://localhost:5173
```

### Using the Web UI

1. Open http://localhost:5173
2. Paste your C/C++ code in the editor
3. Select language (C or C++)
4. Choose optimization level (-O0, -O1, -O2, -O3)
5. Select hardware preset (Intel, AMD, Apple, Educational)
6. Click "Run"
7. View results:
   - Cache hit rates per level
   - Hottest source lines
   - Optimization suggestions

## Understanding Results

### Cache Levels

| Level | Description | Typical Size |
|-------|-------------|--------------|
| L1d | Data cache (per-core) | 32-64 KB |
| L1i | Instruction cache (per-core) | 32-64 KB |
| L2 | Unified cache (per-core) | 256-512 KB |
| L3 | Shared cache (all cores) | 8-32 MB |

### Hit Rate Interpretation

| Hit Rate | Interpretation |
|----------|----------------|
| >95% | Excellent - well-optimized |
| 80-95% | Good - minor optimization possible |
| 50-80% | Poor - significant cache misses |
| <50% | Very Poor - cache thrashing likely |

### Optimization Suggestions

Cache Explorer provides actionable suggestions:

- **Loop Tiling** - Break large loops into cache-friendly blocks
- **Data Layout** - Use arrays instead of linked structures
- **Access Pattern** - Change from column-major to row-major
- **False Sharing** - Add padding between thread-local variables

## Example: Matrix Multiply

Create `matrix.c`:

```c
#define N 64

int main() {
    int A[N][N], B[N][N], C[N][N];

    // Initialize
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++) {
            A[i][j] = i + j;
            B[i][j] = i - j;
            C[i][j] = 0;
        }

    // Multiply (row-major access)
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            for (int k = 0; k < N; k++)
                C[i][j] += A[i][k] * B[k][j];

    return C[0][0];
}
```

Run analysis:

```bash
./backend/scripts/cache-explore matrix.c --config educational
```

## Troubleshooting

### "LLVM pass not built"

```bash
# Rebuild the LLVM pass
cd backend/llvm-pass
mkdir -p build && cd build
cmake ..
make
```

### "Runtime not built"

```bash
# Rebuild the runtime
cd backend/runtime
mkdir -p build && cd build
cmake ..
make
```

### "clang: error: unable to load plugin"

Make sure you're using the correct LLVM version:

```bash
# Check LLVM version
llvm-config --version

# On macOS with Homebrew LLVM
export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
```

### Slow Compilation with C++/STL

By default, STL is filtered for faster compilation. To include STL analysis:

```bash
CACHE_EXPLORER_INCLUDE_STL=1 ./backend/scripts/cache-explore code.cpp
```

## Simulation Accuracy

Cache Explorer is validated against real Intel Xeon hardware with ±4.6% L1 and ±9.3% L2 accuracy.
See [VALIDATION.md](VALIDATION.md) for methodology and detailed results.

## Next Steps

- Check out `examples/` for more sample code
- Read the [User Guide](USER_GUIDE.md) for detailed usage
- See [VALIDATION.md](VALIDATION.md) for hardware validation results

## Getting Help

- Issues: https://github.com/you/cache-explorer/issues
- Discussions: https://github.com/you/cache-explorer/discussions
