#pragma once

#include "CacheLevel.hpp"

class L1Cache : public CacheLevel {
private:
  bool is_inst;

public:
  L1Cache(int kb_size, int associativity, int line_size = 64,
          EvictionPolicy eviction_policy = EvictionPolicy::PLRU,
          bool is_inst = false)
      : CacheLevel(kb_size, associativity, line_size, eviction_policy),
        is_inst(is_inst) {};
};
