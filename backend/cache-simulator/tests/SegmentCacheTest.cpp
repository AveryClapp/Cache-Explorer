#include "../include/SegmentCache.hpp"
#include <iostream>
#include <cassert>
#include <vector>

using namespace cache_explorer;

void test_basic_caching() {
    SegmentCache cache(5, 100);  // 5 events per segment

    // Create a repetitive pattern (simulating a loop)
    std::vector<TraceEvent> events;
    for (int i = 0; i < 100; i++) {
        TraceEvent load{};
        load.is_write = false;
        load.address = 0x1000 + (i % 10) * 4;
        load.size = 4;
        load.file = "test.c";
        load.line = 10;
        load.thread_id = 0;
        events.push_back(load);

        TraceEvent store{};
        store.is_write = true;
        store.address = 0x2000 + (i % 10) * 4;
        store.size = 4;
        store.file = "test.c";
        store.line = 11;
        store.thread_id = 0;
        events.push_back(store);
    }

    // First lookup - should miss
    uint64_t cache_state_hash = 0x12345678;
    auto result1 = cache.lookup(events, 0, cache_state_hash);
    assert(!result1.has_value());
    assert(cache.get_misses() == 1);
    assert(cache.get_hits() == 0);

    // Store a result
    CachedSegmentResult stored;
    stored.l1d_hits = 3;
    stored.l1d_misses = 2;
    stored.segment_length = 5;
    cache.store(events, 0, cache_state_hash, stored);

    // Second lookup - should hit
    auto result2 = cache.lookup(events, 0, cache_state_hash);
    assert(result2.has_value());
    assert(result2->l1d_hits == 3);
    assert(result2->l1d_misses == 2);
    assert(cache.get_hits() == 1);

    // Different cache state - should miss
    uint64_t different_state = 0x87654321;
    auto result3 = cache.lookup(events, 0, different_state);
    assert(!result3.has_value());
    assert(cache.get_misses() == 2);

    std::cout << "✓ Basic caching test passed\n";
}

void test_pattern_hashing() {
    SegmentCache cache(3, 100);

    auto make_load = [](uint64_t addr) {
        TraceEvent e{};
        e.address = addr;
        e.size = 4;
        e.file = "test.c";
        e.line = 10;
        return e;
    };

    auto make_store = [](uint64_t addr) {
        TraceEvent e{};
        e.is_write = true;
        e.address = addr;
        e.size = 4;
        e.file = "test.c";
        e.line = 11;
        return e;
    };

    std::vector<TraceEvent> events1;
    events1.push_back(make_load(0x1000));
    events1.push_back(make_store(0x2000));
    events1.push_back(make_load(0x3000));

    std::vector<TraceEvent> events2;
    events2.push_back(make_load(0x1000));
    events2.push_back(make_store(0x2000));
    events2.push_back(make_load(0x3000));

    // Same pattern should have same hash
    uint64_t hash1 = SegmentCache::hash_pattern(events1, 0, 3);
    uint64_t hash2 = SegmentCache::hash_pattern(events2, 0, 3);
    assert(hash1 == hash2);

    // Different pattern should have different hash
    events2[2].address = 0x4000;  // Change address
    uint64_t hash3 = SegmentCache::hash_pattern(events2, 0, 3);
    assert(hash1 != hash3);

    std::cout << "✓ Pattern hashing test passed\n";
}

void test_cache_statistics() {
    SegmentCache cache(5, 100);

    std::vector<TraceEvent> events;
    for (int i = 0; i < 20; i++) {
        TraceEvent e{};
        e.address = 0x1000 + i * 4;
        e.size = 4;
        e.file = "test.c";
        e.line = 10;
        events.push_back(e);
    }

    uint64_t state = 0x1234;

    // Initial stats
    assert(cache.get_hits() == 0);
    assert(cache.get_misses() == 0);
    assert(cache.get_hit_rate() == 0.0);
    assert(cache.get_cache_size() == 0);

    // Miss
    cache.lookup(events, 0, state);
    assert(cache.get_misses() == 1);
    assert(cache.get_hit_rate() == 0.0);

    // Store and hit
    CachedSegmentResult result{};
    result.l1d_hits = 5;
    cache.store(events, 0, state, result);
    assert(cache.get_cache_size() == 1);

    cache.lookup(events, 0, state);
    assert(cache.get_hits() == 1);
    assert(cache.get_misses() == 1);
    assert(cache.get_hit_rate() == 0.5);

    std::cout << "✓ Cache statistics test passed\n";
}

void test_lru_eviction() {
    SegmentCache cache(3, 2);  // Max 2 entries

    std::vector<TraceEvent> events;
    for (int i = 0; i < 15; i++) {
        TraceEvent e{};
        e.address = 0x1000 + i * 4;
        e.size = 4;
        e.file = "test.c";
        e.line = 10;
        events.push_back(e);
    }

    CachedSegmentResult result{};
    result.l1d_hits = 1;

    // Store 3 different segments (should trigger eviction)
    cache.store(events, 0, 0x1111, result);
    assert(cache.get_cache_size() == 1);

    cache.store(events, 3, 0x2222, result);
    assert(cache.get_cache_size() == 2);

    cache.store(events, 6, 0x3333, result);
    assert(cache.get_cache_size() == 2);  // Should evict LRU

    std::cout << "✓ LRU eviction test passed\n";
}

int main() {
    std::cout << "Running SegmentCache tests...\n\n";

    test_basic_caching();
    test_pattern_hashing();
    test_cache_statistics();
    test_lru_eviction();

    std::cout << "\n✅ All SegmentCache tests passed!\n";
    return 0;
}
