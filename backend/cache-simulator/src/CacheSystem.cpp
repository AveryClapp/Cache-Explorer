#include "../include/CacheSystem.hpp"

void CacheSystem::handle_inclusive_eviction(uint64_t evicted_addr,
                                             CacheLevel &from_level) {
  // Inclusive: when L2/L3 evicts, must back-invalidate lower levels
  if (has_l3() && &from_level == &(*l3_)) {
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
    // Intel DCU prefetcher brings data directly to L1
    // This means next access to prefetched address is an L1 HIT
    if (!l1d.is_present(addr)) {
      // Install in L1 (like Intel DCU prefetcher)
      l1d.install(addr, false);

      // Also install in L2 for inclusive hierarchy
      if (!l2.is_present(addr)) {
        l2.install(addr, false);
      }

      // Also install in L3 for inclusive hierarchy (if L3 exists)
      if (has_l3() && !l3_->is_present(addr)) {
        l3_->install(addr, false);
      }

      prefetched_addresses.insert(addr);
    }
  }
}

void CacheSystem::enable_prefetching(PrefetchPolicy policy, int degree) {
  prefetcher.set_policy(policy);
  prefetcher.set_degree(degree);
  prefetch_enabled = true;
}

void CacheSystem::disable_prefetching() {
  prefetch_enabled = false;
  prefetcher.set_policy(PrefetchPolicy::NONE);
}

