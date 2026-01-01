# Cache Explorer User Guide

A complete guide to understanding and using Cache Explorer for cache performance analysis.

## What is Cache Explorer?

Cache Explorer is a visual cache profiler that shows how your code interacts with CPU cache hierarchies. Think of it as "Compiler Explorer for cache behavior" - you paste code, instantly see cache hits/misses with source-level attribution, and learn optimization techniques.

**Key capabilities:**
- See exactly which lines cause cache misses
- Visualize cache state changes over time
- Compare different access patterns
- Get actionable optimization suggestions
- Test "what if" scenarios with different hardware configs

## When to Use Cache Explorer

### Learning (Primary Use Case)
- Understanding why row-major vs column-major access matters
- Seeing the impact of data structure layout (AoS vs SoA)
- Learning about cache blocking and loop optimization
- Visualizing false sharing in multi-threaded code

### Debugging Performance Issues
- Finding unexpected cache miss hotspots
- Understanding why a "fast" algorithm is slow
- Comparing before/after optimization

### Architecture Exploration
- Testing code against different cache configurations
- Comparing Intel vs AMD vs Apple Silicon cache behavior
- Understanding working set size effects

## Understanding the Results

### Summary Panel

The summary shows overall cache performance:

```
L1 Data    L2 Unified    L3 Shared
98.5%      99.2%         99.8%
```

These are **hit rates** - higher is better:
- **95%+** Excellent - code has good cache locality
- **80-95%** Good - some optimization possible
- **60-80%** Fair - significant optimization potential
- **<60%** Poor - cache-unfriendly access patterns

### Cache Hierarchy

When you run analysis, you'll see the cache hierarchy:

```
L1 (32KB, 8-way)  →  L2 (256KB, 4-way)  →  L3 (8MB, 16-way)  →  Memory
    ~4 cycles            ~12 cycles           ~40 cycles          ~200 cycles
```

Each level is:
- **Faster** but **smaller** than the next
- A cache **hit** means data was found at that level
- A cache **miss** means we had to check the next level

### Hot Lines Table

Shows which source lines cause the most cache activity:

| Line | Hits | Misses | Miss Rate |
|------|------|--------|-----------|
| 42   | 1000 | 50     | 4.8%      |
| 15   | 500  | 200    | 28.6%     |

**Focus on lines with high miss rates AND high miss counts.** A 100% miss rate on 1 access is fine; 50% miss rate on 10,000 accesses is a problem.

### Cache Grid Visualization

The interactive grid shows L1 cache state:
- Each **row** is a cache set
- Each **column** is a way (slot in the set)
- **Color intensity** shows recency (brighter = more recent)
- Use the **timeline scrubber** to step through execution

### Optimization Suggestions

Cache Explorer analyzes patterns and suggests fixes:

- **HIGH severity** (red): Major performance issue
- **MEDIUM severity** (yellow): Noticeable impact
- **LOW severity** (blue): Minor optimization opportunity

Each suggestion includes:
- The problem location (file:line)
- What's wrong
- How to fix it

## Common Patterns and Fixes

### 1. Sequential vs Strided Access

**Problem:** Accessing array elements with large strides

```c
// Bad: stride of 64 elements (256 bytes)
for (int i = 0; i < N; i++) {
    sum += arr[i * 64];
}

// Good: sequential access
for (int i = 0; i < N; i++) {
    sum += arr[i];
}
```

### 2. Row-Major vs Column-Major

**Problem:** Traversing 2D arrays in the wrong order

```c
// Bad: column-major access in C (row-major language)
for (int j = 0; j < cols; j++) {
    for (int i = 0; i < rows; i++) {
        matrix[i][j] = 0;  // Jumps 'cols' elements each access
    }
}

// Good: row-major access
for (int i = 0; i < rows; i++) {
    for (int j = 0; j < cols; j++) {
        matrix[i][j] = 0;  // Sequential access
    }
}
```

### 3. Array of Structs vs Struct of Arrays

**Problem:** Loading unused fields into cache

```c
// Bad: If you only access 'x', you also load y, z, velocity, etc.
struct Particle { float x, y, z; float vx, vy, vz; };
struct Particle particles[N];
for (int i = 0; i < N; i++) sum += particles[i].x;

// Good: Only load what you need
struct Particles {
    float x[N], y[N], z[N];
    float vx[N], vy[N], vz[N];
};
for (int i = 0; i < N; i++) sum += particles.x[i];
```

### 4. Cache Blocking (Tiling)

**Problem:** Working set exceeds cache size

