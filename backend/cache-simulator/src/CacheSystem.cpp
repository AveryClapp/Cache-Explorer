#include "../include/CacheSystem.hpp"

void CacheSystem::handle_inclusive_eviction(uint64_t evicted_addr,
                                             CacheLevel &from_level) {
  // Inclusive: when L2/L3 evicts, must back-invalidate lower levels
  if (&from_level == &l3) {
    l2.invalidate(evicted_addr);
    l1d.invalidate(evicted_addr);
    l1i.invalidate(evicted_addr);
  } else if (&from_level == &l2) {
    l1d.invalidate(evicted_addr);
    l1i.invalidate(evicted_addr);
  }
}

void CacheSystem::handle_exclusive_eviction(uint64_t evicted_addr,
                                             CacheLevel &from_level,
                                             CacheLevel &to_level,
                                             bool was_dirty) {
  // Exclusive: evicted line moves to next level (victim cache behavior)
  to_level.install(evicted_addr, was_dirty);
}

void CacheSystem::issue_prefetches(const std::vector<uint64_t> &addrs) {
  for (uint64_t addr : addrs) {
    // Prefetches go directly to L2 (typical HW behavior)
    // Only prefetch if not already present
    if (!l2.is_present(addr) && !l1d.is_present(addr)) {
      l2.install(addr, false);
      prefetched_addresses.insert(addr);  // Track this prefetch
    }
  }
}

void CacheSystem::enable_prefetching(PrefetchPolicy policy, int degree) {
  prefetcher.setPolicy(policy);
  prefetcher.setDegree(degree);
  prefetch_enabled = true;
}

void CacheSystem::disable_prefetching() {
  prefetch_enabled = false;
  prefetcher.setPolicy(PrefetchPolicy::NONE);
}

SystemAccessResult CacheSystem::access_hierarchy(uint64_t address,
                                                  bool is_write,
                                                  CacheLevel &l1,
                                                  uint64_t pc) {
  SystemAccessResult result = {false, false, false, false, {}, 0};

  // Try L1
  AccessInfo l1_info = l1.access(address, is_write);
  if (l1_info.result == AccessResult::Hit) {
    result.l1_hit = true;
    // Check if this was a prefetched line (promoted from L2 to L1)
    if (prefetch_enabled && prefetched_addresses.count(address)) {
      prefetcher.record_useful_prefetch();
      prefetched_addresses.erase(address);
    }
    return result;
  }

  // L1 miss - handle eviction
  if (l1_info.was_dirty) {
    if (inclusion_policy == InclusionPolicy::Exclusive) {
      handle_exclusive_eviction(l1_info.evicted_address, l1, l2,
                                 l1_info.was_dirty);
    } else {
      result.writebacks.push_back(l1_info.evicted_address);
    }
  }

  // Try L2
  AccessInfo l2_info = l2.access(address, is_write);
  if (l2_info.result == AccessResult::Hit) {
    result.l2_hit = true;

    // Check if this was a prefetched line - prefetches go to L2
    if (prefetch_enabled && prefetched_addresses.count(address)) {
      prefetcher.record_useful_prefetch();
      prefetched_addresses.erase(address);
    }

    if (inclusion_policy == InclusionPolicy::Exclusive) {
      // Exclusive: move from L2 to L1, remove from L2
      l2.invalidate(address);
    }
    // For inclusive/NINE, line stays in L2

    return result;
  }

  // L2 miss - handle eviction
  if (l2_info.was_dirty) {
    if (inclusion_policy == InclusionPolicy::Exclusive) {
      handle_exclusive_eviction(l2_info.evicted_address, l2, l3,
                                 l2_info.was_dirty);
    } else {
      result.writebacks.push_back(l2_info.evicted_address);
    }
  }

  // Try L3
  AccessInfo l3_info = l3.access(address, is_write);
  if (l3_info.result == AccessResult::Hit) {
    result.l3_hit = true;

    if (inclusion_policy == InclusionPolicy::Exclusive) {
      l3.invalidate(address);
    }

    return result;
  }

  // L3 miss - memory access
  result.memory_access = true;

  if (l3_info.was_dirty) {
    result.writebacks.push_back(l3_info.evicted_address);
  }

  // Handle L3 eviction for inclusive policy
  if (inclusion_policy == InclusionPolicy::Inclusive && l3_info.was_dirty) {
    // Back-invalidate all levels when L3 evicts
    // Note: l3_info.evicted_address is the OLD line being evicted, not the new one
    // We've already written it back, but need to invalidate copies in L1/L2
    l2.invalidate(l3_info.evicted_address);
    l1d.invalidate(l3_info.evicted_address);
    l1i.invalidate(l3_info.evicted_address);
  }

  // Issue prefetches on L3 miss (memory access)
  if (prefetch_enabled) {
    auto pf_addrs = prefetcher.on_miss(address, pc);
    result.prefetches_issued = static_cast<int>(pf_addrs.size());
    issue_prefetches(pf_addrs);
  }

  return result;
}

SystemAccessResult CacheSystem::read(uint64_t address, uint64_t pc) {
  return access_hierarchy(address, false, l1d, pc);
}

SystemAccessResult CacheSystem::write(uint64_t address, uint64_t pc) {
  return access_hierarchy(address, true, l1d, pc);
}

SystemAccessResult CacheSystem::fetch(uint64_t address, uint64_t pc) {
  return access_hierarchy(address, false, l1i, pc);
}

HierarchyStats CacheSystem::get_stats() const {
  return {l1d.getStats(), l1i.getStats(), l2.getStats(), l3.getStats()};
}

void CacheSystem::reset_stats() {
  l1d.resetStats();
  l1i.resetStats();
  l2.resetStats();
  l3.resetStats();
}
