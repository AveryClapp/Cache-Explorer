# Hardware Explorer Preview CMake Integration

Hardware Explorer integrates with existing CMake projects through the compatible
`cache-explore` command in two ways:

1. **Toolchain file** — zero changes to your `CMakeLists.txt`, works with CTest
2. **`find_package`** — per-target control, explicit in your build system

---

## Quick Start

```bash
# Configure your project with Hardware Explorer instrumentation
cache-explore cmake /path/to/your/project

# Build
cd build-cache-explorer && make

# Run your binary and analyze
./your_binary 2>&1 | cache-sim --json --config intel
```

---

## Using with CTest

This is the zero-modification path. It works by injecting the LLVM pass as a
compiler flag via a CMake toolchain file — your `CMakeLists.txt` is untouched.

```bash
# Step 1: Configure
cache-explore cmake /path/to/your/project --build-dir build-prof

# Step 2: Build
cd build-prof && make

# Step 3: Run your full CTest suite and collect combined trace
ctest 2>&1 | cache-sim --json --config intel

# Or run a single test binary directly for isolated analysis
./tests/my_test 2>&1 | cache-sim --json
```

> **Note:** `ctest` runs all tests sequentially; their traces are merged into one
> analysis. For per-test breakdown, run each test binary individually.

---

## `find_package` Integration

For per-target control, add Hardware Explorer to your `CMakeLists.txt`:

```cmake
cmake_minimum_required(VERSION 3.16)
project(MyProject C CXX)

find_package(CacheExplorer REQUIRED
  PATHS /path/to/cache-explorer/backend/integration/cmake
)

add_executable(my_app src/main.cpp)

# Profile a specific target
cache_explorer_enable_target(my_app)

# Or profile the whole project
# cache_explorer_enable_project()

# Add a `make analyze-my_app` target
cache_explorer_add_analysis(my_app CONFIG intel JSON)
```

Then configure and build (LLVM Clang required — see Troubleshooting):

```bash
cmake -B build \
  -DCMAKE_C_COMPILER=/opt/homebrew/opt/llvm/bin/clang \
  -DCMAKE_CXX_COMPILER=/opt/homebrew/opt/llvm/bin/clang++ \
  -DCACHE_EXPLORER_PATH=/path/to/cache-explorer/backend .
cmake --build build
cmake --build build --target analyze-my_app
```

---

## Options Reference

| CMake Variable | Default | Description |
|---|---|---|
| `CACHE_EXPLORER_ENABLED` | `ON` | Enable/disable profiling without removing from CMakeLists |
| `CACHE_EXPLORER_PATH` | auto-detected | Path to the Hardware Explorer `backend/` directory |
| `CACHE_EXPLORER_PASS` | auto-detected | Path to `CacheProfiler.so` |
| `CACHE_EXPLORER_RUNTIME` | auto-detected | Path to `libcache-explorer-rt.a` |
| `CACHE_EXPLORER_INCLUDE_STL` | `OFF` | Include STL internals in profiling (slower) |

---

## Troubleshooting

### "Clang not found" or pass plugin fails to load

Hardware Explorer requires LLVM Clang with `-fpass-plugin` support. The toolchain
file (`cache-explore cmake`) sets this automatically. For `find_package`, set
the compiler explicitly:

```bash
# macOS — install via Homebrew
brew install llvm

cmake -B build \
  -DCMAKE_C_COMPILER=/opt/homebrew/opt/llvm/bin/clang \
  -DCMAKE_CXX_COMPILER=/opt/homebrew/opt/llvm/bin/clang++ \
  ...
```

### "CacheProfiler.so not found"

Build the LLVM pass first:

```bash
cd /path/to/cache-explorer/backend/llvm-pass
mkdir -p build && cd build
cmake .. -G Ninja -DLLVM_DIR=/opt/homebrew/opt/llvm/lib/cmake/llvm
ninja
```

### "libcache-explorer-rt.a not found"

Build the runtime library:

```bash
cd /path/to/cache-explorer/backend/runtime
mkdir -p build && cd build
cmake .. -G Ninja && ninja
```

### Binary produces no trace output

The runtime writes to `stderr`. Make sure you're capturing it:

```bash
# Correct — capture stderr
./my_binary 2>&1 | cache-sim --json

# Wrong — stdout only, trace is lost
./my_binary | cache-sim --json
```

---

## Example: Integrating with an Existing CTest Suite

Given a project structured like:

```
my-project/
├── CMakeLists.txt
├── src/
│   └── mylib.c
└── tests/
    ├── CMakeLists.txt
    └── test_mylib.c
```

No changes to `CMakeLists.txt` are required:

```bash
cache-explore cmake my-project/
cd build-cache-explorer && make
ctest --output-on-failure 2>&1 | cache-sim --json --config intel | jq '.levels.l1d.hitRate'
```

See `tests/cmake-integration/sample-project/` for a working example.
