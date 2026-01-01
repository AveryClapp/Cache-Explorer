#pragma once

#include "CacheSystem.hpp"
#include "MemoryAccess.hpp"
#include "TraceEvent.hpp"
#include <functional>
#include <unordered_map>
#include <unordered_set>
#include <vector>

struct SourceStats {
  std::string file;
  uint32_t line;
  uint64_t hits = 0;
  uint64_t misses = 0;
  uint64_t total() const { return hits + misses; }
  double miss_rate() const { return total() ? (double)misses / total() : 0; }
};

// Software prefetch statistics
struct SoftwarePrefetchStats {
  uint64_t issued = 0;       // Total prefetches issued
  uint64_t useful = 0;       // Prefetches that were later accessed
  uint64_t redundant = 0;    // Prefetches to already-cached lines
  uint64_t evicted = 0;      // Prefetches evicted before use
  double accuracy() const { return issued ? (double)useful / issued : 0; }
};

// Vector/SIMD operation statistics
struct VectorStats {
  uint64_t loads = 0;
  uint64_t stores = 0;
  uint64_t bytes_loaded = 0;
  uint64_t bytes_stored = 0;
  uint64_t cross_line_accesses = 0;  // Accesses spanning cache lines
};

// Atomic operation statistics
struct AtomicStats {
  uint64_t load_count = 0;
  uint64_t store_count = 0;
  uint64_t rmw_count = 0;        // fetch_add, fetch_sub, etc.
  uint64_t cmpxchg_count = 0;    // compare-and-swap
  uint64_t contention_events = 0; // High-contention detected
};

// Memory intrinsic statistics
struct MemoryIntrinsicStats {
  uint64_t memcpy_count = 0;
  uint64_t memcpy_bytes = 0;
  uint64_t memset_count = 0;
  uint64_t memset_bytes = 0;
  uint64_t memmove_count = 0;
  uint64_t memmove_bytes = 0;
};

class TraceProcessor {
private:
  CacheSystem cache;
  std::unordered_map<std::string, SourceStats> source_stats;
  std::function<void(const EventResult &)> event_callback;

  // Advanced instrumentation statistics
  SoftwarePrefetchStats sw_prefetch_stats;
  VectorStats vector_stats;
  AtomicStats atomic_stats;
  MemoryIntrinsicStats mem_intrinsic_stats;

  // Track prefetched addresses to measure usefulness
  std::unordered_set<uint64_t> prefetched_addresses;

  std::string make_key(const std::string &file, uint32_t line) {
    return file + ":" + std::to_string(line);
  }

  // Helper to process a single cache line access
  void process_line_access(uint64_t line_addr, bool is_write, bool is_icache,
                           const std::string& file, uint32_t line, uint32_t event_size) {
    SystemAccessResult result;
    if (is_icache) {
      result = cache.fetch(line_addr);
    } else if (is_write) {
      result = cache.write(line_addr);
    } else {
      result = cache.read(line_addr);
    }

    // Track prefetch usefulness
    if (!is_write && prefetched_addresses.count(line_addr)) {
      sw_prefetch_stats.useful++;
      prefetched_addresses.erase(line_addr);
    }

    if (!file.empty()) {
      auto key = make_key(file, line);
      auto &stats = source_stats[key];
      stats.file = file;
      stats.line = line;
      if (result.l1_hit)
        stats.hits++;
      else
        stats.misses++;
    }

    if (event_callback) {
      event_callback({result.l1_hit, result.l2_hit, result.l3_hit,
                      line_addr, event_size, file, line});
    }
  }

public:
  explicit TraceProcessor(const CacheHierarchyConfig &cfg) : cache(cfg) {}

  void set_event_callback(std::function<void(const EventResult &)> cb) {
    event_callback = cb;
  }

  void enable_prefetching(PrefetchPolicy policy, int degree = 2) {
    cache.enable_prefetching(policy, degree);
  }

  void disable_prefetching() {
    cache.disable_prefetching();
  }

  bool is_prefetching_enabled() const {
    return cache.is_prefetching_enabled();
  }

  PrefetchPolicy get_prefetch_policy() const {
    return cache.get_prefetch_policy();
  }

  const PrefetchStats &get_prefetch_stats() const {
    return cache.get_prefetch_stats();
  }

