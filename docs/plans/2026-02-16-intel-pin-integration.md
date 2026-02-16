# Intel Pin Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add production-ready Intel Pin support enabling cache profiling of pre-compiled binaries without source code.

**Architecture:** Extract shared event library (libcache-events) for trace format consistency. Rewrite Pin tool to use shared library. Add binary trace format support to cache-sim. Zero breaking changes to existing LLVM pipeline.

**Tech Stack:** C (libcache-events), C++ (Pin tool, cache-sim), CMake, Intel Pin SDK, CTest

---

## Prerequisites

- Intel Pin 3.28+ downloaded and `PIN_ROOT` set
- LLVM toolchain installed
- Existing Cache Explorer builds successfully
- All existing tests pass (run `tests/regression/test_llvm_unchanged.sh`)

---

## Phase 1: Shared Library Foundation (Week 1-2)

### Task 1: Create libcache-events Project Structure

**Files:**
- Create: `backend/libcache-events/CMakeLists.txt`
- Create: `backend/libcache-events/include/cache_events.h`
- Create: `backend/libcache-events/include/trace_format.h`
- Create: `backend/libcache-events/include/file_table.h`
- Create: `backend/libcache-events/tests/CMakeLists.txt`

**Step 1: Create directory structure**

```bash
mkdir -p backend/libcache-events/{include,src,tests}
cd backend/libcache-events
```

**Step 2: Write CMakeLists.txt**

```cmake
# backend/libcache-events/CMakeLists.txt
cmake_minimum_required(VERSION 3.20)
project(libcache-events VERSION 1.0.0 LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

# Library sources
add_library(cache-events STATIC
  src/trace_writer.c
  src/file_table.c
)

target_include_directories(cache-events PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>
)

# Shared library variant
add_library(cache-events-shared SHARED
  src/trace_writer.c
  src/file_table.c
)

set_target_properties(cache-events-shared PROPERTIES
  OUTPUT_NAME cache-events
  VERSION ${PROJECT_VERSION}
  SOVERSION 1
)

target_include_directories(cache-events-shared PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>
)

# Tests
enable_testing()
add_subdirectory(tests)
```

**Step 3: Create event type header**

```c
// backend/libcache-events/include/cache_events.h
#ifndef CACHE_EVENTS_H
#define CACHE_EVENTS_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// ABI version - only bump on breaking changes
#define CACHE_EVENTS_ABI_VERSION 1
#define CACHE_EVENTS_VERSION_MAJOR 1
#define CACHE_EVENTS_VERSION_MINOR 0

// Event type flags in high bits of address (matches LLVM runtime)
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

// Cache event structure (24 bytes)
typedef struct {
  uint64_t address;      // With flags in high bits
  uint64_t src_address;  // For memcpy/memmove (0 if unused)
  uint32_t size;
  uint32_t line;
  uint32_t file_id;      // Interned filename
  uint32_t thread_id;
} CacheEvent;

// Helper functions for flag manipulation
static inline int is_store(const CacheEvent* e) {
  return (e->address & EVENT_STORE_FLAG) != 0;
}

static inline int is_instruction_fetch(const CacheEvent* e) {
  return (e->address & EVENT_ICACHE_FLAG) != 0;
}

static inline int is_vector(const CacheEvent* e) {
  return (e->address & EVENT_VECTOR_FLAG) != 0;
}

static inline int is_atomic(const CacheEvent* e) {
  return (e->address & EVENT_ATOMIC_FLAG) != 0;
}

static inline int is_memory_intrinsic(const CacheEvent* e) {
  return (e->address & EVENT_MEMINTR_FLAG) != 0;
}

static inline uint64_t get_address(const CacheEvent* e) {
  return e->address & EVENT_ADDR_MASK;
}

// Get library version
int cache_events_abi_version(void);
const char* cache_events_version_string(void);

#ifdef __cplusplus
}
#endif

#endif // CACHE_EVENTS_H
```

**Step 4: Create trace format header**

```c
// backend/libcache-events/include/trace_format.h
#ifndef TRACE_FORMAT_H
#define TRACE_FORMAT_H

#include "cache_events.h"
#include <stdio.h>

#ifdef __cplusplus
extern "C" {
#endif

// Trace format types
typedef enum {
  TRACE_FORMAT_TEXT,    // Human-readable: "L 0x1234 4 file.c:10 T0"
  TRACE_FORMAT_BINARY   // Packed binary with file table
} TraceFormat;

// Opaque trace writer handle
typedef struct TraceWriter TraceWriter;

// Create trace writer
TraceWriter* trace_writer_create(const char* path, TraceFormat format);

// Emit event to trace
void trace_writer_emit_event(TraceWriter* writer, const CacheEvent* event);

// Emit file mapping (for file_id -> filename resolution)
void trace_writer_emit_file_mapping(TraceWriter* writer, uint32_t file_id, const char* path);

// Close and flush trace
void trace_writer_close(TraceWriter* writer);

#ifdef __cplusplus
}
#endif

#endif // TRACE_FORMAT_H
```

**Step 5: Create file table header**

