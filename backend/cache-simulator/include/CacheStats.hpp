#pragma once

#include <cstdint>

struct CacheStats {
  uint64_t hits = 0;
  uint64_t misses = 0;
  uint64_t writebacks = 0;
  uint64_t invalidations = 0;

  // Miss breakdown (3C model)
  uint64_t compulsory_misses = 0;  // Cold misses - first access ever
  uint64_t capacity_misses = 0;    // Working set exceeds cache size
  uint64_t conflict_misses = 0;    // Limited associativity caused eviction

  uint64_t total_accesses() const { return hits + misses; }

  double hit_rate() const {
    if (total_accesses() == 0) return 0.0;
    return static_cast<double>(hits) / total_accesses();
  }

  double miss_rate() const {
    if (total_accesses() == 0) return 0.0;
    return static_cast<double>(misses) / total_accesses();
  }

  // Miss breakdown percentages
  double compulsory_rate() const {
    if (misses == 0) return 0.0;
    return static_cast<double>(compulsory_misses) / misses;
  }

  double capacity_rate() const {
    if (misses == 0) return 0.0;
    return static_cast<double>(capacity_misses) / misses;
  }

  double conflict_rate() const {
    if (misses == 0) return 0.0;
    return static_cast<double>(conflict_misses) / misses;
  }

  void reset() {
    hits = 0;
    misses = 0;
    writebacks = 0;
    invalidations = 0;
    compulsory_misses = 0;
    capacity_misses = 0;
    conflict_misses = 0;
  }

  CacheStats& operator+=(const CacheStats& other) {
    hits += other.hits;
    misses += other.misses;
    writebacks += other.writebacks;
    invalidations += other.invalidations;
    compulsory_misses += other.compulsory_misses;
    capacity_misses += other.capacity_misses;
    conflict_misses += other.conflict_misses;
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
