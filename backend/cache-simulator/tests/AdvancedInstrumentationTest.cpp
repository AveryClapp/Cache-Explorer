// AdvancedInstrumentationTest.cpp
// Tests for: Software Prefetch, Vector/SIMD, and Atomic Operation tracking
//
// These tests verify that the cache simulator correctly handles:
// 1. Software prefetch hints (__builtin_prefetch)
// 2. Vector/SIMD loads/stores (AVX, SSE)
// 3. Atomic operations (std::atomic, atomicrmw, cmpxchg)
//
// TDD: Write tests first, implementation follows

#include "../include/TraceEvent.hpp"
#include "../include/TraceProcessor.hpp"
#include "../include/MultiCoreTraceProcessor.hpp"
#include "../include/CacheSystem.hpp"
#include "../profiles/HardwarePresets.hpp"
#include <cassert>
#include <iostream>
#include <sstream>
#include <vector>

// Test helpers
static int tests_passed = 0;
static int tests_failed = 0;

#define TEST(name) \
  void name(); \
  struct name##_registrar { \
    name##_registrar() { \
      std::cout << "Running " << #name << "... "; \
      try { \
        name(); \
        std::cout << "[PASS]\n"; \
        tests_passed++; \
      } catch (const std::exception& e) { \
        std::cout << "[FAIL] " << e.what() << "\n"; \
        tests_failed++; \
      } catch (...) { \
        std::cout << "[FAIL] Unknown exception\n"; \
        tests_failed++; \
      } \
    } \
  } name##_instance; \
  void name()