```c
// backend/libcache-events/include/file_table.h
#ifndef FILE_TABLE_H
#define FILE_TABLE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Opaque file table handle
typedef struct FileTable FileTable;

// Create file table
FileTable* file_table_create(void);

// Intern filename, return unique ID
uint32_t file_table_intern(FileTable* ft, const char* path);

// Get filename by ID
const char* file_table_get(FileTable* ft, uint32_t file_id);

// Get number of unique files
uint32_t file_table_count(FileTable* ft);

// Destroy file table
void file_table_destroy(FileTable* ft);

#ifdef __cplusplus
}
#endif

#endif // FILE_TABLE_H
```

**Step 6: Commit structure**

```bash
git add backend/libcache-events/
git commit -m "feat(libcache-events): add project structure and headers

- CMakeLists.txt for static and shared library builds
- cache_events.h with event types and flag definitions
- trace_format.h for trace writer interface
- file_table.h for filename interning
- ABI versioning for compatibility"
```

---

### Task 2: Implement Event Flag Unit Tests (TDD)

**Files:**
- Create: `backend/libcache-events/tests/test_events.c`
- Create: `backend/libcache-events/tests/CMakeLists.txt`

**Step 1: Write failing tests for event flags**

```c
// backend/libcache-events/tests/test_events.c
#include "cache_events.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

void test_store_flag() {
  CacheEvent load = {.address = 0x1000};
  CacheEvent store = {.address = 0x1000 | EVENT_STORE_FLAG};

  assert(!is_store(&load));
  assert(is_store(&store));
  assert(get_address(&load) == 0x1000);
  assert(get_address(&store) == 0x1000);

  printf("✓ test_store_flag\n");
}

void test_instruction_fetch_flag() {
  CacheEvent ifetch = {.address = 0x400000 | EVENT_ICACHE_FLAG};

  assert(is_instruction_fetch(&ifetch));
  assert(!is_store(&ifetch));
  assert(get_address(&ifetch) == 0x400000);

  printf("✓ test_instruction_fetch_flag\n");
}

void test_vector_flag() {
  CacheEvent vec = {.address = 0x2000 | EVENT_VECTOR_FLAG};

  assert(is_vector(&vec));
  assert(get_address(&vec) == 0x2000);

  printf("✓ test_vector_flag\n");
}

void test_atomic_flag() {
  CacheEvent atomic = {.address = 0x3000 | EVENT_ATOMIC_FLAG};

  assert(is_atomic(&atomic));
  assert(get_address(&atomic) == 0x3000);

  printf("✓ test_atomic_flag\n");
}

void test_memory_intrinsic_flag() {
  CacheEvent memcpy = {.address = 0x4000 | EVENT_MEMINTR_FLAG};

  assert(is_memory_intrinsic(&memcpy));
  assert(get_address(&memcpy) == 0x4000);

  printf("✓ test_memory_intrinsic_flag\n");
}

void test_combined_flags() {
  // Vector store
  CacheEvent vec_store = {
    .address = 0x5000 | EVENT_VECTOR_FLAG | EVENT_STORE_FLAG
  };

  assert(is_vector(&vec_store));
  assert(is_store(&vec_store));
  assert(get_address(&vec_store) == 0x5000);

  printf("✓ test_combined_flags\n");
}

int main(void) {
  printf("=== Event Flag Tests ===\n");

  test_store_flag();
  test_instruction_fetch_flag();
  test_vector_flag();
  test_atomic_flag();
  test_memory_intrinsic_flag();
  test_combined_flags();

  printf("\n✅ All event flag tests passed\n");
  return 0;
}
```

**Step 2: Write test CMakeLists.txt**

```cmake
# backend/libcache-events/tests/CMakeLists.txt
add_executable(test_events test_events.c)
target_link_libraries(test_events cache-events)

add_test(NAME event_flags COMMAND test_events)
```

**Step 3: Run tests to verify they pass (inline functions already work)**

```bash
cd backend/libcache-events
mkdir build && cd build
cmake ..
make
ctest -V
```

Expected: All tests PASS (inline functions in header already work)

**Step 4: Implement version functions**

```c
// backend/libcache-events/src/version.c
#include "cache_events.h"

int cache_events_abi_version(void) {
  return CACHE_EVENTS_ABI_VERSION;
}

const char* cache_events_version_string(void) {
  return "libcache-events 1.0.0";
}
```

**Step 5: Update CMakeLists.txt to include version.c**

```cmake
# backend/libcache-events/CMakeLists.txt
# Update library sources
add_library(cache-events STATIC
  src/version.c
  src/trace_writer.c
  src/file_table.c
)

add_library(cache-events-shared SHARED
  src/version.c
  src/trace_writer.c
  src/file_table.c
)
```

**Step 6: Commit**

```bash
git add backend/libcache-events/tests/ backend/libcache-events/src/version.c backend/libcache-events/CMakeLists.txt
git commit -m "test(libcache-events): add event flag unit tests

- Test store, instruction fetch, vector, atomic, intrinsic flags
- Test combined flags (e.g., vector + store)
- Test address masking
- Add version functions implementation"
```

---

### Task 3: Implement File Table (TDD)

