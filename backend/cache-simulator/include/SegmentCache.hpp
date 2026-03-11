#pragma once

#include <vector>
#include <unordered_map>
#include <optional>
#include <cstdint>
#include "TraceEvent.hpp"
#include "CacheStats.hpp"

namespace cache_explorer {

/**
 * Represents a cached simulation result for a repeating segment of code
 */
struct CachedSegmentResult {
    // Simulation results for this segment
    uint64_t l1d_hits = 0;
    uint64_t l1d_misses = 0;
    uint64_t l1i_hits = 0;
    uint64_t l1i_misses = 0;
    uint64_t l2_hits = 0;
    uint64_t l2_misses = 0;
    uint64_t l3_hits = 0;
    uint64_t l3_misses = 0;

    uint64_t dtlb_hits = 0;
    uint64_t dtlb_misses = 0;
    uint64_t itlb_hits = 0;
    uint64_t itlb_misses = 0;

    uint64_t coherence_invalidations = 0;
    uint64_t total_cycles = 0;

    size_t segment_length = 0;  // Number of events in segment
    uint64_t times_used = 0;     // How many times this cache entry was used
};

/**
 * Key for looking up cached segments
 */
struct SegmentCacheKey {
    uint64_t pattern_hash;      // Hash of access pattern (addresses + types)
    uint64_t cache_state_hash;  // Hash of cache state

    bool operator==(const SegmentCacheKey& other) const {
        return pattern_hash == other.pattern_hash &&
               cache_state_hash == other.cache_state_hash;
    }
};

} // namespace cache_explorer

// Hash function for SegmentCacheKey
namespace std {
    template<>
    struct hash<cache_explorer::SegmentCacheKey> {
        size_t operator()(const cache_explorer::SegmentCacheKey& key) const {
            return key.pattern_hash ^ (key.cache_state_hash << 1);
        }
    };
}

namespace cache_explorer {

/**
 * Cache for storing simulation results of repetitive code segments
 *
 * This dramatically speeds up simulation of loops and repetitive code by:
 * 1. Detecting when the same access pattern repeats
 * 2. Checking if cache state is similar
 * 3. Replaying cached simulation results instead of re-simulating
 *
 * Example:
 *   for (int i = 0; i < 1000000; i++) {
 *       arr[i] = i;  // Same pattern 1M times
 *   }
 *
 * Simulate iteration 1-3, cache result, replay for iterations 4-1M
 * → 333,333x speedup!
 */
class SegmentCache {
public:
    /**
     * Constructor
     * @param segment_size Number of events to consider as one segment (10-50 typical)
     * @param max_cache_entries Maximum cached segments (LRU eviction beyond this)
     */
    explicit SegmentCache(size_t segment_size = 20, size_t max_cache_entries = 10000);

    /**
     * Try to find a cached result for this segment
     * @param events Trace events starting at current position
     * @param start_index Where in events to start
     * @param cache_state_hash Hash of current cache state
     * @return Cached result if found, nullopt otherwise
     */
    std::optional<CachedSegmentResult> lookup(
        const std::vector<TraceEvent>& events,
        size_t start_index,
        uint64_t cache_state_hash) const;

    /**
     * Store a simulation result for future reuse
     * @param events The segment that was simulated
     * @param start_index Start position in events
     * @param cache_state_hash Cache state before simulation
     * @param result Simulation results to cache
     */
    void store(
        const std::vector<TraceEvent>& events,
        size_t start_index,
        uint64_t cache_state_hash,
        const CachedSegmentResult& result);

    /**
     * Compute hash of an access pattern (addresses + operation types)
     * @param events Trace events
     * @param start Start index
     * @param length How many events to hash
     * @return Hash value
     */
    static uint64_t hash_pattern(
        const std::vector<TraceEvent>& events,
        size_t start,
        size_t length);

    // Statistics
    uint64_t get_hits() const { return cache_hits_; }
    uint64_t get_misses() const { return cache_misses_; }
    double get_hit_rate() const {
        uint64_t total = cache_hits_ + cache_misses_;
        return total > 0 ? (double)cache_hits_ / total : 0.0;
    }
    size_t get_cache_size() const { return cache_.size(); }

    void clear() { cache_.clear(); cache_hits_ = 0; cache_misses_ = 0; }

private:
    size_t segment_size_;           // Number of events per segment
    size_t max_cache_entries_;      // Max cached segments

    mutable uint64_t cache_hits_ = 0;
    mutable uint64_t cache_misses_ = 0;

    std::unordered_map<SegmentCacheKey, CachedSegmentResult> cache_;

    // LRU tracking
    struct CacheEntry {
        SegmentCacheKey key;
        uint64_t last_used_time;
    };
    std::vector<CacheEntry> lru_list_;
    uint64_t current_time_ = 0;

    void evict_lru_if_needed();
};

} // namespace cache_explorer
