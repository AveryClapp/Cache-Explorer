# Intel Pin Integration - Production-Ready Design

**Date:** 2026-02-16
**Status:** Approved
**Scope:** Production-ready Intel Pin integration with full feature parity to LLVM pass
**Platform:** Linux x64 first, expand to other platforms later

---

## Executive Summary

Add production-grade Intel Pin support to Cache Explorer, enabling cache profiling of pre-compiled binaries (GCC, MSVC, proprietary software) without source code or recompilation. This unlocks analysis of closed-source software, Rust programs, and third-party libraries.

**Goals:**
- ✅ Full feature parity with LLVM pass (vector, atomic, instruction cache, memory intrinsics)
- ✅ Zero breaking changes to existing LLVM pipeline
- ✅ Automated testing with 90%+ coverage
- ✅ CI/CD integration for Linux x64
- ✅ Docker and web UI support

**Non-Goals (Future Work):**
- macOS/Windows support (Phase 2+)
- Performance optimizations (acceptable 10-50x overhead for v1)
- Multi-socket NUMA with Pin (research needed)

---

## Architecture Overview

### Core Principle: Backward Compatibility First

The existing LLVM pipeline continues working unchanged throughout development. The shared library is additive, not disruptive.

### Project Structure

```
backend/
├── libcache-events/          # NEW - Shared event library
│   ├── include/
│   │   ├── cache_events.h    # Event types & flags
│   │   ├── trace_format.h    # Binary trace encoding
│   │   └── file_table.h      # Source file interning
│   ├── src/
│   │   ├── trace_writer.c    # Binary trace output
│   │   └── file_table.c      # File interning
│   ├── tests/                # TDD unit tests
│   └── CMakeLists.txt        # Builds libcache-events.{a,so}
│
├── runtime/                  # EXISTING - Keep working as-is
│   ├── cache-explorer-rt.c   # Phase 2: Optionally migrate to shared lib
│   └── cache-explorer-rt.h   # Keep current API unchanged
│
├── pin-tool/                 # EXISTING - Gets rewritten
│   ├── cache_profiler.cpp    # NEW: Links against libcache-events
│   ├── tests/                # NEW: Integration tests
│   └── Makefile
│
└── cache-simulator/          # EXISTING - Minimal changes
    └── src/main.cpp          # Supports both text and binary trace formats
```

### Migration Strategy (No Breaking Changes)

**Phase 1: Create shared library + new Pin tool** (8 weeks)
- Build `libcache-events` alongside existing code
- Rewrite Pin tool to use it
- LLVM runtime stays exactly as-is
- cache-sim learns to read binary format (keeps text format support)
- **Result:** Pin tool works, LLVM pipeline unchanged

**Phase 2 (Optional): Migrate LLVM runtime** (Future)
- After Phase 1 ships and stabilizes (4+ weeks)
- Refactor LLVM runtime to use shared library
- Extensive testing before merging
- Text format kept as legacy option

### Compatibility Guarantees

✅ Existing `cache-explore` CLI works unchanged
✅ All current tests keep passing
✅ LLVM pass output format unchanged (or dual-format support)
✅ cache-sim handles both text and binary traces
✅ Web UI sees no changes

---

## Component Design

### 1. libcache-events (New Shared Library)

**Purpose:** Single source of truth for event types, trace format, and encoding logic.

#### Key Files

**`include/cache_events.h`** - Event type definitions
```c
// Event flags (matches existing LLVM runtime exactly)
#define EVENT_STORE_FLAG    (1ULL << 63)
#define EVENT_ICACHE_FLAG   (1ULL << 62)
#define EVENT_PREFETCH_FLAG (1ULL << 61)
#define EVENT_VECTOR_FLAG   (1ULL << 60)
#define EVENT_ATOMIC_FLAG   (1ULL << 59)
#define EVENT_ATOMIC_RMW    (2ULL << 57)
#define EVENT_ATOMIC_CMPXCHG (3ULL << 57)
#define EVENT_MEMINTR_FLAG  (1ULL << 56)
#define EVENT_MEMSET_TYPE   (1ULL << 54)
#define EVENT_MEMMOVE_TYPE  (2ULL << 54)
#define EVENT_ADDR_MASK     0x00FFFFFFFFFFFFFFULL

typedef struct {
  uint64_t address;      // With flags in high bits
  uint64_t src_address;  // For memcpy/memmove
  uint32_t size;
  uint32_t line;
  uint32_t file_id;      // Interned filename
  uint32_t thread_id;
} CacheEvent;
```

