# Hardware Validation Design

**Date:** 2024-12-30
**Status:** Ready for implementation
**Goal:** Prove simulator accuracy against real hardware for credibility

## Overview

Validate Cache Explorer's simulation accuracy by comparing results against real CPU performance counters (perf). This establishes credibility and catches regressions.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     VALIDATION PIPELINE                              │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Benchmark Suite │     │  Cache Explorer  │     │  Linux Server    │
│                  │     │    Simulator     │     │  (with perf)     │
│  - sequential    │────▶│                  │     │                  │
│  - strided       │     │  Produces:       │     │  Produces:       │
│  - random        │     │  - L1 hits/miss  │     │  - L1 hits/miss  │
│  - matrix_row    │     │  - L2 hits/miss  │     │  - L2 hits/miss  │
│  - matrix_col    │     │  - miss rates    │     │  - miss rates    │
│  - linked_list   │     │                  │     │                  │
└──────────────────┘     └────────┬─────────┘     └────────┬─────────┘
                                  │                        │
                                  ▼                        ▼
                         ┌─────────────────────────────────┐
                         │      Compare & Report           │
                         │                                 │
                         │  ✓ sequential: 99.2% vs 99.1%  │
                         │  ✓ strided:    87.5% vs 88.2%  │
                         │  ✓ random:     45.3% vs 47.1%  │
                         │                                 │
                         │  Overall accuracy: ±3%          │
                         └─────────────────────────────────┘
```

**Two modes:**

1. **Full validation** (weekly/on-demand): Run on Linux server with perf, update baseline numbers
2. **CI validation** (every PR): Compare simulator output against saved baseline, fail if >5% drift

## Benchmark Suite

8 programs covering different cache access patterns:

| Benchmark | Pattern | Expected L1 Hit Rate | Validates |
|-----------|---------|---------------------|-----------|
| `sequential` | Linear array traversal | ~99% | Spatial locality, prefetching |
| `strided_16` | Every 16th element (1 cache line) | ~94% | Cache line size handling |
| `strided_64` | Every 64th element (spans lines) | ~6% | Miss detection |
| `random` | Random indices | ~40-60% | Set associativity, LRU |
| `matrix_row` | Row-major 2D traversal | ~99% | Nested loop locality |
| `matrix_col` | Column-major 2D traversal | ~12% | Cache thrashing detection |
| `linked_list` | Pointer chasing | ~50-70% | Non-contiguous access |
| `working_set` | Repeatedly access N elements | varies | Working set vs cache size |

**Why these 8:**
- Cover common patterns users will profile
- Each isolates a specific cache behavior
- Results are predictable and explainable
- Small enough to run quickly (<1s each)

## Baseline File Format

Baselines are committed to the repo and updated when hardware validation runs:

```json
{
  "hardware": "Intel i7-12700",
  "kernel": "6.1.0",
  "date": "2024-12-30",
  "perf_version": "6.1",
  "cache_config": {
    "l1d": "48KB, 12-way",
    "l2": "1.25MB, 10-way",
    "l3": "25MB, shared"
  },
  "benchmarks": {
    "sequential": {
      "l1_hit_rate": 99.1,
      "l1_accesses": 1000000,
      "l1_misses": 9000
    },
    "strided_16": {
      "l1_hit_rate": 93.8,
      "l1_accesses": 62500,
      "l1_misses": 3875
    }
  }
}
```

## CI Integration

### Job 1: Quick Validation (Every PR)

Runs on standard GitHub runner, compares simulator against saved baselines:

```yaml
validate-accuracy:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Build Cache Explorer
      run: ./scripts/build.sh
    - name: Validate against baseline
      run: ./validation/validate-against-baseline.sh
      # Fails if any benchmark drifts >5% from baseline
```

**Runtime:** ~30 seconds
**Purpose:** Catch regressions before merge

### Job 2: Full Hardware Validation (Weekly/Manual)

Runs on self-hosted Linux runner with perf access:

```yaml
hardware-validation:
  runs-on: [self-hosted, linux, perf]
  if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
  steps:
    - uses: actions/checkout@v4
    - name: Build Cache Explorer
      run: ./scripts/build.sh
    - name: Run hardware validation
      run: ./validation/validate-hardware.sh --update-baseline
    - name: Commit updated baseline
      run: |
        git config user.name "GitHub Actions"
        git config user.email "actions@github.com"
        git add validation/baselines/
        git diff --staged --quiet || git commit -m "Update validation baselines"
        git push
