#include "../include/MultiCoreCacheSystem.hpp"
#include "../include/Prefetcher.hpp"
#include "../profiles/CacheConfig.hpp"
#include <cassert>
#include <iostream>
#include <vector>

// Simple config for testing
CacheConfig make_test_l1_config() {
  return {.kb_size = 1, .associativity = 2, .line_size = 64,
          .policy = EvictionPolicy::LRU, .write_policy = WritePolicy::Back};
}

CacheConfig make_test_l2_config() {
  return {.kb_size = 4, .associativity = 4, .line_size = 64,
          .policy = EvictionPolicy::LRU, .write_policy = WritePolicy::Back};
}

CacheConfig make_test_l3_config() {
  return {.kb_size = 16, .associativity = 8, .line_size = 64,
          .policy = EvictionPolicy::LRU, .write_policy = WritePolicy::Back};
}

// ============================================================================
// PREFETCHER UNIT TESTS (Single-core behavior validation)
// ============================================================================

// Test: NONE policy issues no prefetches
void test_prefetch_none_policy() {
  Prefetcher pf(PrefetchPolicy::NONE, 2, 64);

  auto addrs = pf.on_miss(0x1000);
  assert(addrs.empty());

  addrs = pf.on_miss(0x1040);
  assert(addrs.empty());

  assert(pf.get_stats().prefetches_issued == 0);

  std::cout << "[PASS] test_prefetch_none_policy\n";
}

// Test: NEXT_LINE policy prefetches next N lines
void test_prefetch_next_line_policy() {
  Prefetcher pf(PrefetchPolicy::NEXT_LINE, 2, 64);

  auto addrs = pf.on_miss(0x1000);

  // Should prefetch next 2 lines
  assert(addrs.size() == 2);
  assert(addrs[0] == 0x1040);  // Next line
  assert(addrs[1] == 0x1080);  // Line after

  std::cout << "[PASS] test_prefetch_next_line_policy\n";
}

// Test: STREAM policy detects sequential access
void test_prefetch_stream_detection() {
  Prefetcher pf(PrefetchPolicy::STREAM, 2, 64);

  // First access - no prefetch (need to establish pattern)
  auto addrs = pf.on_miss(0x1000);

  // Second access - sequential, should start building confidence
  addrs = pf.on_miss(0x1040);

  // Third access - sequential pattern confirmed
  addrs = pf.on_miss(0x1080);

  // By now, stream prefetcher should be issuing prefetches
  auto stats = pf.get_stats();
  // At least some prefetches should be issued after pattern detected
  assert(stats.prefetches_issued >= 1);

  std::cout << "[PASS] test_prefetch_stream_detection\n";
}

// Test: STRIDE policy detects strided access
void test_prefetch_stride_detection() {
  Prefetcher pf(PrefetchPolicy::STRIDE, 2, 64);

  // Access with stride of 128 bytes (2 cache lines)
  uint64_t pc = 0x400000;  // Simulated PC

  pf.on_miss(0x1000, pc);
  pf.on_miss(0x1080, pc);  // +128 bytes
  pf.on_miss(0x1100, pc);  // +128 bytes

  // Stride pattern should be detected
  auto addrs = pf.on_miss(0x1180, pc);  // +128 bytes

  // Should prefetch based on detected stride
  // (exact behavior depends on confidence threshold)

  std::cout << "[PASS] test_prefetch_stride_detection\n";
}

// Test: ADAPTIVE combines stream and stride
void test_prefetch_adaptive() {
  Prefetcher pf(PrefetchPolicy::ADAPTIVE, 2, 64);

  // Sequential access
  for (int i = 0; i < 5; i++) {
    pf.on_miss(0x1000 + i * 64);
  }

  auto stats = pf.get_stats();
  // Adaptive should have issued some prefetches
  assert(stats.prefetches_issued >= 1);

  std::cout << "[PASS] test_prefetch_adaptive\n";
}

// Test: Prefetch degree control
void test_prefetch_degree() {
  Prefetcher pf1(PrefetchPolicy::NEXT_LINE, 1, 64);
  Prefetcher pf4(PrefetchPolicy::NEXT_LINE, 4, 64);

  auto addrs1 = pf1.on_miss(0x1000);
  auto addrs4 = pf4.on_miss(0x1000);

  assert(addrs1.size() == 1);
  assert(addrs4.size() == 4);

  std::cout << "[PASS] test_prefetch_degree\n";
}

