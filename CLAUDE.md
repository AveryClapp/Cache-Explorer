# CLAUDE.md - Cache Explorer Project Guide

## Rules

- Do not add `Co-Authored-By` lines to commit messages.

## Current Status (January 2026)

**Overall Completion: ~98%**

| Component | Status | Notes |
|-----------|--------|-------|
| LLVM Pass | ✅ Complete | Instruments loads/stores with file attribution |
| Runtime Library | ✅ Complete | Thread-safe event capture to stdout |
| Cache Simulator | ✅ Complete | Full hierarchy with 5 eviction policies, optimized |
| Multi-Core Support | ✅ Complete | MESI coherence, per-core prefetching |
| Prefetching | ✅ Complete | 6 policies (none/next-line/stream/stride/adaptive/intel) |
| False Sharing Detection | ✅ Complete | Reports with padding suggestions |
| TLB Simulation | ✅ Complete | DTLB/ITLB with LRU replacement |
| Timing Model | ✅ Complete | Configurable latencies per hardware preset |
| Advanced Stats | ✅ Complete | Vector/SIMD, atomics, memcpy/memset tracking |
| Fast Mode | ✅ Complete | `--fast` disables 3C classification for ~3x speed |
| CLI Tool | ✅ Complete | JSON/text output, hardware presets |
| Web Frontend | ✅ Complete | Multi-file, dark/light modes, styled dropdowns, cancel button |
| Comparison Mode | ✅ Complete | Before/after diff view, localStorage persistence, delta indicators |
| Web Backend | ✅ Complete | Docker sandbox, WebSocket streaming |
| Rust Support | ❌ Not Available | Requires std library linking (backlog) |
| Testing | ✅ 123 tests | CacheLevel(22) + CacheSystem(25) + MESI(19) + Prefetch(18) + TLB(8) + Advanced(31) |

**What's Working:**
```bash
# Full pipeline:
./backend/scripts/cache-explore examples/sequential.c --config intel --json

# With prefetching:
./backend/scripts/cache-explore mycode.c --config amd --prefetch stream

# Fast mode (skips 3C miss classification for ~3x speedup):
./backend/scripts/cache-explore mycode.c --config intel --fast

# Docker sandbox (production):
docker run -p 3001:3001 cache-explorer-sandbox:latest
```

---

## Quick Reference

### Build Commands

```bash
# Backend (cache simulator)
cd backend/cache-simulator && mkdir -p build && cd build
cmake .. -G Ninja && ninja

# LLVM pass
cd backend/llvm-pass && mkdir -p build && cd build
cmake .. -G Ninja -DLLVM_DIR=/opt/homebrew/opt/llvm/lib/cmake/llvm && ninja

# Runtime library
cd backend/runtime && mkdir -p build && cd build
cmake .. -G Ninja && ninja

# Frontend
cd frontend && npm install && npm run build

# Run tests
cd backend/cache-simulator/build
./CacheLevelTest && ./CacheSystemTest && ./MESICoherenceTest
./MultiCorePrefetchTest && ./MultiCoreTLBTest && ./AdvancedInstrumentationTest
```

### After Making C++ Changes

**IMPORTANT:** There are TWO cache-sim binaries - changes won't take effect until both are updated:

```bash
# 1. Rebuild in the component directory
cd backend/cache-simulator/build && ninja

# 2. Copy to project root build (used by web server)
cp backend/cache-simulator/build/cache-sim build/backend/cache-simulator/cache-sim

# 3. Clear the server's result cache
rm -f backend/server/cache-explorer.db

# 4. Restart the backend server
lsof -ti:3001 | xargs kill -9; cd backend/server && node server.js &
```

Binary locations:
- `backend/cache-simulator/build/cache-sim` - Component build (use for development)
- `build/backend/cache-simulator/cache-sim` - Project root build (used by `cache-explore` script)

The `cache-explore` script checks the project root build first, so always sync both.

### Multi-LLVM Version Support

The CLI automatically detects your LLVM version and downloads the matching pre-built pass:

```bash
# Auto-detection (recommended) - works with LLVM 17-21
cache-explore matrix.c

# Specify LLVM installation (if you have multiple versions)
cache-explore matrix.c --compiler /opt/homebrew/opt/llvm@18/bin

# Build pass locally (if no pre-built available for your LLVM version)
cache-explore build-pass

# Manage pass cache
cache-explore cache list    # Show cached passes
cache-explore cache clear   # Clear cache
cache-explore cache path    # Show cache location
cache-explore cache size    # Show cache size
```

**Supported LLVM Versions:** 17, 18, 19, 20, 21
**Supported Platforms:** Linux x64, Linux ARM64, macOS ARM64

