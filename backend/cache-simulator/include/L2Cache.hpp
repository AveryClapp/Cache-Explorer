#pragma once

#include "CacheLevel.hpp"

class L2Cache : public CacheLevel {
private:
public:
  explicit L2Cache(const CacheConfig &cfg) : CacheLevel(cfg) {};
};
