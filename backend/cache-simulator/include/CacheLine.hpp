#pragma once

#include <cstdint>

class CacheLine {
private:
  uint64_t tag;
  bool valid;
  bool dirty;
  uint64_t lru_time;

public:
  CacheLine() : tag(0), valid(false), dirty(false), lru_time(0) {}
};
