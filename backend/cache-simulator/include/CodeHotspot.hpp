#pragma once

#include "TraceEvent.hpp"

#include <cstddef>
#include <cstdint>
#include <unordered_map>
#include <vector>

struct CodeHotspot {
  TraceCodeLocation location;
  uint64_t accesses = 0;
  uint64_t reads = 0;
  uint64_t writes = 0;
  uint64_t l1d_hits = 0;
  uint64_t l1d_misses = 0;
  uint64_t l2_hits = 0;
  uint64_t l3_hits = 0;
  uint64_t memory_accesses = 0;

  [[nodiscard]] double l1d_miss_rate() const {
    return accesses ? static_cast<double>(l1d_misses) / accesses : 0.0;
  }
};

class CodeHotspotTracker {
public:
  void record(const TraceEvent &event, bool is_write, bool l1_hit,
              bool l2_hit, bool l3_hit);
  [[nodiscard]] std::vector<CodeHotspot>
  hottest(size_t limit = 100) const;
  void reset();

private:
  struct LocationHash {
    size_t operator()(const TraceCodeLocation &location) const;
  };

  std::unordered_map<TraceCodeLocation, CodeHotspot, LocationHash> hotspots_;
};