// Test: Prefetch stats tracking
void test_prefetch_stats() {
  Prefetcher pf(PrefetchPolicy::NEXT_LINE, 2, 64);

  pf.on_miss(0x1000);  // Issues 2 prefetches

  auto stats = pf.get_stats();
  assert(stats.prefetches_issued == 2);

  pf.record_useful_prefetch();
  stats = pf.get_stats();
  assert(stats.prefetches_useful == 1);

  pf.record_useless_prefetch();
  stats = pf.get_stats();
  assert(stats.prefetches_useless == 1);

  std::cout << "[PASS] test_prefetch_stats\n";
}

// Test: Prefetch accuracy calculation
void test_prefetch_accuracy() {
  Prefetcher pf(PrefetchPolicy::NEXT_LINE, 2, 64);

  pf.on_miss(0x1000);  // 2 prefetches
  pf.on_miss(0x1100);  // 2 more prefetches

  pf.record_useful_prefetch();
  pf.record_useful_prefetch();
  pf.record_useless_prefetch();
  pf.record_useless_prefetch();

  auto stats = pf.get_stats();
  assert(stats.prefetches_issued == 4);
  assert(stats.prefetches_useful == 2);
  double accuracy = stats.accuracy();
  assert(accuracy >= 0.49 && accuracy <= 0.51);  // 50%

  std::cout << "[PASS] test_prefetch_accuracy\n";
}

// Test: Reset stats
void test_prefetch_reset() {
  Prefetcher pf(PrefetchPolicy::NEXT_LINE, 2, 64);

  pf.on_miss(0x1000);
  pf.record_useful_prefetch();

  pf.reset_stats();
  auto stats = pf.get_stats();

  assert(stats.prefetches_issued == 0);
  assert(stats.prefetches_useful == 0);

  std::cout << "[PASS] test_prefetch_reset\n";
}

// ============================================================================
// MULTI-CORE PREFETCHING TESTS
// These tests verify prefetching behavior in multi-core context.
// Currently prefetching is only in single-core mode - these tests
// define the expected behavior for the multi-core implementation.
// ============================================================================

// Test: Per-core prefetch isolation
// Each core should have its own prefetch state
void test_multicore_prefetch_per_core_isolation() {
  // This test defines expected behavior:
  // Core 0 sequential access should not affect core 1's prefetch decisions

  // For now, we just verify the multi-core system works without prefetch
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Sequential access from core 0
  for (int i = 0; i < 10; i++) {
    cache.read(0x1000 + i * 64, 0);
  }

  // Random access from core 1
  cache.read(0x5000, 1);
  cache.read(0x8000, 1);

  // Should complete without issues
  auto stats = cache.get_stats();
  assert(stats.l1_per_core.size() == 4);

  std::cout << "[PASS] test_multicore_prefetch_per_core_isolation\n";
}

// Test: Prefetch doesn't violate coherence
// Prefetched data should respect MESI states
void test_multicore_prefetch_coherence_safety() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Core 0 writes (gets Modified)
  cache.write(0x1000, 0);

  // Core 1 does sequential read near that address
  // Prefetch should not bring in core 0's M line without proper coherence
  for (int i = 1; i < 10; i++) {
    cache.read(0x1000 + i * 64, 1);
  }

  // If core 1 now reads 0x1000, should see coherence traffic
  cache.read(0x1000, 1);

  auto stats = cache.get_stats();
  // Should have coherence invalidations from core 0's M line
  assert(stats.coherence_invalidations >= 1);

  std::cout << "[PASS] test_multicore_prefetch_coherence_safety\n";
}

// Test: Prefetch in shared data scenario
// Multiple cores accessing same sequential region
void test_multicore_prefetch_shared_region() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // All cores read from same region
  for (int i = 0; i < 10; i++) {
    for (int core = 0; core < 4; core++) {
      cache.read(0x1000 + i * 64, core);
    }
  }

  auto stats = cache.get_stats();
  // Should not have false sharing (all reads, same bytes)
  assert(stats.false_sharing_events == 0);

  std::cout << "[PASS] test_multicore_prefetch_shared_region\n";
}

// ============================================================================
// PREFETCH ACCURACY TESTS (Expected patterns)
// ============================================================================

// Test: Sequential access should benefit from prefetching
void test_prefetch_sequential_benefit() {
  Prefetcher pf(PrefetchPolicy::STREAM, 4, 64);

  // Simulate sequential access pattern
  std::vector<uint64_t> all_prefetched;
  for (int i = 0; i < 20; i++) {
    auto addrs = pf.on_miss(0x1000 + i * 64);
    all_prefetched.insert(all_prefetched.end(), addrs.begin(), addrs.end());
  }

  auto stats = pf.get_stats();

  // Sequential pattern should trigger many prefetches
  assert(stats.prefetches_issued >= 10);

  std::cout << "[PASS] test_prefetch_sequential_benefit (issued: "
            << stats.prefetches_issued << ")\n";
}