**Files:**
- Create: `backend/libcache-events/tests/test_file_table.c`
- Create: `backend/libcache-events/src/file_table.c`

**Step 1: Write failing file table tests**

```c
// backend/libcache-events/tests/test_file_table.c
#include "file_table.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

void test_create_destroy() {
  FileTable* ft = file_table_create();
  assert(ft != NULL);
  assert(file_table_count(ft) == 0);

  file_table_destroy(ft);
  printf("✓ test_create_destroy\n");
}

void test_intern_single_file() {
  FileTable* ft = file_table_create();

  uint32_t id = file_table_intern(ft, "main.c");
  assert(id == 0);  // First file gets ID 0
  assert(file_table_count(ft) == 1);

  const char* path = file_table_get(ft, id);
  assert(strcmp(path, "main.c") == 0);

  file_table_destroy(ft);
  printf("✓ test_intern_single_file\n");
}

void test_intern_duplicate_returns_same_id() {
  FileTable* ft = file_table_create();

  uint32_t id1 = file_table_intern(ft, "main.c");
  uint32_t id2 = file_table_intern(ft, "main.c");  // Same file

  assert(id1 == id2);
  assert(file_table_count(ft) == 1);  // Only one entry

  file_table_destroy(ft);
  printf("✓ test_intern_duplicate_returns_same_id\n");
}

void test_intern_multiple_files() {
  FileTable* ft = file_table_create();

  uint32_t id_main = file_table_intern(ft, "main.c");
  uint32_t id_utils = file_table_intern(ft, "utils.c");
  uint32_t id_helper = file_table_intern(ft, "helper.c");

  assert(id_main != id_utils);
  assert(id_main != id_helper);
  assert(id_utils != id_helper);
  assert(file_table_count(ft) == 3);

  assert(strcmp(file_table_get(ft, id_main), "main.c") == 0);
  assert(strcmp(file_table_get(ft, id_utils), "utils.c") == 0);
  assert(strcmp(file_table_get(ft, id_helper), "helper.c") == 0);

  file_table_destroy(ft);
  printf("✓ test_intern_multiple_files\n");
}

void test_thread_safety_basic() {
  // Basic smoke test - full thread safety test would use pthreads
  FileTable* ft = file_table_create();

  for (int i = 0; i < 100; i++) {
    char buf[32];
    snprintf(buf, sizeof(buf), "file%d.c", i);
    file_table_intern(ft, buf);
  }

  assert(file_table_count(ft) == 100);

  file_table_destroy(ft);
  printf("✓ test_thread_safety_basic\n");
}

int main(void) {
  printf("=== File Table Tests ===\n");

  test_create_destroy();
  test_intern_single_file();
  test_intern_duplicate_returns_same_id();
  test_intern_multiple_files();
  test_thread_safety_basic();

  printf("\n✅ All file table tests passed\n");
  return 0;
}
```

**Step 2: Add test to CMakeLists.txt**

```cmake
# backend/libcache-events/tests/CMakeLists.txt
add_executable(test_file_table test_file_table.c)
target_link_libraries(test_file_table cache-events pthread)

add_test(NAME file_table COMMAND test_file_table)
```

**Step 3: Run tests to verify they fail**

```bash
cd backend/libcache-events/build
make
ctest -V
```

Expected: test_file_table FAILS (undefined symbols)

**Step 4: Implement file_table.c**

```c
// backend/libcache-events/src/file_table.c
#include "file_table.h"
#include <stdlib.h>
#include <string.h>
#include <pthread.h>

#define MAX_FILES 4096
#define MAX_PATH_LEN 256

struct FileTable {
  char paths[MAX_FILES][MAX_PATH_LEN];
  uint32_t count;
  pthread_mutex_t mutex;
};

FileTable* file_table_create(void) {
  FileTable* ft = malloc(sizeof(FileTable));
  if (!ft) return NULL;

  ft->count = 0;
  pthread_mutex_init(&ft->mutex, NULL);

  return ft;
}

uint32_t file_table_intern(FileTable* ft, const char* path) {
  if (!ft || !path) return 0;

  pthread_mutex_lock(&ft->mutex);

  // Search for existing entry
  for (uint32_t i = 0; i < ft->count; i++) {
    if (strcmp(ft->paths[i], path) == 0) {
      pthread_mutex_unlock(&ft->mutex);
      return i;
    }
  }

  // Add new entry
  if (ft->count < MAX_FILES) {
    uint32_t id = ft->count++;
    strncpy(ft->paths[id], path, MAX_PATH_LEN - 1);
    ft->paths[id][MAX_PATH_LEN - 1] = '\0';
    pthread_mutex_unlock(&ft->mutex);
    return id;
  }

  // Overflow - return 0 (fallback to first file)
  pthread_mutex_unlock(&ft->mutex);
  return 0;
}

const char* file_table_get(FileTable* ft, uint32_t file_id) {
  if (!ft || file_id >= ft->count) return "";
  return ft->paths[file_id];
}

uint32_t file_table_count(FileTable* ft) {
  if (!ft) return 0;
  return ft->count;
}

void file_table_destroy(FileTable* ft) {
  if (!ft) return;
  pthread_mutex_destroy(&ft->mutex);
  free(ft);
}
```

