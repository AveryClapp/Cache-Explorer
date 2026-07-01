# Cache Explorer Hardware Validation

This document describes how Cache Explorer's simulation accuracy is validated against real hardware using Linux `perf` performance counters.

## Validation Results Summary

**Target Accuracy**: ±5% for L1, ±10% for L2

**Achieved Accuracy** (Intel Xeon Platinum 8488C - AWS c7i.4xlarge):

| Cache Level | Average Delta | Max Delta | Status |
|-------------|---------------|-----------|--------|
| **L1 Data** | ±4.6% | 8.2% | ✅ Within target |
| **L2** | ±9.3% | 22.7% | ✅ Within target (avg) |

## Detailed Benchmark Results

### L1 Cache Validation

| Benchmark | Simulator | Hardware | Delta | Notes |
|-----------|-----------|----------|-------|-------|
| sequential | 99.2% | 96.9% | +2.3% | Sequential array access |
| strided_16 | 97.1% | 91.1% | +6.0% | 16-byte stride |
| strided_64 | 89.6% | 82.6% | +7.0% | Cache-line stride |
| random | 83.6% | 91.4% | -7.8% | Random access pattern |
| matrix_row | 98.7% | 99.3% | -0.6% | Row-major traversal |
| matrix_col | 93.2% | 97.4% | -4.2% | Column-major traversal |
| linked_list | 90.6% | 98.8% | -8.2% | Pointer chasing |
| working_set | 99.4% | 98.7% | +0.7% | Fits in L1 |

### L2 Cache Validation

| Benchmark | Simulator | Hardware | Delta | Notes |
|-----------|-----------|----------|-------|-------|
| sequential | 90.8% | 95.9% | -5.1% | L2 stream prefetch |
| strided_16 | 90.8% | 97.2% | -6.4% | L2 stride detection |
| strided_64 | 90.7% | 97.4% | -6.7% | L2 prefetch helps |
| random | 97.0% | 96.1% | +0.9% | Random defeats prefetch |
| matrix_row | 49.8% | 72.5% | -22.7% | Complex 2D pattern |
| matrix_col | 78.0% | 87.0% | -9.0% | 2D with poor locality |
| linked_list | 99.0% | 93.2% | +5.8% | Sequential in memory |
| working_set | 70.2% | 88.7% | -18.5% | L2 working set |

## Hardware Configuration

Validation performed on **Intel Xeon Platinum 8488C (Sapphire Rapids)**:

| Level | Size | Associativity | Line Size |
|-------|------|---------------|-----------|
| L1 Data | 48 KB | 12-way | 64 bytes |
| L1 Instruction | 32 KB | 8-way | 64 bytes |
| L2 | 2 MB | 16-way | 64 bytes |
| L3 | 105 MB | 15-way | 64 bytes |

The simulator uses an exact config match (`--config xeon8488c`).

## Perf Counters Used

### L1 Counters (All Vendors)

| Counter | Measurement |
|---------|-------------|
| `L1-dcache-loads` | Total L1D accesses |
| `L1-dcache-load-misses` | L1D misses |

### L2 Counters (Vendor-Specific)

| Vendor | Hit Counter | Miss Counter |
|--------|-------------|--------------|
| **Intel** | `l2_rqsts.demand_data_rd_hit` | `l2_rqsts.demand_data_rd_miss` |
| **AMD** | `l2_cache_hits_from_dc_misses` | `l2_cache_misses_from_dc_misses` |
| **ARM** | `l2d_cache` (total) | `l2d_cache_refill` (misses) |
| **Fallback** | `cache-references` | `cache-misses` |

Note: L3/LLC counters are not available on EC2 virtualization.

## Running Validation

The validation script auto-detects CPU vendor (Intel, AMD, ARM) and selects the appropriate simulator config and perf counters.

### On Linux with perf

```bash
# 1. Install perf
sudo apt install linux-tools-generic linux-tools-$(uname -r)

# 2. Enable perf counters
echo 0 | sudo tee /proc/sys/kernel/perf_event_paranoid

# 3. Build Cache Explorer
./scripts/build.sh

# 4. Run validation (auto-detects architecture)
./validation/validate-hardware.sh

# 5. Update baseline (saves results for CI comparison)
./validation/validate-hardware.sh --update-baseline

# 6. Force a specific config (optional)
./validation/validate-hardware.sh --config zen4
```

### Multi-Architecture Validation

