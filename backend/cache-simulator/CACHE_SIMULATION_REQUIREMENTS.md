# Cache Simulation Requirements

A comprehensive checklist of everything needed to accurately simulate real CPU cache behavior.

---

## Table of Contents

1. [Cache Structure](#1-cache-structure)
2. [Address Handling](#2-address-handling)
3. [Replacement Policies](#3-replacement-policies)
4. [Write Policies](#4-write-policies)
5. [Multi-Level Coordination](#5-multi-level-coordination)
6. [Cache Coherence (Multi-Core)](#6-cache-coherence-multi-core)
7. [Advanced Hardware Features](#7-advanced-hardware-features)
8. [Real Hardware Configurations](#8-real-hardware-configurations)
9. [Visualization Requirements](#9-visualization-requirements)
10. [Implementation Status](#10-implementation-status)

---

## 1. Cache Structure

### 1.1 Basic Organization
- [x] Set-associative structure (N-way)
- [x] Configurable cache size
- [x] Configurable line size (typically 64 bytes)
- [x] Configurable associativity
- [x] Tag/index/offset bit calculation

### 1.2 Cache Hierarchy
- [ ] L1 Data Cache (L1d) - per core, fastest, smallest
- [ ] L1 Instruction Cache (L1i) - per core, read-only
- [ ] L2 Cache - per core (Intel) or shared (some AMD)
- [ ] L3 Cache (LLC) - shared across cores
- [ ] Optional L4 Cache (eDRAM on some Intel chips)

### 1.3 Typical Real-World Sizes

| Level | Size | Associativity | Latency | Shared |
|-------|------|---------------|---------|--------|
| L1d | 32-48 KB | 8-12 way | 4-5 cycles | Per-core |
| L1i | 32-64 KB | 8 way | 4-5 cycles | Per-core |
| L2 | 256 KB - 1 MB | 4-8 way | 12-14 cycles | Per-core |
| L3 | 8-96 MB | 12-16 way | 40-75 cycles | Shared |

---

## 2. Address Handling

### 2.1 Address Parsing
- [x] Tag extraction
- [x] Index extraction
- [x] Offset extraction
- [x] Configurable bit widths

### 2.2 Access Size Handling
- [ ] Support 1, 2, 4, 8, 16, 32, 64 byte accesses
- [ ] Detect accesses spanning cache line boundaries
- [ ] Handle unaligned accesses (split into multiple line accesses)
- [ ] SIMD/vector access sizes (128, 256, 512 bits)

```cpp
// Example: 8-byte access at offset 60 spans two lines
// Line N: bytes 60-63 (4 bytes)
// Line N+1: bytes 0-3 (4 bytes)
```

### 2.3 Address Types
- [ ] Physical addresses (what caches actually use)
- [ ] Virtual addresses (what programs use)
- [ ] Note: Most L1 caches are VIPT (Virtually Indexed, Physically Tagged)

---

## 3. Replacement Policies

### 3.1 Policies to Implement

| Policy | Complexity | Used In | Status |
|--------|------------|---------|--------|
| LRU | High | Educational/Some L1 | [x] |
| Pseudo-LRU (Tree) | Medium | Most L1/L2 | [ ] |
| Pseudo-LRU (Bit) | Low | Some L1 | [ ] |
| Random | Very Low | Some ARM | [ ] |
| FIFO | Low | Rare | [ ] |
| RRIP (Intel) | Medium | Intel L3 | [ ] |
| DRRIP | Medium | Adaptive RRIP | [ ] |
| LFU | High | Rare | [ ] |

### 3.2 True LRU
- [x] Track access order for each set
- [x] Update on every hit
- [x] Evict least recently used
- Note: Only practical for low associativity (2-4 way)

### 3.3 Pseudo-LRU (Tree-Based)
- [ ] Binary tree of decision bits per set
- [ ] O(log N) bits per set instead of O(N log N)
- [ ] Update path from root to accessed way
- [ ] Follow opposite path to find victim

```
         [0]           <- 0 = go left, 1 = go right
        /   \
      [0]   [1]
      / \   / \
     W0 W1 W2 W3

Access W2: Set root=1, set right child=0
Evict: Follow bits (opposite) -> W0 or W1
```

### 3.4 RRIP (Re-Reference Interval Prediction)
- [ ] 2-3 bit counter per cache line (RRPV)
- [ ] Higher value = predicted longer until re-reference
- [ ] On insert: set to near-max (assume not reused soon)
- [ ] On hit: set to 0 (will be reused soon)
- [ ] On evict: find line with max RRPV, increment others

---

## 4. Write Policies

### 4.1 Write-Hit Policies
- [x] Write-Back: Write to cache only, mark dirty, write to memory on eviction
- [ ] Write-Through: Write to cache AND memory immediately

### 4.2 Write-Miss Policies
- [x] Write-Allocate: Load line into cache, then write (current behavior)
- [ ] No-Write-Allocate: Write directly to memory, don't load into cache

### 4.3 Common Combinations
| Combination | Description | Used In |
|-------------|-------------|---------|
| Write-Back + Write-Allocate | Default for most caches | L1, L2, L3 |
| Write-Through + No-Write-Allocate | Simple, used in some embedded | Rare |
| Write-Through + Write-Allocate | Uncommon | Very rare |

### 4.4 Dirty Line Handling
- [x] Track dirty bit per line
- [x] Return dirty line address on eviction
- [ ] Write-back buffer (coalesce multiple writebacks)
- [ ] Eviction to next level vs memory

---

## 5. Multi-Level Coordination

### 5.1 Inclusion Policies

#### Inclusive (Most Intel)
- [ ] L2 contains superset of L1
- [ ] L3 contains superset of L2
- [ ] On L3 eviction: **back-invalidate** L1 and L2
- [ ] Wastes space (duplication) but simple coherence

```
L3 evicts line X → Must invalidate X in L2 → Must invalidate X in L1
```

#### Exclusive (Some AMD)
- [ ] Lines exist in exactly ONE level
- [ ] On L1 miss: Check L2, if hit move to L1 (remove from L2)
- [ ] On L1 eviction: Move to L2 (victim cache behavior)
- [ ] Better space efficiency, complex movement

```
L1 evicts line X → X moves to L2 (not discarded)
L2 hit for line Y → Y moves to L1, removed from L2
```

#### NINE - Non-Inclusive Non-Exclusive (Modern AMD, some Intel)
- [ ] No strict inclusion or exclusion
- [ ] L3 may or may not contain L1/L2 lines
- [ ] On L3 eviction: Snoop L1/L2, write back if dirty
- [ ] Most flexible, moderate complexity

### 5.2 Multi-Level Access Flow

```
CPU Request for address A
    │
    ▼
┌─────────┐ Hit
│   L1    │────────► Return data
└────┬────┘
     │ Miss
     ▼
┌─────────┐ Hit
│   L2    │────────► Install in L1, Return data
└────┬────┘
     │ Miss
     ▼
┌─────────┐ Hit
│   L3    │────────► Install in L2, Install in L1, Return data
└────┬────┘
     │ Miss
     ▼
┌─────────┐
│ Memory  │────────► Install in L3, L2, L1, Return data
└─────────┘
```

### 5.3 Eviction Cascades
- [ ] L1 eviction may cause L2 write (exclusive) or nothing (inclusive)
- [ ] L2 eviction may cause L3 write or back-invalidation
- [ ] Track writeback traffic between levels

---

## 6. Cache Coherence (Multi-Core)

### 6.1 MESI Protocol States

| State | Description | Can Read | Can Write | Shared |
|-------|-------------|----------|-----------|--------|
| **M** (Modified) | Only copy, dirty | Yes | Yes | No |
| **E** (Exclusive) | Only copy, clean | Yes | Yes (→M) | No |
| **S** (Shared) | Multiple copies, clean | Yes | No (must invalidate others) | Yes |
| **I** (Invalid) | Not present | No | No | - |

### 6.2 State Transitions

```
     ┌──────────────────────────────────────────┐
     │                                          │
     ▼                                          │
   ┌───┐  Read hit   ┌───┐  Write    ┌───┐     │
   │ I │────────────►│ E │─────────►│ M │     │
   └───┘  (exclusive)└───┘          └───┘     │
     │                 │              │        │
     │ Read hit        │ Other core   │ Other core
     │ (shared)        │ reads        │ reads
     │                 ▼              ▼        │
     │              ┌───┐◄──────────────       │
     └─────────────►│ S │                      │
                    └───┘──────────────────────┘
                       Other core writes
                       (invalidate)
```

### 6.3 MOESI Extension (AMD)
- [ ] **O** (Owned): Dirty but shared, responsible for writeback
- [ ] Allows sharing dirty data without writeback first

### 6.4 Coherence Implementation
- [ ] Snooping: Each cache monitors bus for other cores' accesses
- [ ] Directory: Central tracker of which cores have which lines
- [ ] Snoop filter: Optimization to reduce snoop traffic

### 6.5 False Sharing Detection
- [ ] Detect when cores access different data in same cache line
- [ ] Track per-core access patterns per line
- [ ] Flag lines with multiple writers to different offsets

```cpp
// Core 0 writes to &data[0] (offset 0)
// Core 1 writes to &data[8] (offset 8)
// Same cache line → False sharing → Constant invalidations
```

---

## 7. Advanced Hardware Features

### 7.1 Prefetching
- [ ] Hardware stride prefetcher (detect sequential/strided patterns)
- [ ] Software prefetch hints (_mm_prefetch)
- [ ] Adjacent cache line prefetch
- [ ] Stream buffers

### 7.2 Non-Temporal Operations
- [ ] Streaming stores (bypass cache, go direct to memory)
- [ ] Non-temporal loads (hint: won't be reused)
- [ ] Write-combining for streaming writes

### 7.3 Memory Barriers & Fences
- [ ] Track memory ordering constraints
- [ ] MFENCE, LFENCE, SFENCE effects

### 7.4 Atomic Operations
- [ ] Cache line locking for atomics
- [ ] CAS (Compare-and-Swap) behavior
- [ ] Impact on coherence traffic

### 7.5 TLB (Optional - Related but Separate)
- [ ] Virtual to physical address translation
- [ ] TLB miss → Page table walk
- [ ] Impact on cache access latency

---

## 8. Real Hardware Configurations

### 8.1 Intel Core (12th-14th Gen)

```
L1d: 48 KB, 12-way, 64B lines, ~5 cycles, per P-core
L1i: 32 KB, 8-way, 64B lines, ~5 cycles, per P-core
L2:  1.25 MB, 10-way, 64B lines, ~14 cycles, per P-core
L3:  30 MB (shared), 12-way, 64B lines, ~50 cycles

Inclusion: L3 is NINE (non-inclusive)
Replacement: RRIP-like for L3
Prefetching: Aggressive hardware prefetching
```

### 8.2 AMD Zen 4

```
L1d: 32 KB, 8-way, 64B lines, ~4 cycles, per core
L1i: 32 KB, 8-way, 64B lines, ~4 cycles, per core
L2:  1 MB, 8-way, 64B lines, ~14 cycles, per core
L3:  32 MB per CCD (shared), 16-way, 64B lines, ~50 cycles

Inclusion: Exclusive L1/L2, NINE L3
Victim cache behavior for L2
```

### 8.3 Apple M3

```
L1d: 64 KB, 64B lines, per core
L1i: 128 KB, 64B lines, per core
L2:  4 MB per cluster, shared within cluster
SLC: 24-36 MB, system level cache

Unique: Very large L1i, cluster-based L2
```

### 8.4 Configuration Profiles
- [ ] Create preset configurations for common CPUs
- [ ] Allow custom configuration
- [ ] Validate configurations (realistic combinations)

---

## 9. Visualization Requirements

### 9.1 Real-Time State Display
- [ ] Cache contents per set (which lines are present)
- [ ] Line states (valid, dirty, MESI state)
- [ ] Tag values and decoded addresses
- [ ] LRU/replacement state

### 9.2 Access Pattern Visualization
- [ ] Heat map of set usage (hot sets)
- [ ] Temporal access timeline
- [ ] Spatial access pattern (address ranges)
- [ ] Miss rate over time

### 9.3 Statistics
- [ ] Hit rate / Miss rate per level
- [ ] Breakdown: Cold miss, Conflict miss, Capacity miss
- [ ] Writebacks count
- [ ] Evictions count
- [ ] Coherence traffic (snoops, invalidations)

### 9.4 Source Code Correlation
- [ ] Map cache events to source lines
- [ ] Highlight hot lines (many misses)
- [ ] Show memory access pattern for each source line
- [ ] Identify optimization opportunities

### 9.5 Problem Detection
- [ ] False sharing warnings
- [ ] Cache thrashing detection
- [ ] Poor spatial locality warnings
- [ ] Capacity miss patterns

### 9.6 Educational Overlays
- [ ] Step-by-step access explanation
- [ ] Show address breakdown (tag/index/offset)
- [ ] Animate data movement between levels
- [ ] Explain why hit or miss occurred

---

## 10. Implementation Status

### Phase 1: Single Level (Current)
- [x] CacheLevel class with set-associative structure
- [x] LRU replacement policy
- [x] Address parsing (tag/index/offset)
- [x] Hit/miss detection
- [x] Dirty bit tracking
- [x] Eviction with dirty writeback info
- [x] Config validation
- [x] Comprehensive tests

### Phase 2: Multi-Level (Next)
- [ ] CacheSystem coordinating L1/L2/L3
- [ ] Inclusive policy implementation
- [ ] Exclusive policy implementation
- [ ] NINE policy implementation
- [ ] Proper eviction cascades
- [ ] Writeback propagation

### Phase 3: Access Handling
- [ ] Variable access sizes
- [ ] Cross-line access handling
- [ ] Read vs Write differentiation in stats

### Phase 4: Advanced Replacement
- [ ] Pseudo-LRU (tree-based)
- [ ] RRIP for L3
- [ ] Policy selection per level

### Phase 5: Coherence
- [ ] MESI state machine
- [ ] Multi-core simulation
- [ ] False sharing detection
- [ ] Coherence traffic tracking

### Phase 6: Real Configurations
- [ ] Intel preset
- [ ] AMD preset
- [ ] Apple Silicon preset
- [ ] Validation against real hardware (perf counters)

---

## Priority Order for Implementation

1. **Multi-level coordination** - Core feature for realistic simulation
2. **Access size handling** - Required for accurate results
3. **Pseudo-LRU** - More realistic than true LRU
4. **MESI coherence** - Required for multi-threaded code
5. **Real hardware presets** - User experience
6. **Prefetching** - Nice to have for accuracy
7. **TLB** - Separate concern, lower priority

---

## References

- Intel Optimization Manual: https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html
- What Every Programmer Should Know About Memory: https://people.freebsd.org/~lstewart/articles/cpumemory.pdf
- A Primer on Memory Consistency and Cache Coherence: https://pages.cs.wisc.edu/~markhill/papers/primer2020_2nd_edition.pdf
- WikiChip for specific CPU configurations: https://en.wikichip.org/