Pre-built passes are downloaded from GitHub Releases on first run and cached in `~/.cache/cache-explorer/passes/`.

### Key Files

**Cache Simulator:**
- `backend/cache-simulator/include/CacheLevel.hpp` - Single cache level with MESI
- `backend/cache-simulator/include/CacheSystem.hpp` - L1/L2/L3 hierarchy
- `backend/cache-simulator/include/MultiCoreCacheSystem.hpp` - Multi-core with coherence
- `backend/cache-simulator/include/Prefetcher.hpp` - 6 prefetch policies
- `backend/cache-simulator/include/TLB.hpp` - TLB simulation
- `backend/cache-simulator/include/CacheStats.hpp` - Stats with 3C miss breakdown
- `backend/cache-simulator/include/AdvancedStats.hpp` - Vector/atomic/memcpy stats

**LLVM Pass:**
- `backend/llvm-pass/CacheExplorerPass.cpp` - Instrumentation pass

**Runtime:**
- `backend/runtime/cache-explorer-rt.c` - Event capture functions

**Frontend:**
- `frontend/src/App.tsx` - Main React component
- `frontend/src/App.css` - Styling with dark/light themes
- `frontend/src/hooks/useBaseline.ts` - Comparison mode state with localStorage persistence
- `frontend/src/components/DiffSummary.tsx` - Comparison verdict and summary
- `frontend/src/components/MetricCards.tsx` - Hit rate cards with delta indicators

---

## Architecture

### C/C++ Pipeline
```
User Code → Clang + CacheExplorerPass.so → Instrumented Binary
                                                ↓
                                     Runtime: __tag_mem_load/store
                                                ↓
                                     Trace: "L 0x7fff1234 4 main.c:10 T0"
                                                ↓
                                     cache-sim → JSON output
                                                ↓
                                     WebSocket → Frontend
```

### Rust Pipeline (via LLVM Bitcode)
```
Rust Code → rustc --emit=llvm-bc → Bitcode (.bc)
                                        ↓
                           opt -load-pass-plugin CacheProfiler.so
                                        ↓
                              Instrumented Bitcode
                                        ↓
                              clang + Runtime → Executable
                                        ↓
                              (same as C/C++ from here)
```

Rust requires the bitcode pipeline because `rustc` doesn't support `-fpass-plugin` like Clang.
The `opt` tool applies our instrumentation pass to the LLVM bitcode, then Clang links it with the runtime.

### Cache Hierarchy Model

```
          Per-Core          Shared
       ┌─────────────┐   ┌─────────┐   ┌─────────┐
Core 0 │ L1D   L1I   │──▶│         │──▶│         │
       └─────────────┘   │   L2    │   │   L3    │──▶ Memory
       ┌─────────────┐   │         │   │         │
Core 1 │ L1D   L1I   │──▶│         │──▶│         │
       └─────────────┘   └─────────┘   └─────────┘
            │                              │
            └────── MESI Coherence ────────┘
```

### MESI State Machine

```
                    ┌──────────────┐
       Read Miss    │              │  Write Hit
    ┌──────────────▶│   Modified   │◀─────────────┐
    │               │              │              │
    │               └──────┬───────┘              │
    │                      │                      │
    │              Remote  │ Read                 │
    │                      ▼                      │
    │               ┌──────────────┐              │
    │               │              │              │
    │   ┌──────────▶│   Shared     │──────────────┤
    │   │           │              │ Write Hit    │
    │   │           └──────┬───────┘              │
    │   │                  │                      │
    │   │ Remote Read      │ Remote               │
    │   │                  │ Write                │
    │   │                  ▼                      │
┌───┴───┴───┐       ┌──────────────┐              │
│           │       │              │              │
│ Exclusive │◀──────│   Invalid    │──────────────┘
│           │ Read  │              │ Write Miss
└───────────┘ Miss  └──────────────┘
```

---

## Eviction Policies

| Policy | Description | Use Case |
|--------|-------------|----------|
| LRU | True Least Recently Used | Default, accurate |
| PLRU | Tree-based Pseudo-LRU | Faster, 8+ way caches |
| RANDOM | Random eviction | Baseline comparison |
| SRRIP | Static Re-reference Interval Prediction | L3 simulation |
| BRRIP | Bimodal RRIP | Scan-resistant workloads |

## Prefetch Policies

| Policy | Description |
|--------|-------------|
| NONE | No prefetching |
| NEXT_LINE | Prefetch N+1 on miss at N |
| STREAM | Detect streams, prefetch ahead |
| STRIDE | Detect stride patterns |
| ADAPTIVE | Combine stream + stride |
| INTEL | DCU + IP-stride prefetcher |

---

## Hardware Presets