  void process(const TraceEvent &event) {
    uint32_t line_size = event.is_icache
                             ? cache.get_l1i().getLineSize()
                             : cache.get_l1d().getLineSize();

    // Handle software prefetch hints
    if (event.is_prefetch) {
      sw_prefetch_stats.issued++;
      // Prefetch the cache line without counting as demand access
      uint64_t line_addr = (event.address / line_size) * line_size;
      // Just warm the cache - don't count in stats
      cache.read(line_addr);  // Read brings it into cache
      prefetched_addresses.insert(line_addr);
      return;  // Don't process further
    }

    // Handle memcpy - generates reads from source and writes to dest
    if (event.is_memcpy || event.is_memmove) {
      if (event.is_memcpy) {
        mem_intrinsic_stats.memcpy_count++;
        mem_intrinsic_stats.memcpy_bytes += event.size;
      } else {
        mem_intrinsic_stats.memmove_count++;
        mem_intrinsic_stats.memmove_bytes += event.size;
      }

      // Process source reads
      auto src_lines = split_access_to_cache_lines(
          {event.src_address, event.size, false}, line_size);
      for (const auto &line_access : src_lines) {
        process_line_access(line_access.line_address, false, false,
                           event.file, event.line, event.size);
      }

      // Process dest writes
      auto dst_lines = split_access_to_cache_lines(
          {event.address, event.size, true}, line_size);
      for (const auto &line_access : dst_lines) {
        process_line_access(line_access.line_address, true, false,
                           event.file, event.line, event.size);
      }
      return;
    }

    // Handle memset - generates writes to destination
    if (event.is_memset) {
      mem_intrinsic_stats.memset_count++;
      mem_intrinsic_stats.memset_bytes += event.size;

      auto lines = split_access_to_cache_lines(
          {event.address, event.size, true}, line_size);
      for (const auto &line_access : lines) {
        process_line_access(line_access.line_address, true, false,
                           event.file, event.line, event.size);
      }
      return;
    }

    // Track vector statistics
    if (event.is_vector) {
      if (event.is_write) {
        vector_stats.stores++;
        vector_stats.bytes_stored += event.size;
      } else {
        vector_stats.loads++;
        vector_stats.bytes_loaded += event.size;
      }
    }

    // Track atomic statistics
    if (event.is_atomic) {
      if (event.is_cmpxchg) {
        atomic_stats.cmpxchg_count++;
      } else if (event.is_rmw) {
        atomic_stats.rmw_count++;
      } else if (event.is_write) {
        atomic_stats.store_count++;
      } else {
        atomic_stats.load_count++;
      }
    }

    // Standard processing for regular loads/stores, vectors, and atomics
    auto lines = split_access_to_cache_lines(
        {event.address, event.size, event.is_write}, line_size);

    // Track cross-line accesses for vectors
    if (event.is_vector && lines.size() > 1) {
      vector_stats.cross_line_accesses++;
    }

    for (const auto &line_access : lines) {
      process_line_access(line_access.line_address, event.is_write,
                         event.is_icache, event.file, event.line, event.size);
    }
  }

  const HierarchyStats get_stats() const { return cache.get_stats(); }

  std::vector<SourceStats> get_hot_lines(size_t limit = 10) const {
    std::vector<SourceStats> sorted;
    for (const auto &[key, stats] : source_stats) {
      sorted.push_back(stats);
    }
    std::sort(sorted.begin(), sorted.end(),
              [](const auto &a, const auto &b) { return a.misses > b.misses; });
    if (sorted.size() > limit)
      sorted.resize(limit);
    return sorted;
  }

  void reset() {
    cache.reset_stats();
    source_stats.clear();
    sw_prefetch_stats = {};
    vector_stats = {};
    atomic_stats = {};
    mem_intrinsic_stats = {};
    prefetched_addresses.clear();
  }

  // Access to cache system for visualization
  const CacheSystem& get_cache_system() const { return cache; }

  // Advanced instrumentation statistics getters
  const SoftwarePrefetchStats& get_software_prefetch_stats() const {
    return sw_prefetch_stats;
  }

  const VectorStats& get_vector_stats() const {
    return vector_stats;
  }

  const AtomicStats& get_atomic_stats() const {
    return atomic_stats;
  }

  const MemoryIntrinsicStats& get_memory_intrinsic_stats() const {
    return mem_intrinsic_stats;
  }
};