| Platform | Instance Type | Simulator Config | L2 Counters |
|----------|---------------|------------------|-------------|
| **Intel Xeon** | AWS c7i | `xeon8488c` | `l2_rqsts.*` |
| **AMD EPYC** | AWS c6a/m6a | `zen4` | `l2_cache_*` or generic |
| **ARM Graviton** | AWS c7g/m7g | `graviton3` | `l2d_cache*` |

```bash
# Intel (c7i instance)
./validation/validate-hardware.sh --update-baseline

# AMD (c6a instance)
./validation/validate-hardware.sh --update-baseline

# ARM Graviton (c7g instance)
./validation/validate-hardware.sh --update-baseline
```

The script will:
1. Auto-detect vendor from `lscpu`
2. Select matching simulator config
3. Use vendor-specific perf counters
4. Save baseline with vendor metadata

### On macOS/Windows (no perf)

```bash
# Compare against saved Linux baseline
./validation/validate-against-baseline.sh
```

## Vendor-Specific Prefetch Configurations

Each hardware preset now includes vendor-accurate prefetch settings:

### Intel (Xeon, 12th/14th Gen)
- L2 streamer: Up to 32 concurrent streams
- Adjacent line prefetcher: Pairs cache lines to 128 bytes
- Prefetch degree: 4 lines (conservative; real hardware uses smart backoff)

### AMD (Zen 3/4, EPYC)
- L1+L2 prefetch only (L3 is victim cache)
- No adjacent line pairing
- Prefetch degree: 4 lines

### Apple (M1/M2/M3)
- Data Memory-Dependent Prefetcher (DMP) - pointer prefetch
- More aggressive L1 prefetch
- Prefetch degree: 4 lines

### ARM (Graviton 3, Cortex-A)
- L1 Data Prefetcher (DPF)
- L2 stream prefetcher
- Prefetch degree: 4 lines
- Fewer concurrent streams than Intel (8 vs 32)

### Educational
- No prefetching (clearer results for learning)

## Why Accuracy Matters

Cache Explorer is designed as an **engineering tool**, not just educational:

| Accuracy | Use Case |
|----------|----------|
| ±20% | Educational only |
| ±10% | Directional guidance |
| **±5%** | **Engineering decisions** |
| ±2% | Production profiler |

At ±5% L1 accuracy, engineers can:
- Restructure code based on simulator feedback
- Trust that improvements will translate to real hardware
- Compare different algorithms' cache behavior

## Known Limitations

### Simulator Underestimates L2 Hit Rate
The simulator shows lower L2 hit rates than hardware for some patterns (matrix_row: -22.7%). This is because:
- Intel's L2 prefetcher is more sophisticated than our model
- Real hardware has dynamic prefetch distance adjustment
- We use conservative prefetch settings to avoid over-prefetching

### Linked List Shows Variance
Hardware shows 98.8% L1 hits for linked_list because nodes are allocated sequentially in memory (array-backed). Our prefetcher doesn't fully model Intel's stream detection for this pattern.

### LLC Not Available on Cloud
AWS EC2 virtualization doesn't expose L3/LLC performance counters. Bare metal instances would be needed for full L3 validation.

## Future Improvements

1. **Smart Prefetch Backoff** - Detect when prefetching hurts and reduce aggressiveness
2. **Pattern-Specific Prefetch** - Different degrees for stream vs stride patterns
3. **L3 Validation** - Use bare metal instances for LLC counter access

## Multi-Architecture Support (Ready)

The validation script now supports:
- **Intel** - Validated on Xeon 8488C (c7i)
- **AMD** - Ready for validation on EPYC (c6a/m6a)
- **ARM Graviton** - Ready for validation on Graviton 3 (c7g)

Each architecture uses vendor-specific prefetch models and perf counters.

## Benchmark Descriptions

| Benchmark | Description |
|-----------|-------------|
| `sequential` | Linear array traversal - best case for prefetching |
| `strided_16` | Access every 16 bytes - tests stride detection |
| `strided_64` | Access every cache line - worst case for spatial locality |
| `random` | Random array indices - defeats prefetching |
| `matrix_row` | Row-major 2D traversal - cache friendly |
| `matrix_col` | Column-major 2D traversal - cache unfriendly |
| `linked_list` | Pointer chasing through nodes |
| `working_set` | Repeated access to data that fits in cache |

## References

- [Intel Optimization Manual - Prefetcher Details](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html)
- [AMD Zen 4 Memory Subsystem](https://chipsandcheese.com/p/amds-zen-4-part-2-memory-subsystem-and-conclusion)
- [Linux perf Documentation](http://www.brendangregg.com/perf.html)
