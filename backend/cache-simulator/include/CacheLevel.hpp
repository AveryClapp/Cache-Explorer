#pragma once

#include "CacheLine.hpp"
#include "EvictionPolicy.hpp"
#include <vector>

class CacheLevel {
private:
  int kb_size;
  int set_assoc;
  int num_sets;
  EvictionPolicy eviction_policy;
  std::vector<std::vector<CacheLine>> sets;

public:
  CacheLevel() = delete;
  CacheLevel(int kb_size, int associativity, int line_size = 64,
             EvictionPolicy eviction_policy = EvictionPolicy::PLRU)
      : kb_size(kb_size), set_assoc(associativity),
        num_sets(kb_size * 1024 / (line_size * associativity)) {
    sets.resize(num_sets, std::vector<CacheLine>(set_assoc));
  }
  int getNumSets() const { return num_sets; }
  int getAssociativity() const { return set_assoc; }
  int getSizeKB() const { return kb_size; }
};
