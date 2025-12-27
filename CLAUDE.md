# CLAUDE.md - Cache Explorer Project Guide

## ⚠️ IMPORTANT: Project Requirements

**📋 See `PROJECT_REQUIREMENTS.md` for the complete, authoritative specification.**

That document defines every requirement for Cache Explorer 1.0 release. It includes:
- Prioritized roadmap (P0/P1/P2/P3)
- Current completion status (~55%)
- Release checklists (Alpha → Beta → 1.0)
- All feature requirements with checkboxes

**🔄 IMPORTANT:** Update `PROJECT_REQUIREMENTS.md` as features are implemented!
- Check off completed items `[x]`
- Update completion percentages
- Move items between priority tiers if needed

**Current Status:** Alpha complete, targeting Beta release.

**Critical Path to Beta (P0):**
1. ~~WebSocket real-time streaming~~ ✅ DONE
2. ~~Docker sandbox for code execution~~ ✅ DONE
3. ~~Quick Start documentation~~ ✅ DONE
4. Better compilation error messages (1 day)
5. Hardware validation vs `perf` (2 days)

---

## Project Overview

**Cache Explorer** is a visual cache profiler that shows how code interacts with CPU cache hierarchies in real-time. Think "Compiler Explorer for cache behavior" - engineers paste code, instantly see cache hits/misses with source-level attribution, understand performance bottlenecks, and learn optimization techniques.

**Primary Goal:** Make cache hierarchies understandable through interactive visualization, helping developers learn performance optimization and profile production code.

**Impact Goal:** Become THE standard tool for cache analysis - as essential as Compiler Explorer is for assembly, as trusted as perf/VTune but with better UX.

## Architecture: LLVM Instrumentation Pass

**Core Technology: Compile-time instrumentation + runtime profiling**

```
User Code → Clang + CacheProfilerPass → Instrumented Binary → Runs (2-5x overhead)
                                              ↓
                                    Runtime Library tracks accesses
                                              ↓
                                    Cache Simulator (L1/L2/L3)
                                              ↓
                                    WebSocket → Browser Visualization
```

### Why This Architecture

**Evaluated alternatives:**
- ❌ lli interpreter: Too slow (100-1000x), can't handle real code
- ❌ Static analysis: Fundamentally limited, can't handle dynamic addresses
- ❌ WASM: Missing language features (malloc, threads), loses semantic info
- ❌ Binary instrumentation: Slower (5-20x), harder source attribution, save for GCC support later

**LLVM pass wins:**
- ✅ Fast: 2-5x overhead (production-acceptable)
- ✅ Complete: Sees every memory access, deterministic
- ✅ Accurate: Source-level attribution via debug info
- ✅ Proven: Same approach as AddressSanitizer, ThreadSanitizer
- ✅ Scalable: Works on real codebases, integrates with build systems
- ✅ Flexible: Web UI (learning) + CLI (production profiling)

### How It Works

**1. Compilation (LLVM Pass):**
```cpp
// CacheProfilerPass inserts tracking calls
// Original code:
int x = arr[i];

// Instrumented code:
__cache_track_load(&arr[i], 4, "file.c", 42);
int x = arr[i];
```

**2. Execution (Runtime Library):**
```cpp
// Lightweight C library linked into binary
void __cache_track_load(void* addr, uint32_t size, const char* file, uint32_t line) {
    // Buffer event, send to cache simulator
    event_buffer[count++] = {addr, size, file, line, READ};
}
```

**3. Simulation (Cache Model):**
```cpp
// Simulates L1/L2/L3 hierarchy
for (auto& event : events) {
    CacheResult result = cache_sim.access(event.addr, event.size);
    if (result.miss) {
        // Analyze pattern, generate insights
        detect_false_sharing(event);
        suggest_optimization(event);
    }
}
```

**4. Visualization (Web UI):**
- Real-time cache state updates
- Source code highlighting on events
- Timeline of hits/misses
- Performance suggestions

## Deployment Model

### Web Application (Primary - Learning)
```
Browser → WebSocket → Backend Server
                         ↓
                   Clang + CacheProfiler.so
                         ↓
                   Execute instrumented binary
                         ↓
                   Stream cache events back
```

**User experience:**
1. Paste C/C++/Rust code in browser
2. Click "Run"
3. Server compiles with instrumentation
4. Executes and simulates cache (fast! 2-5x overhead)
5. Real-time visualization in browser

