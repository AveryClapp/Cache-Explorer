# Cache Explorer - Development Status

## What Works

**Core pipeline:**

```
source.c → clang + CacheProfiler.so → instrumented binary → runtime trace → cache-sim → stats
```

- LLVM pass instruments loads/stores with source location (file:line)
- Lock-free ring buffer runtime (~1M events before flush)
- Cache simulator: L1d/L1i/L2/L3, LRU/PLRU/Random, configurable sizes
- CLI outputs hit rates + hottest source lines

**Usage:**

```bash
./backend/scripts/cache-explore examples/sequential.c --config educational
```

## What's Missing

### High Priority (MVP for web)

- [x] Web frontend (Monaco editor, cache visualization)
- [x] Backend server (compile endpoint)
- [ ] Better error messages when compilation fails
- [ ] WebSocket for streaming (currently batch only)

### Medium Priority

- [ ] Multi-threading support (see roadmap below)
- [ ] Optimization suggestions ("consider padding this struct")

## Multi-Threading Roadmap

### Overview
Support multi-threaded programs with per-core caches, MESI coherence, and false sharing detection.

### Components

**1. Runtime - Thread ID tracking**
```c
// Add to CacheEvent
typedef struct {
  uint64_t address;
  uint32_t size;
  uint32_t line;
  uint32_t thread_id;  // NEW
} CacheEvent;

// Capture with pthread_self() or gettid()
```

**2. Trace Format**
```
L 0x7fff1234 4 main.c:10       # current (single-threaded)
L 0x7fff1234 4 main.c:10 T3    # with thread ID
```

**3. Multi-Core Cache System**
- N copies of L1 (one per core/thread)
- Shared L2/L3
- Thread → Core mapping (round-robin or pinned)

**4. MESI Coherence** (infrastructure exists in CoherenceController.hpp)
- Track cache line states across cores
- Snoop protocol for invalidations
- Writeback on M→S transitions

**5. False Sharing Detection**
Track: `{ cache_line_addr, byte_offset, thread_id, is_write }`
Flag when: same cache line, different offsets, different threads, at least one write

Example output:
```
WARNING: False sharing detected
  Cache line 0x7fff1200 accessed by threads 1, 2
  Thread 1: writes offset 0-3 (counter.c:45)
  Thread 2: writes offset 4-7 (counter.c:46)
  Consider: Add 60 bytes padding between fields
```

### Medium Priority

- [ ] Inline source annotations (Monaco decorations for hit/miss lines)
- [ ] Program input handling (stdin, command-line args via #define injection)
- [ ] Hardware validation (compare against `perf stat`, cachegrind)

### Low Priority / Future

- [ ] L1 Instruction cache simulation
  - Approach: Basic block instrumentation (1 call per BB instead of per instruction)
  - Track instruction fetch patterns
  - Model I-cache misses separately from D-cache
  - Challenge: Need to count instructions per BB at compile time
- [ ] TLB simulation
- [ ] GCC support via Intel Pin
- [ ] ARM cache models

## Known Issues

1. L3 simulation assumes single-core (no cross-core sharing)

Note: Runtime library accesses are NOT tracked (it's pre-compiled without the pass).
Compiler-generated code without debug info is filtered in the LLVM pass.

## File Structure

```
backend/
├── llvm-pass/CacheExplorerPass.cpp   # instrumentation
├── runtime/cache-explorer-rt.c        # event buffering
├── cache-simulator/
│   ├── src/main.cpp                   # CLI entry
│   ├── src/CacheLevel.cpp             # cache logic
│   ├── src/CacheSystem.cpp            # L1/L2/L3 coordination
│   └── include/*.hpp                  # data structures
└── scripts/cache-explore              # wrapper script
```

## Running the App

```bash
# Terminal 1 - Backend
cd backend/server && npm start

# Terminal 2 - Frontend
cd frontend && npm run dev
```

Frontend: http://localhost:5173
Backend: http://localhost:3001
