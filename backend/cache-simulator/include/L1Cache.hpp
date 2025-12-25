#pragma once

#include "CacheLevel.hpp"

class L1Cache : public CacheLevel {
private:
  bool is_inst;

public:
  explicit L1Cache(const CacheConfig &cfg, bool is_inst = false)
      : CacheLevel(cfg), is_inst(is_inst) {};
};
