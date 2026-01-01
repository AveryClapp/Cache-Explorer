# How to Read Cache Explorer Results

This guide explains what each part of the Cache Explorer output means and how to interpret the results to optimize your code.

## The Summary Panel

When you run code, you'll see a summary like this:

```
Events: 45,000 (sampled 1:1)
L1d: 98.5% hit rate (44,325 hits / 675 misses)
L2:  45.2% hit rate (305 hits / 370 misses)
L3:  89.0% hit rate (329 hits / 41 misses)
```

### What Each Number Means

**Events**: Total memory accesses tracked. This includes loads (reads), stores (writes), and instruction fetches.

**Hit Rate**: Percentage of accesses found in that cache level.
- **95%+ L1 hit rate**: Excellent - your data fits in L1
- **90-95% L1 hit rate**: Good - minor optimization possible
- **<90% L1 hit rate**: Poor - significant cache misses

**Hits/Misses**: Raw counts. More misses = more latency.

### Cache Hierarchy Flow

```
CPU Request → L1 (fastest, smallest)
                ↓ miss
             L2 (medium)
                ↓ miss
             L3 (larger, shared)
                ↓ miss
             Main Memory (slow!)
```

Each miss adds latency:
- L1 hit: ~4 cycles
- L2 hit: ~12 cycles
- L3 hit: ~40 cycles
- Memory: ~200+ cycles

## Hot Lines Table

```
Line    Misses   Miss Rate
12      450      67.2%
8       125      12.5%
15      50       5.0%
```

**Line**: Source code line number causing misses.

**Misses**: Absolute count of cache misses from this line.

**Miss Rate**: Percentage of accesses from this line that missed.

### Interpreting Hot Lines

1. **High misses + high miss rate**: This line has a fundamental cache problem (e.g., strided access, random access)

2. **High misses + low miss rate**: This line runs many times but is mostly cache-friendly. The misses are just compulsory (first access to data).

3. **Low misses + high miss rate**: This line doesn't run often, but when it does, it misses. May indicate cold code path.

## The Cache Grid Visualization

The interactive grid shows L1 cache state over time.

```
Set 0: [■][■][□][□]  ← 4-way associative
Set 1: [■][□][□][□]
Set 2: [□][□][□][□]
...
```

**Colors**:
- Empty (gray): Unused cache line
- Cold (blue): Not recently accessed
- Warm (yellow): Recently accessed
- Hot (red): Just accessed
- Dirty (border): Modified, needs writeback

### What to Look For

1. **Uneven usage**: If only a few sets are hot, you may have set conflicts (aliasing)

2. **Constant eviction**: Lines rapidly cycling = working set too large for cache

3. **Dirty bits**: Many dirty lines = write-heavy code

## Timeline View

Shows access pattern over time:

```
████████████████░░░░░░░░████████████████
 ^-- L1 hits --^  ^miss^  ^-- hits --^
```

**Green bars**: L1 hits (fast)
**Yellow bars**: L2 hits (medium)
**Red bars**: L3 hits or memory (slow)

### Patterns to Recognize

**Solid green**: Excellent locality, data stays in cache

**Periodic red spikes**: Eviction pattern - working set exceeds cache

**Random red scattered**: Poor spatial locality

**Red at start, then green**: Compulsory misses (cold start)

## Multi-Core Results

When running multi-threaded code:

```
Threads: 4
Cores: 4
Coherence invalidations: 1,234
False sharing events: 3
```

**Coherence invalidations**: Times one core's write invalidated another core's cached copy. Some is normal; excessive indicates contention.

**False sharing events**: Different threads modifying adjacent bytes in the same cache line. Always bad - add padding.

## False Sharing Visualization

```
Cache Line 0x7fff5000
[T1][T1][T2][T2][  ][  ][  ][  ]...
 ^--- Thread 1 writes here
       ^--- Thread 2 writes here (SAME CACHE LINE!)
```

Even though threads access different bytes, they share a cache line. Every write invalidates the other core's copy.

**Fix**: Add padding to separate data:
```c
struct Data {
    int thread1_counter;
    char padding[60];  // Ensures next field is on different cache line
    int thread2_counter;
};
```

## Suggestions Panel

Cache Explorer provides optimization suggestions:

```
[HIGH] false_sharing at line 45
  Multiple threads writing to same cache line
  Fix: Add 56 bytes padding between fields

[MEDIUM] poor_locality overall
  L1 miss rate is 15%
  Fix: Review data structure layout
```

**Severity levels**:
- HIGH: Significant performance impact, fix first
- MEDIUM: Noticeable impact, worth addressing
- LOW: Minor optimization opportunity

## Common Patterns and Fixes

### Pattern 1: Column-Major Access
**Symptom**: High L1 miss rate on array access
**Cause**: Accessing `arr[j][i]` instead of `arr[i][j]`
**Fix**: Swap loop order

### Pattern 2: Linked List Traversal
**Symptom**: Every access misses L1
**Cause**: Pointer chasing defeats prefetcher
**Fix**: Use arrays or arena allocation

### Pattern 3: False Sharing
**Symptom**: High coherence invalidations, poor multi-threaded scaling
**Cause**: Thread-local data on shared cache lines
**Fix**: Align data to cache line boundaries

### Pattern 4: Working Set Too Large
**Symptom**: L1 misses, but L2 hits well
**Cause**: Active data exceeds L1 size
**Fix**: Block/tile algorithms, reduce working set

## Tips for Analysis

1. **Start with L1 miss rate** - It's the most impactful

2. **Check hot lines first** - Focus on the biggest offenders

3. **Use educational config** - Smaller caches make problems obvious

4. **Compare before/after** - Use diff mode to validate fixes

5. **Profile realistic input** - Cache behavior depends on data size

## Simulation Accuracy

Cache Explorer results are validated against real hardware. On Intel Xeon Platinum 8488C:

- **L1 Data**: ±4.6% accuracy (within ±5% target)
- **L2**: ±9.3% accuracy (within ±10% target)

This means you can trust the simulator's hit/miss ratios to reflect real hardware behavior. For detailed validation methodology, see [VALIDATION.md](VALIDATION.md).

## Next Steps

- [Cache Optimization Patterns](OPTIMIZATION_PATTERNS.md) - Specific techniques
- [Quick Start Guide](QUICK_START.md) - Getting started
- [Hardware Validation](VALIDATION.md) - Accuracy methodology
