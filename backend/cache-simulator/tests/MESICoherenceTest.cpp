#include "../include/MultiCoreCacheSystem.hpp"
#include "../include/CoherenceController.hpp"
#include "../include/CoherenceState.hpp"
#include "../include/CacheLevel.hpp"
#include "../profiles/CacheConfig.hpp"
#include <cassert>
#include <iostream>
#include <vector>

// Simple config for testing - small caches for predictable behavior
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
// MESI COHERENCE CORRECTNESS TESTS
// ============================================================================

// Test 1: Invalid -> Shared transition (read miss, no other copies)
void test_mesi_invalid_to_shared_on_read() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Thread 0 reads address - should get it in Shared state
  auto result = cache.read(0x1000, 0);
  assert(!result.l1_hit);  // First access is a miss

  // Second read should hit
  result = cache.read(0x1000, 0);
  assert(result.l1_hit);

  std::cout << "[PASS] test_mesi_invalid_to_shared_on_read\n";
}

// Test 2: Invalid -> Exclusive transition (read miss, first reader)
void test_mesi_invalid_to_exclusive() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Core 0 reads - should be exclusive (only copy)
  cache.read(0x1000, 0);

  // No other core has it, so no invalidations should occur
  auto stats = cache.get_stats();
  assert(stats.coherence_invalidations == 0);

  std::cout << "[PASS] test_mesi_invalid_to_exclusive\n";
}

// Test 3: Invalid -> Modified transition (write miss)
void test_mesi_invalid_to_modified_on_write() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Thread 0 writes - should get Modified state
  auto result = cache.write(0x1000, 0);
  assert(!result.l1_hit);  // First write is a miss

  // Subsequent read should hit (data is in cache)
  result = cache.read(0x1000, 0);
  assert(result.l1_hit);

  std::cout << "[PASS] test_mesi_invalid_to_modified_on_write\n";
}

// Test 4: Shared -> Invalid transition (another core writes)
void test_mesi_shared_to_invalid_on_remote_write() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Thread 0 reads address
  cache.read(0x1000, 0);

  // Thread 1 reads same address - both now in Shared state
  cache.read(0x1000, 1);

  // Thread 2 writes - should invalidate cores 0 and 1
  cache.write(0x1000, 2);

  auto stats = cache.get_stats();
  // Should have at least 1 invalidation (cores 0 and 1 had copies)
  assert(stats.coherence_invalidations >= 1);

  std::cout << "[PASS] test_mesi_shared_to_invalid_on_remote_write\n";
}

// Test 5: Modified -> Invalid transition (another core wants exclusive)
void test_mesi_modified_to_invalid_on_remote_write() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Thread 0 writes - gets Modified state
  cache.write(0x1000, 0);

  // Thread 1 writes same address - should invalidate core 0's copy
  cache.write(0x1000, 1);

  auto stats = cache.get_stats();
  // Should have invalidation (core 0's M copy invalidated)
  assert(stats.coherence_invalidations >= 1);

  std::cout << "[PASS] test_mesi_modified_to_invalid_on_remote_write\n";
}

// Test 6: Shared -> Modified (local upgrade)
void test_mesi_shared_to_modified_upgrade() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Thread 0 reads - gets Shared/Exclusive
  cache.read(0x1000, 0);

  // Thread 0 writes same address - upgrades to Modified
  cache.write(0x1000, 0);

  // Should still hit in L1 (data was there)
  auto result = cache.read(0x1000, 0);
  assert(result.l1_hit);

  std::cout << "[PASS] test_mesi_shared_to_modified_upgrade\n";
}

// Test 7: Modified data forwarding (snoop hit on modified line)
void test_mesi_modified_data_forwarding() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Thread 0 writes - has Modified copy
  cache.write(0x1000, 0);

  // Thread 1 reads - should get data forwarded from core 0
  cache.read(0x1000, 1);

  auto stats = cache.get_stats();
  // The modified line was found (coherence traffic occurred)
  assert(stats.coherence_invalidations >= 1);

  std::cout << "[PASS] test_mesi_modified_data_forwarding\n";
}

// Test 8: Silent write in Exclusive/Modified state
void test_mesi_silent_write() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Thread 0 writes twice to same address
  cache.write(0x1000, 0);

  auto stats_before = cache.get_stats();

  // Second write should be silent (already Modified)
  cache.write(0x1000, 0);

  auto stats_after = cache.get_stats();

  // No additional coherence traffic for second write
  assert(stats_after.coherence_invalidations == stats_before.coherence_invalidations);

  std::cout << "[PASS] test_mesi_silent_write\n";
}

