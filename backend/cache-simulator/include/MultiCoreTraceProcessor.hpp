#pragma once

#include "MemoryAccess.hpp"
#include "MultiCoreCacheSystem.hpp"
#include "TraceEvent.hpp"
#include <algorithm>
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
    event_callback = cb;
  }

  void process(const TraceEvent &event) {
    seen_threads.insert(event.thread_id);

    auto lines = split_access_to_cache_lines(
        {event.address, event.size, event.is_write}, cache.get_line_size());

    for (const auto &line_access : lines) {
      MultiCoreAccessResult result;
      // Pass original address for false sharing detection (preserves byte offset)
      if (event.is_write) {
        result = cache.write(event.address, event.thread_id,
                             event.file, event.line);
      } else {
        result = cache.read(event.address, event.thread_id,
                            event.file, event.line);
      }

      if (!event.file.empty()) {
        auto key = make_key(event.file, event.line);
        auto &stats = source_stats[key];
        stats.file = event.file;
        stats.line = event.line;
        stats.threads.insert(event.thread_id);
        if (result.l1_hit)
          stats.hits++;
        else
          stats.misses++;
      }

      if (event_callback) {
        event_callback({result.l1_hit, result.l2_hit, result.l3_hit,
                        line_access.line_address, event.size, event.file,
                        event.line});
      }
    }
  }

  MultiCoreStats get_stats() const { return cache.get_stats(); }

  std::vector<MultiCoreSourceStats> get_hot_lines(size_t limit = 10) const {
    std::vector<MultiCoreSourceStats> sorted;
    for (const auto &[key, stats] : source_stats) {
      sorted.push_back(stats);
    }
    std::sort(sorted.begin(), sorted.end(),
              [](const auto &a, const auto &b) { return a.misses > b.misses; });
    if (sorted.size() > limit)
      sorted.resize(limit);
    return sorted;
  }

  std::vector<FalseSharingReport> get_false_sharing_reports() const {
    return cache.get_false_sharing_reports();
  }

  size_t get_thread_count() const { return seen_threads.size(); }
  int get_num_cores() const { return cache.get_num_cores(); }
};