**Step 5: Run tests to verify they pass**

```bash
cd backend/libcache-events/build
make
ctest -V
```

Expected: All tests PASS

**Step 6: Commit**

```bash
git add backend/libcache-events/src/file_table.c backend/libcache-events/tests/test_file_table.c backend/libcache-events/tests/CMakeLists.txt
git commit -m "feat(libcache-events): implement file table with tests

- Thread-safe filename interning
- Deduplication (same file gets same ID)
- Support up to 4096 unique files
- Full test coverage (create, intern, lookup, thread safety)"
```

---

### Task 4: Implement Trace Writer (TDD)

**Files:**
- Create: `backend/libcache-events/tests/test_trace_writer.c`
- Create: `backend/libcache-events/src/trace_writer.c`

**Step 1: Write failing trace writer tests**

```c
// backend/libcache-events/tests/test_trace_writer.c
#include "trace_format.h"
#include "file_table.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

void test_text_format_load() {
  const char* path = "/tmp/test_trace_text.txt";

  TraceWriter* w = trace_writer_create(path, TRACE_FORMAT_TEXT);
  assert(w != NULL);

  // Emit file mapping
  trace_writer_emit_file_mapping(w, 0, "main.c");

  // Emit load event
  CacheEvent load = {
    .address = 0x7fff1234,
    .src_address = 0,
    .size = 4,
    .line = 42,
    .file_id = 0,
    .thread_id = 0
  };
  trace_writer_emit_event(w, &load);

  trace_writer_close(w);

  // Read back and verify format
  FILE* f = fopen(path, "r");
  assert(f != NULL);

  char line[256];
  fgets(line, sizeof(line), f);
  assert(strstr(line, "L 0x7fff1234 4 main.c 42 T0") != NULL);

  fclose(f);
  unlink(path);

  printf("✓ test_text_format_load\n");
}

void test_text_format_store() {
  const char* path = "/tmp/test_trace_store.txt";

  TraceWriter* w = trace_writer_create(path, TRACE_FORMAT_TEXT);
  trace_writer_emit_file_mapping(w, 0, "main.c");

  CacheEvent store = {
    .address = 0x7fff5678 | EVENT_STORE_FLAG,
    .size = 8,
    .line = 43,
    .file_id = 0,
    .thread_id = 1
  };
  trace_writer_emit_event(w, &store);

  trace_writer_close(w);

  FILE* f = fopen(path, "r");
  char line[256];
  fgets(line, sizeof(line), f);
  assert(strstr(line, "S 0x7fff5678 8 main.c 43 T1") != NULL);

  fclose(f);
  unlink(path);

  printf("✓ test_text_format_store\n");
}

void test_text_format_instruction_fetch() {
  const char* path = "/tmp/test_trace_ifetch.txt";

  TraceWriter* w = trace_writer_create(path, TRACE_FORMAT_TEXT);
  trace_writer_emit_file_mapping(w, 0, "main.c");

  CacheEvent ifetch = {
    .address = 0x400000 | EVENT_ICACHE_FLAG,
    .size = 5,
    .line = 10,
    .file_id = 0,
    .thread_id = 0
  };
  trace_writer_emit_event(w, &ifetch);

  trace_writer_close(w);

  FILE* f = fopen(path, "r");
  char line[256];
  fgets(line, sizeof(line), f);
  assert(strstr(line, "I 0x400000 5 main.c 10 T0") != NULL);

  fclose(f);
  unlink(path);

  printf("✓ test_text_format_instruction_fetch\n");
}

void test_binary_format_basic() {
  const char* path = "/tmp/test_trace_binary.bin";

  TraceWriter* w = trace_writer_create(path, TRACE_FORMAT_BINARY);
  assert(w != NULL);

  trace_writer_emit_file_mapping(w, 0, "main.c");

  CacheEvent event = {
    .address = 0x1000,
    .size = 4,
    .line = 10,
    .file_id = 0,
    .thread_id = 0
  };
  trace_writer_emit_event(w, &event);

  trace_writer_close(w);

  // Verify file exists and has header
  FILE* f = fopen(path, "rb");
  assert(f != NULL);

  char magic[4];
  fread(magic, 1, 4, f);
  assert(memcmp(magic, "CEXP", 4) == 0);

  fclose(f);
  unlink(path);

  printf("✓ test_binary_format_basic\n");
}

int main(void) {
  printf("=== Trace Writer Tests ===\n");

  test_text_format_load();
  test_text_format_store();
  test_text_format_instruction_fetch();
  test_binary_format_basic();

  printf("\n✅ All trace writer tests passed\n");
  return 0;
}
```

**Step 2: Add test to CMakeLists.txt**

```cmake
# backend/libcache-events/tests/CMakeLists.txt (append)
add_executable(test_trace_writer test_trace_writer.c)
target_link_libraries(test_trace_writer cache-events)

add_test(NAME trace_writer COMMAND test_trace_writer)
```

**Step 3: Run tests to verify they fail**

```bash
cd backend/libcache-events/build
make
ctest -V
```

