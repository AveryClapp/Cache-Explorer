#include "include/BranchPredictor.hpp"

#include <algorithm>

namespace {
// Round up to the next power of two, with a floor of 2.
size_t round_up_pow2(size_t n) {
  if (n < 2)
    return 2;
  size_t p = 1;
  while (p < n)
    p <<= 1;
  return p;
}
} // namespace

BranchPredictor::BranchPredictor(size_t table_entries) {
  size_t entries = round_up_pow2(table_entries);
  index_mask_ = entries - 1;
  // Initialize counters to "weakly not-taken" (1), the conventional reset
  // state for a 2-bit bimodal predictor.
  counters_.assign(entries, 1);
}

bool BranchPredictor::process(uint64_t branch_id, bool taken,
                              std::string_view file, uint32_t line) {
  size_t idx = static_cast<size_t>(branch_id & index_mask_);
  uint8_t counter = counters_[idx];
  bool predicted_taken = counter >= 2;
  bool mispredicted = predicted_taken != taken;

  stats_.total++;
  if (mispredicted)
    stats_.mispredictions++;

  BranchSiteStats &site = site_stats_[branch_id];
  if (site.total == 0) {
    site.file = std::string(file);
    site.line = line;
  }
  site.total++;
  if (mispredicted)
    site.mispredictions++;

  // Saturating update toward the observed direction.
  if (taken) {
    if (counter < 3)
      counters_[idx] = counter + 1;
  } else {
    if (counter > 0)
      counters_[idx] = counter - 1;
  }

  return mispredicted;
}

std::vector<BranchSiteStats>
BranchPredictor::hot_mispredicts(size_t limit) const {
  std::vector<BranchSiteStats> sites;
  sites.reserve(site_stats_.size());
  for (const auto &[id, s] : site_stats_)
    sites.push_back(s);

  std::sort(sites.begin(), sites.end(),
            [](const BranchSiteStats &a, const BranchSiteStats &b) {
              return a.mispredictions > b.mispredictions;
            });

  if (sites.size() > limit)
    sites.resize(limit);
  return sites;
}

void BranchPredictor::reset() {
  std::fill(counters_.begin(), counters_.end(), static_cast<uint8_t>(1));
  stats_ = BranchPredictionStats{};
  site_stats_.clear();
}