SystemAccessResult CacheSystem::access_hierarchy(uint64_t address,
                                                  bool is_write,
                                                  CacheLevel &l1,
                                                  TLB &tlb,
                                                  uint64_t pc) {
  SystemAccessResult result = {false, false, false, false, false, false, {}, 0, 0};

  // TLB lookup (happens before/in parallel with cache access)
  bool tlb_miss = false;
  if (tlb_enabled) {
    bool tlb_hit = tlb.access(address);
    tlb_miss = !tlb_hit;
    if (&tlb == &dtlb) {
      result.dtlb_hit = tlb_hit;
    } else {
      result.itlb_hit = tlb_hit;
    }
  }

  // Try L1
  AccessInfo l1_info = l1.access(address, is_write);
  if (l1_info.result == AccessResult::Hit) [[likely]] {
    result.l1_hit = true;
    // Calculate timing: L1 hit
    result.cycles = latency_config.l1_hit;
    if (tlb_miss) {
      result.cycles += latency_config.tlb_miss_penalty;
      timing_stats.tlb_miss_cycles += latency_config.tlb_miss_penalty;
    }
    timing_stats.l1_hit_cycles += latency_config.l1_hit;
    timing_stats.total_cycles += result.cycles;

    // Check if this was a prefetched line (promoted from L2 to L1)
    // Must align address to cache line boundary for lookup
    if (prefetch_enabled) {
      uint64_t line_addr = address & ~(static_cast<uint64_t>(l1d.get_line_size()) - 1);
      if (prefetched_addresses.count(line_addr)) {
        prefetcher.record_useful_prefetch();
        prefetched_addresses.erase(line_addr);
      }
    }
    return result;
  }

  // L1 miss - trigger prefetching (like Intel DCU prefetcher)
  // Real hardware prefetches on L1 miss, not just L3 miss
  if (prefetch_enabled) {
    auto pf_addrs = prefetcher.on_miss(address, pc);
    result.prefetches_issued = static_cast<int>(pf_addrs.size());
    issue_prefetches(pf_addrs);
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
  if (l2_info.result == AccessResult::Hit) [[likely]] {
    result.l2_hit = true;
    // Calculate timing: L2 hit (includes L1 miss time)
    result.cycles = latency_config.l2_hit;
    if (tlb_miss) {
      result.cycles += latency_config.tlb_miss_penalty;
      timing_stats.tlb_miss_cycles += latency_config.tlb_miss_penalty;
    }
    timing_stats.l2_hit_cycles += latency_config.l2_hit;
    timing_stats.total_cycles += result.cycles;

    // Check if this was a prefetched line - prefetches go to L2
    // Must align address to cache line boundary for lookup
    if (prefetch_enabled) {
      uint64_t line_addr = address & ~(static_cast<uint64_t>(l1d.get_line_size()) - 1);
      if (prefetched_addresses.count(line_addr)) {
        prefetcher.record_useful_prefetch();
        prefetched_addresses.erase(line_addr);
      }
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
    if (inclusion_policy == InclusionPolicy::Exclusive && has_l3()) {
      handle_exclusive_eviction(l2_info.evicted_address, l2, *l3_,
                                 l2_info.was_dirty);
    } else {
      result.writebacks.push_back(l2_info.evicted_address);
    }
  }

  // Try L3 (if it exists)
  if (has_l3()) {
    AccessInfo l3_info = l3_->access(address, is_write);
    if (l3_info.result == AccessResult::Hit) {
      result.l3_hit = true;
      // Calculate timing: L3 hit
      result.cycles = latency_config.l3_hit;
      if (tlb_miss) {
        result.cycles += latency_config.tlb_miss_penalty;
        timing_stats.tlb_miss_cycles += latency_config.tlb_miss_penalty;
      }
      timing_stats.l3_hit_cycles += latency_config.l3_hit;
      timing_stats.total_cycles += result.cycles;

      if (inclusion_policy == InclusionPolicy::Exclusive) {
        l3_->invalidate(address);
      }

      return result;
    }

    // L3 miss - memory access
    result.memory_access = true;
    // Calculate timing: memory access
    result.cycles = latency_config.memory;
    if (tlb_miss) {
      result.cycles += latency_config.tlb_miss_penalty;
      timing_stats.tlb_miss_cycles += latency_config.tlb_miss_penalty;
    }
    timing_stats.memory_cycles += latency_config.memory;
    timing_stats.total_cycles += result.cycles;

    if (l3_info.was_dirty) {
      result.writebacks.push_back(l3_info.evicted_address);
    }

    // Handle L3 eviction for inclusive policy
    // Inclusive caches must back-invalidate on ALL evictions, not just dirty ones
    // This ensures lower levels never have lines not present in higher levels
    if (inclusion_policy == InclusionPolicy::Inclusive && l3_info.had_eviction) {
      // Back-invalidate all levels when L3 evicts any line
      // Note: l3_info.evicted_address is the OLD line being evicted, not the new one
      l2.invalidate(l3_info.evicted_address);
      l1d.invalidate(l3_info.evicted_address);
      l1i.invalidate(l3_info.evicted_address);
    }
  } else {
    // No L3 - L2 miss goes directly to memory
    result.memory_access = true;
    result.cycles = latency_config.memory;
    if (tlb_miss) {
      result.cycles += latency_config.tlb_miss_penalty;
      timing_stats.tlb_miss_cycles += latency_config.tlb_miss_penalty;
    }
    timing_stats.memory_cycles += latency_config.memory;
    timing_stats.total_cycles += result.cycles;
  }

  // Note: Prefetching is now triggered on L1 miss (earlier in hierarchy)
  // This matches Intel DCU prefetcher behavior

  return result;
}

SystemAccessResult CacheSystem::read(uint64_t address, uint64_t pc) {
  return access_hierarchy(address, false, l1d, dtlb, pc);
}

SystemAccessResult CacheSystem::write(uint64_t address, uint64_t pc) {
  return access_hierarchy(address, true, l1d, dtlb, pc);
}

SystemAccessResult CacheSystem::fetch(uint64_t address, uint64_t pc) {
  return access_hierarchy(address, false, l1i, itlb, pc);
}

HierarchyStats CacheSystem::get_stats() const {
  CacheStats l3_stats = has_l3() ? l3_->get_stats() : CacheStats{};
  return {l1d.get_stats(), l1i.get_stats(), l2.get_stats(), l3_stats, timing_stats};
}

void CacheSystem::reset_stats() {
  l1d.reset_stats();
  l1i.reset_stats();
  l2.reset_stats();
  if (has_l3()) {
    l3_->reset_stats();
  }
  timing_stats.reset();
}
