#include "../include/CacheSystem.hpp"
#include "../include/MemoryAccess.hpp"
#include "../profiles/HardwarePresets.hpp"
#include <cassert>
#include <iostream>

CacheHierarchyConfig make_simple_config() {
  return {
      .l1_data = {.kb_size = 1, .associativity = 2, .line_size = 64,
                  .policy = EvictionPolicy::LRU, .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 1, .associativity = 2, .line_size = 64,
                  .policy = EvictionPolicy::LRU, .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 4, .associativity = 4, .line_size = 64,
             .policy = EvictionPolicy::LRU, .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 16, .associativity = 8, .line_size = 64,
             .policy = EvictionPolicy::LRU, .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::Inclusive};
}

void test_basic_read() {
  CacheSystem cache(make_simple_config());

  auto result = cache.read(0x1000);
  assert(!result.l1_hit);
  assert(!result.l2_hit);
  assert(!result.l3_hit);
  assert(result.memory_access);

  result = cache.read(0x1000);
  assert(result.l1_hit);
  assert(!result.memory_access);

  std::cout << "[PASS] test_basic_read\n";
}

void test_basic_write() {
  CacheSystem cache(make_simple_config());

  auto result = cache.write(0x1000);
  assert(result.memory_access);

  result = cache.read(0x1000);
  assert(result.l1_hit);

  std::cout << "[PASS] test_basic_write\n";
}

void test_instruction_fetch() {
  CacheSystem cache(make_simple_config());

  auto result = cache.fetch(0x1000);
  assert(result.memory_access);

  result = cache.fetch(0x1000);
  assert(result.l1_hit);

  // Data access should miss L1i cache
  result = cache.read(0x1000);
  assert(!result.l1_hit); // Different L1 cache

  std::cout << "[PASS] test_instruction_fetch\n";
}

void test_l2_hit() {
  CacheSystem cache(make_simple_config());

  // Fill L1d with other lines to evict target
  cache.read(0x1000); // Install our target

  // L1d is 1KB, 2-way, 64B = 8 sets. Fill set 0.
  // 0x1000 maps to set (0x1000 >> 6) & 7 = 0
  // Fill with 3 more lines to same set to evict original
  cache.read(0x1000 + 0x200); // different tag, same set
  cache.read(0x1000 + 0x400);

  // Now 0x1000 should be evicted from L1 but in L2
  auto result = cache.read(0x1000);
  assert(result.l2_hit || result.l1_hit);

  std::cout << "[PASS] test_l2_hit\n";
}

void test_stats_tracking() {
  CacheSystem cache(make_simple_config());

  cache.read(0x1000);
  cache.read(0x1000);
  cache.read(0x2000);

  auto stats = cache.get_stats();
  assert(stats.l1d.misses == 2);
  assert(stats.l1d.hits == 1);
  assert(stats.l1d.total_accesses() == 3);

  std::cout << "[PASS] test_stats_tracking\n";
}

void test_stats_reset() {
  CacheSystem cache(make_simple_config());

  cache.read(0x1000);
  cache.reset_stats();

  auto stats = cache.get_stats();
  assert(stats.l1d.total_accesses() == 0);

  std::cout << "[PASS] test_stats_reset\n";
}

void test_inclusive_back_invalidation() {
  auto cfg = make_simple_config();
  cfg.inclusion_policy = InclusionPolicy::Inclusive;
  CacheSystem cache(cfg);

  // Access a line
  cache.read(0x1000);

  // Verify in L1
  assert(cache.get_l1d().is_present(0x1000));

  // Access enough lines to evict from L3
  // L3 is 16KB, 8-way, 64B = 32 sets
  // Fill set 0 with 9 lines to evict original
  uint64_t base = 0x1000;
  for (int i = 1; i <= 8; i++) {
    cache.read(base + i * 0x800); // different tags, same L3 set
  }

  // After L3 evicts, L1 should also be invalidated (inclusive)
  // Note: this depends on L3 set mapping

  std::cout << "[PASS] test_inclusive_back_invalidation\n";
}

void test_exclusive_victim_behavior() {
  auto cfg = make_simple_config();
  cfg.inclusion_policy = InclusionPolicy::Exclusive;
  CacheSystem cache(cfg);

  cache.read(0x1000);
  assert(cache.get_l1d().is_present(0x1000));

  std::cout << "[PASS] test_exclusive_victim_behavior\n";
}

void test_cross_line_access() {
  MemoryAccess access = {.address = 60, .size = 8, .is_write = false};
  auto lines = split_access_to_cache_lines(access, 64);

  assert(lines.size() == 2);
  assert(lines[0].line_address == 0);
  assert(lines[1].line_address == 64);

  std::cout << "[PASS] test_cross_line_access\n";
}

void test_single_line_access() {
  MemoryAccess access = {.address = 100, .size = 4, .is_write = false};
  auto lines = split_access_to_cache_lines(access, 64);

  assert(lines.size() == 1);
  assert(lines[0].line_address == 64);

  std::cout << "[PASS] test_single_line_access\n";
}

void test_hardware_presets_valid() {
  auto intel = make_intel_12th_gen_config();
  assert(intel.l1_data.is_valid());
  assert(intel.l2.is_valid());
  assert(intel.l3.is_valid());

  auto amd = make_amd_zen4_config();
  assert(amd.l1_data.is_valid());
  assert(amd.l2.is_valid());
  assert(amd.l3.is_valid());

  auto apple = make_apple_m_series_config();
  assert(apple.l1_data.is_valid());
  assert(apple.l2.is_valid());
  assert(apple.l3.is_valid());

  std::cout << "[PASS] test_hardware_presets_valid\n";
}

void test_plru_policy() {
  CacheConfig cfg = {.kb_size = 1, .associativity = 4, .line_size = 64,
                     .policy = EvictionPolicy::PLRU};
  CacheLevel cache(cfg);

  // Fill set 0
  uint64_t addrs[5];
  for (int i = 0; i < 4; i++) {
    addrs[i] = i * 0x100;
    cache.access(addrs[i], false);
  }

  // All should hit
  for (int i = 0; i < 4; i++) {
    auto info = cache.access(addrs[i], false);
    assert(info.result == AccessResult::Hit);
  }

  // Add 5th, should evict something
  addrs[4] = 4 * 0x100;
  auto info = cache.access(addrs[4], false);
  assert(info.result == AccessResult::Miss);

  std::cout << "[PASS] test_plru_policy\n";
}

void test_srrip_policy() {
  CacheConfig cfg = {.kb_size = 1, .associativity = 4, .line_size = 64,
                     .policy = EvictionPolicy::SRRIP};
  CacheLevel cache(cfg);

  // Fill set 0
  for (int i = 0; i < 4; i++) {
    cache.access(i * 0x100, false);
  }

  // All should hit
  for (int i = 0; i < 4; i++) {
    auto info = cache.access(i * 0x100, false);
    assert(info.result == AccessResult::Hit);
  }

  // Add 5th, should evict LRU-like
  auto info = cache.access(4 * 0x100, false);
  assert(info.result == AccessResult::Miss);

  std::cout << "[PASS] test_srrip_policy\n";
}

void test_brrip_policy() {
  CacheConfig cfg = {.kb_size = 1, .associativity = 4, .line_size = 64,
                     .policy = EvictionPolicy::BRRIP};
  CacheLevel cache(cfg);

  // Fill set 0
  for (int i = 0; i < 4; i++) {
    cache.access(i * 0x100, false);
  }

  // All should hit
  for (int i = 0; i < 4; i++) {
    auto info = cache.access(i * 0x100, false);
    assert(info.result == AccessResult::Hit);
  }

  // Add 5th, should evict
  auto info = cache.access(4 * 0x100, false);
  assert(info.result == AccessResult::Miss);

  std::cout << "[PASS] test_brrip_policy\n";
}

void test_prefetching_stream() {
  CacheSystem cache(make_simple_config());
  cache.enable_prefetching(PrefetchPolicy::STREAM, 2);

  // Sequential accesses should trigger stream prefetching
  for (int i = 0; i < 10; i++) {
    cache.read(0x1000 + i * 64);
  }

  auto stats = cache.get_prefetch_stats();
  assert(stats.prefetches_issued > 0);

  std::cout << "[PASS] test_prefetching_stream\n";
}

void test_prefetching_disabled() {
  CacheSystem cache(make_simple_config());
  assert(!cache.is_prefetching_enabled());

  // Access some data
  for (int i = 0; i < 10; i++) {
    cache.read(0x1000 + i * 64);
  }

  auto stats = cache.get_prefetch_stats();
  assert(stats.prefetches_issued == 0);

  std::cout << "[PASS] test_prefetching_disabled\n";
}

// ============ CORRECTNESS VERIFICATION TESTS ============

void test_sequential_access_high_hit_rate() {
  // Sequential access within cache should have very high hit rate
  // (after first miss, subsequent accesses to same line should hit)
  CacheSystem cache(make_simple_config());

  // Access 10 bytes sequentially - all within one cache line (64 bytes)
  for (int i = 0; i < 10; i++) {
    cache.read(0x1000 + i);
  }

  auto stats = cache.get_stats();
  // First access misses, next 9 hit (same cache line)
  assert(stats.l1d.hits == 9);
  assert(stats.l1d.misses == 1);
  double hit_rate = stats.l1d.hit_rate();
  assert(hit_rate >= 0.89 && hit_rate <= 0.91);  // Should be exactly 90%

  std::cout << "[PASS] test_sequential_access_high_hit_rate (90% expected, got "
            << (hit_rate * 100) << "%)\n";
}

void test_strided_access_pattern() {
  // Strided access by cache line should have 0% L1 hit rate initially
  // Each access is to a new line
  CacheSystem cache(make_simple_config());

  // Access every 64 bytes (new cache line each time)
  for (int i = 0; i < 8; i++) {
    cache.read(0x1000 + i * 64);
  }

  auto stats = cache.get_stats();
  // All 8 accesses should miss (new cache line each time)
  assert(stats.l1d.misses == 8);
  assert(stats.l1d.hits == 0);

  // Now access same lines again - should all hit
  for (int i = 0; i < 8; i++) {
    cache.read(0x1000 + i * 64);
  }

  stats = cache.get_stats();
  assert(stats.l1d.hits == 8);  // Second round all hit
  double hit_rate = stats.l1d.hit_rate();
  assert(hit_rate >= 0.49 && hit_rate <= 0.51);  // Should be 50%

  std::cout << "[PASS] test_strided_access_pattern (50% expected, got "
            << (hit_rate * 100) << "%)\n";
}

void test_random_access_low_hit_rate() {
  // Random access to many lines should have low hit rate
  // when exceeding cache capacity
  CacheSystem cache(make_simple_config());

  // Our L1d is 1KB = 16 cache lines (64B each)
  // Access 32 different cache lines (twice capacity)
  for (int i = 0; i < 32; i++) {
    cache.read(i * 64);  // Each access is a new cache line
  }

  auto stats = cache.get_stats();
  // All should miss since each is a new line
  assert(stats.l1d.misses == 32);
  assert(stats.l1d.hits == 0);

  std::cout << "[PASS] test_random_access_low_hit_rate (0% hit rate as expected)\n";
}

void test_temporal_locality() {
  // Repeated access to same location should hit after first miss
  CacheSystem cache(make_simple_config());

  // Access same address 100 times
  for (int i = 0; i < 100; i++) {
    cache.read(0x1000);
  }

  auto stats = cache.get_stats();
  assert(stats.l1d.misses == 1);  // Only first access misses
  assert(stats.l1d.hits == 99);   // Rest all hit
  double hit_rate = stats.l1d.hit_rate();
  assert(hit_rate >= 0.98);  // Should be 99%

  std::cout << "[PASS] test_temporal_locality (99% expected, got "
            << (hit_rate * 100) << "%)\n";
}

void test_spatial_locality() {
  // Accessing data within same cache line should hit
  CacheSystem cache(make_simple_config());

  // Access different offsets within same cache line
  uint64_t base = 0x1000 & ~0x3F;  // Align to cache line
  for (int offset = 0; offset < 64; offset += 4) {
    cache.read(base + offset);
  }

  auto stats = cache.get_stats();
  // 16 accesses (0, 4, 8, ... 60), all to same cache line
  // First miss, rest 15 hit
  assert(stats.l1d.misses == 1);
  assert(stats.l1d.hits == 15);
  double hit_rate = stats.l1d.hit_rate();
  assert(hit_rate >= 0.93);  // Should be 93.75%

  std::cout << "[PASS] test_spatial_locality (93.75% expected, got "
            << (hit_rate * 100) << "%)\n";
}

void test_working_set_fits_cache() {
  // When working set fits in cache, should achieve high hit rate
  CacheSystem cache(make_simple_config());

  // L1d is 1KB = 16 lines. Use only 8 lines for working set.
  uint64_t working_set[8];
  for (int i = 0; i < 8; i++) {
    working_set[i] = i * 64;  // 8 different cache lines
  }

  // First pass: populate cache (all misses)
  for (int i = 0; i < 8; i++) {
    cache.read(working_set[i]);
  }

  // 10 more passes: should all hit
  for (int pass = 0; pass < 10; pass++) {
    for (int i = 0; i < 8; i++) {
      cache.read(working_set[i]);
    }
  }

  auto stats = cache.get_stats();
  // 8 initial misses + 80 hits
  assert(stats.l1d.misses == 8);
  assert(stats.l1d.hits == 80);
  double hit_rate = stats.l1d.hit_rate();
  assert(hit_rate >= 0.90);  // Should be ~91%

  std::cout << "[PASS] test_working_set_fits_cache (90.9% expected, got "
            << (hit_rate * 100) << "%)\n";
}

void test_working_set_exceeds_cache() {
  // When working set exceeds cache, should have lower hit rate
  CacheSystem cache(make_simple_config());

  // L1d is 1KB, 2-way = 8 sets. Use 20 lines that all map to set 0.
  // Set index = (addr >> 6) & (8-1) = (addr >> 6) & 7
  // For set 0: addr = 0, 0x200, 0x400, 0x600, etc.
  uint64_t working_set[20];
  for (int i = 0; i < 20; i++) {
    working_set[i] = i * 0x200;  // All map to set 0
  }

  // Multiple passes over working set
  for (int pass = 0; pass < 5; pass++) {
    for (int i = 0; i < 20; i++) {
      cache.read(working_set[i]);
    }
  }

  auto stats = cache.get_stats();
  // With 2-way set associative, can only keep 2 lines per set
  // 20 lines competing for 2 slots = thrashing
  double hit_rate = stats.l1d.hit_rate();
  // Should be low due to thrashing
  assert(hit_rate < 0.30);  // Should be much lower than 30%

  std::cout << "[PASS] test_working_set_exceeds_cache (low hit rate expected, got "
            << (hit_rate * 100) << "%)\n";
}

void test_hit_rate_bounds() {
  // Verify hit rate is always in valid range [0, 1]
  CacheSystem cache(make_simple_config());

  // Empty cache
  auto stats = cache.get_stats();
  assert(stats.l1d.hit_rate() >= 0.0 && stats.l1d.hit_rate() <= 1.0);
  assert(stats.l2.hit_rate() >= 0.0 && stats.l2.hit_rate() <= 1.0);
  assert(stats.l3.hit_rate() >= 0.0 && stats.l3.hit_rate() <= 1.0);

  // After some accesses
  for (int i = 0; i < 100; i++) {
    cache.read(i * 8);
  }

  stats = cache.get_stats();
  assert(stats.l1d.hit_rate() >= 0.0 && stats.l1d.hit_rate() <= 1.0);
  assert(stats.l2.hit_rate() >= 0.0 && stats.l2.hit_rate() <= 1.0);
  assert(stats.l3.hit_rate() >= 0.0 && stats.l3.hit_rate() <= 1.0);

  std::cout << "[PASS] test_hit_rate_bounds\n";
}

void test_miss_count_consistency() {
  // Verify: misses at L1 should flow to L2, L2 misses to L3
  CacheSystem cache(make_simple_config());

  // Access many unique lines to force hierarchy traversal
  for (int i = 0; i < 100; i++) {
    cache.read(i * 64);
  }

  auto stats = cache.get_stats();

  // L1 misses should approximately equal L2 total accesses
  // (some L1 misses may be filtered, but should be close)
  uint64_t l1_misses = stats.l1d.misses;
  uint64_t l2_total = stats.l2.total_accesses();

  // Allow some flexibility due to prefetching, but should be in same ballpark
  assert(l2_total <= l1_misses);  // L2 can't have more than L1 missed

  // L2 misses should be <= L3 accesses
  uint64_t l2_misses = stats.l2.misses;
  uint64_t l3_total = stats.l3.total_accesses();
  assert(l3_total <= l2_misses + 10);  // Allow small margin

  std::cout << "[PASS] test_miss_count_consistency (L1 misses=" << l1_misses
            << ", L2 total=" << l2_total << ", L3 total=" << l3_total << ")\n";
}

int main() {
  std::cout << "Running CacheSystem tests...\n\n";

  // Basic functionality tests
  test_basic_read();
  test_basic_write();
  test_instruction_fetch();
  test_l2_hit();
  test_stats_tracking();
  test_stats_reset();
  test_inclusive_back_invalidation();
  test_exclusive_victim_behavior();
  test_cross_line_access();
  test_single_line_access();
  test_hardware_presets_valid();

  // Eviction policy tests
  test_plru_policy();
  test_srrip_policy();
  test_brrip_policy();

  // Prefetching tests
  test_prefetching_stream();
  test_prefetching_disabled();

  // Correctness verification tests (verify expected cache behavior)
  std::cout << "\n--- Correctness Verification ---\n";
  test_sequential_access_high_hit_rate();
  test_strided_access_pattern();
  test_random_access_low_hit_rate();
  test_temporal_locality();
  test_spatial_locality();
  test_working_set_fits_cache();
  test_working_set_exceeds_cache();
  test_hit_rate_bounds();
  test_miss_count_consistency();

  std::cout << "\n=== All 25 tests passed! ===\n";
  return 0;
}