| Preset | L1D | L2 | L3/SLC | Notes |
|--------|-----|-----|--------|-------|
| `educational` | 4KB | 32KB | 256KB | Small caches to easily see misses |
| `intel` | 48KB | 1.25MB | 30MB | Intel 12th Gen (Alder Lake) |
| `intel14` | 48KB | 2MB | 36MB | Intel 14th Gen (Raptor Lake) |
| `xeon` | 48KB | 2MB | 60MB | Intel Xeon Scalable |
| `amd` | 32KB | 1MB | 32MB | AMD Zen 4 (Ryzen 7000) |
| `zen3` | 32KB | 512KB | 32MB | AMD Zen 3 (Ryzen 5000) |
| `epyc` | 32KB | 512KB | 256MB | AMD EPYC Server |
| `apple` | 64KB | 4MB | 32MB SLC | Apple M1 |
| `m2` | 128KB | 16MB | 24MB SLC | Apple M2 |
| `m3` | 128KB | 32MB | 32MB SLC | Apple M3 |
| `graviton` | 64KB | 1MB | 32MB | AWS Graviton 3 |
| `rpi4` | 32KB | 1MB | — | Raspberry Pi 4 (no L3) |

Apple Silicon uses SLC (System Level Cache) instead of traditional L3 - shared with GPU/NPU.

---

## API Output Format

```json
{
  "config": "intel",
  "events": 12345,
  "multicore": true,
  "cores": 4,
  "levels": {
    "l1d": {
      "hits": 10000,
      "misses": 500,
      "hitRate": 0.952,
      "writebacks": 100,
      "compulsory": 50,
      "capacity": 300,
      "conflict": 150
    },
    "l2": { ... },
    "l3": { ... }
  },
  "coherence": {
    "invalidations": 42,
    "falseSharingEvents": 2
  },
  "hotLines": [...],
  "falseSharing": [...],
  "suggestions": [...],
  "prefetch": {
    "policy": "stream",
    "accuracy": 0.90
  },
  "tlb": {
    "dtlb": { "hits": 50000, "misses": 10, "hitRate": 0.9998 }
  },
  "timing": {
    "totalCycles": 125000,
    "avgLatency": 5.2
  },
  "advancedStats": {
    "vector": { "loads": 100, "stores": 50, "bytesLoaded": 3200, "bytesStored": 1600, "crossLineAccesses": 5 },
    "atomic": { "loads": 10, "stores": 5, "rmw": 20, "cmpxchg": 2 },
    "memoryIntrinsics": { "memcpyCount": 5, "memcpyBytes": 4096, "memsetCount": 2, "memsetBytes": 1024 },
    "softwarePrefetch": { "issued": 50, "useful": 40, "accuracy": 0.80 }
  }
}
```

---

## Docker Deployment

```bash
# Build (includes Rust toolchain)
docker build -t cache-explorer-sandbox:latest -f docker/Dockerfile .

# Run
docker run -p 3001:3001 cache-explorer-sandbox:latest

# Access
open http://localhost:3001
```

The Docker container includes:
- LLVM 18 (clang, opt, lld)
- Rust 1.80 (pinned for LLVM 18 compatibility)
- CacheProfiler.so LLVM pass
- cache-sim binary
- Runtime library

---

## Automated Releases & CI/CD

### Conventional Commits

This project uses **conventional commits** for automated versioning and changelog generation. Follow this format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat:` - New feature (bumps MINOR version, e.g., 1.0.0 → 1.1.0)
- `fix:` - Bug fix (bumps PATCH version, e.g., 1.0.0 → 1.0.1)
- `perf:` - Performance improvement (bumps PATCH)
- `docs:` - Documentation only
- `test:` - Adding/updating tests
- `refactor:` - Code refactoring (no behavior change)
- `chore:` - Maintenance tasks

**Breaking changes** (bumps MAJOR version, e.g., 1.0.0 → 2.0.0):
Add `BREAKING CHANGE:` in the footer or `!` after the type:
```
feat!: remove deprecated --old-flag option

BREAKING CHANGE: --old-flag has been removed, use --new-flag instead
```

**Examples:**
```bash
# Feature (1.0.0 → 1.1.0)
git commit -m "feat: add segment caching for 10x speedup on repetitive loops"

# Bug fix (1.0.0 → 1.0.1)
git commit -m "fix: correct L3 hit rate calculation for MESI protocol"

# Performance (1.0.0 → 1.0.1)
git commit -m "perf: optimize cache lookup with hash map instead of linear search"

# Breaking change (1.0.0 → 2.0.0)
git commit -m "feat!: replace --config with --preset for consistency