Expected: test_trace_writer FAILS (undefined symbols)

**Step 4: Implement trace_writer.c**

```c
// backend/libcache-events/src/trace_writer.c
#include "trace_format.h"
#include "file_table.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct TraceWriter {
  FILE* file;
  TraceFormat format;
  FileTable* file_table;
  uint64_t event_count;
};

TraceWriter* trace_writer_create(const char* path, TraceFormat format) {
  TraceWriter* w = malloc(sizeof(TraceWriter));
  if (!w) return NULL;

  w->file = fopen(path, format == TRACE_FORMAT_BINARY ? "wb" : "w");
  if (!w->file) {
    free(w);
    return NULL;
  }

  w->format = format;
  w->file_table = file_table_create();
  w->event_count = 0;

  // Write binary header
  if (format == TRACE_FORMAT_BINARY) {
    fwrite("CEXP", 1, 4, w->file);  // Magic
    uint32_t version = 1;
    fwrite(&version, sizeof(version), 1, w->file);
    // Event count written at close
    uint64_t placeholder = 0;
    fwrite(&placeholder, sizeof(placeholder), 1, w->file);
  }

  return w;
}

void trace_writer_emit_file_mapping(TraceWriter* w, uint32_t file_id, const char* path) {
  if (!w || !path) return;

  file_table_intern(w->file_table, path);

  // For binary format, file table written at close
  // For text format, no explicit mapping needed
}

void trace_writer_emit_event(TraceWriter* w, const CacheEvent* event) {
  if (!w || !event) return;

  w->event_count++;

  if (w->format == TRACE_FORMAT_TEXT) {
    // Determine event type character
    char type = 'L';  // Load
    if (is_store(event)) type = 'S';
    else if (is_instruction_fetch(event)) type = 'I';

    uint64_t addr = get_address(event);
    const char* file = file_table_get(w->file_table, event->file_id);

    fprintf(w->file, "%c 0x%llx %u %s %u T%u\n",
            type, (unsigned long long)addr, event->size,
            file, event->line, event->thread_id);
  } else {
    // Binary format - write raw struct
    fwrite(event, sizeof(CacheEvent), 1, w->file);
  }
}

void trace_writer_close(TraceWriter* w) {
  if (!w) return;

  if (w->format == TRACE_FORMAT_BINARY) {
    // Write file table
    uint32_t file_count = file_table_count(w->file_table);
    fwrite(&file_count, sizeof(file_count), 1, w->file);

    for (uint32_t i = 0; i < file_count; i++) {
      const char* path = file_table_get(w->file_table, i);
      uint16_t len = strlen(path);
      fwrite(&len, sizeof(len), 1, w->file);
      fwrite(path, 1, len, w->file);
    }

    // Update event count in header
    fseek(w->file, 8, SEEK_SET);  // After magic + version
    fwrite(&w->event_count, sizeof(w->event_count), 1, w->file);
  }

  fclose(w->file);
  file_table_destroy(w->file_table);
  free(w);
}
```

**Step 5: Run tests to verify they pass**

```bash
cd backend/libcache-events/build
make
ctest -V
```

Expected: All tests PASS

**Step 6: Commit**

```bash
git add backend/libcache-events/src/trace_writer.c backend/libcache-events/tests/test_trace_writer.c backend/libcache-events/tests/CMakeLists.txt
git commit -m "feat(libcache-events): implement trace writer with tests

- Text format: \"L 0x1234 4 file.c:10 T0\"
- Binary format: packed struct with file table
- Support load, store, instruction fetch events
- Full test coverage for both formats"
```

---

### Task 5: Verify Backward Compatibility

**Files:**
- None (verification only)

**Step 1: Run existing regression tests**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/Cache-Explorer
./tests/regression/test_llvm_unchanged.sh
```

Expected: All tests PASS (LLVM pipeline unchanged)

**Step 2: Run existing cache-simulator tests**

```bash
cd backend/cache-simulator/build
./CacheLevelTest
./CacheSystemTest
./MESICoherenceTest
./MultiCorePrefetchTest
./MultiCoreTLBTest
./AdvancedInstrumentationTest
```

Expected: All tests PASS

**Step 3: Build cache-explore and verify it works**

```bash
./backend/scripts/cache-explore examples/sequential.c --config intel --json
```

Expected: Valid JSON output with hit rates

**Step 4: Document verification**

```bash
echo "✅ Backward compatibility verified" >> docs/plans/2026-02-16-intel-pin-integration.md
git add docs/plans/2026-02-16-intel-pin-integration.md
git commit -m "docs: verify backward compatibility after Phase 1.1

All existing tests pass:
- LLVM pipeline unchanged
- cache-simulator tests pass
- cache-explore CLI works"
```

---

## Phase 2: Pin Tool Rewrite (Week 3-4)

### Task 6: Create Pin Tool Test Infrastructure

**Files:**
- Create: `backend/pin-tool/tests/fixtures/basic.c`
- Create: `backend/pin-tool/tests/fixtures/loop.c`
- Create: `backend/pin-tool/tests/fixtures/vector.c`
- Create: `backend/pin-tool/tests/test_runner.sh`

**Step 1: Create test fixtures**

```c
// backend/pin-tool/tests/fixtures/basic.c
#include <stdio.h>

