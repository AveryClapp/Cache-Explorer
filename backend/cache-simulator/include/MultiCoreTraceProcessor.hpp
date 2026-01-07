#pragma once

#include "MemoryAccess.hpp"
#include "MultiCoreCacheSystem.hpp"
#include "TraceEvent.hpp"
#include <functional>
#include <unordered_map>
#include <unordered_set>
#include <vector>

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

  std::string make_key(const std::string &file, uint32_t line) {
    return file + ":" + std::to_string(line);
  }

public:
  MultiCoreTraceProcessor(int num_cores, const CacheConfig &l1_cfg,
                          const CacheConfig &l2_cfg,
                          const CacheConfig &l3_cfg)
      : cache(num_cores, l1_cfg, l2_cfg, l3_cfg) {}

  void set_event_callback(std::function<void(const EventResult &)> cb) {
    event_callback = std::move(cb);
  }

  // Process a trace event through the cache system
  void process(const TraceEvent &event);

  MultiCoreStats get_stats() const { return cache.get_stats(); }

  // Get the hottest source lines by miss count
  std::vector<MultiCoreSourceStats> get_hot_lines(size_t limit = 10) const;

  // Get false sharing reports from the cache system
  std::vector<FalseSharingReport> get_false_sharing_reports() const;

  size_t get_thread_count() const { return seen_threads.size(); }
  int get_num_cores() const { return cache.get_num_cores(); }

  // Access to cache system for visualization
  const MultiCoreCacheSystem& get_cache_system() const { return cache; }
};