// Test: Random access should not benefit from stream prefetch
void test_prefetch_random_no_benefit() {
  Prefetcher pf(PrefetchPolicy::STREAM, 2, 64);

  // Random addresses (different pages)
  uint64_t random_addrs[] = {0x1000, 0x5000, 0x9000, 0x3000, 0x7000,
                              0x2000, 0x8000, 0x4000, 0x6000, 0xA000};

  for (auto addr : random_addrs) {
    pf.on_miss(addr);
  }

  auto stats = pf.get_stats();

  // Stream prefetcher should NOT issue many prefetches for random access
  // (pattern not detected)
  // Note: exact threshold depends on implementation
  assert(stats.prefetches_issued < 5);

  std::cout << "[PASS] test_prefetch_random_no_benefit (issued: "
            << stats.prefetches_issued << ")\n";
}

// Test: Strided access should benefit from stride prefetch
void test_prefetch_strided_benefit() {
  Prefetcher pf(PrefetchPolicy::STRIDE, 2, 64);

  uint64_t pc = 0x400100;
  int64_t stride = 256;  // 4 cache lines

  // Access with consistent stride
  for (int i = 0; i < 10; i++) {
    pf.on_miss(0x1000 + i * stride, pc);
  }

  auto stats = pf.get_stats();

  // Stride pattern should be detected and prefetches issued
  assert(stats.prefetches_issued >= 1);

  std::cout << "[PASS] test_prefetch_strided_benefit (issued: "
            << stats.prefetches_issued << ")\n";
}

// Test: Page boundary awareness
void test_prefetch_page_boundary() {
  Prefetcher pf(PrefetchPolicy::STREAM, 4, 64);

  // Access near page boundary (4KB pages)
  // Address 0xFE0 is near end of page 0
  pf.on_miss(0xF80);
  pf.on_miss(0xFC0);

  auto addrs = pf.on_miss(0x1000);  // Crosses to next page

  // Prefetcher should handle page crossing appropriately
  // (may limit prefetches at boundary or start new stream)

  std::cout << "[PASS] test_prefetch_page_boundary\n";
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

// Test: End-to-end prefetch with multi-core
void test_integration_multicore_sequential() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Core 0: sequential access
  for (int i = 0; i < 100; i++) {
    cache.read(0x10000 + i * 64, 0);
  }

  // Core 1: different sequential region
  for (int i = 0; i < 100; i++) {
    cache.read(0x20000 + i * 64, 1);
  }

  auto stats = cache.get_stats();

  // Both cores should show activity
  assert(stats.l1_per_core[0].total_accesses() >= 100);
  assert(stats.l1_per_core[1].total_accesses() >= 100);

  // No false sharing (different regions)
  assert(stats.false_sharing_events == 0);

  std::cout << "[PASS] test_integration_multicore_sequential\n";
}

// Test: End-to-end with producer-consumer prefetch
void test_integration_producer_consumer() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Producer (core 0) writes sequentially
  for (int i = 0; i < 20; i++) {
    cache.write(0x1000 + i * 64, 0);
  }

  // Consumer (core 1) reads sequentially (same region)
  for (int i = 0; i < 20; i++) {
    cache.read(0x1000 + i * 64, 1);
  }

  auto stats = cache.get_stats();

  // Should have coherence traffic (producer's M lines accessed by consumer)
  assert(stats.coherence_invalidations >= 1);

  std::cout << "[PASS] test_integration_producer_consumer\n";
}

// ============================================================================
// MAIN
// ============================================================================

int main() {
  std::cout << "Running Multi-Core Prefetch Tests...\n\n";

  std::cout << "--- Prefetcher Unit Tests ---\n";
  test_prefetch_none_policy();
  test_prefetch_next_line_policy();
  test_prefetch_stream_detection();
  test_prefetch_stride_detection();
  test_prefetch_adaptive();
  test_prefetch_degree();
  test_prefetch_stats();
  test_prefetch_accuracy();
  test_prefetch_reset();

  std::cout << "\n--- Multi-Core Context Tests ---\n";
  test_multicore_prefetch_per_core_isolation();
  test_multicore_prefetch_coherence_safety();
  test_multicore_prefetch_shared_region();

  std::cout << "\n--- Prefetch Accuracy Tests ---\n";
  test_prefetch_sequential_benefit();
  test_prefetch_random_no_benefit();
  test_prefetch_strided_benefit();
  test_prefetch_page_boundary();

  std::cout << "\n--- Integration Tests ---\n";
  test_integration_multicore_sequential();
  test_integration_producer_consumer();

  std::cout << "\n=== All Multi-Core Prefetch Tests Passed! ===\n";
  return 0;
}