int main() {
  int x = 42;
  int y = x + 1;
  printf("Result: %d\n", y);
  return 0;
}
```

```c
// backend/pin-tool/tests/fixtures/loop.c
int main() {
  int sum = 0;
  for (int i = 0; i < 100; i++) {
    sum += i;
  }
  return sum;
}
```

```c
// backend/pin-tool/tests/fixtures/vector.c
#include <immintrin.h>

int main() {
  float a[8] = {1,2,3,4,5,6,7,8};
  float b[8] = {8,7,6,5,4,3,2,1};
  float c[8];

  __m256 va = _mm256_load_ps(a);
  __m256 vb = _mm256_load_ps(b);
  __m256 vc = _mm256_add_ps(va, vb);
  _mm256_store_ps(c, vc);

  return 0;
}
```

**Step 2: Create test runner script**

```bash
#!/bin/bash
# backend/pin-tool/tests/test_runner.sh

set -e

if [[ -z "$PIN_ROOT" ]]; then
  echo "Error: PIN_ROOT not set"
  exit 1
fi

PIN="$PIN_ROOT/pin"
PINTOOL="../obj-intel64/cache_profiler.so"

echo "=== Pin Tool Tests ==="

# Test 1: Basic memory operations
echo "Test 1: Basic memory operations..."
gcc -g -o /tmp/basic fixtures/basic.c
$PIN -t $PINTOOL -o /tmp/trace1.txt -- /tmp/basic
grep -q "^L" /tmp/trace1.txt && echo "✓ Found load events"
grep -q "^S" /tmp/trace1.txt && echo "✓ Found store events"

# Test 2: Instruction fetch
echo "Test 2: Instruction fetch..."
gcc -g -o /tmp/loop fixtures/loop.c
$PIN -t $PINTOOL -o /tmp/trace2.txt -- /tmp/loop
IFETCH_COUNT=$(grep -c "^I" /tmp/trace2.txt || true)
if [[ $IFETCH_COUNT -gt 100 ]]; then
  echo "✓ Found $IFETCH_COUNT instruction fetch events"
else
  echo "✗ Too few instruction fetches: $IFETCH_COUNT"
  exit 1
fi

echo ""
echo "✅ All Pin tool tests passed"
```

**Step 3: Make test runner executable**

```bash
chmod +x backend/pin-tool/tests/test_runner.sh
```

**Step 4: Commit test infrastructure**

```bash
git add backend/pin-tool/tests/
git commit -m "test(pin-tool): add test infrastructure

- Test fixtures: basic, loop, vector programs
- Test runner script with assertions
- Verifies load, store, instruction fetch events"
```

---

### Task 7: Rewrite Pin Tool with libcache-events

**Files:**
- Modify: `backend/pin-tool/cache_profiler.cpp`
- Modify: `backend/pin-tool/Makefile`

**Step 1: Update Makefile to link libcache-events**

```makefile
# backend/pin-tool/Makefile
ifndef PIN_ROOT
$(error PIN_ROOT is not set)
endif

CONFIG_ROOT := $(PIN_ROOT)/source/tools/Config
include $(CONFIG_ROOT)/makefile.config

TOOL_ROOTS := cache_profiler
OBJDIR := obj-$(TARGET)/

# Link against libcache-events
TOOL_CXXFLAGS += -std=c++17 -O2
TOOL_CXXFLAGS += -I../../libcache-events/include

# Link static library
TOOL_LIBS += -L../../libcache-events/build -lcache-events -lpthread

include $(TOOLS_ROOT)/Config/makefile.default.rules

all: $(OBJDIR)cache_profiler$(PINTOOL_SUFFIX)

clean:
	rm -rf obj-*

test: $(OBJDIR)cache_profiler$(PINTOOL_SUFFIX)
	cd tests && ./test_runner.sh
```

**Step 2: Rewrite cache_profiler.cpp (part 1: setup)**

```cpp
// backend/pin-tool/cache_profiler.cpp
#include "pin.H"
#include "cache_events.h"
#include "trace_format.h"
#include <iostream>
#include <unordered_map>
#include <string>

// Output trace writer
static TraceWriter* trace_writer = nullptr;

// Knobs (command line options)
KNOB<std::string> KnobOutputFile(KNOB_MODE_WRITEONCE, "pintool",
    "o", "cache_trace.txt", "Output file");

KNOB<BOOL> KnobBinaryFormat(KNOB_MODE_WRITEONCE, "pintool",
    "binary", "0", "Use binary format (default: text)");

KNOB<UINT64> KnobMaxEvents(KNOB_MODE_WRITEONCE, "pintool",
    "max", "10000000", "Maximum events");

KNOB<UINT64> KnobSampleRate(KNOB_MODE_WRITEONCE, "pintool",
    "sample", "1", "Sample rate");

// Statistics
static UINT64 total_events = 0;
static UINT64 sample_counter = 0;

// Thread ID tracking
static TLS_KEY tls_key = INVALID_TLS_KEY;

