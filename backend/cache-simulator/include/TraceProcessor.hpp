#pragma once

#include <functional>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "AdvancedStats.hpp"
#include "CacheSystem.hpp"
#include "MemoryAccess.hpp"
#include "TraceEvent.hpp"

// Struct key for source location lookup - avoids string allocation in hot path
struct SourceKey {
  std::string_view file;
  uint32_t line;

  bool operator==(const SourceKey &other) const {
    return line == other.line && file == other.file;
  }
};

struct SourceKeyHash {
  size_t operator()(const SourceKey &k) const {
    size_t h = std::hash<std::string_view>{}(k.file);
    h ^= std::hash<uint32_t>{}(k.line) + 0x9e3779b9 + (h << 6) + (h >> 2);
    return h;
  }
};

struct SourceStats {
  std::string file;
  uint32_t line;
  uint64_t hits = 0;
  uint64_t misses = 0;
  [[nodiscard]] uint64_t total() const { return hits + misses; }
  [[nodiscard]] double miss_rate() const { return total() ? (double)misses / total() : 0; }
};

class TraceProcessor {
private:
  CacheSystem cache;
  std::unordered_map<SourceKey, SourceStats, SourceKeyHash> source_stats;
  std::function<void(const EventResult &)> event_callback;

  // Advanced instrumentation statistics
  SoftwarePrefetchStats sw_prefetch_stats;
  VectorStats vector_stats;
  AtomicStats atomic_stats;
  MemoryIntrinsicStats mem_intrinsic_stats;

  // Track prefetched addresses to measure usefulness
  std::unordered_set<uint64_t> prefetched_addresses;

  // Helper to process a single cache line access
  void process_line_access(uint64_t line_addr, bool is_write, bool is_icache,
                           std::string_view file, uint32_t line,
                           uint32_t event_size);

public:
  explicit TraceProcessor(const CacheHierarchyConfig &cfg);

  void set_event_callback(std::function<void(const EventResult &)> cb);

  void enable_prefetching(PrefetchPolicy policy, int degree = 2);
  void disable_prefetching();
  [[nodiscard]] bool is_prefetching_enabled() const;
  [[nodiscard]] PrefetchPolicy get_prefetch_policy() const;
  [[nodiscard]] const PrefetchStats &get_prefetch_stats() const;

  void process(const TraceEvent &event);

  [[nodiscard]] HierarchyStats get_stats() const;

  [[nodiscard]] std::vector<SourceStats> get_hot_lines(size_t limit = 10) const;

  void reset();

  // Access to cache system for visualization
  [[nodiscard]] const CacheSystem &get_cache_system() const;

  // Performance: enable fast mode (disables 3C miss classification)
  void set_fast_mode(bool enable) { cache.set_fast_mode(enable); }

  // Advanced instrumentation statistics getters
  [[nodiscard]] const SoftwarePrefetchStats &get_software_prefetch_stats() const;
  [[nodiscard]] const VectorStats &get_vector_stats() const;
  [[nodiscard]] const AtomicStats &get_atomic_stats() const;
  [[nodiscard]] const MemoryIntrinsicStats &get_memory_intrinsic_stats() const;
};