```

**Runtime:** ~2 minutes
**Purpose:** Refresh baseline numbers, catch hardware-specific issues

## Validation Output

For README and documentation:

```
=== Cache Explorer Accuracy Report ===
Hardware: Intel i7-12700 (Alder Lake)
Date: 2024-12-30

| Benchmark    | Simulator | Hardware |  Delta |
|--------------|-----------|----------|--------|
| sequential   |    99.2%  |   99.1%  |  +0.1% |
| strided_16   |    94.1%  |   93.8%  |  +0.3% |
| strided_64   |     6.2%  |    5.9%  |  +0.3% |
| random       |    52.1%  |   54.3%  |  -2.2% |
| matrix_row   |    98.9%  |   99.0%  |  -0.1% |
| matrix_col   |    12.4%  |   11.8%  |  +0.6% |
| linked_list  |    61.2%  |   63.5%  |  -2.3% |
| working_set  |    88.7%  |   89.1%  |  -0.4% |

Average delta: ±0.8%
Max delta: 2.3%
Status: PASS (all within 5% threshold)
```

## Server Setup

### Option A: Dedicated Validation VPS (Recommended)

| Provider | Instance | Cost | Notes |
|----------|----------|------|-------|
| Hetzner CAX11 | 2 vCPU ARM, 4GB | ~$4/mo | ARM validation |
| Hetzner CPX11 | 2 vCPU AMD, 2GB | ~$5/mo | x86 validation |

### Setup Script

```bash
#!/bin/bash
# validation/setup-server.sh
# One-time setup for validation server

set -e

# Enable perf counters (persists across reboots)
echo 0 | sudo tee /proc/sys/kernel/perf_event_paranoid
echo 'kernel.perf_event_paranoid=0' | sudo tee -a /etc/sysctl.conf

# Install dependencies
sudo apt update && sudo apt install -y \
  linux-tools-generic \
  linux-tools-$(uname -r) \
  clang \
  cmake \
  ninja-build \
  git \
  bc

# Verify perf works
perf stat ls > /dev/null 2>&1 && echo "perf: OK" || echo "perf: FAILED"

echo "Server ready for validation"
```

### Option B: Use Existing Backend Server

Run validation on the Hetzner CX31 backend server during off-peak hours. Add a cron job or manual trigger.

**Security note:** Validation runs trusted benchmark code only (not user submissions), so no sandboxing needed.

## File Structure

```
validation/
├── benchmarks/
│   ├── sequential.c
│   ├── strided_16.c
│   ├── strided_64.c
│   ├── random.c
│   ├── matrix_row.c
│   ├── matrix_col.c
│   ├── linked_list.c
│   └── working_set.c
├── baselines/
│   ├── intel-i7-12700.json
│   └── amd-ryzen-5600.json    # Future
├── validate-against-baseline.sh
├── validate-hardware.sh
└── setup-server.sh

.github/workflows/
└── validation.yml
```

## Success Criteria

- [ ] All 8 benchmarks within ±5% of hardware baseline
- [ ] CI blocks PRs that cause >5% drift from baseline
- [ ] Published accuracy table in README with hardware specs
- [ ] At least one hardware baseline committed (Intel or AMD)

## Implementation Steps

1. **Create benchmark programs** (~1 hour)
   - Write 8 C programs with controlled access patterns
   - Ensure deterministic behavior (fixed seeds, no timing dependencies)

2. **Create validation scripts** (~2 hours)
   - `validate-hardware.sh`: Run benchmarks with perf, generate baseline
   - `validate-against-baseline.sh`: Compare simulator to saved baseline

3. **Set up CI workflow** (~1 hour)
   - Quick validation on every PR
   - Full validation weekly or on-demand

4. **Set up validation server** (~30 min)
   - Provision small VPS or use existing server
   - Run setup script, configure GitHub Actions runner

5. **Generate initial baseline** (~30 min)
   - Run full validation on server
   - Commit baseline file
   - Update README with accuracy table

**Total effort: ~5 hours**
