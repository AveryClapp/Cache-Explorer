#pragma once

#include "CacheSystem.hpp"
#include "MemoryAccess.hpp"
#include "TraceEvent.hpp"
#include <functional>
#include <unordered_map>
#include <vector>

struct SourceStats {
  std::string file;
  uint32_t line;
  uint64_t hits = 0;
  uint64_t misses = 0;
  uint64_t total() const { return hits + misses; }
  double miss_rate() const { return total() ? (double)misses / total() : 0; }
};

class TraceProcessor {
private:
  CacheSystem cache;
  std::unordered_map<std::string, SourceStats> source_stats;
  std::function<void(const EventResult &)> event_callback;

  std::string make_key(const std::string &file, uint32_t line) {
    return file + ":" + std::to_string(line);
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
    // Get the appropriate line size based on event type
    uint32_t line_size = event.is_icache
                             ? cache.get_l1i().getLineSize()
                             : cache.get_l1d().getLineSize();

    auto lines = split_access_to_cache_lines(
        {event.address, event.size, event.is_write}, line_size);

    for (const auto &line_access : lines) {
      SystemAccessResult result;
      if (event.is_icache) {
        result = cache.fetch(line_access.line_address);
      } else if (event.is_write) {
        result = cache.write(line_access.line_address);
      } else {
        result = cache.read(line_access.line_address);
      }

      if (!event.file.empty()) {
        auto key = make_key(event.file, event.line);
        auto &stats = source_stats[key];
        stats.file = event.file;
        stats.line = event.line;
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
  }
};
