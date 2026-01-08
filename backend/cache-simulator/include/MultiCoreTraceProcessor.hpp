#pragma once

#include <functional>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

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

  std::string make_key(std::string_view file, uint32_t line);

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
};