**`include/trace_writer.h`** - Trace output interface
```c
typedef struct TraceWriter TraceWriter;

TraceWriter* trace_writer_create(const char* path, TraceFormat format);
void trace_writer_emit_event(TraceWriter* w, const CacheEvent* event);
void trace_writer_emit_file_mapping(TraceWriter* w, uint32_t id, const char* path);
void trace_writer_close(TraceWriter* w);

typedef enum {
  TRACE_FORMAT_TEXT,    // Current format: "L 0x1234 4 file.c:10 T0"
  TRACE_FORMAT_BINARY   // New format: packed binary
} TraceFormat;
```

**`include/file_table.h`** - Source file interning
```c
typedef struct FileTable FileTable;

FileTable* file_table_create(void);
uint32_t file_table_intern(FileTable* ft, const char* path);
const char* file_table_get(FileTable* ft, uint32_t id);
void file_table_destroy(FileTable* ft);
```

**Build:** CMake produces both `libcache-events.a` (static) and `libcache-events.so` (shared)

---

### 2. Pin Tool (Rewritten)

**Full event type support:**
- ✅ Loads/stores (existing)
- ✅ Instruction fetches (NEW - track every instruction execution)
- ✅ Vector/SIMD operations (NEW - detect SSE/AVX via `INS_Category`)
- ✅ Atomic operations (NEW - detect LOCK prefix, CMPXCHG, etc.)
- ✅ Memory intrinsics (NEW - intercept memcpy/memset/memmove via `RTN_Replace`)

**Implementation Highlights:**

```cpp
// cache_profiler.cpp (rewritten)
#include "cache_events.h"
#include "trace_writer.h"
#include "pin.H"

TraceWriter* writer = trace_writer_create("trace.bin", TRACE_FORMAT_BINARY);

// Instruction fetch tracking (NEW)
VOID RecordInstructionFetch(THREADID tid, ADDRINT ip, UINT32 size) {
  CacheEvent event = {
    .address = ip | EVENT_ICACHE_FLAG,
    .size = size,
    // ... source location
  };
  trace_writer_emit_event(writer, &event);
}

// Vector operation detection (NEW)
if (INS_Category(ins) == XED_CATEGORY_SSE ||
    INS_Category(ins) == XED_CATEGORY_AVX) {
  // Set EVENT_VECTOR_FLAG
}

// Atomic detection (NEW)
if (INS_IsAtomicUpdate(ins) || INS_HasRealRep(ins)) {
  // Set EVENT_ATOMIC_FLAG with appropriate subtype
}

// Intercept libc functions (NEW)
RTN memcpy_rtn = RTN_FindByName(img, "memcpy");
if (RTN_Valid(memcpy_rtn)) {
  RTN_Replace(memcpy_rtn, (AFUNPTR)Instrumented_memcpy);
}
```

---

### 3. cache-sim (Minimal Changes)

**Current:** Reads text format from stdin
**New:** Supports both text and binary formats (auto-detected)

```cpp
// main.cpp changes (< 50 lines)
char magic[4];
fread(magic, 1, 4, stdin);

if (memcmp(magic, "CEXP", 4) == 0) {
  parse_binary_trace(stdin);  // NEW path
} else {
  rewind(stdin);
  parse_text_trace(stdin);    // EXISTING path (unchanged)
}
```

**Benefit:** Existing workflows unchanged, new binary format is faster.

---

### 4. LLVM Runtime (Phase 2 - Optional Migration)

**Current:** Standalone implementation
**Future:** Links against `libcache-events` for consistency

Migration is gradual. Text format kept as fallback during transition.

---

## Data Flow

### Flow 1: LLVM Pass Pipeline (Existing - Unchanged)

```
Source Code (C/C++/Zig)
    ↓
Clang + CacheExplorerPass.so
    ↓
Instrumented Binary (linked with cache-explorer-rt)
    ↓
__tag_mem_load/store() calls
    ↓
Text trace to stdout: "L 0x7fff1234 4 main.c:10 T0"
    ↓
cache-sim --json (reads text format)
    ↓
JSON output to WebSocket/CLI
```

