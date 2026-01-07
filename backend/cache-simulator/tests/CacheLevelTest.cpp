#include "../include/CacheLevel.hpp"
#include <cassert>
#include <iostream>

// Test config: 1KB, 4-way, 64-byte lines = 4 sets
// offset_bits = 6, index_bits = 2, tag = rest
CacheConfig make_test_config() {
  return {.kb_size = 1, .associativity = 4, .line_size = 64};
}

// Helper to create address with specific tag and index
uint64_t make_address(uint64_t tag, uint64_t index, uint64_t offset = 0) {
  // For test config: offset=6 bits, index=2 bits
  return (tag << 8) | (index << 6) | offset;
}

void test_config_validation() {
  // Valid config
  CacheConfig valid = {.kb_size = 1, .associativity = 4, .line_size = 64};
  assert(valid.is_valid());

  // Zero size
  CacheConfig zero_size = {.kb_size = 0, .associativity = 4, .line_size = 64};
  assert(!zero_size.is_valid());

  // Zero associativity
  CacheConfig zero_assoc = {.kb_size = 1, .associativity = 0, .line_size = 64};
  assert(!zero_assoc.is_valid());

  // Non-power-of-2 line size
  CacheConfig bad_line = {.kb_size = 1, .associativity = 4, .line_size = 48};
  assert(!bad_line.is_valid());

  // Non-power-of-2 num_sets (3KB / 64 / 4 = 12 sets)
  CacheConfig bad_sets = {.kb_size = 3, .associativity = 4, .line_size = 64};
  assert(!bad_sets.is_valid());

  std::cout << "[PASS] test_config_validation\n";
}

void test_invalid_config_throws() {
  CacheConfig invalid = {.kb_size = 0, .associativity = 4, .line_size = 64};
  bool threw = false;
  try {
    CacheLevel cache(invalid);
  } catch (const std::invalid_argument &) {
    threw = true;
  }
  assert(threw);

  std::cout << "[PASS] test_invalid_config_throws\n";
}

void test_address_parsing() {
  CacheConfig cfg = make_test_config();
  // 1KB, 4-way, 64-byte lines = 4 sets
  // offset_bits = 6, index_bits = 2

  // Address 0x1234:
  // offset (bits 0-5) = 0x34
  // index (bits 6-7) = (0x1234 >> 6) & 0x3 = 0x48 & 0x3 = 0
  // tag (bits 8+) = 0x1234 >> 8 = 0x12
  uint64_t addr = 0x1234;
  assert(cfg.get_offset(addr) == 0x34);
  assert(cfg.get_index(addr) == 0);
  assert(cfg.get_tag(addr) == 0x12);

  // Address 0x1C0 = 448 = 0b111_000000
  // offset = 0, index = (448 >> 6) & 3 = 7 & 3 = 3, tag = 448 >> 8 = 1
  addr = 0x1C0;
  assert(cfg.get_offset(addr) == 0);
  assert(cfg.get_index(addr) == 3);
  assert(cfg.get_tag(addr) == 1);

  std::cout << "[PASS] test_address_parsing\n";
}

void test_address_zero() {
  CacheConfig cfg = make_test_config();
  CacheLevel cache(cfg);

  // Address 0 should work
  uint64_t addr = 0;
  assert(cfg.get_offset(addr) == 0);
  assert(cfg.get_index(addr) == 0);
  assert(cfg.get_tag(addr) == 0);

  AccessInfo info = cache.access(addr, false);
  assert(info.result == AccessResult::Miss);

  info = cache.access(addr, false);
  assert(info.result == AccessResult::Hit);

  std::cout << "[PASS] test_address_zero\n";
}

void test_large_address() {
  CacheConfig cfg = make_test_config();
  CacheLevel cache(cfg);

  // Large 64-bit address
  uint64_t addr = 0xDEADBEEF12345678ULL;
  AccessInfo info = cache.access(addr, false);
  assert(info.result == AccessResult::Miss);

  info = cache.access(addr, false);
  assert(info.result == AccessResult::Hit);

  std::cout << "[PASS] test_large_address\n";
}