**Like Compiler Explorer, but for runtime cache behavior.**

### CLI Tool (Secondary - Production)
```bash
# Local profiling workflow
cache-explorer compile mycode.c -O2
cache-explorer run ./a.out
cache-explorer report --html

# Or integrated with build:
clang -fpass-plugin=CacheProfiler.so mycode.c
./a.out  # Generates cache-profile.json
cache-explorer visualize cache-profile.json
```

**Both modes use the same LLVM pass + cache simulator.**

## Project Structure

```
cache-explorer/
├── backend/
│   ├── llvm-pass/                      # CORE: Compiler instrumentation
│   │   ├── CacheProfilerPass.cpp       # LLVM pass that inserts tracking
│   │   ├── PassRegistry.cpp            # Register with Clang
│   │   └── CMakeLists.txt
│   │
│   ├── runtime/                        # CORE: Event tracking library
│   │   ├── cache-profiler-rt.c         # __cache_track_load/store
│   │   ├── event-buffer.c              # Efficient buffering
│   │   └── CMakeLists.txt
│   │
│   ├── cache-simulator/                # CORE: Cache model
│   │   ├── CacheSimulator.cpp          # Main simulator
│   │   ├── CacheLevel.cpp              # L1/L2/L3 hierarchy
│   │   ├── ReplacementPolicy.cpp       # LRU, FIFO, etc.
│   │   ├── CoherenceProtocol.cpp       # MESI (multi-threading)
│   │   ├── FalseSharingDetector.cpp    # Detects conflicts
│   │   └── CMakeLists.txt
│   │
│   ├── server/                         # Web backend
│   │   ├── CompilationService.cpp      # Wraps Clang + pass
│   │   ├── ExecutionSandbox.cpp        # Secure execution (Docker)
│   │   ├── WebSocketServer.cpp         # Streams events to client
│   │   ├── SessionManager.cpp          # Manages user sessions
│   │   └── CMakeLists.txt
│   │
│   ├── cli/                            # Command-line tool
│   │   ├── main.cpp                    # Entry point
│   │   ├── ProfileRunner.cpp           # Local profiling workflow
│   │   ├── ReportGenerator.cpp         # HTML/terminal output
│   │   └── CMakeLists.txt
│   │
│   └── CMakeLists.txt                  # Root build
│
├── frontend/                           # Web UI
│   ├── src/
│   │   ├── components/
│   │   │   ├── CodeEditor.tsx          # Monaco editor
│   │   │   ├── CacheVisualizer.tsx     # Cache state display
│   │   │   ├── MemoryView.tsx          # Address space view
│   │   │   ├── Timeline.tsx            # Event timeline
│   │   │   └── SourceAnnotations.tsx   # Inline perf hints
│   │   ├── lib/
│   │   │   ├── websocket.ts            # Backend connection
│   │   │   └── cache-renderer.ts       # Visualization logic
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts
│
├── docker/
│   ├── Dockerfile.sandbox              # Secure execution env
│   └── seccomp-profile.json            # Syscall whitelist
│
├── examples/                           # Educational examples
│   ├── matrix-multiply.c               # Row vs column major
│   ├── linked-list.c                   # Pointer chasing
│   ├── false-sharing.c                 # Multi-threaded conflicts
│   └── cache-oblivious.c               # Advanced patterns
│
├── docs/
│   ├── architecture.md                 # System design
│   ├── llvm-pass-guide.md             # Implementation details
│   └── cache-theory.md                 # Educational content
│
├── scripts/
│   ├── setup.sh                        # Initial setup
│   └── build.sh                        # Build all components
│
├── CLAUDE.md                           # This file
├── README.md                           # User-facing docs
└── .gitignore
```

## Technical Components

### 1. LLVM Pass (Instrumentation)

**File:** `backend/llvm-pass/CacheProfilerPass.cpp`

**Responsibilities:**
- Walk LLVM IR, find LoadInst and StoreInst
- Insert calls to tracking functions before each memory operation
- Preserve debug info (DILocation) for source attribution
- Optimize: only instrument hot paths, configurable sampling

**Key challenge:** Efficient instrumentation without excessive overhead

### 2. Runtime Library (Tracking)

**File:** `backend/runtime/cache-profiler-rt.c`

