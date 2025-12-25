#pragma once

#include "CacheLevel.hpp"

class L3Cache : public CacheLevel {
private:
public:
  explicit L3Cache(const CacheConfig &cfg) : CacheLevel(cfg) {};
};
