#pragma once

#include <cstdint>
#include <unordered_map>
#include <vector>

enum class PrefetchPolicy {
  NONE,       // No prefetching
  NEXT_LINE,  // Always prefetch next cache line (adjacent line prefetcher)
  STREAM,     // Detect sequential streams, prefetch ahead
  STRIDE,     // Detect strided access patterns
  ADAPTIVE,   // Combine stream and stride detection
  INTEL,      // Intel-like: adjacent line + adaptive (most realistic)
};

struct PrefetchStats {
  uint64_t prefetches_issued = 0;
  uint64_t prefetches_useful = 0;  // Prefetched data was actually used
  uint64_t prefetches_late = 0;    // Demand access before prefetch completed
  uint64_t prefetches_useless = 0; // Evicted before use

  void reset() {
    prefetches_issued = 0;
    prefetches_useful = 0;
    prefetches_late = 0;
    prefetches_useless = 0;
  }

  [[nodiscard]] constexpr double accuracy() const noexcept {
    if (prefetches_issued == 0)
      return 0.0;
    return static_cast<double>(prefetches_useful) / prefetches_issued;
  }

  [[nodiscard]] constexpr double coverage() const noexcept {
    // Fraction of demand misses that could have been avoided
    // This requires tracking at a higher level
    return 0.0;
  }
};

// Stream detector entry for detecting sequential access patterns
struct StreamEntry {
  uint64_t start_addr = 0;
  uint64_t last_addr = 0;
  int direction = 0;  // +1 ascending, -1 descending
  int confidence = 0; // Number of consecutive sequential accesses
  bool valid = false;

  static constexpr int CONFIDENCE_THRESHOLD = 2;
  static constexpr int MAX_CONFIDENCE = 8;
};

// Stride detector entry for detecting strided access patterns
struct StrideEntry {
  uint64_t last_addr = 0;
  int64_t stride = 0;
  int confidence = 0;
  bool valid = false;

  static constexpr int CONFIDENCE_THRESHOLD = 2;
  static constexpr int MAX_CONFIDENCE = 8;
};

class Prefetcher {
private:
  PrefetchPolicy policy;
  int prefetch_degree;   // How many lines to prefetch ahead
  int line_size;         // Cache line size in bytes

  // Stream detection state (per-page tracking)
  static constexpr int NUM_STREAM_ENTRIES = 16;
  std::vector<StreamEntry> stream_table;

  // Stride detection state (per-PC tracking)
  std::unordered_map<uint64_t, StrideEntry> stride_table;

  PrefetchStats stats;

  // Internal methods
  std::vector<uint64_t> next_line_prefetch(uint64_t addr);
  std::vector<uint64_t> stream_prefetch(uint64_t addr, uint64_t pc);
  std::vector<uint64_t> stride_prefetch(uint64_t addr, uint64_t pc);
  std::vector<uint64_t> adaptive_prefetch(uint64_t addr, uint64_t pc);
  std::vector<uint64_t> intel_prefetch(uint64_t addr, uint64_t pc);

  void update_stream_table(uint64_t addr);
  void update_stride_table(uint64_t addr, uint64_t pc);

  uint64_t get_line_addr(uint64_t addr) const {
    return addr & ~static_cast<uint64_t>(line_size - 1);
  }

  uint64_t get_page(uint64_t addr) const {
    return addr >> 12;  // 4KB pages
  }

public:
  Prefetcher(PrefetchPolicy p = PrefetchPolicy::NONE, int degree = 2,
             int line_sz = 64)
      : policy(p), prefetch_degree(degree), line_size(line_sz) {
    stream_table.resize(NUM_STREAM_ENTRIES);
  }

  // Called on cache miss, returns addresses to prefetch
  std::vector<uint64_t> on_miss(uint64_t addr, uint64_t pc = 0);

  // Called when prefetched data is used (hit on prefetched line)
  void record_useful_prefetch() { stats.prefetches_useful++; }

  // Called when prefetched data is evicted without use
  void record_useless_prefetch() { stats.prefetches_useless++; }

  // Accessors
  [[nodiscard]] PrefetchPolicy get_policy() const { return policy; }
  void set_policy(PrefetchPolicy p) { policy = p; }
  [[nodiscard]] int get_degree() const { return prefetch_degree; }
  void set_degree(int d) { prefetch_degree = d; }
  [[nodiscard]] const PrefetchStats &get_stats() const { return stats; }
  void reset_stats() { stats.reset(); }
};
