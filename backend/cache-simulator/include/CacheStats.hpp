#pragma once

#include <cstdint>

struct CacheStats {
  uint64_t hits = 0;
  uint64_t misses = 0;
  uint64_t writebacks = 0;
  uint64_t invalidations = 0;

  uint64_t total_accesses() const { return hits + misses; }

  double hit_rate() const {
    if (total_accesses() == 0) return 0.0;
    return static_cast<double>(hits) / total_accesses();
  }

  double miss_rate() const {
    if (total_accesses() == 0) return 0.0;
    return static_cast<double>(misses) / total_accesses();
  }

  void reset() {
    hits = 0;
    misses = 0;
    writebacks = 0;
    invalidations = 0;
  }

  CacheStats& operator+=(const CacheStats& other) {
    hits += other.hits;
    misses += other.misses;
    writebacks += other.writebacks;
    invalidations += other.invalidations;
    return *this;
  }
};

struct HierarchyStats {
  CacheStats l1d;
  CacheStats l1i;
  CacheStats l2;
  CacheStats l3;

  void reset() {
    l1d.reset();
    l1i.reset();
    l2.reset();
    l3.reset();
  }
};
