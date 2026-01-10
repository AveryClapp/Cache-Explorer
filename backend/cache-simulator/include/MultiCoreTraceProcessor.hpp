#pragma once

#include <functional>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "AdvancedStats.hpp"
#include "MemoryAccess.hpp"
#include "MultiCoreCacheSystem.hpp"
#include "TraceEvent.hpp"

struct MultiCoreSourceStats {
  std::string file;
  uint32_t line;
  uint64_t hits = 0;
  uint64_t misses = 0;
  std::unordered_set<uint32_t> threads;
  uint64_t total() const { return hits + misses; }
  double miss_rate() const { return total() ? (double)misses / total() : 0; }
};

class MultiCoreTraceProcessor {
private:
  MultiCoreCacheSystem cache;
  std::unordered_map<std::string, MultiCoreSourceStats> source_stats;
  std::unordered_set<uint32_t> seen_threads;
  std::function<void(const EventResult &)> event_callback;

  // Advanced instrumentation statistics
  SoftwarePrefetchStats sw_prefetch_stats;
  VectorStats vector_stats;
  AtomicStats atomic_stats;
  MemoryIntrinsicStats mem_intrinsic_stats;

  // Track prefetched addresses to measure usefulness
  std::unordered_set<uint64_t> prefetched_addresses;

  std::string make_key(std::string_view file, uint32_t line);
  void process_line_access(const TraceEvent &event, uint64_t line_addr, bool is_write);

public:
  MultiCoreTraceProcessor(int num_cores, const CacheConfig &l1_cfg,
                          const CacheConfig &l2_cfg,
                          const CacheConfig &l3_cfg,
                          PrefetchPolicy prefetch_policy = PrefetchPolicy::NONE,
                          int prefetch_degree = 2);

  void set_event_callback(std::function<void(const EventResult &)> cb);

  // Process a trace event through the cache system
  void process(const TraceEvent &event);

  [[nodiscard]] MultiCoreStats get_stats() const { return cache.get_stats(); }

  // Get the hottest source lines by miss count
  [[nodiscard]] std::vector<MultiCoreSourceStats> get_hot_lines(size_t limit = 10) const;

  // Get false sharing reports from the cache system
  [[nodiscard]] std::vector<FalseSharingReport> get_false_sharing_reports() const;

  [[nodiscard]] size_t get_thread_count() const { return seen_threads.size(); }
  [[nodiscard]] int get_num_cores() const { return cache.get_num_cores(); }

  // Access to cache system for visualization
  [[nodiscard]] const MultiCoreCacheSystem& get_cache_system() const { return cache; }

  // Performance: enable fast mode (disables 3C miss classification)
  void set_fast_mode(bool enable) { cache.set_fast_mode(enable); }

  // Advanced instrumentation statistics getters
  [[nodiscard]] const SoftwarePrefetchStats& get_software_prefetch_stats() const { return sw_prefetch_stats; }
  [[nodiscard]] const VectorStats& get_vector_stats() const { return vector_stats; }
  [[nodiscard]] const AtomicStats& get_atomic_stats() const { return atomic_stats; }
  [[nodiscard]] const MemoryIntrinsicStats& get_memory_intrinsic_stats() const { return mem_intrinsic_stats; }
};
