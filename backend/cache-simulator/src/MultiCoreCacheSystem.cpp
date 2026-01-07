#include "include/MultiCoreCacheSystem.hpp"

MultiCoreCacheSystem::MultiCoreCacheSystem(int cores, const CacheConfig &l1_cfg,
                                           const CacheConfig &l2_cfg,
                                           const CacheConfig &l3_cfg,
                                           PrefetchPolicy pf_policy,
                                           int pf_degree)
    : num_cores(cores), l2(l2_cfg), l3(l3_cfg), coherence(cores),
      prefetch_policy(pf_policy), prefetch_degree(pf_degree),
      line_size(l1_cfg.line_size) {
  for (int i = 0; i < cores; i++) {
    l1_caches.push_back(std::make_unique<CacheLevel>(l1_cfg));
    coherence.register_cache(i, l1_caches[i].get());
    // Each core gets its own prefetcher with independent state
    prefetchers.push_back(
        std::make_unique<Prefetcher>(pf_policy, pf_degree, l1_cfg.line_size));
    // Each core gets its own DTLB (64 entries, 4-way, 4KB pages)
    dtlbs.push_back(std::make_unique<TLB>(TLBConfig{64, 4, 4096}));
  }
}

int MultiCoreCacheSystem::get_core_for_thread(uint32_t thread_id) {
  auto it = thread_to_core.find(thread_id);
  if (it != thread_to_core.end()) {
    return it->second;
  }
  int core = next_core % num_cores;
  thread_to_core[thread_id] = core;
  next_core++;
  return core;
}

void MultiCoreCacheSystem::issue_prefetches(int core, uint64_t miss_addr,
                                            uint64_t pc) {
  if (prefetch_policy == PrefetchPolicy::NONE)
    return;

  auto prefetch_addrs = prefetchers[core]->on_miss(miss_addr, pc);
  for (uint64_t pf_addr : prefetch_addrs) {
    uint64_t line_addr = get_line_address(pf_addr);

    // Don't prefetch if already in L1
    if (l1_caches[core]->is_present(line_addr))
      continue;

    // Prefetch into L1 with appropriate coherence state
    // Check other caches for coherence
    bool others_have_it = false;
    for (int other = 0; other < num_cores; other++) {
      if (other != core && l1_caches[other]->is_present(line_addr)) {
        others_have_it = true;
        break;
      }
    }

    // Install prefetched line as Shared (if others have it) or Exclusive
    CoherenceState pf_state =
        others_have_it ? CoherenceState::Shared : CoherenceState::Exclusive;

    // Fetch into L2/L3 if needed, then L1
    if (!l2.is_present(line_addr)) {
      l3.access(line_addr, false);
      l2.install(line_addr, false);
    }
    l1_caches[core]->install_with_state(line_addr, pf_state);
  }
}

void MultiCoreCacheSystem::track_access_for_false_sharing(
    uint64_t addr, uint32_t thread_id, bool is_write, const std::string &file,
    uint32_t line) {
  uint64_t line_addr = get_line_address(addr);
  uint32_t byte_offset = addr & (line_size - 1);

  auto &accesses = line_accesses[line_addr];
  accesses.push_back({thread_id, byte_offset, is_write, file, line});

  std::unordered_set<uint32_t> threads_seen;
  std::unordered_set<uint32_t> offsets_seen;
  bool has_write = false;

  for (const auto &a : accesses) {
    threads_seen.insert(a.thread_id);
    offsets_seen.insert(a.byte_offset);
    if (a.is_write)
      has_write = true;
  }

  if (threads_seen.size() > 1 && offsets_seen.size() > 1 && has_write) {
    if (false_sharing_lines.insert(line_addr).second) {
      false_sharing_count++;
    }
  }
}

MultiCoreAccessResult MultiCoreCacheSystem::read(uint64_t address,
                                                 uint32_t thread_id,
                                                 const std::string &file,
                                                 uint32_t line) {
  int core = get_core_for_thread(thread_id);
  track_access_for_false_sharing(address, thread_id, false, file, line);

  // TLB lookup for data access
  dtlbs[core]->access(address);

  uint64_t line_addr = get_line_address(address);

  auto l1_info = l1_caches[core]->access(line_addr, false);
  if (l1_info.result == AccessResult::Hit) {
    return {true, false, false, false};
  }

  // L1 miss - trigger prefetcher for this core
  issue_prefetches(core, line_addr);

  // Snoop other caches - may get data from Modified line
  auto snoop = coherence.request_read(core, line_addr);
  if (snoop.was_modified) {
    coherence_invalidations++;
    // Downgrade the owner's line from M to S
    l1_caches[snoop.data_source_core]->downgrade_to_shared(line_addr);
  }

  // Determine coherence state for new line:
  // Shared if others have it, Exclusive if we're the only one
  CoherenceState new_state =
      snoop.found ? CoherenceState::Shared : CoherenceState::Exclusive;

  auto l2_info = l2.access(line_addr, false);
  if (l2_info.result == AccessResult::Hit) {
    l1_caches[core]->install_with_state(line_addr, new_state);
    return {false, true, false, false};
  }

  auto l3_info = l3.access(line_addr, false);
  l2.install(line_addr, false);
  l1_caches[core]->install_with_state(line_addr, new_state);

  bool l3_hit = (l3_info.result == AccessResult::Hit);
  return {false, false, l3_hit, !l3_hit};
}

