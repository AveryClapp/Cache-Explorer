# Cache Explorer User Guide

A complete guide to understanding and using Cache Explorer for cache performance analysis.

## Table of Contents

1. [What is Cache Explorer?](#what-is-cache-explorer)
2. [Getting Started](#getting-started)
   - [Web UI Quick Start](#web-ui-quick-start)
   - [CLI Quick Start](#cli-quick-start)
3. [Understanding the Visualization](#understanding-the-visualization)
   - [Timeline View](#timeline-view)
   - [Cache State Grid](#cache-state-grid)
   - [Source Annotations](#source-annotations)
4. [Interpreting Results](#interpreting-results)
   - [Hit Rates](#hit-rates)
   - [Miss Patterns](#miss-patterns)
   - [3C Miss Classification](#3c-miss-classification)
5. [Common Workflows](#common-workflows)
   - [Profiling a New Codebase](#profiling-a-new-codebase)
   - [Optimization Iteration](#optimization-iteration)
   - [Comparing Configurations](#comparing-configurations)
6. [Hardware Configurations](#hardware-configurations)
7. [When to Use Cache Explorer](#when-to-use-cache-explorer)
8. [Limitations](#limitations)

---

## What is Cache Explorer?

Cache Explorer is a visual cache profiler that shows how your code interacts with CPU cache hierarchies. Think of it as "Compiler Explorer for cache behavior" - you paste code, instantly see cache hits/misses with source-level attribution, and learn optimization techniques.

**Key capabilities:**
- See exactly which lines cause cache misses
- Visualize cache state changes over time
- Compare different access patterns
- Get actionable optimization suggestions
- Test "what if" scenarios with different hardware configs
- Detect false sharing in multi-threaded code
- Simulate different CPU architectures (Intel, AMD, Apple Silicon, ARM)

---

## Getting Started

### Web UI Quick Start

The web UI is the fastest way to explore cache behavior interactively.

**1. Start the servers:**

```bash
# Terminal 1: Backend server
cd backend/server
npm install
npm start
# Runs at http://localhost:3001

# Terminal 2: Frontend
cd frontend
npm install
npm run dev
# Runs at http://localhost:5173
```

**2. Open your browser** to http://localhost:5173

**3. Write or paste code** in the Monaco editor:

```c
#define N 128
int main() {
    int arr[N][N];
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            arr[i][j] = i + j;
    return 0;
}
```

**4. Configure your analysis:**
- **Language**: C or C++
- **Optimization**: -O0 through -O3
- **Config**: Hardware preset (Intel, AMD, Apple, Educational)
- **Prefetch**: Prefetching strategy (none, stream, stride, adaptive)

**5. Click "Run"** and view results in real-time.

**Web UI Features:**
- **Dark/Light Mode**: Toggle in settings, persists across sessions
- **Command Palette**: Press `Cmd+K` (Mac) or `Ctrl+K` (Windows/Linux)
- **Examples Gallery**: Type `>` in command palette to browse examples
- **Share URLs**: Get a compressed link to share your code
- **Source Annotations**: Hover over highlighted lines for miss details

### CLI Quick Start

The CLI is ideal for scripting, CI integration, and profiling local files.

**Basic usage:**

```bash
# Analyze a C file with default settings (Intel config)
./backend/scripts/cache-explore mycode.c

# Analyze C++ with optimization
./backend/scripts/cache-explore mycode.cpp -O2

# Get JSON output for programmatic use
./backend/scripts/cache-explore mycode.c --json
```

**With hardware presets:**

```bash
# Educational (small caches, easier to understand)
./backend/scripts/cache-explore code.c --config educational

# Intel 12th Gen
./backend/scripts/cache-explore code.c --config intel12

# AMD Zen 4
./backend/scripts/cache-explore code.c --config zen4

# Apple M-Series with DMP
./backend/scripts/cache-explore code.c --config apple
```

**With prefetching:**

```bash
# No prefetching (raw cache behavior)
./backend/scripts/cache-explore code.c --prefetch none

# Stream prefetcher (Intel-style)
./backend/scripts/cache-explore code.c --prefetch stream

# Stride detector
./backend/scripts/cache-explore code.c --prefetch stride

# Adaptive (stream + stride combined)
./backend/scripts/cache-explore code.c --prefetch adaptive
```

**Performance options for large programs:**

```bash
# Sample 1 in 100 events (faster)
./backend/scripts/cache-explore large.c --sample 100

# Limit total events
./backend/scripts/cache-explore large.c --limit 1000000

# Define constants
./backend/scripts/cache-explore matrix.c -D N=1000
```

**Example CLI output:**

```
=== Cache Simulation Results ===
Config: intel
Events: 16,384

Level     Hits       Misses     Hit Rate   Writebacks
-------   --------   --------   --------   ----------
L1d       15,872     512        96.9%      128
L1i       4,096      16         99.6%      0
L2        384        128        75.0%      64
L3        96         32         75.0%      0

=== Hottest Lines ===
matrix.c:15 - 256 misses (50.0%)
matrix.c:12 - 128 misses (25.0%)
matrix.c:8  - 64 misses  (12.5%)

=== Suggestions ===
[HIGH] poor_locality at matrix.c:15
  Column-major access pattern detected
  Fix: Swap loop order for row-major access
```

---

## Understanding the Visualization

### Timeline View

The timeline shows memory access patterns over time:

```
Time →
████████████░░░░░░████████████████░░████████
 ^-- L1 hits --^  ^misses^  ^-- hits --^  ^miss^
```

**Color coding:**
- **Green**: L1 cache hit (fastest, ~4 cycles)
- **Yellow**: L2 cache hit (~12 cycles)
- **Orange**: L3 cache hit (~40 cycles)
- **Red**: Memory access (~200+ cycles)

**What to look for:**
- **Solid green**: Excellent locality - data stays in cache
- **Periodic red spikes**: Working set exceeds cache size
- **Red at start, then green**: Normal cold-start misses
- **Random red throughout**: Poor spatial locality

**Using the timeline scrubber:**
1. Click and drag to select a time range
2. Use arrow keys to step through events one at a time
3. Observe the cache grid update in real-time
4. Correlate events with source lines (highlighted in editor)

### Cache State Grid

The cache grid visualizes the L1 data cache state:

```
Set 0:  [M][E][S][I]  ← 4-way associative (4 slots per set)
Set 1:  [S][S][I][I]
Set 2:  [E][I][I][I]
Set 3:  [M][M][S][I]
...
Set 63: [I][I][I][I]
```

**Grid layout:**
- **Rows**: Cache sets (determined by address bits)
- **Columns**: Ways (slots within each set)
- **Cell color**: MESI coherence state

**MESI state colors:**

| Color | State | Meaning |
|-------|-------|---------|
| Red/Orange | Modified (M) | Data is dirty, only this cache has it |
| Green | Exclusive (E) | Data is clean, only this cache has it |
| Blue | Shared (S) | Data is clean, may be in other caches |
| Gray | Invalid (I) | Cache line is empty or invalidated |

**Hover information:**
- Tag bits (which memory address)
- Full address range
- Last access time
- Dirty/clean status

**Multi-core view:**
Use the **Core** dropdown to switch between cores and see how each core's private L1 cache differs. This helps visualize:
- Cache coherence behavior
- How threads share data
- False sharing patterns

### Source Annotations

The code editor shows inline performance hints:

```c
for (int i = 0; i < N; i++)
    for (int j = 0; j < N; j++)
        matrix[i][j] = i + j;  // [256 misses | 12.5% miss rate]
                               //  ↑ Click for details
```

**Annotation colors:**
- **Green background**: Good locality (<5% miss rate)
- **Yellow background**: Some misses (5-20% miss rate)
- **Red background**: High miss rate (>20%)

**Click on a highlighted line** to see:
- Total hits and misses
- Miss rate percentage
- Which cache levels were hit
- Optimization suggestions for this line

---

## Interpreting Results

### Hit Rates

The summary panel shows hit rates for each cache level:

```
L1 Data    L2 Unified    L3 Shared
98.5%      85.2%         95.8%
```

**Interpreting L1 hit rates:**

| Hit Rate | Interpretation | Action |
|----------|----------------|--------|
| >95% | Excellent | Code is well-optimized |
| 90-95% | Good | Minor optimization possible |
| 80-90% | Fair | Check hot lines for issues |
| 60-80% | Poor | Significant optimization needed |
| <60% | Very Poor | Major cache-unfriendly patterns |

**Understanding the hierarchy:**

L1 misses go to L2. L2 misses go to L3. L3 misses go to memory.

```
Total latency = L1_time + (L1_miss_rate * L2_time) +
                (L1_miss_rate * L2_miss_rate * L3_time) + ...
```

So a 95% L1 hit rate with 50% L2 hit rate is often better than 90% L1 with 90% L2.

### Miss Patterns

**Hot Lines Table:**

| Line | Hits | Misses | Miss Rate | Type |
|------|------|--------|-----------|------|
| 42 | 10,000 | 500 | 4.8% | Capacity |
| 15 | 1,000 | 400 | 28.6% | Conflict |
| 8 | 100 | 100 | 50.0% | Compulsory |

**Focus on:** Lines with **high miss counts AND high miss rates**

- High misses + low rate = Runs many times, mostly hits (good)
- Low misses + high rate = Cold path (usually fine)
- High misses + high rate = **Optimization target**

### 3C Miss Classification

Cache Explorer classifies misses into three categories:

**Compulsory (Cold) Misses:**
- First access to data that has never been in cache
- Cannot be eliminated (except through prefetching)
- Expected at program start and when touching new data

**Capacity Misses:**
- Data was in cache but evicted because cache was full
- Working set exceeds cache size
- Fix with: Loop tiling, smaller data structures, or algorithmic changes

**Conflict Misses:**
- Data was in cache but evicted due to set conflicts
- Multiple addresses map to same cache set
- Fix with: Data alignment, padding, or data structure reorganization

**Viewing in JSON output:**

```json
{
  "l1d": {
    "misses": 500,
    "compulsory": 50,
    "capacity": 300,
    "conflict": 150
  }
}
```

---

## Common Workflows

### Profiling a New Codebase

**Step 1: Start with educational config**
```bash
./backend/scripts/cache-explore code.c --config educational
```
Smaller caches make problems more obvious.

**Step 2: Identify hot lines**
Look at the "Hottest Lines" section. Focus on lines with:
- High miss counts (absolute impact)
- High miss rates (optimization potential)

**Step 3: Understand the pattern**
For each hot line, ask:
- Is this sequential or strided access?
- Is the working set too large?
- Are there unnecessary fields being loaded?

**Step 4: Switch to realistic config**
```bash
./backend/scripts/cache-explore code.c --config intel
```
Verify the pattern still matters on real hardware.

### Optimization Iteration

**Step 1: Baseline measurement**
```bash
./backend/scripts/cache-explore original.c --json > baseline.json
```

**Step 2: Make ONE change**
Common changes:
- Swap loop order
- Add cache blocking
- Change AoS to SoA
- Add padding for false sharing

**Step 3: Measure again**
```bash
./backend/scripts/cache-explore optimized.c --json > optimized.json
```

**Step 4: Compare results**
```bash
diff baseline.json optimized.json
```
Or use the web UI's split view.

**Step 5: Iterate**
If improvement is insufficient, try additional changes one at a time.

### Comparing Configurations

Test how code behaves on different architectures:

```bash
# Test on multiple configs
for config in educational intel zen4 apple; do
    echo "=== $config ==="
    ./backend/scripts/cache-explore code.c --config $config --json | jq '.levels.l1d.hitRate'
done
```

This helps answer:
- Will this optimization help on AMD?
- How does Apple's larger L1 affect behavior?
- What's the minimum cache size this code needs?

---

## Hardware Configurations

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

The cache grid shows the final state of the L1 data cache after execution:

**Grid Layout:**
- Each **row** is a cache set (typically 64 sets for a 32KB L1)
- Each **column** is a way (slot within the set)
- **Hover** over a cell to see the tag and state details

**MESI State Colors:**

| Color | State | Meaning |
|-------|-------|---------|
| Orange/Red | Modified (M) | Data is dirty, only this cache has it |
| Green | Exclusive (E) | Data is clean, only this cache has it |
| Blue | Shared (S) | Data is clean, may be in other caches |
| Gray | Invalid (I) | Cache line is empty or invalidated |

**Multi-Core Support:**
For simulations with multiple cores, use the **Core** dropdown above the grid to view each core's L1 cache. This is useful for visualizing cache coherence behavior and seeing how different threads use their private caches

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