**Phase 1:** Zero changes to this flow
**Phase 2:** Runtime optionally uses libcache-events, but text format stays supported

---

### Flow 2: Pin Tool Pipeline (New)

```
Pre-compiled Binary (any compiler, any language)
    ↓
pin -t cache_profiler.so -- ./binary
    ↓
Pin intercepts every instruction
    ↓
cache_profiler.so classifies events:
  - Memory ops → CacheEvent (data cache)
  - Instructions → CacheEvent (instruction cache)
  - Vector ops → CacheEvent (with VECTOR flag)
  - Atomics → CacheEvent (with ATOMIC flag)
  - memcpy/memset → RTN_Replace → CacheEvent
    ↓
trace_writer_emit_event() (from libcache-events)
    ↓
Binary trace file: trace.bin
    ↓
cache-sim --json < trace.bin (auto-detects binary format)
    ↓
JSON output (identical to LLVM flow)
```

---

### Trace Format Details

**Text Format (Current - Kept for compatibility):**
```
L 0x7fff5fbff8e0 4 main.c 42 T0         # Load
S 0x7fff5fbff8e4 8 main.c 43 T0         # Store
I 0x400000 5 main.c 42 T0               # Instruction (NEW)
V L 0x7fff5fbff900 32 main.c 50 T0      # Vector load (NEW)
A S 0x7fff5fbff910 4 main.c 55 T0       # Atomic store (NEW)
M memcpy 0x1000 0x2000 128 main.c 60 T0 # memcpy (NEW)
```

**Binary Format (New - Faster, more compact):**
```
Header:
  [Magic: "CEXP"]
  [Version: 1]
  [Event count: uint64]

File Table:
  [Count: uint32]
  [Entry 0: id=0, path="main.c"]
  [Entry 1: id=1, path="utils.c"]
  ...

Event Stream (packed struct):
  [CacheEvent] 24 bytes each
  [CacheEvent]
  ...
```

**Performance:** Text ~60 bytes/event, Binary ~24 bytes/event (60% smaller), parsing 3-5x faster.

---

### Integration with Web UI

**Current flow:** User uploads code → Backend compiles with LLVM pass → cache-sim → WebSocket → Frontend

**New flow (Pin mode):** User uploads binary → Backend runs Pin tool → cache-sim → WebSocket → Frontend

**UI Changes:**
```tsx
// Add toggle in upload dialog
<RadioGroup>
  <Radio value="source">Source Code (C/C++/Zig)</Radio>
  <Radio value="binary">Pre-compiled Binary</Radio>  {/* NEW */}
</RadioGroup>
```

**Backend changes:**
```js
// server.js
if (req.body.mode === 'binary') {
  execSync('cache-explore-pin ./binary');
} else {
  execSync('cache-explore ./source.c');  // Existing
}
```

---

## Error Handling

### 1. Build-Time Errors (Backward Compatibility)

**Problem:** What if libcache-events fails to build?

**Solution:** Make it optional in Phase 1

```cmake
# backend/CMakeLists.txt
option(BUILD_LIBCACHE_EVENTS "Build shared event library" ON)

if(BUILD_LIBCACHE_EVENTS)
  add_subdirectory(libcache-events)
  add_subdirectory(pin-tool)
endif()

# Existing components always build
add_subdirectory(runtime)
add_subdirectory(cache-simulator)
add_subdirectory(llvm-pass)
```

**Result:** If libcache-events fails, LLVM pipeline still works.

---

### 2. Pin Tool Runtime Errors

**Pin not installed:**
```bash
Error: Intel Pin not found.
Download from: https://intel.com/pin
Then: export PIN_ROOT=/path/to/pin
```

**Binary lacks debug info:**
```bash
Warning: Binary lacks debug info. Source attribution limited.
Continuing with address-only attribution...
```

**Pin crashes:**
```bash
Pin error: Segmentation fault in target binary
Workaround: Use cache-explore with source code instead.
```

---

### 3. Trace Format Errors

**Corrupted trace:**
```cpp
if (!validate_binary_header(stdin)) {
  std::cerr << "Error: Corrupted trace (invalid magic/version)\n";
  return 1;
}
```

**Format auto-detection with fallback:**
```cpp
try {
  parse_binary_trace(stdin);
} catch (const std::exception& e) {
  rewind(stdin);
  parse_text_trace(stdin);  // Fallback
}
```