MultiCoreAccessResult MultiCoreCacheSystem::write(uint64_t address,
                                                  uint32_t thread_id,
                                                  const std::string &file,
                                                  uint32_t line) {
  int core = get_core_for_thread(thread_id);
  track_access_for_false_sharing(address, thread_id, true, file, line);

  // TLB lookup for data access
  dtlbs[core]->access(address);

  uint64_t line_addr = get_line_address(address);

  // Request exclusive access - invalidates all other copies
  auto snoop = coherence.request_exclusive(core, line_addr);
  if (snoop.found) {
    coherence_invalidations++;
  }

  // Check if we have the line in L1
  auto l1_info = l1_caches[core]->access(line_addr, true);
  if (l1_info.result == AccessResult::Hit) {
    // Upgrade to Modified state (handles S->M, E->M transitions)
    l1_caches[core]->set_coherence_state(line_addr, CoherenceState::Modified);
    return {true, false, false, false};
  }

  // L1 miss - trigger prefetcher for this core
  issue_prefetches(core, line_addr);

  // Miss in L1 - need to fetch and install as Modified
  auto l2_info = l2.access(line_addr, false);
  if (l2_info.result == AccessResult::Hit) {
    l1_caches[core]->install_with_state(line_addr, CoherenceState::Modified);
    return {false, true, false, false};
  }

  auto l3_info = l3.access(line_addr, false);
  l2.install(line_addr, false);
  l1_caches[core]->install_with_state(line_addr, CoherenceState::Modified);

  bool l3_hit = (l3_info.result == AccessResult::Hit);
  return {false, false, l3_hit, !l3_hit};
}

MultiCoreStats MultiCoreCacheSystem::get_stats() const {
  MultiCoreStats stats;
  for (const auto &l1 : l1_caches) {
    stats.l1_per_core.push_back(l1->get_stats());
  }
  for (const auto &pf : prefetchers) {
    stats.prefetch_per_core.push_back(pf->get_stats());
  }
  stats.l2 = l2.get_stats();
  stats.l3 = l3.get_stats();
  stats.coherence_invalidations = coherence_invalidations;
  stats.false_sharing_events = false_sharing_count;
  return stats;
}

TLBHierarchyStats MultiCoreCacheSystem::get_tlb_stats() const {
  TLBHierarchyStats stats;
  for (const auto &dtlb : dtlbs) {
    stats.dtlb += dtlb->get_stats();
  }
  // ITLB not tracked yet (would need instruction fetch tracking)
  return stats;
}

TLBStats MultiCoreCacheSystem::get_tlb_stats_for_core(int core) const {
  if (core < 0 || core >= num_cores)
    return TLBStats{};
  return dtlbs[core]->get_stats();
}

std::vector<FalseSharingReport>
MultiCoreCacheSystem::get_false_sharing_reports() const {
  std::vector<FalseSharingReport> reports;
  for (uint64_t line_addr : false_sharing_lines) {
    FalseSharingReport report;
    report.cache_line_addr = line_addr;

    auto it = line_accesses.find(line_addr);
    if (it != line_accesses.end()) {
      for (const auto &a : it->second) {
        report.accesses.push_back({line_addr, a.file, a.line, a.thread_id,
                                   a.is_write, a.byte_offset});
      }
    }
    reports.push_back(report);
  }
  return reports;
}

CoherenceState MultiCoreCacheSystem::get_l1_coherence_state(int core,
                                                            uint64_t address) const {
  if (core < 0 || core >= num_cores)
    return CoherenceState::Invalid;
  uint64_t line_addr = get_line_address(address);
  return l1_caches[core]->get_coherence_state(line_addr);
}

bool MultiCoreCacheSystem::is_line_in_l1(int core, uint64_t address) const {
  if (core < 0 || core >= num_cores)
    return false;
  uint64_t line_addr = get_line_address(address);
  return l1_caches[core]->is_present(line_addr);
}

const CacheLevel *MultiCoreCacheSystem::get_l1_cache(int core) const {
  if (core < 0 || core >= num_cores)
    return nullptr;
  return l1_caches[core].get();
}

PrefetchStats MultiCoreCacheSystem::get_prefetch_stats(int core) const {
  if (core < 0 || core >= num_cores)
    return PrefetchStats{};
  return prefetchers[core]->get_stats();
}

void MultiCoreCacheSystem::reset_prefetch_stats() {
  for (auto &pf : prefetchers) {
    pf->reset_stats();
  }
}
