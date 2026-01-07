#include "../include/MultiCoreCacheSystem.hpp"
#include "../include/TLB.hpp"
#include "../profiles/CacheConfig.hpp"
#include <cassert>
#include <iostream>

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
// MULTI-CORE TLB TESTS
// ============================================================================

// Test 1: TLB stats should be accessible from MultiCoreCacheSystem
void test_multicore_tlb_stats_available() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Should be able to get TLB stats from the multi-core system
  auto tlb_stats = cache.get_tlb_stats();

  // Initially should have 0 hits and 0 misses
  assert(tlb_stats.dtlb.hits == 0);
  assert(tlb_stats.dtlb.misses == 0);
  assert(tlb_stats.itlb.hits == 0);
  assert(tlb_stats.itlb.misses == 0);

  std::cout << "[PASS] test_multicore_tlb_stats_available\n";
}

// Test 2: TLB miss on first access to a page
void test_multicore_tlb_miss_on_first_access() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // First read to a page should miss TLB
  cache.read(0x1000, 0);  // Thread 0 reads address

  auto tlb_stats = cache.get_tlb_stats();
  assert(tlb_stats.dtlb.misses == 1);
  assert(tlb_stats.dtlb.hits == 0);

  std::cout << "[PASS] test_multicore_tlb_miss_on_first_access\n";
}

// Test 3: TLB hit on subsequent access to same page
void test_multicore_tlb_hit_on_same_page() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // First access - TLB miss
  cache.read(0x1000, 0);

  // Second access to same page (different offset) - TLB hit
  cache.read(0x1040, 0);  // Same page, different offset

  auto tlb_stats = cache.get_tlb_stats();
  assert(tlb_stats.dtlb.misses == 1);
  assert(tlb_stats.dtlb.hits == 1);

  std::cout << "[PASS] test_multicore_tlb_hit_on_same_page\n";
}

// Test 4: Different pages should cause different TLB misses
void test_multicore_tlb_different_pages() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Access 3 different pages (assuming 4KB page size)
  cache.read(0x1000, 0);      // Page 1
  cache.read(0x2000, 0);      // Page 2
  cache.read(0x3000, 0);      // Page 3

  auto tlb_stats = cache.get_tlb_stats();
  assert(tlb_stats.dtlb.misses == 3);
  assert(tlb_stats.dtlb.hits == 0);

  std::cout << "[PASS] test_multicore_tlb_different_pages\n";
}

// Test 5: Each core should have its own TLB
void test_multicore_per_core_tlb() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Thread 0 on core 0 accesses page 1
  cache.read(0x1000, 0);

  // Thread 1 on core 1 accesses same page - should also miss TLB (per-core TLB)
  cache.read(0x1000, 1);

  auto tlb_stats = cache.get_tlb_stats();
  // Both cores should have TLB misses (per-core TLBs)
  assert(tlb_stats.dtlb.misses == 2);
  assert(tlb_stats.dtlb.hits == 0);

  std::cout << "[PASS] test_multicore_per_core_tlb\n";
}

// Test 6: Write accesses should also track TLB
void test_multicore_tlb_write_access() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Write to new page - should miss TLB
  cache.write(0x1000, 0);

  // Read same page - should hit TLB
  cache.read(0x1040, 0);

  auto tlb_stats = cache.get_tlb_stats();
  assert(tlb_stats.dtlb.misses == 1);
  assert(tlb_stats.dtlb.hits == 1);

  std::cout << "[PASS] test_multicore_tlb_write_access\n";
}

// Test 7: Per-core TLB stats should be available
void test_multicore_per_core_tlb_stats() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Thread 0 makes 3 accesses
  cache.read(0x1000, 0);  // miss
  cache.read(0x1040, 0);  // hit
  cache.read(0x2000, 0);  // miss

  // Thread 1 makes 1 access
  cache.read(0x3000, 1);  // miss

  // Get per-core stats
  auto core0_tlb = cache.get_tlb_stats_for_core(0);
  auto core1_tlb = cache.get_tlb_stats_for_core(1);

  assert(core0_tlb.hits == 1);
  assert(core0_tlb.misses == 2);
  assert(core1_tlb.hits == 0);
  assert(core1_tlb.misses == 1);

  std::cout << "[PASS] test_multicore_per_core_tlb_stats\n";
}

// Test 8: TLB hit rate should be calculable
void test_multicore_tlb_hit_rate() {
  MultiCoreCacheSystem cache(4, make_test_l1_config(),
                              make_test_l2_config(), make_test_l3_config());

  // Access pattern: miss, hit, hit, hit (4 accesses, 1 miss, 3 hits)
  cache.read(0x1000, 0);  // miss
  cache.read(0x1040, 0);  // hit
  cache.read(0x1080, 0);  // hit
  cache.read(0x10C0, 0);  // hit

  auto tlb_stats = cache.get_tlb_stats();
  double hit_rate = tlb_stats.dtlb.hit_rate();

  // Should be 75% hit rate (3 hits / 4 accesses)
  assert(hit_rate > 0.74 && hit_rate < 0.76);

  std::cout << "[PASS] test_multicore_tlb_hit_rate\n";
}

int main() {
  std::cout << "=== Multi-Core TLB Tests ===\n\n";

  test_multicore_tlb_stats_available();
  test_multicore_tlb_miss_on_first_access();
  test_multicore_tlb_hit_on_same_page();
  test_multicore_tlb_different_pages();
  test_multicore_per_core_tlb();
  test_multicore_tlb_write_access();
  test_multicore_per_core_tlb_stats();
  test_multicore_tlb_hit_rate();

  std::cout << "\n=== All 8 tests passed! ===\n";
  return 0;
}
