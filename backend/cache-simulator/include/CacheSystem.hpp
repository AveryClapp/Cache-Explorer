#pragma once

#include "../profiles/CacheConfig.hpp"
#include "CacheLevel.hpp"
#include "CacheStats.hpp"
#include "InclusionPolicy.hpp"
#include <optional>

enum class AccessType { Read, Write, InstructionFetch };

struct SystemAccessResult {
  bool l1_hit;
  bool l2_hit;
  bool l3_hit;
  bool memory_access;
  std::vector<uint64_t> writebacks;
};

class CacheSystem {
private:
  InclusionPolicy inclusion_policy;
  CacheLevel l1d;
  CacheLevel l1i;
  CacheLevel l2;
  CacheLevel l3;

  void handle_inclusive_eviction(uint64_t evicted_addr, CacheLevel &from_level);
  void handle_exclusive_eviction(uint64_t evicted_addr, CacheLevel &from_level,
                                  CacheLevel &to_level, bool was_dirty);
  SystemAccessResult access_hierarchy(uint64_t address, bool is_write,
                                       CacheLevel &l1);

public:
  CacheSystem(const CacheHierarchyConfig &cfg)
      : inclusion_policy(cfg.inclusion_policy), l1d(cfg.l1_data),
        l1i(cfg.l1_inst), l2(cfg.l2), l3(cfg.l3) {}

  SystemAccessResult read(uint64_t address);
  SystemAccessResult write(uint64_t address);
  SystemAccessResult fetch(uint64_t address);

  HierarchyStats get_stats() const;
  void reset_stats();

  const CacheLevel &get_l1d() const { return l1d; }
  const CacheLevel &get_l1i() const { return l1i; }
  const CacheLevel &get_l2() const { return l2; }
  const CacheLevel &get_l3() const { return l3; }

  InclusionPolicy get_inclusion_policy() const { return inclusion_policy; }
};
