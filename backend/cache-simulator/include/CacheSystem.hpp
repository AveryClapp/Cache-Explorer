#pragma once

#include "../profiles/CacheConfig.hpp"
#include "CacheLevel.hpp"
#include "CacheStats.hpp"
#include "InclusionPolicy.hpp"
#include "Prefetcher.hpp"
#include <optional>
#include <unordered_set>

enum class AccessType { Read, Write, InstructionFetch };

struct SystemAccessResult {
  bool l1_hit;
  bool l2_hit;
  bool l3_hit;
  bool memory_access;
  std::vector<uint64_t> writebacks;
  int prefetches_issued;  // Number of prefetches triggered by this access
};

class CacheSystem {
private:
  InclusionPolicy inclusion_policy;
  CacheLevel l1d;
  CacheLevel l1i;
  CacheLevel l2;
  CacheLevel l3;
  Prefetcher prefetcher;
  bool prefetch_enabled;
  std::unordered_set<uint64_t> prefetched_addresses;  // Track prefetched lines

  void handle_inclusive_eviction(uint64_t evicted_addr, CacheLevel &from_level);
  void handle_exclusive_eviction(uint64_t evicted_addr, CacheLevel &from_level,
                                  CacheLevel &to_level, bool was_dirty);
  SystemAccessResult access_hierarchy(uint64_t address, bool is_write,
                                       CacheLevel &l1, uint64_t pc = 0);
  void issue_prefetches(const std::vector<uint64_t> &addrs);

public:
  CacheSystem(const CacheHierarchyConfig &cfg)
      : inclusion_policy(cfg.inclusion_policy), l1d(cfg.l1_data),
        l1i(cfg.l1_inst), l2(cfg.l2), l3(cfg.l3),
        prefetcher(PrefetchPolicy::NONE, 2, cfg.l1_data.line_size),
        prefetch_enabled(false) {}

  SystemAccessResult read(uint64_t address, uint64_t pc = 0);
  SystemAccessResult write(uint64_t address, uint64_t pc = 0);
  SystemAccessResult fetch(uint64_t address, uint64_t pc = 0);

  // Prefetching control
  void enable_prefetching(PrefetchPolicy policy, int degree = 2);
  void disable_prefetching();
  bool is_prefetching_enabled() const { return prefetch_enabled; }
  const PrefetchStats &get_prefetch_stats() const { return prefetcher.getStats(); }

  HierarchyStats get_stats() const;
  void reset_stats();

  const CacheLevel &get_l1d() const { return l1d; }
  const CacheLevel &get_l1i() const { return l1i; }
  const CacheLevel &get_l2() const { return l2; }
  const CacheLevel &get_l3() const { return l3; }

  InclusionPolicy get_inclusion_policy() const { return inclusion_policy; }
  PrefetchPolicy get_prefetch_policy() const { return prefetcher.getPolicy(); }
};
