# Hardware Explorer Preview: Quick Start Guide

Get the local-first CPU performance modeling workbench running in 5 minutes.

## Prerequisites

- **macOS** (ARM64/Intel) or **Linux** (x86_64)
- **LLVM/Clang 17-21** (LLVM 18 recommended)
- **CMake 3.20+**
- **Node.js 20.19+ or 22.12+** (for the web UI)

## Installation

```bash
# Clone the repository
git clone https://github.com/AveryClapp/Cache-Explorer.git
cd cache-explorer

# Check your local toolchain, then start the product
./scripts/doctor.sh
./scripts/dev.sh
```

`./scripts/dev.sh` builds missing native artifacts, installs Node
dependencies when needed, and prints the frontend URL.

For a build-only path:

```bash
./scripts/build.sh
```

This writes native artifacts under `build/backend/`.

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

The JSON includes cache levels plus Hardware Explorer fields:
- `profile`: selected hardware profile metadata
- `summary`: primary bottleneck, estimated cycles, confidence, and top source
- `subsystems.execution`: estimated IPC/CPI, memory/frontend/branch stalls
- `sourceAnnotations`: ranked source lines with subsystem labels

### Real-Time Streaming

```bash
# Stream events as they happen (for integration)
./backend/scripts/cache-explore your_code.c --stream
```

### Hardware Presets

Each profile combines published CPU cache metadata with modeled prefetch
behavior. Treat cross-profile results as directional unless its trust packet
shows captured calibration evidence:

```bash
# List profile IDs before scripting compare/experiment runs
./backend/scripts/cache-explore profiles --ids

# Intel 12th Gen (default)
./backend/scripts/cache-explore code.c --config intel

# Intel Xeon (historical narrow cache evidence; inspect the trust packet)
./backend/scripts/cache-explore code.c --config xeon8488c

# AMD Zen 4
./backend/scripts/cache-explore code.c --config zen4

# Apple M-Series (with DMP - data-dependent prefetch)
./backend/scripts/cache-explore code.c --config apple

# Educational (smaller caches, easier to understand)
./backend/scripts/cache-explore code.c --config educational
```

`--hardware <name>` is also accepted as an alias for `--config <name>`.

14+ presets available: `intel`, `intel12`, `intel14`, `xeon`, `xeon8488c`, `amd`, `zen3`, `zen4`, `epyc`, `apple`, `apple_m2`, `apple_m3`, `graviton3`, `rpi4`, `embedded`, `educational`

### Hardware Explorer Kernel Experiment

Use the Conv2D example for a realistic single-kernel experiment:

```bash
# Direct traversal on one hardware profile
./backend/scripts/cache-explore examples/conv2d_kernel.c -O2 --hardware intel14 --json

# Tiled traversal on the same profile
./backend/scripts/cache-explore examples/conv2d_kernel.c -O2 -D RUN_TILED=1 --hardware intel14 --json

# Compile and trace once, then replay the trace across profiles
./backend/scripts/cache-explore compare examples/conv2d_kernel.c -O2 --configs educational,intel14,zen4,m3
```

For interactive experiments, add `--limit 200000` to cap trace size while still exercising the pipeline and bottleneck summaries.

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
./scripts/dev.sh
```

### Using the Web UI

1. Open the frontend URL printed by `./scripts/dev.sh`
2. Paste your C/C++ code in the editor
3. Select language (C or C++)
4. Choose optimization level (-O0, -O1, -O2, -O3)
5. Select hardware preset (Intel, AMD, Apple, Educational)
6. Click "Execute"
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

Hardware Explorer provides actionable suggestions:

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

## Model Confidence

The historical Intel Xeon measurements in [VALIDATION.md](VALIDATION.md) are a
narrow reference, not a blanket accuracy guarantee. Default Intel, AMD, and
Apple profiles remain Preview models until their checked-in evidence packets
contain reproducible captures instead of placeholders.

## Next Steps

- Check out `examples/` for more sample code
- Read the [User Guide](USER_GUIDE.md) for detailed usage
- See [VALIDATION.md](VALIDATION.md) for hardware validation results

## Getting Help

- Issues: https://github.com/AveryClapp/Cache-Explorer/issues
- Discussions: https://github.com/AveryClapp/Cache-Explorer/discussions
