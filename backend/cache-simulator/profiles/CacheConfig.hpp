#pragma once

#include "../include/EvictionPolicy.hpp"
#include "../include/InclusionPolicy.hpp"
#include "../include/WritePolicy.hpp"

#include <cstdint>
using CacheSize = uint64_t;

struct CacheConfig {
  CacheSize kb_size;
  int associativity;
  int line_size = 64;
  EvictionPolicy policy = EvictionPolicy::LRU;
  WritePolicy write_policy = WritePolicy::Back;

  bool is_valid() const {
    if (kb_size == 0 || associativity <= 0 || line_size <= 0) return false;
    if ((line_size & (line_size - 1)) != 0) return false; // must be power of 2
    if (num_sets() <= 0) return false;
    if ((num_sets() & (num_sets() - 1)) != 0) return false; // must be power of 2
    return true;
  }

  int num_sets() const {
    return (kb_size * 1024) / (line_size * associativity);
  }
  int num_lines() const { return (kb_size * 1024) / line_size; }

  int offset_bits() const { return __builtin_ctz(line_size); }
  int index_bits() const { return __builtin_ctz(num_sets()); }
  int tag_bits() const { return 64 - offset_bits() - index_bits(); }

  uint64_t get_offset(uint64_t addr) const {
    return addr & ((1ULL << offset_bits()) - 1);
  }
  uint64_t get_index(uint64_t addr) const {
    return (addr >> offset_bits()) & ((1ULL << index_bits()) - 1);
  }
  uint64_t get_tag(uint64_t addr) const {
    return addr >> (offset_bits() + index_bits());
  }
};

struct CacheHierarchyConfig {
  CacheConfig l1_data;
  CacheConfig l1_inst;
  CacheConfig l2;
  CacheConfig l3;
  InclusionPolicy inclusion_policy;
};