BREAKING CHANGE: --config flag renamed to --preset"
```

### Automated Release Process

When you push to `main`:

1. **Release Please** analyzes commits since last release
2. Creates a PR with:
   - Updated version number
   - Generated CHANGELOG.md
   - Updated package.json
3. When you merge the PR:
   - Creates a git tag (e.g., `v1.2.0`)
   - Creates GitHub release with notes
4. The git tag triggers:
   - **LLVM Pass Builds** - Builds CacheProfiler.so for LLVM 17-21
   - **Docker Images** - Publishes to `ghcr.io/[username]/cache-explorer-*`

**Published Docker Images:**
```bash
# Pull pre-built images
docker pull ghcr.io/[username]/cache-explorer-sandbox:latest
docker pull ghcr.io/[username]/cache-explorer-backend:latest
docker pull ghcr.io/[username]/cache-explorer-frontend:latest

# Use in production
docker run -p 3001:3001 ghcr.io/[username]/cache-explorer-sandbox:latest
```

**Image tags:**
- `latest` - Most recent build from main
- `v1.2.3` - Specific version
- `v1.2` - Latest patch in v1.2.x series
- `v1` - Latest minor in v1.x.x series

**Manual Release:**
If you need to create a release manually:
```bash
# Create and push a version tag
git tag -a v1.2.0 -m "Release v1.2.0"
git push origin v1.2.0
```

---

## Common Tasks

### Add a New Eviction Policy
1. Add enum value to `EvictionPolicy` in `EvictionPolicy.hpp`
2. Implement `find_victim_<policy>()` in `CacheLevel.cpp`
3. Add case to `find_victim()` switch
4. Add test in `CacheLevelTest.cpp`

### Add a New Hardware Preset
1. Add function `make_<cpu>_config()` in `CacheConfig.hpp`
2. Add to preset map in `main.cpp`
3. Add to dropdown in `App.tsx`

### Add a New Prefetch Policy
1. Add enum value to `PrefetchPolicy` in `Prefetcher.hpp`
2. Implement logic in `Prefetcher::on_access()`
3. Add test in `MultiCorePrefetchTest.cpp`

### Using Comparison Mode (Web UI)
1. Run analysis on your code
2. Click "Set Baseline" in the header (or use command palette: `@` → "Set as diff baseline")
3. Modify your code to optimize cache behavior
4. Run analysis again
5. Click "Compare" to see side-by-side diff and delta indicators

**Features:**
- Side-by-side code diff (baseline left, current right - current is editable)
- Delta indicators on metric cards (green ▲ = improvement, red ▼ = regression)
- Hot line deltas showing which lines improved/regressed
- "Resolved" section for hot lines that dropped off the list
- Config mismatch warning if hardware preset changed
- Baseline persists in localStorage (survives page refresh)

---

## Future Work

### Potential Enhancements
- **Rust Support** - Backend code exists but requires std library linking solution. Options:
  - Build custom rustc with pass built-in
  - Use cargo build scripts with LLVM pass (blocked by rustc not supporting `-load-pass-plugin`)
  - Link Rust std library manually (complex, version-dependent)
- **Intel Pin Integration** - Support tracing pre-compiled binaries without recompilation
- **NUMA Simulation** - Multi-socket memory architecture
- **Speculative Execution Modeling** - Branch prediction and speculative loads

## Known Limitations

- **No Rust support** - Rust's std library linking is not compatible with the LLVM pass pipeline
- **No speculative execution** - All accesses are committed
- **Single-socket only** - No NUMA simulation
- **Simplified timing** - Fixed latencies per level

---

## Resources

**LLVM:**
- [Writing LLVM Passes](https://llvm.org/docs/WritingAnLLVMPass.html)

**Cache Architecture:**
- [What Every Programmer Should Know About Memory](https://people.freebsd.org/~lstewart/articles/cpumemory.pdf)
- [MESI Protocol](https://en.wikipedia.org/wiki/MESI_protocol)

**Reference:**
- [cachegrind](https://valgrind.org/docs/manual/cg-manual.html)

---

## Project Structure

```
cache-explorer/
├── backend/
│   ├── llvm-pass/           # LLVM instrumentation pass
│   ├── runtime/             # Event capture library
│   ├── cache-simulator/     # Core simulation engine
│   │   ├── include/         # Headers (.hpp)
│   │   ├── src/             # Implementation (.cpp)
│   │   └── tests/           # Unit tests
│   ├── server/              # Node.js WebSocket server
│   └── scripts/             # Build/run scripts
├── frontend/                # React + TypeScript
├── docker/                  # Container configs
├── tests/e2e/               # End-to-end tests
├── docs/                    # User documentation
└── CLAUDE.md                # This file
```

---

**Last Updated:** January 2026
**Project Phase:** Production Ready