```c
// Bad: Inner loop touches all of B column
for (int i = 0; i < N; i++)
    for (int j = 0; j < N; j++)
        for (int k = 0; k < N; k++)
            C[i][j] += A[i][k] * B[k][j];

// Good: Process in cache-sized blocks
for (int ii = 0; ii < N; ii += BLOCK)
    for (int jj = 0; jj < N; jj += BLOCK)
        for (int kk = 0; kk < N; kk += BLOCK)
            for (int i = ii; i < ii+BLOCK; i++)
                for (int j = jj; j < jj+BLOCK; j++)
                    for (int k = kk; k < kk+BLOCK; k++)
                        C[i][j] += A[i][k] * B[k][j];
```

### 5. False Sharing (Multi-threaded)

**Problem:** Different threads writing to same cache line

```c
// Bad: counter1 and counter2 on same cache line
struct { int counter1; int counter2; } shared;

// Thread 1: shared.counter1++  // Invalidates Thread 2's cache
// Thread 2: shared.counter2++  // Invalidates Thread 1's cache

// Good: Pad to separate cache lines
struct {
    int counter1;
    char padding[60];  // Pad to 64-byte cache line
    int counter2;
} shared;
```

## Hardware Configurations

Cache Explorer includes 14+ presets for common processors:

| Config | L1d | L2 | L3 | Prefetch Model |
|--------|-----|----|----|----------------|
| `educational` | 4KB | 32KB | 256KB | None |
| `intel` | 32KB | 256KB | 8MB | Stream + adjacent line |
| `intel12` | 48KB | 1.25MB | 30MB | Stream + stride |
| `intel14` | 48KB | 2MB | 36MB | Stream + stride |
| `xeon` | 32KB | 1MB | 35MB | Stream + adjacent line |
| `xeon8488c` | 48KB | 2MB | 96MB | Stream + stride + adjacent |
| `amd` | 32KB | 512KB | 32MB | L1+L2 only (L3 victim cache) |
| `zen3` | 32KB | 512KB | 32MB | L1+L2 only |
| `zen4` | 32KB | 1MB | 32MB | L1+L2 only |
| `epyc` | 32KB | 512KB | 256MB | L1+L2 only |
| `apple` | 128KB | 4MB | Shared | DMP (pointer prefetch) |
| `apple_m2` | 128KB | 16MB | Shared | DMP |
| `apple_m3` | 128KB | 16MB | Shared | DMP |
| `graviton3` | 64KB | 1MB | 32MB | Standard stream |
| `rpi4` | 32KB | 1MB | None | Basic stream |
| `embedded` | 16KB | 64KB | None | None |

Each preset includes vendor-accurate cache sizes, associativity, and prefetch behavior. Use `--config <name>` in CLI or select from the Config panel in the web UI.

## Tips for Effective Analysis

1. **Start with small examples** - The cache grid is most useful with small working sets
2. **Use the timeline scrubber** - Step through to see exactly when misses occur
3. **Compare configurations** - Same code can behave differently on different hardware
4. **Check the suggestions** - They often point directly to the problem
5. **Iterate** - Make one change, re-run, see the improvement

## Keyboard Shortcuts (Web UI)

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Open command palette |
| `Cmd+R` | Run analysis |
| `Cmd+S` | Share/copy link |
| `>` in palette | Filter to examples |
| `:` in palette | Filter to settings |
| `@` in palette | Filter to actions |
| `*` in palette | Filter to config |

## Simulation Accuracy

Cache Explorer is validated against real hardware using Linux `perf` performance counters.

**Achieved Accuracy** (Intel Xeon Platinum 8488C):

| Cache Level | Average Delta | Max Delta | Status |
|-------------|---------------|-----------|--------|
| L1 Data | ±4.6% | 8.2% | Within ±5% target |
| L2 | ±9.3% | 22.7% | Within ±10% target (avg) |

At ±5% L1 accuracy, you can:
- Trust that simulated improvements translate to real hardware
- Restructure code based on simulator feedback
- Compare different algorithms' cache behavior

See [VALIDATION.md](VALIDATION.md) for detailed methodology and per-benchmark results.

## Limitations

Cache Explorer is a **simulation**, not hardware measurement:

- **Timing is approximate** - Real cache latencies vary with frequency, contention
- **Prefetching is simplified** - Hardware prefetchers use smart backoff; simulation uses fixed degree
- **TLB not modeled** - Translation lookaside buffer effects not included
- **Bandwidth not modeled** - Memory controller contention not simulated
- **L3/LLC counters not available on cloud** - EC2 virtualization blocks LLC perf counters

For production profiling, validate with hardware counters (`perf stat`, VTune).

## Getting Help

- **Examples**: Load built-in examples from the command palette (`>`)
- **Documentation**: See `docs/OPTIMIZATION_PATTERNS.md` for detailed patterns
- **Issues**: Report bugs at [GitHub Issues](https://github.com/you/cache-explorer/issues)
