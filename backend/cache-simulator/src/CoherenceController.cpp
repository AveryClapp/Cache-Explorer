#include "include/CoherenceController.hpp"
#include <algorithm>

CoherenceController::CoherenceController(int cores) : num_cores(cores) {
  l1_caches.resize(cores, nullptr);
}

void CoherenceController::register_cache(int core_id, CacheLevel *cache) {
  if (core_id < num_cores)
    l1_caches[core_id] = cache;
}

SnoopResult CoherenceController::request_read(int requesting_core,
                                              uint64_t address) {
  SnoopResult result = {false, false, 0};

  for (int core = 0; core < num_cores; core++) {
    if (core == requesting_core || !l1_caches[core])
      continue;

    if (l1_caches[core]->is_present(address)) {
      result.found = true;
      if (l1_caches[core]->is_dirty(address)) {
        result.was_modified = true;
        result.data_source_core = core;
        // Downgrade M -> S, need writeback
        bool was_dirty;
        l1_caches[core]->get_line_for_writeback(address, was_dirty);
      }
      sharers[address].push_back(core);
    }
  }

  sharers[address].push_back(requesting_core);
  return result;
}

SnoopResult CoherenceController::request_exclusive(int requesting_core,
                                                   uint64_t address) {
  SnoopResult result = {false, false, 0};

  for (int core = 0; core < num_cores; core++) {
    if (core == requesting_core || !l1_caches[core])
      continue;

    if (l1_caches[core]->is_present(address)) {
      result.found = true;
      if (l1_caches[core]->is_dirty(address)) {
        result.was_modified = true;
        result.data_source_core = core;
      }
      // Invalidate other copies
      l1_caches[core]->invalidate(address);
    }
  }

  // Clear sharers, new owner is requesting core
  sharers[address].clear();
  owner[address] = requesting_core;
  return result;
}

bool CoherenceController::detect_false_sharing(uint64_t address,
                                               int line_size) {
  uint64_t line_mask = ~(static_cast<uint64_t>(line_size) - 1);
  uint64_t line_addr = address & line_mask;

  auto it = sharers.find(line_addr);
  if (it == sharers.end())
    return false;

  return it->second.size() > 1;
}

void CoherenceController::evict_line(int core_id, uint64_t address) {
  auto it = sharers.find(address);
  if (it != sharers.end()) {
    auto &cores = it->second;
    cores.erase(std::remove(cores.begin(), cores.end(), core_id), cores.end());
    if (cores.empty())
      sharers.erase(it);
  }

  if (owner.count(address) && owner[address] == core_id)
    owner.erase(address);
}

int CoherenceController::get_sharer_count(uint64_t address) const {
  auto it = sharers.find(address);
  return it != sharers.end() ? static_cast<int>(it->second.size()) : 0;
}
