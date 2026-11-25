#include "include/CodeHotspot.hpp"

#include <algorithm>
#include <functional>

size_t CodeHotspotTracker::LocationHash::operator()(
    const TraceCodeLocation &location) const {
  size_t hash = std::hash<uint32_t>{}(location.image_table_id);
  hash ^= std::hash<uint64_t>{}(location.rva) + 0x9e3779b9 + (hash << 6) +
          (hash >> 2);
  return hash;
}

void CodeHotspotTracker::record(const TraceEvent &event, bool is_write,
                                bool l1_hit, bool l2_hit, bool l3_hit) {
  if (!event.code_location || event.is_icache || event.is_prefetch ||
      event.is_branch) {
    return;
  }

  auto [entry, inserted] = hotspots_.try_emplace(*event.code_location);
  CodeHotspot &hotspot = entry->second;
  if (inserted) hotspot.location = *event.code_location;

  ++hotspot.accesses;
  if (is_write)
    ++hotspot.writes;
  else
    ++hotspot.reads;

  if (l1_hit) {
    ++hotspot.l1d_hits;
  } else {
    ++hotspot.l1d_misses;
    if (l2_hit)
      ++hotspot.l2_hits;
    else if (l3_hit)
      ++hotspot.l3_hits;
    else
      ++hotspot.memory_accesses;
  }
}

std::vector<CodeHotspot> CodeHotspotTracker::hottest(size_t limit) const {
  std::vector<CodeHotspot> sorted;
  sorted.reserve(hotspots_.size());
  for (const auto &[_, hotspot] : hotspots_) sorted.push_back(hotspot);
  std::sort(sorted.begin(), sorted.end(), [](const auto &left, const auto &right) {
    if (left.l1d_misses != right.l1d_misses)
      return left.l1d_misses > right.l1d_misses;
    if (left.accesses != right.accesses)
      return left.accesses > right.accesses;
    if (left.location.image_table_id != right.location.image_table_id)
      return left.location.image_table_id < right.location.image_table_id;
    return left.location.rva < right.location.rva;
  });
  if (sorted.size() > limit) sorted.resize(limit);
  return sorted;
}

void CodeHotspotTracker::reset() { hotspots_.clear(); }
