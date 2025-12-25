#pragma once

#include "InclusionPolicy.hpp"
#include "L1Cache.hpp"
#include "L2Cache.hpp"
#include "L3Cache.hpp"

class CacheSystem {
private:
  InclusionPolicy inclusion_policy;
  CacheLevel l1_mem;
  CacheLevel l1_inst;
  CacheLevel l2;
  CacheLevel l3;

public:
  // Need to look at specs user wants. For now, assume fixed params
  explicit CacheSystem(const CacheHierarchyConfig &cfg)
      : inclusion_policy(cfg.inclusion_policy), l1_mem(cfg.l1_data),
        l1_inst(cfg.l1_inst), l2(cfg.l2), l3(cfg.l3) {};
};
