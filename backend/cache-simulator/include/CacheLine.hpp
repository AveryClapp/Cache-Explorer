#pragma once

#include <cstdint>

struct CacheLine {
  uint64_t tag = 0;
  bool valid = false;
  bool dirty = false;
  uint64_t lru_time = 0;
};