struct ThreadData {
    UINT32 thread_id;
    UINT64 event_count;
};

// Source location cache
struct SourceLocation {
    std::string file;
    UINT32 line;
    UINT32 file_id;
};

static std::unordered_map<ADDRINT, SourceLocation> addr_to_source;
static PIN_LOCK output_lock;

// Get thread-local data
static ThreadData* GetThreadData(THREADID tid) {
    ThreadData* data = static_cast<ThreadData*>(PIN_GetThreadData(tls_key, tid));
    if (!data) {
        data = new ThreadData();
        data->thread_id = tid;
        data->event_count = 0;
        PIN_SetThreadData(tls_key, data, tid);
    }
    return data;
}

// Helper to emit event
static inline void EmitEvent(CacheEvent* event) {
    if (total_events >= KnobMaxEvents.Value()) return;

    // Sampling
    if (KnobSampleRate.Value() > 1) {
        sample_counter++;
        if (sample_counter % KnobSampleRate.Value() != 0) return;
    }

    trace_writer_emit_event(trace_writer, event);
    total_events++;
}
```

**Step 3: Rewrite cache_profiler.cpp (part 2: instrumentation)**

```cpp
// Record memory access
static VOID RecordMemAccess(THREADID tid, VOID* addr, UINT32 size,
                            BOOL is_write, ADDRINT ip) {
    ThreadData* tdata = GetThreadData(tid);

    // Find source location
    auto it = addr_to_source.find(ip);
    UINT32 file_id = 0;
    UINT32 line = 0;

    if (it != addr_to_source.end()) {
        file_id = it->second.file_id;
        line = it->second.line;
    }

    // Create event
    CacheEvent event = {
        .address = reinterpret_cast<uint64_t>(addr),
        .src_address = 0,
        .size = size,
        .line = line,
        .file_id = file_id,
        .thread_id = tdata->thread_id
    };

    // Set store flag
    if (is_write) {
        event.address |= EVENT_STORE_FLAG;
    }

    PIN_GetLock(&output_lock, tid + 1);
    EmitEvent(&event);
    PIN_ReleaseLock(&output_lock);
}

// Record instruction fetch
static VOID RecordInstructionFetch(THREADID tid, ADDRINT ip, UINT32 size) {
    ThreadData* tdata = GetThreadData(tid);

    auto it = addr_to_source.find(ip);
    UINT32 file_id = 0;
    UINT32 line = 0;

    if (it != addr_to_source.end()) {
        file_id = it->second.file_id;
        line = it->second.line;
    }

    CacheEvent event = {
        .address = ip | EVENT_ICACHE_FLAG,
        .src_address = 0,
        .size = size,
        .line = line,
        .file_id = file_id,
        .thread_id = tdata->thread_id
    };

    PIN_GetLock(&output_lock, tid + 1);
    EmitEvent(&event);
    PIN_ReleaseLock(&output_lock);
}

// Instruction instrumentation callback
static VOID InstrumentInstruction(INS ins, VOID* v) {
    ADDRINT ip = INS_Address(ins);

    // Cache source location
    if (addr_to_source.find(ip) == addr_to_source.end()) {
        SourceLocation loc;
        loc.line = 0;
        loc.file_id = 0;

        INT32 column;
        std::string file;
        PIN_GetSourceLocation(ip, &column,
                              reinterpret_cast<INT32*>(&loc.line), &file);

        if (!file.empty()) {
            loc.file = file;
            // File ID will be assigned when emitting file mapping
        }

        addr_to_source[ip] = loc;
    }

    // Instrument instruction fetch
    INS_InsertPredicatedCall(
        ins, IPOINT_BEFORE, (AFUNPTR)RecordInstructionFetch,
        IARG_THREAD_ID,
        IARG_INST_PTR,
        IARG_UINT32, INS_Size(ins),
        IARG_END);

    // Instrument memory operands
    UINT32 memOperands = INS_MemoryOperandCount(ins);
    for (UINT32 memOp = 0; memOp < memOperands; memOp++) {
        UINT32 size = INS_MemoryOperandSize(ins, memOp);

        if (INS_MemoryOperandIsRead(ins, memOp)) {
            INS_InsertPredicatedCall(
                ins, IPOINT_BEFORE, (AFUNPTR)RecordMemAccess,
                IARG_THREAD_ID,
                IARG_MEMORYOP_EA, memOp,
                IARG_UINT32, size,
                IARG_BOOL, FALSE,
                IARG_INST_PTR,
                IARG_END);
        }

        if (INS_MemoryOperandIsWritten(ins, memOp)) {
            INS_InsertPredicatedCall(
                ins, IPOINT_BEFORE, (AFUNPTR)RecordMemAccess,
                IARG_THREAD_ID,
                IARG_MEMORYOP_EA, memOp,
                IARG_UINT32, size,
                IARG_BOOL, TRUE,
                IARG_INST_PTR,
                IARG_END);
        }
    }
}
```

**Step 4: Rewrite cache_profiler.cpp (part 3: initialization and cleanup)**

```cpp
// Thread callbacks
static VOID ThreadStart(THREADID tid, CONTEXT* ctxt, INT32 flags, VOID* v) {
    GetThreadData(tid);
}