---

### 4. Library ABI Compatibility

**Problem:** LLVM runtime and Pin tool using different libcache-events versions?

**Solution:** Semantic versioning + ABI stability

```c
#define CACHE_EVENTS_ABI_VERSION 1  // Only bump on breaking changes

void trace_writer_init(void) {
  if (cache_events_abi_version() != CACHE_EVENTS_ABI_VERSION) {
    fprintf(stderr, "Error: ABI version mismatch\n");
    abort();
  }
}
```

---

## Testing Strategy (Test-Driven Development)

### TDD Workflow

**Rule:** Every feature starts with a failing test. No implementation without a test.

```
1. Write failing test    # RED
2. Implement feature     # GREEN
3. Verify test passes    # GREEN
4. Refactor if needed    # REFACTOR
5. Commit both together  # Never commit code without its test
```

---

### Test Categories

#### 1. Unit Tests - libcache-events

**File:** `backend/libcache-events/tests/test_events.c`

```c
void test_event_flags() {
  CacheEvent load = {.address = 0x1000};
  CacheEvent store = {.address = 0x1000 | EVENT_STORE_FLAG};
  assert(!is_store(load));
  assert(is_store(store));
}

void test_vector_flag() { /* ... */ }
void test_atomic_subtypes() { /* ... */ }
void test_instruction_fetch() { /* ... */ }
```

**Status:** Write all tests → Run → All FAIL → Implement → All PASS

---

#### 2. Trace Format Tests

**File:** `backend/libcache-events/tests/test_trace_format.c`

```c
void test_text_format_compatibility() {
  CacheEvent load = { /* populate */ };
  char* output = event_to_text(&load);
  assert(strcmp(output, "L 0x7fff1234 4 main.c 42 T0") == 0);
}

void test_binary_format_roundtrip() { /* serialize → deserialize → verify */ }
void test_file_table_interning() { /* ... */ }
```

---

#### 3. Pin Tool Integration Tests

**File:** `backend/pin-tool/tests/test_pin_tool.cpp`

```cpp
void test_basic_memory_operations() {
  system("gcc -g -o /tmp/test tests/fixtures/basic.c");
  system("pin -t cache_profiler.so -- /tmp/test");

  auto events = parse_trace("cache_trace.txt");
  assert(has_event(events, EVENT_TYPE_LOAD));
  assert(has_event(events, EVENT_TYPE_STORE));
}

void test_instruction_fetch() { /* verify instruction cache events */ }
void test_vector_operations() { /* verify SIMD tracking */ }
void test_atomic_operations() { /* verify atomic flags */ }
void test_memory_intrinsics() { /* verify memcpy/memset */ }
```

---

#### 4. Backward Compatibility Tests (Critical!)

**File:** `tests/regression/test_llvm_unchanged.sh`

```bash
#!/bin/bash
# MUST pass at all times during Phase 1

./backend/scripts/cache-explore examples/sequential.c --json > /tmp/test.json
jq '.levels.l1d.hits' /tmp/test.json > /dev/null

cd backend/cache-simulator/build
./CacheLevelTest || exit 1
./CacheSystemTest || exit 1

echo "✅ LLVM pipeline unchanged"
```

**Run after EVERY commit.**

---

#### 5. Format Compatibility Tests

**File:** `tests/integration/test_format_compatibility.cpp`

```cpp
void test_pin_vs_llvm_consistency() {
  // Compile with LLVM pass
  system("./cache-explore tests/fixtures/simple.c --json > /tmp/llvm.json");

  // Compile with GCC, trace with Pin
  system("gcc -g -o /tmp/simple tests/fixtures/simple.c");
  system("./cache-explore-pin /tmp/simple --json > /tmp/pin.json");

  auto llvm = parse_json("/tmp/llvm.json");
  auto pin = parse_json("/tmp/pin.json");

  // Verify same hit rates (within tolerance)
  assert(abs(llvm.l1d_hit_rate - pin.l1d_hit_rate) < 0.05);
}
```

---

### CI/CD Integration

**File:** `.github/workflows/pin-tool-ci.yml`

