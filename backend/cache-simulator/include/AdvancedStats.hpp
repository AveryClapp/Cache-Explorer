#pragma once

#include <cstdint>

// Software prefetch statistics
struct SoftwarePrefetchStats {
  uint64_t issued = 0;    // Total prefetches issued
  uint64_t useful = 0;    // Prefetches that were later accessed
  uint64_t redundant = 0; // Prefetches to already-cached lines
  uint64_t evicted = 0;   // Prefetches evicted before use
  [[nodiscard]] double accuracy() const { return issued ? (double)useful / issued : 0; }
};

// Vector/SIMD operation statistics
struct VectorStats {
  uint64_t loads = 0;
  uint64_t stores = 0;
  uint64_t bytes_loaded = 0;
  uint64_t bytes_stored = 0;
  uint64_t cross_line_accesses = 0; // Accesses spanning cache lines
};

// Atomic operation statistics
struct AtomicStats {
  uint64_t load_count = 0;
  uint64_t store_count = 0;
  uint64_t rmw_count = 0;         // fetch_add, fetch_sub, etc.
  uint64_t cmpxchg_count = 0;     // compare-and-swap
  uint64_t contention_events = 0; // High-contention detected
};

// Memory intrinsic statistics
struct MemoryIntrinsicStats {
  uint64_t memcpy_count = 0;
  uint64_t memcpy_bytes = 0;
  uint64_t memset_count = 0;
  uint64_t memset_bytes = 0;
  uint64_t memmove_count = 0;
  uint64_t memmove_bytes = 0;
};