void test_basic_hit_miss() {
  CacheConfig cfg = make_test_config();
  CacheLevel cache(cfg);

  uint64_t addr = 0x1000;

  // First access should miss
  AccessInfo info = cache.access(addr, false);
  assert(info.result == AccessResult::Miss);

  // Second access should hit
  info = cache.access(addr, false);
  assert(info.result == AccessResult::Hit);

  // Different address, same set, should miss
  uint64_t addr2 = 0x2000; // different tag, same index
  info = cache.access(addr2, false);
  assert(info.result == AccessResult::Miss);

  // Original address should still hit
  info = cache.access(addr, false);
  assert(info.result == AccessResult::Hit);

  std::cout << "[PASS] test_basic_hit_miss\n";
}

void test_same_address_repeated() {
  CacheConfig cfg = make_test_config();
  CacheLevel cache(cfg);

  uint64_t addr = 0x1000;

  // First access misses
  AccessInfo info = cache.access(addr, false);
  assert(info.result == AccessResult::Miss);

  // Many repeated accesses should all hit
  for (int i = 0; i < 100; i++) {
    info = cache.access(addr, false);
    assert(info.result == AccessResult::Hit);
  }

  std::cout << "[PASS] test_same_address_repeated\n";
}

void test_different_sets() {
  CacheConfig cfg = make_test_config();
  CacheLevel cache(cfg);

  // Access addresses in all 4 sets
  for (int set = 0; set < 4; set++) {
    uint64_t addr = make_address(1, set);
    AccessInfo info = cache.access(addr, false);
    assert(info.result == AccessResult::Miss);
  }

  // All should hit
  for (int set = 0; set < 4; set++) {
    uint64_t addr = make_address(1, set);
    AccessInfo info = cache.access(addr, false);
    assert(info.result == AccessResult::Hit);
  }

  std::cout << "[PASS] test_different_sets\n";
}

void test_lru_eviction() {
  CacheConfig cfg = make_test_config();
  CacheLevel cache(cfg);

  // Fill set 0 with 4 lines (4-way associative)
  uint64_t base = 0x1000;
  uint64_t addrs[5];
  for (int i = 0; i < 4; i++) {
    addrs[i] = base + (i * 0x100); // different tags, same index
    cache.access(addrs[i], false);
  }

  // All 4 should hit
  for (int i = 0; i < 4; i++) {
    AccessInfo info = cache.access(addrs[i], false);
    assert(info.result == AccessResult::Hit);
  }

  // Access 5th address - should evict LRU (addrs[0])
  addrs[4] = base + (4 * 0x100);
  AccessInfo info = cache.access(addrs[4], false);
  assert(info.result == AccessResult::Miss);

  // addrs[0] should now miss (was evicted)
  info = cache.access(addrs[0], false);
  assert(info.result == AccessResult::Miss);

  std::cout << "[PASS] test_lru_eviction\n";
}

void test_lru_update_on_hit() {
  CacheConfig cfg = make_test_config();
  CacheLevel cache(cfg);

  // Fill set 0: access A, B, C, D
  uint64_t A = make_address(1, 0);
  uint64_t B = make_address(2, 0);
  uint64_t C = make_address(3, 0);
  uint64_t D = make_address(4, 0);
  uint64_t E = make_address(5, 0);

  cache.access(A, false); // LRU order: A
  cache.access(B, false); // LRU order: A, B
  cache.access(C, false); // LRU order: A, B, C
  cache.access(D, false); // LRU order: A, B, C, D

  // Re-access A - should move to MRU
  cache.access(A, false); // LRU order: B, C, D, A

  // Access E - should evict B (now LRU), not A
  cache.access(E, false);

  // A should still hit
  AccessInfo info = cache.access(A, false);
  assert(info.result == AccessResult::Hit);

  // B should miss (was evicted)
  info = cache.access(B, false);
  assert(info.result == AccessResult::Miss);

  std::cout << "[PASS] test_lru_update_on_hit\n";
}