**Responsibilities:**
- Provide `__cache_track_load/store` functions
- Buffer events efficiently (circular buffer, batching)
- Write to shared memory or file for cache simulator
- Minimal overhead (<1% beyond instrumentation)

**Key challenge:** Low-latency event recording

### 3. Cache Simulator (Analysis)

**Files:** `backend/cache-simulator/*.cpp`

**Responsibilities:**
- Model L1/L2/L3 cache hierarchy accurately
- Implement replacement policies (LRU, FIFO, Random, etc.)
- Cache coherence for multi-threading (MESI protocol)
- Detect patterns: false sharing, cache thrashing, strided access
- Generate optimization suggestions

**Key challenge:** Accuracy + performance of simulation

### 4. Web Server (Orchestration)

**Files:** `backend/server/*.cpp`

**Responsibilities:**
- Accept code from frontend via WebSocket
- Compile with Clang + CacheProfiler pass
- Execute instrumented binary in Docker sandbox
- Stream cache events to frontend in real-time
- Manage concurrent user sessions

**Key challenge:** Security (untrusted code execution)

### 5. Frontend (Visualization)

**Files:** `frontend/src/**/*.tsx`

**Responsibilities:**
- Code editor with syntax highlighting
- Real-time cache state visualization (hit/miss ratios, heat maps)
- Timeline showing memory access patterns
- Source code annotations with performance hints
- Interactive controls (run, step, pause, reset)

**Key challenge:** Smooth visualization of high-frequency events

## Build System

**Root CMakeLists.txt:**
```cmake
cmake_minimum_required(VERSION 3.20)
project(CacheExplorer)

find_package(LLVM REQUIRED CONFIG)

add_subdirectory(llvm-pass)      # Builds CacheProfiler.so
add_subdirectory(runtime)        # Builds libcache-profiler-rt.a
add_subdirectory(cache-simulator) # Builds libcache-sim.a
add_subdirectory(server)         # Builds cache-explorer-server
add_subdirectory(cli)            # Builds cache-explorer CLI
```

**Build commands:**
```bash
./scripts/setup.sh      # Install dependencies
./scripts/build.sh      # Build all components
```

## Development Phases

### Phase 1: Core Profiler

**Goal:** Working cache profiler with web UI

**Deliverables:**
- LLVM pass that instruments loads/stores
- Runtime library for event tracking
- Basic cache simulator (L1/L2/L3, LRU only)
- Web server (compilation + execution)
- Simple visualization (hit/miss counts, cache state)

**Success criteria:** Users can paste code, see cache behavior

### Phase 2: Advanced Features

**Goal:** Production-grade profiler

**Deliverables:**
- Multiple replacement policies (LRU, FIFO, Random, Pseudo-LRU)
- Multi-threading support (pthread tracking)
- Cache coherence simulation (MESI protocol)
- False sharing detection
- Better visualization (timelines, heat maps, source annotations)
- Optimization suggestions

**Success criteria:** Competes with cachegrind for functionality, better UX

### Phase 3: Scale & Extensions

**Goal:** Industry standard tool

**Deliverables:**
- CLI tool for local profiling
- Build system integration (CMake, Bazel, Cargo)
- Hardware validation (compare sim vs perf counters)
- Binary instrumentation (Intel Pin) for GCC support
- TLB simulation (future feature)
- Example library + tutorials
- Blog posts + academic paper

**Success criteria:** Used in production, cited in research

## Key Technical Challenges

### 1. LLVM Pass Implementation
- **Challenge:** Insert instrumentation without breaking optimizations
- **Solution:** Use IRBuilder, preserve debug info, run late in pipeline

### 2. Instrumentation Overhead
- **Challenge:** 2-5x overhead target
- **Solution:** Lightweight runtime, batch events, optional sampling

### 3. Cache Simulator Accuracy
- **Challenge:** Model real hardware behavior correctly
- **Solution:** Configurable parameters, validate against perf counters

### 4. Multi-threading Correctness
- **Challenge:** Cache coherence is complex (MESI state machine)
- **Solution:** Careful implementation, extensive testing, reference papers

### 5. False Sharing Detection
- **Challenge:** Detect when threads conflict on same cache line
- **Solution:** Track per-thread access patterns, correlate by cache line address

### 6. Security (Web App)
- **Challenge:** Execute untrusted user code safely
- **Solution:** Docker containers, seccomp filtering, resource limits, timeouts

### 7. Real-time Visualization
- **Challenge:** Stream high-frequency events smoothly
- **Solution:** Event batching, WebSocket, client-side buffering

