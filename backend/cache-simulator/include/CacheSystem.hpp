#pragma once

#include "../profiles/CacheConfig.hpp"
#include "CacheLevel.hpp"
#include "CacheStats.hpp"
#include "InclusionPolicy.hpp"
#include "Prefetcher.hpp"
#include "TLB.hpp"
#include <optional>
#include <unordered_set>

enum class AccessType { Read, Write, InstructionFetch };

struct SystemAccessResult {
  bool l1_hit;
  bool l2_hit;
  bool l3_hit;
  bool memory_access;
  bool dtlb_hit;   // Data TLB hit
  bool itlb_hit;   // Instruction TLB hit
  std::vector<uint64_t> writebacks;
  int prefetches_issued;  // Number of prefetches triggered by this access
  int cycles;      // Total cycles for this access (for timing model)
};

class CacheSystem {
private:
  InclusionPolicy inclusion_policy;
  CacheLevel l1d;
  CacheLevel l1i;
  CacheLevel l2;
  CacheLevel l3;
  TLB dtlb;  // Data TLB
  TLB itlb;  // Instruction TLB
  Prefetcher prefetcher;
  bool prefetch_enabled;
  bool tlb_enabled;
  std::unordered_set<uint64_t> prefetched_addresses;  // Track prefetched lines
  LatencyConfig latency_config;  // Timing configuration
  TimingStats timing_stats;      // Accumulated timing statistics

  void handle_inclusive_eviction(uint64_t evicted_addr, CacheLevel &from_level);
  void handle_exclusive_eviction(uint64_t evicted_addr, CacheLevel &from_level,
                                  CacheLevel &to_level, bool was_dirty);
  SystemAccessResult access_hierarchy(uint64_t address, bool is_write,
                                       CacheLevel &l1, TLB &tlb, uint64_t pc = 0);
  void issue_prefetches(const std::vector<uint64_t> &addrs);

public:
  CacheSystem(const CacheHierarchyConfig &cfg)
      : inclusion_policy(cfg.inclusion_policy), l1d(cfg.l1_data),
        l1i(cfg.l1_inst), l2(cfg.l2), l3(cfg.l3),
        dtlb(TLBConfig{64, 4, 4096}),   // 64-entry, 4-way, 4KB pages
        itlb(TLBConfig{64, 4, 4096}),   // 64-entry, 4-way, 4KB pages
        prefetcher(PrefetchPolicy::NONE, 2, cfg.l1_data.line_size),
        prefetch_enabled(false), tlb_enabled(true),
        latency_config(cfg.latency), timing_stats() {}

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

  // TLB access
  const TLB &get_dtlb() const { return dtlb; }
  const TLB &get_itlb() const { return itlb; }
  TLBHierarchyStats get_tlb_stats() const {
    return {dtlb.get_stats(), itlb.get_stats(), {}};
  }
  void enable_tlb() { tlb_enabled = true; }
  void disable_tlb() { tlb_enabled = false; }
  bool is_tlb_enabled() const { return tlb_enabled; }

  InclusionPolicy get_inclusion_policy() const { return inclusion_policy; }
  PrefetchPolicy get_prefetch_policy() const { return prefetcher.getPolicy(); }

  // Timing stats access
  const TimingStats& get_timing_stats() const { return timing_stats; }
  const LatencyConfig& get_latency_config() const { return latency_config; }
  void set_latency_config(const LatencyConfig& cfg) { latency_config = cfg; }
};