```yaml
name: Pin Tool CI

jobs:
  test-backward-compatibility:
    runs-on: ubuntu-latest
    steps:
      # CRITICAL: Regression tests FIRST
      - name: Verify LLVM pipeline unchanged
        run: ./tests/regression/test_llvm_unchanged.sh

      - name: Build libcache-events
        run: cd backend/libcache-events && cmake . && make && ctest

      - name: Download Intel Pin
        run: wget [pin-url] && tar xzf pin.tar.gz

      - name: Build Pin tool
        run: cd backend/pin-tool && make PIN_ROOT=$PWD/../pin

      - name: Run Pin tool tests
        run: cd backend/pin-tool/tests && ./run_all_tests.sh
```

---

### Test Coverage Goals

| Component | Unit Tests | Integration Tests | Coverage |
|-----------|------------|-------------------|----------|
| libcache-events | 20+ | N/A | >90% |
| Pin tool | N/A | 15+ | >80% |
| cache-sim | 5+ new | 10+ | >90% |
| Backward compat | N/A | 5+ | 100% |

---

## Implementation Timeline

### Phase 1: Production-Ready Pin Tool (8 weeks)

**Week 1-2: Shared Library Foundation**
- Create `backend/libcache-events/` structure
- Write unit tests (TDD: write tests first)
- Implement event types, flags, trace writer
- Implement file table interning
- Binary trace format encoder/decoder
- All tests passing

**Week 3-4: Pin Tool Rewrite**
- Write integration tests (fixtures + assertions)
- Rewrite `cache_profiler.cpp` using libcache-events
- Implement instruction fetch tracking
- Implement vector/SIMD detection
- Implement atomic operation detection
- All tests passing

**Week 5-6: Memory Intrinsics + cache-sim**
- Implement memcpy/memset/memmove interception via RTN_Replace
- Add binary format parser to cache-sim
- Format auto-detection logic
- Backward compatibility testing (text format still works)
- All tests passing

**Week 7-8: CI/CD, Docker, Web UI**
- Add Pin tool to GitHub Actions CI
- Update Dockerfile to include Pin
- Add binary upload mode to web UI
- Add `cache-explore-pin` wrapper to Docker
- Documentation updates (README, CLAUDE.md)
- Final regression testing
- Release v2.0.0

---

## Success Criteria

- ✅ Pin tool generates traces with all event types (load, store, ifetch, vector, atomic, memcpy)
- ✅ Trace format compatibility: Pin and LLVM produce equivalent cache-sim results (<5% variance)
- ✅ Zero breaking changes: All existing tests pass throughout development
- ✅ Test coverage: >90% for libcache-events, >80% for Pin tool
- ✅ CI/CD: Automated builds and tests on Linux x64
- ✅ Docker: Pin tool works in container
- ✅ Web UI: Binary upload mode functional
- ✅ Documentation: README, tutorials, troubleshooting guide

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Pin ABI changes between versions | Medium | High | Test against Pin 3.28-3.30, document supported versions |
| Format incompatibility between tools | Low | High | Shared library guarantees consistency, extensive tests |
| Breaking existing LLVM pipeline | Low | Critical | Regression tests run on every commit, feature flags |
| Pin overhead too high (>100x) | Medium | Medium | Implement sampling, document performance trade-offs |
| Debug info missing in binaries | High | Low | Graceful degradation, clear warning messages |

---

## Future Enhancements (Post-Phase 1)

### Phase 2: macOS ARM64 Support (4 weeks)
- Pin on macOS has limitations (Intel-only in some versions)
- May require alternative (DynamoRIO, custom instrumentation)

### Phase 3: Performance Optimizations (2 weeks)
- Sampling strategies (spatial, temporal)
- Multi-threaded trace writing
- Compressed binary format

### Phase 4: Windows Support (4 weeks)
- Pin Windows build configuration
- Visual Studio integration
- Cross-platform CI

---

## Open Questions

None - design approved and ready for implementation.

---

## References

- [Intel Pin Documentation](https://www.intel.com/content/www/us/en/developer/articles/tool/pin-a-dynamic-binary-instrumentation-tool.html)
- [Cache Explorer CLAUDE.md](../../CLAUDE.md)
- [Cache Explorer GitHub Issue #2](https://github.com/AveryClapp/Cache-Explorer/issues/2)

---

**Status:** ✅ Approved for implementation
**Next Step:** Create implementation plan with writing-plans skill
