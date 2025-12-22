# Cache Explorer LLVM Pass

An LLVM instrumentation pass that tracks memory load and store operations for cache profiling.

## Overview

This pass instruments LLVM IR to insert tracking calls before every memory load and store operation, capturing:
- Memory address
- Access size (in bytes)
- Source file and line number

The instrumented program calls into a runtime library that can log events, buffer them, or feed them to a cache simulator.

## Prerequisites

- LLVM/Clang 15+ (tested with LLVM 21)
- CMake 3.20+
- C++17 compiler

## Building the Pass

```bash
# From the llvm-pass directory
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

This creates `build/CacheProfiler.so`, the LLVM pass plugin.

## Using the Pass

### Step-by-Step: Instrumenting and Running a Program

#### 1. Create a test program

```c
// test.c
#include <stdio.h>

int main(int argc, char** argv) {
    int arr[100];

    // Store values
    for (int i = 0; i < argc + 10; i++) {
        arr[i] = i;
    }

    // Load values
    int sum = 0;
    for (int i = 0; i < argc + 10; i++) {
        sum += arr[i];
    }

    printf("Sum: %d\n", sum);
    return 0;
}
```

#### 2. Compile to LLVM IR

```bash
clang -O1 -g test.c -S -emit-llvm -o test.ll
```

**Important flags:**
- `-O1`: Enable optimization (required to avoid `optnone` attribute that skips passes)
- `-g`: Include debug info for source file/line attribution
- `-S -emit-llvm`: Output LLVM IR instead of machine code

#### 3. Run the instrumentation pass

```bash
opt -load-pass-plugin=./build/CacheProfiler.so \
    -passes="function(cache-explorer)" \
    test.ll -S -o test_instrumented.ll
```

This inserts calls to `__tag_mem_load()` and `__tag_mem_store()` before memory operations.

#### 4. Verify instrumentation (optional)

```bash
# Count instrumentation calls
grep "call.*__tag_mem" test_instrumented.ll | wc -l

# See the actual calls
grep -B 2 "call.*__tag_mem" test_instrumented.ll | head -20
```

#### 5. Compile instrumented IR to assembly

```bash
llc test_instrumented.ll -o test_instrumented.s
```

#### 6. Link with runtime library

```bash
clang test_instrumented.s ../runtime/cache-explorer-rt.c -o test_final
```

#### 7. Run the instrumented program

```bash
./test_final
```

**Example output:**
```
STORE: 0x16d62a438 [4 bytes] at test.c:8
STORE: 0x16d62a43c [4 bytes] at test.c:8
STORE: 0x16d62a440 [4 bytes] at test.c:8
...
LOAD: 0x16d62a438 [4 bytes] at test.c:13
LOAD: 0x16d62a43c [4 bytes] at test.c:13
LOAD: 0x16d62a440 [4 bytes] at test.c:13
...
Sum: 55
```

## Quick Commands Reference

```bash
# All-in-one: compile, instrument, and run
clang -O1 -g test.c -S -emit-llvm -o test.ll && \
opt -load-pass-plugin=./build/CacheProfiler.so -passes="function(cache-explorer)" test.ll -S -o test_instrumented.ll && \
llc test_instrumented.ll -o test_instrumented.s && \
clang test_instrumented.s ../runtime/cache-explorer-rt.c -o test_final && \
./test_final
```

## Understanding the Output

Each instrumentation call shows:
- **Operation**: `LOAD` or `STORE`
- **Address**: Memory address being accessed (e.g., `0x16d62a438`)
- **Size**: Number of bytes (4 for `int`, 8 for `double`, etc.)
- **Location**: Source file and line number (e.g., `test.c:8`)

**Example:**
```
STORE: 0x16d62a438 [4 bytes] at test.c:8
```
Means: A 4-byte store operation at address `0x16d62a438`, from line 8 of `test.c`.

## Common Issues

### Pass doesn't instrument anything

**Cause:** Code compiled with `-O0` has `optnone` attribute, which skips optimization passes.

**Solution:** Use `-O1` or higher when compiling to LLVM IR.

### No debug info in output (`<unknown>:0`)

**Cause:** Code wasn't compiled with debug symbols.

**Solution:** Always use `-g` flag when compiling to IR.

### All memory operations optimized away

**Cause:** Optimizer constant-folded your code.

**Solution:** Use runtime values (like `argc`) to prevent optimization:

```c
// BAD: Will be optimized away
int x = 42;
int y = x + 1;

// GOOD: Uses argc, can't be optimized
int x = argc;
int y = x + 1;
```

## Runtime Library

The current runtime (`../runtime/cache-explorer-rt.c`) simply prints events to stdout.

For production use, you can:
1. **Buffer events** to a circular buffer
2. **Write to file** for offline analysis
3. **Feed to cache simulator** via shared memory or direct calls
4. **Stream to server** via WebSocket for real-time visualization

See `../runtime/` for examples and implementation.

## Pass Implementation Details

For a detailed walkthrough of how the pass works internally, see [PASS_WALKTHRU.md](./PASS_WALKTHRU.md).

## Integration with Cache Simulator

The instrumented events are ready to feed into a cache simulator. The recommended flow:

```
Instrumented Binary → Runtime Library → Event Buffer → Cache Simulator → Visualization
```

See the main project README for details on the full cache profiling pipeline.

## Troubleshooting

### `opt: unknown function pass 'cache-explorer'`

You must use the full pipeline syntax: `function(cache-explorer)` not just `cache-explorer`.

### `clang: error: unknown argument`

Different LLVM versions have different pass loading syntax. We use the new pass manager syntax (`-load-pass-plugin`).

### Segfault when running instrumented binary

Make sure you're linking with the runtime library (`cache-explorer-rt.c`), which provides the `__tag_mem_load/store` implementations.

## Examples

The `test.c` and `test2.c` files show simple examples. More complex examples:

### Matrix Multiplication (Cache-Friendly vs Cache-Hostile)

```c
// Row-major (cache-friendly)
for (int i = 0; i < N; i++)
    for (int j = 0; j < N; j++)
        C[i][j] = A[i][j] + B[i][j];

// Column-major (cache-hostile)
for (int j = 0; j < N; j++)
    for (int i = 0; i < N; i++)
        C[i][j] = A[i][j] + B[i][j];
```

Instrument both and compare cache behavior!

## Development

**Rebuilding after changes:**
```bash
cmake --build build --clean-first
```

**Testing with verbose output:**
```bash
opt -load-pass-plugin=./build/CacheProfiler.so \
    -passes="function(cache-explorer)" \
    -debug-pass-manager \
    test.ll -S -o test_instrumented.ll
```

## License

Part of the Cache Explorer project.
