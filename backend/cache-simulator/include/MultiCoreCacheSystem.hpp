#pragma once

#include "../profiles/CacheConfig.hpp"
#include "CacheLevel.hpp"
#include "CacheStats.hpp"
#include "CoherenceController.hpp"
#include "Prefetcher.hpp"
#include "TLB.hpp"
#include <memory>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

struct FalseSharingEvent {
  uint64_t cache_line_addr;
  std::string file;
  uint32_t line;
  uint32_t thread_id;
  bool is_write;
  uint32_t byte_offset;
};

struct FalseSharingReport {
  uint64_t cache_line_addr;
  std::vector<FalseSharingEvent> accesses;
  uint32_t invalidation_count = 0;
};

struct MultiCoreStats {
  std::vector<CacheStats> l1_per_core;
  CacheStats l2;
  CacheStats l3;
  uint64_t coherence_invalidations = 0;
  uint64_t false_sharing_events = 0;
  std::vector<PrefetchStats> prefetch_per_core;  // Per-core prefetch statistics
};

struct MultiCoreAccessResult {
  bool l1_hit;
  bool l2_hit;
  bool l3_hit;
  bool memory_access;
};

class MultiCoreCacheSystem {
private:
  int num_cores;
  std::vector<std::unique_ptr<CacheLevel>> l1_caches;
  std::vector<std::unique_ptr<Prefetcher>> prefetchers;  // Per-core prefetchers
  std::vector<std::unique_ptr<TLB>> dtlbs;  // Per-core data TLBs
  CacheLevel l2;
  CacheLevel l3;
  CoherenceController coherence;

  PrefetchPolicy prefetch_policy = PrefetchPolicy::NONE;
  int prefetch_degree = 2;

  std::unordered_map<uint32_t, int> thread_to_core;
  int next_core = 0;

  struct LineAccess {
    uint32_t thread_id;
    uint32_t byte_offset;
    bool is_write;
    std::string file;
    uint32_t line;
  };
  std::unordered_map<uint64_t, std::vector<LineAccess>> line_accesses;
  std::unordered_set<uint64_t> false_sharing_lines;

  uint64_t coherence_invalidations = 0;
  uint64_t false_sharing_count = 0;
  uint32_t line_size;

  int get_core_for_thread(uint32_t thread_id);

  uint64_t get_line_address(uint64_t addr) const {
    return addr & ~(static_cast<uint64_t>(line_size) - 1);
  }

  void issue_prefetches(int core, uint64_t miss_addr, uint64_t pc = 0);

  void track_access_for_false_sharing(uint64_t addr, uint32_t thread_id,
                                       bool is_write, std::string_view file,
                                       uint32_t line);

public:
  MultiCoreCacheSystem(int cores, const CacheConfig &l1_cfg,
                       const CacheConfig &l2_cfg,
                       const CacheConfig &l3_cfg,
                       PrefetchPolicy pf_policy = PrefetchPolicy::NONE,
                       int pf_degree = 2);

  MultiCoreAccessResult read(uint64_t address, uint32_t thread_id,
                              std::string_view file = "", uint32_t line = 0);

  MultiCoreAccessResult write(uint64_t address, uint32_t thread_id,
                               std::string_view file = "", uint32_t line = 0);

  [[nodiscard]] MultiCoreStats get_stats() const;

  // Get aggregated TLB stats across all cores
  [[nodiscard]] TLBHierarchyStats get_tlb_stats() const;

  // Get TLB stats for a specific core
  [[nodiscard]] TLBStats get_tlb_stats_for_core(int core) const;

  [[nodiscard]] std::vector<FalseSharingReport> get_false_sharing_reports() const;

  [[nodiscard]] int get_num_cores() const { return num_cores; }
  [[nodiscard]] uint32_t get_line_size() const { return line_size; }

  // MESI state query for testing/debugging
  [[nodiscard]] CoherenceState get_l1_coherence_state(int core, uint64_t address) const;

  [[nodiscard]] bool is_line_in_l1(int core, uint64_t address) const;

  // Cache state access for visualization
  [[nodiscard]] const CacheLevel* get_l1_cache(int core) const;

  // Prefetcher configuration accessors
  [[nodiscard]] PrefetchPolicy get_prefetch_policy() const { return prefetch_policy; }
  [[nodiscard]] int get_prefetch_degree() const { return prefetch_degree; }

  [[nodiscard]] PrefetchStats get_prefetch_stats(int core) const;

  void reset_prefetch_stats();
};
