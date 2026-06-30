#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

// Per-branch-site prediction statistics, keyed by static branch-site id.
struct BranchSiteStats {
  std::string file;
  uint32_t line = 0;
  uint64_t total = 0;
  uint64_t mispredictions = 0;
  [[nodiscard]] double misprediction_rate() const {
    return total ? (double)mispredictions / total : 0;
  }
};

// Global branch-prediction statistics.
struct BranchPredictionStats {
  uint64_t total = 0;
  uint64_t mispredictions = 0;
  [[nodiscard]] uint64_t correct() const { return total - mispredictions; }
  [[nodiscard]] double accuracy() const {
    return total ? (double)correct() / total : 0;
  }
  [[nodiscard]] double misprediction_rate() const {
    return total ? (double)mispredictions / total : 0;
  }
};

// Bimodal branch predictor: a table of 2-bit saturating counters indexed by
// the low bits of the branch-site id. Counter states 0..3 map to
// strongly/weakly not-taken (0,1) and weakly/strongly taken (2,3).
//
// This is the textbook baseline predictor and the first execution-engine
// model in the simulator. It consumes branch-direction trace events; the
// memory caches are unaffected.
class BranchPredictor {
public:
  // table_entries is rounded up to a power of two (min 2).
  explicit BranchPredictor(size_t table_entries = 1024);

  // Feed one observed branch outcome and update predictor state.
  // Returns true if the prediction was wrong (a misprediction).
  bool process(uint64_t branch_id, bool taken, std::string_view file,
               uint32_t line);

  [[nodiscard]] const BranchPredictionStats &stats() const { return stats_; }

  // Branch sites with the most mispredictions, highest first.
  [[nodiscard]] std::vector<BranchSiteStats>
  hot_mispredicts(size_t limit = 10) const;

  void reset();

private:
  std::vector<uint8_t> counters_; // 2-bit saturating counters (0..3)
  uint64_t index_mask_;           // table_entries - 1 (power of two)
  BranchPredictionStats stats_;
  std::unordered_map<uint64_t, BranchSiteStats> site_stats_;
};