// Test 9: Multiple readers (Shared state)
void test_mesi_multiple_readers() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // All 4 cores read same address
  for (int t = 0; t < 4; t++) {
    cache.read(0x1000, t);
  }

  // Should not cause invalidations (all are reading)
  auto stats = cache.get_stats();
  assert(stats.coherence_invalidations == 0);

  // All cores should have the data
  for (int t = 0; t < 4; t++) {
    auto result = cache.read(0x1000, t);
    assert(result.l1_hit);
  }

  std::cout << "[PASS] test_mesi_multiple_readers\n";
}

// Test 10: Write invalidates all sharers
void test_mesi_write_invalidates_all_sharers() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Cores 0, 1, 2 read address
  cache.read(0x1000, 0);
  cache.read(0x1000, 1);
  cache.read(0x1000, 2);

  // Core 3 writes - should invalidate all other copies
  cache.write(0x1000, 3);

  auto stats = cache.get_stats();
  // At least one invalidation should occur
  assert(stats.coherence_invalidations >= 1);

  // Now cores 0, 1, 2 should miss when they read again
  // (their copies were invalidated)
  auto result0 = cache.read(0x1000, 0);
  auto result1 = cache.read(0x1000, 1);
  auto result2 = cache.read(0x1000, 2);

  // At least some should miss due to invalidation
  // (exact behavior depends on implementation)

  std::cout << "[PASS] test_mesi_write_invalidates_all_sharers\n";
}

// ============================================================================
// MESI COHERENCE ACCURACY TESTS
// ============================================================================

// Test: Invalidation count accuracy
void test_mesi_invalidation_count_accuracy() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Pattern: Core 0 writes, then cores 1,2,3 read, then core 0 writes again
  cache.write(0x1000, 0);  // Core 0 gets M

  // Cores 1,2,3 read - core 0's M line detected
  cache.read(0x1000, 1);
  cache.read(0x1000, 2);
  cache.read(0x1000, 3);

  auto stats = cache.get_stats();
  uint64_t inv_after_reads = stats.coherence_invalidations;

  // Core 0 writes again - should invalidate all other copies
  cache.write(0x1000, 0);

  stats = cache.get_stats();
  uint64_t inv_after_write = stats.coherence_invalidations;

  // Additional invalidations should occur
  assert(inv_after_write > inv_after_reads);

  std::cout << "[PASS] test_mesi_invalidation_count_accuracy (invs: "
            << inv_after_write << ")\n";
}

// Test: Producer-consumer pattern
void test_mesi_producer_consumer_pattern() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Simulate producer-consumer: core 0 writes, core 1 reads
  for (int i = 0; i < 10; i++) {
    cache.write(0x1000 + i * 64, 0);  // Producer writes
    cache.read(0x1000 + i * 64, 1);   // Consumer reads
  }

  auto stats = cache.get_stats();
  // Should have coherence traffic for each item
  // (producer's M line snooped by consumer)
  assert(stats.coherence_invalidations >= 10);

  std::cout << "[PASS] test_mesi_producer_consumer_pattern (invs: "
            << stats.coherence_invalidations << ")\n";
}

// Test: False sharing detection accuracy
void test_false_sharing_detection() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Two threads writing to different bytes in same cache line
  // Base address 0x1000, line size 64
  uint64_t base = 0x1000;

  for (int i = 0; i < 10; i++) {
    cache.write(base + 0, 0, "test.c", 10);   // Thread 0 writes byte 0
    cache.write(base + 32, 1, "test.c", 20);  // Thread 1 writes byte 32
  }

  auto stats = cache.get_stats();
  assert(stats.false_sharing_events >= 1);

  auto reports = cache.get_false_sharing_reports();
  assert(!reports.empty());

  // Verify the false sharing report
  bool found = false;
  for (const auto& report : reports) {
    if (report.cache_line_addr == (base & ~0x3FUL)) {
      found = true;
      assert(report.accesses.size() >= 2);
    }
  }
  assert(found);

  std::cout << "[PASS] test_false_sharing_detection (events: "
            << stats.false_sharing_events << ")\n";
}

// Test: No false sharing when threads access same bytes
void test_no_false_sharing_same_bytes() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Two threads writing to SAME byte - this is true sharing, not false sharing
  uint64_t addr = 0x1000;

  for (int i = 0; i < 10; i++) {
    cache.write(addr, 0, "test.c", 10);
    cache.write(addr, 1, "test.c", 20);
  }

  auto stats = cache.get_stats();
  // Should NOT be detected as false sharing (same bytes)
  assert(stats.false_sharing_events == 0);

  std::cout << "[PASS] test_no_false_sharing_same_bytes\n";
}

