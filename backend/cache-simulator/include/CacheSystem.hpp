#pragma once

#include "InclusionPolicy.hpp"
#include "L1Cache.hpp"
#include "L2Cache.hpp"
#include "L3Cache.hpp"

class CacheSystem {
private:
  InclusionPolicy inclusion_policy;
  L1Cache *l1_mem;
  L1Cache *l1_inst;
  L2Cache *l2_mem;
  L3Cache *l3_mem;

public:
  // Need to look at specs user wants
  // CacheSystem()
};