void test_sequential_evictions() {
  CacheConfig cfg = make_test_config();
  CacheLevel cache(cfg);

  // Fill set 0
  uint64_t addrs[8];
  for (int i = 0; i < 8; i++) {
    addrs[i] = make_address(i + 1, 0);
  }

  // Load first 4
  for (int i = 0; i < 4; i++) {
    cache.access(addrs[i], false);
  }

  // Load next 4, each should evict one
  for (int i = 4; i < 8; i++) {
    AccessInfo info = cache.access(addrs[i], false);
    assert(info.result == AccessResult::Miss);
    assert(!info.was_dirty); // weren't written
  }

  // First 4 should all miss now
  for (int i = 0; i < 4; i++) {
    AccessInfo info = cache.access(addrs[i], false);
    assert(info.result == AccessResult::Miss);
  }

  std::cout << "[PASS] test_sequential_evictions\n";
}

void test_dirty_tracking() {
  CacheConfig cfg = make_test_config();
  CacheLevel cache(cfg);

  uint64_t addr = 0x1000;

  // Read miss - not dirty
  cache.access(addr, false);
  assert(!cache.is_dirty(addr));

  // Write hit - now dirty
  cache.access(addr, true);
  assert(cache.is_dirty(addr));

  // Write miss on new address - dirty from start
  uint64_t addr2 = 0x2000;
  cache.access(addr2, true);
  assert(cache.is_dirty(addr2));

  std::cout << "[PASS] test_dirty_tracking\n";
}

void test_read_after_write() {
  CacheConfig cfg = make_test_config();
  CacheLevel cache(cfg);

  uint64_t addr = 0x1000;

  // Write first
  cache.access(addr, true);
  assert(cache.is_dirty(addr));

  // Read after - should still be dirty
  cache.access(addr, false);
  assert(cache.is_dirty(addr));

  std::cout << "[PASS] test_read_after_write\n";
}

void test_dirty_eviction() {
  CacheConfig cfg = make_test_config();
  CacheLevel cache(cfg);

  // Fill set with dirty lines
  uint64_t base = 0x1000;
  for (int i = 0; i < 4; i++) {
    cache.access(base + (i * 0x100), true); // write access
  }

  // Evict by adding 5th line
  uint64_t new_addr = base + (4 * 0x100);
  AccessInfo info = cache.access(new_addr, false);

  assert(info.result == AccessResult::MissWithEviction);
  assert(info.was_dirty == true);
  assert(info.had_eviction == true);
  assert(info.evicted_address != 0);

  std::cout << "[PASS] test_dirty_eviction\n";
}

void test_evicted_address_correct() {
  CacheConfig cfg = make_test_config();
  CacheLevel cache(cfg);

  // Create specific addresses for set 0
  uint64_t addr0 = make_address(10, 0); // tag=10, index=0
  uint64_t addr1 = make_address(11, 0);
  uint64_t addr2 = make_address(12, 0);
  uint64_t addr3 = make_address(13, 0);
  uint64_t addr4 = make_address(14, 0);

  // Fill set with dirty lines
  cache.access(addr0, true);
  cache.access(addr1, true);
  cache.access(addr2, true);
  cache.access(addr3, true);

  // Evict addr0 (LRU)
  AccessInfo info = cache.access(addr4, false);

  assert(info.result == AccessResult::MissWithEviction);
  assert(info.was_dirty);
  // Verify the evicted address matches addr0
  assert(info.evicted_address == addr0);

  std::cout << "[PASS] test_evicted_address_correct\n";
}

void test_clean_eviction_tracks_address() {
  CacheConfig cfg = make_test_config();
  CacheLevel cache(cfg);

  // Fill set with clean lines
  uint64_t first_addr = make_address(1, 0);
  for (int i = 0; i < 4; i++) {
    cache.access(make_address(i + 1, 0), false);
  }

  // Evict - clean eviction still tracks address for inclusive cache back-invalidation
  AccessInfo info = cache.access(make_address(5, 0), false);

  assert(info.result == AccessResult::Miss); // Not MissWithEviction (no writeback needed)
  assert(!info.was_dirty);
  assert(info.had_eviction == true);  // Eviction happened
  assert(info.evicted_address == first_addr);  // Address tracked for back-invalidation

  std::cout << "[PASS] test_clean_eviction_tracks_address\n";
}