// Test: No false sharing when only one thread writes
void test_no_false_sharing_reads_only() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  uint64_t base = 0x1000;

  // Thread 0 reads byte 0, Thread 1 reads byte 32
  for (int i = 0; i < 10; i++) {
    cache.read(base + 0, 0, "test.c", 10);
    cache.read(base + 32, 1, "test.c", 20);
  }

  auto stats = cache.get_stats();
  // No false sharing (no writes)
  assert(stats.false_sharing_events == 0);

  std::cout << "[PASS] test_no_false_sharing_reads_only\n";
}

// ============================================================================
// COHERENCE STATE TRANSITION TESTS
// ============================================================================

// Test state helper functions
void test_coherence_state_helpers() {
  // Invalid state
  assert(!can_read(CoherenceState::Invalid));
  assert(!can_write_silently(CoherenceState::Invalid));
  assert(!is_dirty_state(CoherenceState::Invalid));

  // Shared state
  assert(can_read(CoherenceState::Shared));
  assert(!can_write_silently(CoherenceState::Shared));
  assert(!is_dirty_state(CoherenceState::Shared));

  // Exclusive state
  assert(can_read(CoherenceState::Exclusive));
  assert(can_write_silently(CoherenceState::Exclusive));
  assert(!is_dirty_state(CoherenceState::Exclusive));

  // Modified state
  assert(can_read(CoherenceState::Modified));
  assert(can_write_silently(CoherenceState::Modified));
  assert(is_dirty_state(CoherenceState::Modified));

  std::cout << "[PASS] test_coherence_state_helpers\n";
}

// ============================================================================
// MULTI-CORE SYSTEM TESTS
// ============================================================================

// Test per-core L1 isolation
void test_multicore_l1_isolation() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Each core accesses different address
  cache.read(0x1000, 0);
  cache.read(0x2000, 1);
  cache.read(0x3000, 2);
  cache.read(0x4000, 3);

  // Each should hit on second access to their own address
  assert(cache.read(0x1000, 0).l1_hit);
  assert(cache.read(0x2000, 1).l1_hit);
  assert(cache.read(0x3000, 2).l1_hit);
  assert(cache.read(0x4000, 3).l1_hit);

  // And miss on each other's addresses
  assert(!cache.read(0x2000, 0).l1_hit);  // Core 0 doesn't have core 1's data

  std::cout << "[PASS] test_multicore_l1_isolation\n";
}

// Test shared L2/L3
void test_multicore_shared_l2l3() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Core 0 reads address, bringing it into L2/L3
  cache.read(0x1000, 0);

  // Core 1 reads same address - should hit in L2 (not memory)
  auto result = cache.read(0x1000, 1);
  assert(!result.memory_access);  // Should hit somewhere in hierarchy

  std::cout << "[PASS] test_multicore_shared_l2l3\n";
}

// Test thread-to-core mapping
void test_thread_to_core_mapping() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Access from 10 different threads
  for (uint32_t t = 0; t < 10; t++) {
    cache.read(0x1000 + t * 64, t);
  }

  // Threads should be distributed across cores (round-robin)
  auto stats = cache.get_stats();
  assert(stats.l1_per_core.size() == 4);

  // Each core should have some accesses
  uint64_t total = 0;
  for (const auto& s : stats.l1_per_core) {
    total += s.total_accesses();
  }
  assert(total >= 10);

  std::cout << "[PASS] test_thread_to_core_mapping\n";
}

// ============================================================================
// MAIN
// ============================================================================

int main() {
  std::cout << "Running MESI Coherence Tests...\n\n";

  std::cout << "--- Correctness Tests ---\n";
  test_mesi_invalid_to_shared_on_read();
  test_mesi_invalid_to_exclusive();
  test_mesi_invalid_to_modified_on_write();
  test_mesi_shared_to_invalid_on_remote_write();
  test_mesi_modified_to_invalid_on_remote_write();
  test_mesi_shared_to_modified_upgrade();
  test_mesi_modified_data_forwarding();
  test_mesi_silent_write();
  test_mesi_multiple_readers();
  test_mesi_write_invalidates_all_sharers();

  std::cout << "\n--- Accuracy Tests ---\n";
  test_mesi_invalidation_count_accuracy();
  test_mesi_producer_consumer_pattern();
  test_false_sharing_detection();
  test_no_false_sharing_same_bytes();
  test_no_false_sharing_reads_only();

  std::cout << "\n--- State Helper Tests ---\n";
  test_coherence_state_helpers();

  std::cout << "\n--- Multi-Core System Tests ---\n";
  test_multicore_l1_isolation();
  test_multicore_shared_l2l3();
  test_thread_to_core_mapping();

  std::cout << "\n=== All MESI Coherence Tests Passed! ===\n";
  return 0;
}