#define ASSERT(cond) \
  if (!(cond)) throw std::runtime_error("Assertion failed: " #cond)

#define ASSERT_EQ(a, b) \
  if ((a) != (b)) { \
    std::ostringstream ss; \
    ss << "Expected " << (b) << " but got " << (a); \
    throw std::runtime_error(ss.str()); \
  }

// =============================================================================
// PART 1: Trace Event Parsing Tests
// =============================================================================

// New event types to be added to TraceEvent:
// P = Software Prefetch hint
// V = Vector Load (SIMD)
// W = Vector Store (SIMD) - wait, W is already write. Use 'U' for vector store
// A = Atomic operation (load)
// X = Atomic operation (store/RMW)
// C = Compare-and-swap (cmpxchg)

TEST(test_parse_prefetch_event) {
  // Format: P <address> <size> <file:line> <thread>
  // P indicates a software prefetch hint
  auto event = parse_trace_event("P 0x1000 64 test.c:10 T1");

  ASSERT(event.has_value());
  ASSERT(event->is_prefetch);  // New field
  ASSERT(!event->is_write);
  ASSERT(!event->is_icache);
  ASSERT_EQ(event->address, 0x1000ULL);
  ASSERT_EQ(event->size, 64U);
  ASSERT_EQ(event->file, "test.c");
  ASSERT_EQ(event->line, 10U);
}

TEST(test_parse_prefetch_with_hint_level) {
  // Format: P<level> <address> <size> <file:line>
  // Prefetch levels: 0=T0 (all caches), 1=T1 (L2+), 2=T2 (L3), 3=NTA (non-temporal)
  auto event = parse_trace_event("P0 0x2000 64 test.c:20 T1");

  ASSERT(event.has_value());
  ASSERT(event->is_prefetch);
  ASSERT_EQ(event->prefetch_hint, 0);  // T0 - prefetch to all cache levels
}

TEST(test_parse_vector_load_event) {
  // Format: V <address> <size> <file:line> <thread>
  // V indicates a vector (SIMD) load
  // Size will typically be 16 (SSE), 32 (AVX), 64 (AVX-512)
  auto event = parse_trace_event("V 0x1000 32 test.c:15 T1");

  ASSERT(event.has_value());
  ASSERT(event->is_vector);  // New field
  ASSERT(!event->is_write);
  ASSERT_EQ(event->size, 32U);  // AVX = 256 bits = 32 bytes
}

TEST(test_parse_vector_store_event) {
  // Format: U <address> <size> <file:line> <thread>
  // U indicates a vector (SIMD) store
  auto event = parse_trace_event("U 0x1000 32 test.c:16 T1");

  ASSERT(event.has_value());
  ASSERT(event->is_vector);
  ASSERT(event->is_write);
  ASSERT_EQ(event->size, 32U);
}

TEST(test_parse_atomic_load_event) {
  // Format: A <address> <size> <file:line> <thread>
  // A indicates an atomic load
  auto event = parse_trace_event("A 0x1000 8 test.c:25 T1");

  ASSERT(event.has_value());
  ASSERT(event->is_atomic);  // New field
  ASSERT(!event->is_write);
  ASSERT_EQ(event->size, 8U);
}

TEST(test_parse_atomic_rmw_event) {
  // Format: X <address> <size> <file:line> <thread>
  // X indicates an atomic read-modify-write (fetch_add, fetch_sub, etc.)
  auto event = parse_trace_event("X 0x1000 4 test.c:30 T1");

  ASSERT(event.has_value());
  ASSERT(event->is_atomic);
  ASSERT(event->is_write);  // RMW is both read and write
  ASSERT(event->is_rmw);    // New field - distinguishes from plain atomic store
}

TEST(test_parse_cmpxchg_event) {
  // Format: C <address> <size> <file:line> <thread>
  // C indicates a compare-and-swap operation
  auto event = parse_trace_event("C 0x1000 8 test.c:35 T1");

  ASSERT(event.has_value());
  ASSERT(event->is_atomic);
  ASSERT(event->is_cmpxchg);  // New field
}

// =============================================================================
// PART 2: Simulator Processing Tests
// =============================================================================

TEST(test_simulator_prefetch_warms_cache) {
  // Prefetch should bring data into cache; subsequent demand access should hit
  auto cfg = make_educational_config();
  TraceProcessor processor(cfg);

  // First, a prefetch to address 0x1000
  TraceEvent prefetch;
  prefetch.is_prefetch = true;
  prefetch.address = 0x1000;
  prefetch.size = 64;
  prefetch.file = "test.c";
  prefetch.line = 10;
  processor.process(prefetch);

  // Record stats after prefetch (it warms the cache)
  auto stats_after_prefetch = processor.get_stats();

  // Now a demand load to the same address - should hit
  TraceEvent load;
  load.is_write = false;
  load.address = 0x1000;
  load.size = 8;
  load.file = "test.c";
  load.line = 12;
  processor.process(load);

  auto stats = processor.get_stats();
  // The demand load should HIT because prefetch warmed the cache
  ASSERT(stats.l1d.hits > stats_after_prefetch.l1d.hits);
}

TEST(test_simulator_prefetch_stats_tracked) {
  // Software prefetches should have their own statistics
  auto cfg = make_educational_config();
  TraceProcessor processor(cfg);

  TraceEvent prefetch;
  prefetch.is_prefetch = true;
  prefetch.address = 0x2000;
  prefetch.size = 64;
  processor.process(prefetch);

  auto pf_stats = processor.get_software_prefetch_stats();  // New method
  ASSERT_EQ(pf_stats.issued, 1ULL);
}

TEST(test_simulator_vector_load_crosses_cache_lines) {
  // A 32-byte vector load that crosses cache line boundary should generate 2 cache accesses
  auto cfg = make_educational_config();  // 64-byte cache lines
  TraceProcessor processor(cfg);

  // Address 0x1030 + 32 bytes = 0x1050, crosses the 0x1040 boundary
  TraceEvent vec_load;
  vec_load.is_vector = true;
  vec_load.is_write = false;
  vec_load.address = 0x1030;  // 48 bytes into a cache line
  vec_load.size = 32;         // Will cross into next cache line
  vec_load.file = "test.c";
  vec_load.line = 20;
  processor.process(vec_load);

  auto stats = processor.get_stats();
  // Should have 2 misses (2 cache lines touched)
  ASSERT_EQ(stats.l1d.misses, 2ULL);
}

TEST(test_simulator_vector_load_single_line) {
  // A 32-byte vector load aligned within a cache line should be 1 access
  auto cfg = make_educational_config();
  TraceProcessor processor(cfg);

  TraceEvent vec_load;
  vec_load.is_vector = true;
  vec_load.is_write = false;
  vec_load.address = 0x1000;  // Aligned to cache line
  vec_load.size = 32;
  processor.process(vec_load);

  auto stats = processor.get_stats();
  ASSERT_EQ(stats.l1d.misses, 1ULL);  // Only 1 cache line touched
}

TEST(test_simulator_vector_stats_tracked) {
  // Vector operations should have their own statistics
  auto cfg = make_educational_config();
  TraceProcessor processor(cfg);

  TraceEvent vec_load;
  vec_load.is_vector = true;
  vec_load.address = 0x1000;
  vec_load.size = 32;
  processor.process(vec_load);

  auto vec_stats = processor.get_vector_stats();  // New method
  ASSERT_EQ(vec_stats.loads, 1ULL);
  ASSERT_EQ(vec_stats.bytes_loaded, 32ULL);
}

TEST(test_simulator_atomic_triggers_coherence) {
  // In multi-core, atomic operations should cause coherence traffic
  auto cfg = make_educational_config();
  MultiCoreTraceProcessor processor(2, cfg.l1_data, cfg.l2, cfg.l3);

  // Thread 1 does atomic read
  TraceEvent atomic_load;
  atomic_load.is_atomic = true;
  atomic_load.is_write = false;
  atomic_load.address = 0x1000;
  atomic_load.size = 8;
  atomic_load.thread_id = 1;
  processor.process(atomic_load);

  // Thread 2 does atomic RMW on same address
  TraceEvent atomic_rmw;
  atomic_rmw.is_atomic = true;
  atomic_rmw.is_write = true;
  atomic_rmw.is_rmw = true;
  atomic_rmw.address = 0x1000;
  atomic_rmw.size = 8;
  atomic_rmw.thread_id = 2;
  processor.process(atomic_rmw);

  auto stats = processor.get_stats();
  // Atomic RMW from T2 should invalidate T1's copy
  ASSERT(stats.coherence_invalidations > 0);
}

TEST(test_simulator_atomic_stats_tracked) {
  // Atomic operations should have their own statistics
  auto cfg = make_educational_config();
  TraceProcessor processor(cfg);

  TraceEvent atomic;
  atomic.is_atomic = true;
  atomic.is_rmw = true;
  atomic.address = 0x1000;
  atomic.size = 8;
  processor.process(atomic);

  auto atomic_stats = processor.get_atomic_stats();  // New method
  ASSERT_EQ(atomic_stats.rmw_count, 1ULL);
}

TEST(test_simulator_cmpxchg_is_rmw) {
  // Compare-and-swap is a special RMW that reads and conditionally writes
  auto cfg = make_educational_config();
  TraceProcessor processor(cfg);

  TraceEvent cmpxchg;
  cmpxchg.is_atomic = true;
  cmpxchg.is_cmpxchg = true;
  cmpxchg.address = 0x1000;
  cmpxchg.size = 8;
  processor.process(cmpxchg);

  auto atomic_stats = processor.get_atomic_stats();
  ASSERT_EQ(atomic_stats.cmpxchg_count, 1ULL);
}

// =============================================================================
// PART 3: Multi-Core Coherence Tests for Atomics
// =============================================================================

TEST(test_atomic_exclusive_lock_pattern) {
  // Simulate a spinlock: multiple threads doing atomic RMW on same address
  auto cfg = make_educational_config();
  MultiCoreTraceProcessor processor(4, cfg.l1_data, cfg.l2, cfg.l3);

  // Thread 1 acquires lock (atomic RMW - is both read and write)
  TraceEvent acquire1{};
  acquire1.is_atomic = true;
  acquire1.is_write = true;  // RMW writes to cache
  acquire1.is_rmw = true;
  acquire1.address = 0x1000;
  acquire1.size = 4;
  acquire1.thread_id = 1;
  processor.process(acquire1);

  // Thread 2, 3, 4 all try to acquire (will invalidate previous core's cache line)
  for (int t = 2; t <= 4; t++) {
    TraceEvent acquire{};
    acquire.is_atomic = true;
    acquire.is_write = true;  // RMW writes to cache
    acquire.is_rmw = true;
    acquire.address = 0x1000;
    acquire.size = 4;
    acquire.thread_id = t;
    processor.process(acquire);
  }

  auto stats = processor.get_stats();
  // Each atomic RMW by a new core should cause invalidation
  ASSERT(stats.coherence_invalidations >= 3);
}

TEST(test_atomic_contention_detection) {
  // High contention on atomic should cause many coherence invalidations
  auto cfg = make_educational_config();
  MultiCoreTraceProcessor processor(4, cfg.l1_data, cfg.l2, cfg.l3);

  // Many atomic operations from different threads on same address
  for (int i = 0; i < 100; i++) {
    TraceEvent atomic{};
    atomic.is_atomic = true;
    atomic.is_write = true;  // RMW writes to cache
    atomic.is_rmw = true;
    atomic.address = 0x1000;
    atomic.size = 4;
    atomic.thread_id = (i % 4) + 1;
    processor.process(atomic);
  }

  auto stats = processor.get_stats();
  // High contention causes many coherence invalidations
  // With 100 accesses across 4 threads, most will cause invalidations
  ASSERT(stats.coherence_invalidations > 50);
}

// =============================================================================
// PART 4: End-to-End Integration Tests
// =============================================================================

// These test that the full pipeline works:
// Source code with __builtin_prefetch -> LLVM pass -> trace -> simulator

TEST(test_trace_format_backwards_compatible) {
  // Old trace format should still work
  auto event = parse_trace_event("L 0x1000 8 test.c:10 T1");
  ASSERT(event.has_value());
  ASSERT(!event->is_write);
  ASSERT(!event->is_prefetch);
  ASSERT(!event->is_vector);
  ASSERT(!event->is_atomic);

  auto store = parse_trace_event("S 0x2000 4 test.c:12 T1");
  ASSERT(store.has_value());
  ASSERT(store->is_write);
}

TEST(test_vector_size_correctness) {
  // Vector sizes should match SIMD widths
  // SSE = 128 bits = 16 bytes
  // AVX = 256 bits = 32 bytes
  // AVX-512 = 512 bits = 64 bytes

  auto sse = parse_trace_event("V 0x1000 16 test.c:10 T1");
  ASSERT(sse.has_value());
  ASSERT_EQ(sse->size, 16U);

  auto avx = parse_trace_event("V 0x1000 32 test.c:11 T1");
  ASSERT(avx.has_value());
  ASSERT_EQ(avx->size, 32U);

  auto avx512 = parse_trace_event("V 0x1000 64 test.c:12 T1");
  ASSERT(avx512.has_value());
  ASSERT_EQ(avx512->size, 64U);
}

// =============================================================================
// PART 5: Statistics Accuracy Tests
// =============================================================================

TEST(test_prefetch_accuracy_calculation) {
  // Test that prefetch accuracy is correctly calculated
  auto cfg = make_educational_config();
  TraceProcessor processor(cfg);

  // Issue 10 prefetches
  for (int i = 0; i < 10; i++) {
    TraceEvent pf{};
    pf.is_prefetch = true;
    pf.address = 0x1000 + i * 64;
    pf.size = 64;
    processor.process(pf);
  }

  // Use only 6 of them (demand loads to 6 prefetched addresses)
  for (int i = 0; i < 6; i++) {
    TraceEvent load{};
    load.is_write = false;
    load.address = 0x1000 + i * 64;
    load.size = 8;
    processor.process(load);
  }

  auto pf_stats = processor.get_software_prefetch_stats();
  ASSERT_EQ(pf_stats.issued, 10ULL);
  ASSERT_EQ(pf_stats.useful, 6ULL);
  // Accuracy should be 60%
  double accuracy = pf_stats.accuracy();
  ASSERT(accuracy >= 0.59 && accuracy <= 0.61);
}

TEST(test_vector_bandwidth_calculation) {
  // Test that vector bandwidth is tracked
  auto cfg = make_educational_config();
  TraceProcessor processor(cfg);

  // 10 AVX loads (32 bytes each) = 320 bytes
  for (int i = 0; i < 10; i++) {
    TraceEvent vec{};
    vec.is_vector = true;
    vec.is_write = false;
    vec.address = 0x1000 + i * 64;  // Different cache lines
    vec.size = 32;
    processor.process(vec);
  }

  auto vec_stats = processor.get_vector_stats();
  ASSERT_EQ(vec_stats.loads, 10ULL);
  ASSERT_EQ(vec_stats.bytes_loaded, 320ULL);
}

// =============================================================================
// PART 6: Memory Intrinsic Tests (memcpy, memset, memmove)
// =============================================================================

// Memory intrinsics need special handling because they bypass normal load/store
// and become LLVM intrinsics: llvm.memcpy, llvm.memset, llvm.memmove

TEST(test_parse_memcpy_event) {
  // Format: M <dest_addr> <src_addr> <size> <file:line> <thread>
  // M indicates a memcpy operation
  auto event = parse_trace_event("M 0x2000 0x1000 1024 test.c:50 T1");

  ASSERT(event.has_value());
  ASSERT(event->is_memcpy);  // New field
  ASSERT_EQ(event->address, 0x2000ULL);  // Destination
  ASSERT_EQ(event->src_address, 0x1000ULL);  // Source (new field)
  ASSERT_EQ(event->size, 1024U);
}

TEST(test_parse_memset_event) {
  // Format: Z <dest_addr> <size> <file:line> <thread>
  // Z indicates a memset operation (zero/fill)
  auto event = parse_trace_event("Z 0x1000 4096 test.c:55 T1");

  ASSERT(event.has_value());
  ASSERT(event->is_memset);  // New field
  ASSERT_EQ(event->address, 0x1000ULL);
  ASSERT_EQ(event->size, 4096U);
}

TEST(test_parse_memmove_event) {
  // Format: O <dest_addr> <src_addr> <size> <file:line> <thread>
  // O indicates a memmove operation (overlapping allowed)
  auto event = parse_trace_event("O 0x2000 0x1800 256 test.c:60 T1");

  ASSERT(event.has_value());
  ASSERT(event->is_memmove);  // New field
  ASSERT_EQ(event->address, 0x2000ULL);
  ASSERT_EQ(event->src_address, 0x1800ULL);
  ASSERT_EQ(event->size, 256U);
}

TEST(test_simulator_memcpy_generates_cache_accesses) {
  // memcpy(dest, src, 1024) should generate:
  // - 16 cache line reads from src (1024 / 64)
  // - 16 cache line writes to dest
  auto cfg = make_educational_config();
  TraceProcessor processor(cfg);

  TraceEvent memcpy_event{};
  memcpy_event.is_memcpy = true;
  memcpy_event.address = 0x2000;      // dest
  memcpy_event.src_address = 0x1000;  // src
  memcpy_event.size = 1024;
  memcpy_event.file = "test.c";
  memcpy_event.line = 50;
  processor.process(memcpy_event);

  auto stats = processor.get_stats();
  // 16 src reads + 16 dest writes = 32 accesses total
  // All should be misses (cold cache)
  ASSERT_EQ(stats.l1d.misses, 32ULL);
}

TEST(test_simulator_memset_generates_writes) {
  // memset(buffer, 0, 4096) should generate:
  // - 64 cache line writes (4096 / 64)
  auto cfg = make_educational_config();
  TraceProcessor processor(cfg);

  TraceEvent memset_event{};
  memset_event.is_memset = true;
  memset_event.address = 0x1000;
  memset_event.size = 4096;
  memset_event.file = "test.c";
  memset_event.line = 55;
  processor.process(memset_event);

  auto stats = processor.get_stats();
  // 64 cache lines written
  ASSERT_EQ(stats.l1d.misses, 64ULL);
}

TEST(test_simulator_memcpy_stats_tracked) {
  // Memory intrinsics should have their own statistics
  auto cfg = make_educational_config();
  TraceProcessor processor(cfg);

  TraceEvent memcpy_event{};
  memcpy_event.is_memcpy = true;
  memcpy_event.address = 0x2000;
  memcpy_event.src_address = 0x1000;
  memcpy_event.size = 512;
  processor.process(memcpy_event);

  auto mem_stats = processor.get_memory_intrinsic_stats();  // New method
  ASSERT_EQ(mem_stats.memcpy_count, 1ULL);
  ASSERT_EQ(mem_stats.memcpy_bytes, 512ULL);
}

TEST(test_simulator_memset_stats_tracked) {
  auto cfg = make_educational_config();
  TraceProcessor processor(cfg);

  TraceEvent memset_event{};
  memset_event.is_memset = true;
  memset_event.address = 0x1000;
  memset_event.size = 2048;
  processor.process(memset_event);

  auto mem_stats = processor.get_memory_intrinsic_stats();
  ASSERT_EQ(mem_stats.memset_count, 1ULL);
  ASSERT_EQ(mem_stats.memset_bytes, 2048ULL);
}

TEST(test_memcpy_overlapping_with_existing_data) {
  // memcpy where source is already cached should hit for reads
  auto cfg = make_educational_config();
  TraceProcessor processor(cfg);

  // First, load source data into cache
  for (int i = 0; i < 4; i++) {
    TraceEvent load{};
    load.is_write = false;
    load.address = 0x1000 + i * 64;  // 4 cache lines
    load.size = 8;
    processor.process(load);
  }

  auto stats_before = processor.get_stats();
  ASSERT_EQ(stats_before.l1d.misses, 4ULL);  // 4 cold misses

  // Now memcpy from the same source (should hit for reads)
  TraceEvent memcpy_event{};
  memcpy_event.is_memcpy = true;
  memcpy_event.address = 0x2000;      // dest (cold)
  memcpy_event.src_address = 0x1000;  // src (warm)
  memcpy_event.size = 256;            // 4 cache lines
  processor.process(memcpy_event);

  auto stats_after = processor.get_stats();
  // Source reads should hit (4 hits)
  // Dest writes should miss (4 misses)
  uint64_t new_misses = stats_after.l1d.misses - stats_before.l1d.misses;
  uint64_t new_hits = stats_after.l1d.hits - stats_before.l1d.hits;

  ASSERT_EQ(new_hits, 4ULL);   // Source reads hit
  ASSERT_EQ(new_misses, 4ULL); // Dest writes miss
}

TEST(test_large_memcpy_bandwidth_impact) {
  // Large memcpy should be flagged as potential bandwidth issue
  auto cfg = make_educational_config();
  TraceProcessor processor(cfg);

  // 1MB memcpy
  TraceEvent memcpy_event{};
  memcpy_event.is_memcpy = true;
  memcpy_event.address = 0x200000;
  memcpy_event.src_address = 0x100000;
  memcpy_event.size = 1024 * 1024;  // 1MB
  memcpy_event.file = "test.c";
  memcpy_event.line = 100;
  processor.process(memcpy_event);

  // Check that this is captured in hot lines
  auto hot_lines = processor.get_hot_lines(1);
  ASSERT(!hot_lines.empty());
  ASSERT_EQ(hot_lines[0].line, 100U);
  ASSERT(hot_lines[0].misses > 1000);  // Many misses from large copy
}

// =============================================================================
// PART 7: Combined Operations Tests
// =============================================================================

TEST(test_mixed_operations_stats) {
  // Test that all operation types are tracked correctly together
  auto cfg = make_educational_config();
  TraceProcessor processor(cfg);

  // Regular load
  TraceEvent load{};
  load.is_write = false;
  load.address = 0x1000;
  load.size = 8;
  processor.process(load);

  // Regular store
  TraceEvent store{};
  store.is_write = true;
  store.address = 0x2000;
  store.size = 8;
  processor.process(store);

  // Prefetch
  TraceEvent prefetch{};
  prefetch.is_prefetch = true;
  prefetch.address = 0x3000;
  prefetch.size = 64;
  processor.process(prefetch);

  // Vector load
  TraceEvent vec{};
  vec.is_vector = true;
  vec.address = 0x4000;
  vec.size = 32;
  processor.process(vec);

  // Atomic RMW
  TraceEvent atomic{};
  atomic.is_atomic = true;
  atomic.is_rmw = true;
  atomic.address = 0x5000;
  atomic.size = 8;
  processor.process(atomic);

  // Memset
  TraceEvent memset_ev{};
  memset_ev.is_memset = true;
  memset_ev.address = 0x6000;
  memset_ev.size = 128;
  processor.process(memset_ev);

  // Verify all stats are independent
  auto stats = processor.get_stats();
  ASSERT(stats.l1d.misses >= 4);  // At least load, store, vec, atomic miss

  auto pf_stats = processor.get_software_prefetch_stats();
  ASSERT_EQ(pf_stats.issued, 1ULL);

  auto vec_stats = processor.get_vector_stats();
  ASSERT_EQ(vec_stats.loads, 1ULL);

  auto atomic_stats = processor.get_atomic_stats();
  ASSERT_EQ(atomic_stats.rmw_count, 1ULL);

  auto mem_stats = processor.get_memory_intrinsic_stats();
  ASSERT_EQ(mem_stats.memset_count, 1ULL);
}

// =============================================================================
// Main
// =============================================================================

int main() {
  std::cout << "=== Advanced Instrumentation Tests ===\n\n";
  std::cout << "Testing: Prefetch, Vector/SIMD, Atomic Operations\n\n";

  // Tests run automatically via static initialization

  std::cout << "\n=== Summary ===\n";
  std::cout << "Passed: " << tests_passed << "\n";
  std::cout << "Failed: " << tests_failed << "\n";

  if (tests_failed > 0) {
    std::cout << "\n[FAIL] Some tests failed!\n";
    return 1;
  }

  std::cout << "\n[PASS] All tests passed!\n";
  return 0;
}
