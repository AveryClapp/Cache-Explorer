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

  [[nodiscard]] constexpr uint64_t total_accesses() const noexcept { return hits + misses; }

  [[nodiscard]] constexpr double hit_rate() const noexcept {
    if (total_accesses() == 0) return 0.0;
    return static_cast<double>(hits) / total_accesses();
  }

  [[nodiscard]] constexpr double miss_rate() const noexcept {
    if (total_accesses() == 0) return 0.0;
    return static_cast<double>(misses) / total_accesses();
  }

  // Miss breakdown percentages
  [[nodiscard]] constexpr double compulsory_rate() const noexcept {
    if (misses == 0) return 0.0;
    return static_cast<double>(compulsory_misses) / misses;
  }

  [[nodiscard]] constexpr double capacity_rate() const noexcept {
    if (misses == 0) return 0.0;
    return static_cast<double>(capacity_misses) / misses;
  }

  [[nodiscard]] constexpr double conflict_rate() const noexcept {
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

// Timing statistics for cycle-level analysis
struct TimingStats {
  uint64_t total_cycles = 0;          // Total simulated cycles for all accesses
  uint64_t l1_hit_cycles = 0;         // Cycles from L1 hits
  uint64_t l2_hit_cycles = 0;         // Cycles from L2 hits
  uint64_t l3_hit_cycles = 0;         // Cycles from L3 hits
  uint64_t memory_cycles = 0;         // Cycles from memory accesses
  uint64_t tlb_miss_cycles = 0;       // Additional cycles from TLB misses

  [[nodiscard]] constexpr double average_access_latency(uint64_t total_accesses) const noexcept {
    if (total_accesses == 0) return 0.0;
    return static_cast<double>(total_cycles) / total_accesses;
  }

  void reset() {
    total_cycles = 0;
    l1_hit_cycles = 0;
    l2_hit_cycles = 0;
    l3_hit_cycles = 0;
    memory_cycles = 0;
    tlb_miss_cycles = 0;
  }

  TimingStats& operator+=(const TimingStats& other) {
    total_cycles += other.total_cycles;
    l1_hit_cycles += other.l1_hit_cycles;
    l2_hit_cycles += other.l2_hit_cycles;
    l3_hit_cycles += other.l3_hit_cycles;
    memory_cycles += other.memory_cycles;
    tlb_miss_cycles += other.tlb_miss_cycles;
    return *this;
  }
};

struct HierarchyStats {
  CacheStats l1d;
  CacheStats l1i;
  CacheStats l2;
  CacheStats l3;
  TimingStats timing;  // Cycle-level timing statistics

  void reset() {
    l1d.reset();
    l1i.reset();
    l2.reset();
    l3.reset();
    timing.reset();
  }
};