## Language Support

**Tier 1 (Full Support):**
- C (Clang)
- C++ (Clang)
- Rust (LLVM backend)

**Tier 2 (Future):**
- Swift (LLVM backend)
- Any LLVM-based language

**Tier 3 (Possible via Pin):**
- GCC-compiled binaries (Phase 3)
- Proprietary compilers (Phase 3)

## Testing Strategy

**Unit Tests:**
- Cache simulator logic (hit/miss correctness)
- Replacement policies (LRU behavior)
- Coherence protocol (MESI state transitions)

**Integration Tests:**
- Small C programs with known cache behavior
- Compare simulation vs expected results

**Validation Tests:**
- Run same code with perf counters
- Compare simulated vs actual cache statistics
- Ensure simulator accuracy

**Example Test Cases:**
```c
// Sequential access (should hit after first miss)
int arr[1000];
for (int i = 0; i < 1000; i++) arr[i] = i;

// Strided access (tests cache line behavior)
for (int i = 0; i < 1000; i += 16) arr[i] = i;

// Column-major (should miss frequently)
for (int i = 0; i < N; i++)
    for (int j = 0; j < M; j++)
        matrix[j][i] = 0;
```

## Competitive Landscape

| Tool | Strengths | Weaknesses | Our Advantage |
|------|-----------|------------|---------------|
| **perf** | Low overhead, HW counters | Batch-only, cryptic output, steep learning curve | Real-time, interactive, visual |
| **VTune** | Comprehensive, accurate | Expensive, Intel-only, complex UI | Open source, cross-platform, simpler |
| **cachegrind** | Accurate simulation | Slow (50x), no visualization, outdated | Faster (2-5x), modern UI, educational |
| **Compiler Explorer** | Amazing UX, interactive | Static only (assembly), no runtime | Runtime profiling, cache-specific insights |

**Our differentiation:**
- Interactive exploration (not batch)
- Educational AND practical
- Modern web UI
- Open source
- Source-level insights
- Real-time feedback

## Success Metrics

**Technical:**
- ✅ 2-5x overhead (vs 50x cachegrind)
- ✅ <100ms latency for small programs
- ✅ Handles 10K+ LOC programs
- ✅ Cache simulator accuracy >95% vs real hardware

**Adoption:**
- ✅ 1000+ GitHub stars in Year 1
- ✅ Used in university courses
- ✅ Production users (companies profiling code)
- ✅ Conference talks (LLVM Dev Meeting, PLDI)
- ✅ Citations in research papers

**Impact:**
- ✅ "Compiler Explorer for cache behavior"
- ✅ Go-to tool for learning cache optimization
- ✅ Trusted for production profiling

## Resources

**LLVM:**
- [Writing LLVM Passes](https://llvm.org/docs/WritingAnLLVMPass.html)
- [LLVM IR Reference](https://llvm.org/docs/LangRef.html)
- [AddressSanitizer design](https://github.com/google/sanitizers/wiki/AddressSanitizerAlgorithm)

**Cache Architecture:**
- [What Every Programmer Should Know About Memory](https://people.freebsd.org/~lstewart/articles/cpumemory.pdf)
- [MESI Protocol](https://en.wikipedia.org/wiki/MESI_protocol)
- [Intel Optimization Manual](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html)

**Reference Implementations:**
- [cachegrind](https://valgrind.org/docs/manual/cg-manual.html)
- [Compiler Explorer](https://github.com/compiler-explorer/compiler-explorer)
- [perf](http://www.brendangregg.com/perf.html)

## Common Pitfalls

1. **Over-instrumenting** - Focus on memory ops only
2. **Ignoring debug info** - DILocation is crucial
3. **Buffering naively** - Use circular buffers + batching
4. **Cache model too simple** - Need realistic associativity, replacement
5. **Docker overkill** - Keep containers lightweight
6. **Visualization lag** - Batch events, don't send one-by-one

## Questions for AI Assistants

When helping with this project:

1. **What phase are we in?**
2. **What component?** (LLVM pass, simulator, frontend, etc.)
3. **What's the specific issue?**
4. **Have you built the LLVM pass yet?**
5. **Testing with simple C first?**

## This Document

Last updated: December 2024
Project status: Architecture finalized, ready to implement
Next step: Build LLVM pass + runtime library (Phase 1)