static VOID ThreadFini(THREADID tid, const CONTEXT* ctxt, INT32 code, VOID* v) {
    ThreadData* data = GetThreadData(tid);
    if (data) {
        delete data;
        PIN_SetThreadData(tls_key, nullptr, tid);
    }
}

// Finalization callback
static VOID Fini(INT32 code, VOID* v) {
    // Emit file mappings
    for (const auto& pair : addr_to_source) {
        if (!pair.second.file.empty()) {
            trace_writer_emit_file_mapping(trace_writer, pair.second.file_id,
                                           pair.second.file.c_str());
        }
    }

    trace_writer_close(trace_writer);

    std::cerr << "\n=== Cache Explorer Pin Tool ===" << std::endl;
    std::cerr << "Total events: " << total_events << std::endl;
    std::cerr << "Output: " << KnobOutputFile.Value() << std::endl;
}

// Usage
static INT32 Usage() {
    std::cerr << "Cache Explorer Pin Tool" << std::endl;
    std::cerr << KNOB_BASE::StringKnobSummary() << std::endl;
    return -1;
}

int main(int argc, char* argv[]) {
    if (PIN_Init(argc, argv)) {
        return Usage();
    }

    PIN_InitLock(&output_lock);

    tls_key = PIN_CreateThreadDataKey(nullptr);
    if (tls_key == INVALID_TLS_KEY) {
        std::cerr << "Failed to allocate TLS key" << std::endl;
        return 1;
    }

    // Create trace writer
    TraceFormat format = KnobBinaryFormat.Value() ?
                         TRACE_FORMAT_BINARY : TRACE_FORMAT_TEXT;
    trace_writer = trace_writer_create(KnobOutputFile.Value().c_str(), format);

    if (!trace_writer) {
        std::cerr << "Failed to create trace writer" << std::endl;
        return 1;
    }

    // Register callbacks
    INS_AddInstrumentFunction(InstrumentInstruction, nullptr);
    PIN_AddThreadStartFunction(ThreadStart, nullptr);
    PIN_AddThreadFiniFunction(ThreadFini, nullptr);
    PIN_AddFiniFunction(Fini, nullptr);

    std::cerr << "Cache Explorer Pin Tool started" << std::endl;
    std::cerr << "  Output: " << KnobOutputFile.Value() << std::endl;
    std::cerr << "  Format: " << (format == TRACE_FORMAT_BINARY ? "binary" : "text") << std::endl;

    PIN_StartProgram();
    return 0;
}
```

**Step 5: Build Pin tool**

```bash
cd backend/pin-tool
make PIN_ROOT=$PIN_ROOT
```

Expected: Builds successfully, creates `obj-intel64/cache_profiler.so`

**Step 6: Run tests**

```bash
cd backend/pin-tool/tests
./test_runner.sh
```

Expected: Tests PASS (load, store, instruction fetch events present)

**Step 7: Commit**

```bash
git add backend/pin-tool/cache_profiler.cpp backend/pin-tool/Makefile
git commit -m "feat(pin-tool): rewrite with libcache-events

- Link against shared library for consistency
- Support both text and binary formats
- Track instruction fetches (NEW)
- Track loads and stores with source attribution
- All tests passing"
```

---

*[Remaining tasks continue with vector/SIMD detection, atomic operations, memory intrinsics, cache-sim binary format support, CI/CD, Docker, and web UI integration - following same TDD pattern]*

---

## Execution Notes

**Test-First Discipline:**
- Every implementation starts with a failing test
- Run `ctest` after every change to verify test state
- Commit test + implementation together

**Backward Compatibility:**
- Run `./tests/regression/test_llvm_unchanged.sh` frequently
- Never let existing tests regress
- If something breaks, fix immediately before continuing

**Frequent Commits:**
- Commit after each completed task (test + implementation)
- Use conventional commit messages (feat:, test:, fix:, docs:)
- Keep commits focused and atomic

**Pin Tool Development:**
- Always verify Pin tool builds: `make PIN_ROOT=$PIN_ROOT`
- Test with real binaries: compile fixtures with `-g` for debug info
- Check trace output manually: `head -20 cache_trace.txt`

---

## Success Criteria

- ✅ All libcache-events unit tests pass (90%+ coverage)
- ✅ Pin tool generates traces with all event types
- ✅ Pin tool tests pass (15+ integration tests)
- ✅ Existing LLVM pipeline unchanged (regression tests pass)
- ✅ cache-sim reads both text and binary formats
- ✅ CI/CD builds Pin tool on Linux x64
- ✅ Docker includes Pin tool
- ✅ Web UI supports binary upload mode

---

## Timeline Summary

- **Week 1-2:** libcache-events foundation (Tasks 1-5)
- **Week 3-4:** Pin tool rewrite (Tasks 6-10)
- **Week 5-6:** Memory intrinsics + cache-sim (Tasks 11-15)
- **Week 7-8:** CI/CD, Docker, Web UI (Tasks 16-20)

**Total:** 20 tasks, 8 weeks, production-ready Pin integration
