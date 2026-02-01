#include "../include/SegmentCache.hpp"
#include <algorithm>

namespace cache_explorer {

SegmentCache::SegmentCache(size_t segment_size, size_t max_cache_entries)
    : segment_size_(segment_size), max_cache_entries_(max_cache_entries) {
    lru_list_.reserve(max_cache_entries);
}

std::optional<CachedSegmentResult> SegmentCache::lookup(
    const std::vector<TraceEvent>& events,
    size_t start_index,
    uint64_t cache_state_hash) const {

    // Not enough events left for a full segment
    if (start_index + segment_size_ > events.size()) {
        return std::nullopt;
    }

    // Compute pattern hash
    uint64_t pattern_hash = hash_pattern(events, start_index, segment_size_);

    // Look up in cache
    SegmentCacheKey key{pattern_hash, cache_state_hash};
    auto it = cache_.find(key);

    if (it != cache_.end()) {
        cache_hits_++;
        // Update LRU
        const_cast<SegmentCache*>(this)->current_time_++;
        const_cast<CachedSegmentResult&>(it->second).times_used++;
        return it->second;
    }

    cache_misses_++;
    return std::nullopt;
}

void SegmentCache::store(
    const std::vector<TraceEvent>& events,
    size_t start_index,
    uint64_t cache_state_hash,
    const CachedSegmentResult& result) {

    // Not enough events for a full segment
    if (start_index + segment_size_ > events.size()) {
        return;
    }

    // Compute pattern hash
    uint64_t pattern_hash = hash_pattern(events, start_index, segment_size_);

    // Create key
    SegmentCacheKey key{pattern_hash, cache_state_hash};

    // Check if already cached
    if (cache_.find(key) != cache_.end()) {
        return;  // Already cached
    }

    // Evict if needed
    if (cache_.size() >= max_cache_entries_) {
        evict_lru_if_needed();
    }

    // Store in cache
    cache_[key] = result;

    // Update LRU list
    current_time_++;
    lru_list_.push_back({key, current_time_});
}

uint64_t SegmentCache::hash_pattern(
    const std::vector<TraceEvent>& events,
    size_t start,
    size_t length) {

    // FNV-1a hash algorithm (fast, good distribution)
    const uint64_t FNV_OFFSET_BASIS = 14695981039346656037ULL;
    const uint64_t FNV_PRIME = 1099511628211ULL;

    uint64_t hash = FNV_OFFSET_BASIS;

    size_t end = std::min(start + length, events.size());
    for (size_t i = start; i < end; i++) {
        const auto& event = events[i];

        // Hash event type flags
        uint64_t type_bits = 0;
        if (event.is_write) type_bits |= 1;
        if (event.is_icache) type_bits |= 2;
        if (event.is_vector) type_bits |= 4;
        if (event.is_atomic) type_bits |= 8;
        if (event.is_prefetch) type_bits |= 16;
        hash ^= type_bits;
        hash *= FNV_PRIME;

        // Hash address (most important for pattern matching)
        hash ^= event.address;
        hash *= FNV_PRIME;

        // Hash size
        hash ^= event.size;
        hash *= FNV_PRIME;

        // Hash thread ID (multi-threading affects pattern)
        hash ^= event.thread_id;
        hash *= FNV_PRIME;

        // Note: We DON'T hash file/line because the same loop at the same
        // location should match even if addresses shift slightly
    }

    return hash;
}

void SegmentCache::evict_lru_if_needed() {
    if (lru_list_.empty()) {
        return;
    }

    // Find LRU entry (smallest last_used_time)
    auto lru_it = std::min_element(lru_list_.begin(), lru_list_.end(),
        [](const CacheEntry& a, const CacheEntry& b) {
            return a.last_used_time < b.last_used_time;
        });

    if (lru_it != lru_list_.end()) {
        // Remove from cache
        cache_.erase(lru_it->key);

        // Remove from LRU list
        lru_list_.erase(lru_it);
    }
}

} // namespace cache_explorer