void test_is_present() {
  CacheConfig cfg = make_test_config();
  CacheLevel cache(cfg);

  uint64_t addr = 0x1000;

  assert(!cache.is_present(addr));
  cache.access(addr, false);
  assert(cache.is_present(addr));

  std::cout << "[PASS] test_is_present\n";
}

void test_invalidate() {
  CacheConfig cfg = make_test_config();
  CacheLevel cache(cfg);

  uint64_t addr = 0x1000;

  cache.access(addr, true); // write to make dirty
  assert(cache.is_present(addr));
  assert(cache.is_dirty(addr));

  cache.invalidate(addr);
  assert(!cache.is_present(addr));
  assert(!cache.is_dirty(addr));

  std::cout << "[PASS] test_invalidate\n";
}

void test_invalidate_not_present() {
  CacheConfig cfg = make_test_config();
  CacheLevel cache(cfg);

  // Invalidating non-existent address should not crash
  cache.invalidate(0x1000);
  assert(!cache.is_present(0x1000));

  std::cout << "[PASS] test_invalidate_not_present\n";
}

void test_install() {
  CacheConfig cfg = make_test_config();
  CacheLevel cache(cfg);

  uint64_t addr = 0x1000;

  // Install without access
  AccessInfo info = cache.install(addr, false);
  assert(info.result == AccessResult::Miss);
  assert(cache.is_present(addr));
  assert(!cache.is_dirty(addr));

  // Install dirty
  uint64_t addr2 = 0x2000;
  info = cache.install(addr2, true);
  assert(cache.is_present(addr2));
  assert(cache.is_dirty(addr2));

  std::cout << "[PASS] test_install\n";
}

void test_install_already_present() {
  CacheConfig cfg = make_test_config();
  CacheLevel cache(cfg);

  uint64_t addr = 0x1000;

  cache.install(addr, false);
  assert(!cache.is_dirty(addr));

  // Install again with dirty - should update
  AccessInfo info = cache.install(addr, true);
  assert(info.result == AccessResult::Hit);
  assert(cache.is_dirty(addr));

  std::cout << "[PASS] test_install_already_present\n";
}

void test_install_evicts_dirty() {
  CacheConfig cfg = make_test_config();
  CacheLevel cache(cfg);

  // Fill set 0 with dirty lines
  for (int i = 0; i < 4; i++) {
    cache.access(make_address(i + 1, 0), true);
  }

  // Install should evict and report dirty
  uint64_t addr = make_address(5, 0);
  AccessInfo info = cache.install(addr, false);

  assert(info.result == AccessResult::MissWithEviction);
  assert(info.was_dirty);
  assert(info.had_eviction);
  assert(info.evicted_address == make_address(1, 0)); // evicted first one

  std::cout << "[PASS] test_install_evicts_dirty\n";
}

int main() {
  std::cout << "Running CacheLevel tests...\n\n";

  // Config validation
  test_config_validation();
  test_invalid_config_throws();

  // Address parsing
  test_address_parsing();
  test_address_zero();
  test_large_address();

  // Basic hit/miss
  test_basic_hit_miss();
  test_same_address_repeated();
  test_different_sets();

  // LRU eviction
  test_lru_eviction();
  test_lru_update_on_hit();
  test_sequential_evictions();

  // Dirty tracking
  test_dirty_tracking();
  test_read_after_write();
  test_dirty_eviction();
  test_evicted_address_correct();
  test_clean_eviction_tracks_address();

  // Utility methods
  test_is_present();
  test_invalidate();
  test_invalidate_not_present();
  test_install();
  test_install_already_present();
  test_install_evicts_dirty();

  std::cout << "\n=== All 22 tests passed! ===\n";
  return 0;
}
