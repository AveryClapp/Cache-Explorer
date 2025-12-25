#pragma once

#include "../profiles/CacheConfig.hpp"
#include "CacheLevel.hpp"
#include "CacheStats.hpp"
#include "CoherenceController.hpp"
#include <memory>
#include <unordered_map>
#include <unordered_set>
#include <vector>

struct FalseSharingEvent {
  uint64_t cache_line_addr;
  std::string file;
  uint32_t line;
  uint32_t thread_id;
  bool is_write;
  uint32_t byte_offset;
};

struct FalseSharingReport {
  uint64_t cache_line_addr;
  std::vector<FalseSharingEvent> accesses;
  uint32_t invalidation_count = 0;
};

struct MultiCoreStats {
  std::vector<CacheStats> l1_per_core;
  CacheStats l2;
  CacheStats l3;
  uint64_t coherence_invalidations = 0;
  uint64_t false_sharing_events = 0;
};

struct MultiCoreAccessResult {
  bool l1_hit;
  bool l2_hit;
  bool l3_hit;
  bool memory_access;
};

class MultiCoreCacheSystem {
private:
  int num_cores;
  std::vector<std::unique_ptr<CacheLevel>> l1_caches;
  CacheLevel l2;
  CacheLevel l3;
  CoherenceController coherence;

  std::unordered_map<uint32_t, int> thread_to_core;
  int next_core = 0;

  struct LineAccess {
    uint32_t thread_id;
    uint32_t byte_offset;
    bool is_write;
    std::string file;
    uint32_t line;
  };
  std::unordered_map<uint64_t, std::vector<LineAccess>> line_accesses;
  std::unordered_set<uint64_t> false_sharing_lines;

  uint64_t coherence_invalidations = 0;
  uint64_t false_sharing_count = 0;
  uint32_t line_size;

  int get_core_for_thread(uint32_t thread_id) {
    auto it = thread_to_core.find(thread_id);
    if (it != thread_to_core.end()) {
      return it->second;
    }
    int core = next_core % num_cores;
    thread_to_core[thread_id] = core;
    next_core++;
    return core;
  }

  uint64_t get_line_address(uint64_t addr) const {
    return addr & ~(static_cast<uint64_t>(line_size) - 1);
  }

  void track_access_for_false_sharing(uint64_t addr, uint32_t thread_id,
                                       bool is_write, const std::string &file,
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
      if (a.is_write) has_write = true;
    }

    if (threads_seen.size() > 1 && offsets_seen.size() > 1 && has_write) {
      if (false_sharing_lines.insert(line_addr).second) {
        false_sharing_count++;
      }
    }
  }

public:
  MultiCoreCacheSystem(int cores, const CacheConfig &l1_cfg,
                       const CacheConfig &l2_cfg,
                       const CacheConfig &l3_cfg)
      : num_cores(cores), l2(l2_cfg), l3(l3_cfg), coherence(cores),
        line_size(l1_cfg.line_size) {
    for (int i = 0; i < cores; i++) {
      l1_caches.push_back(std::make_unique<CacheLevel>(l1_cfg));
      coherence.register_cache(i, l1_caches[i].get());
    }
  }

  MultiCoreAccessResult read(uint64_t address, uint32_t thread_id,
                              const std::string &file = "", uint32_t line = 0) {
    int core = get_core_for_thread(thread_id);
    track_access_for_false_sharing(address, thread_id, false, file, line);

    uint64_t line_addr = get_line_address(address);

    auto l1_info = l1_caches[core]->access(line_addr, false);
    if (l1_info.result == AccessResult::Hit) {
      return {true, false, false, false};
    }

    auto snoop = coherence.request_read(core, line_addr);
    if (snoop.was_modified) {
      coherence_invalidations++;
    }

    auto l2_info = l2.access(line_addr, false);
    if (l2_info.result == AccessResult::Hit) {
      l1_caches[core]->install(line_addr, false);
      return {false, true, false, false};
    }

    auto l3_info = l3.access(line_addr, false);
    l2.install(line_addr, false);
    l1_caches[core]->install(line_addr, false);

    bool l3_hit = (l3_info.result == AccessResult::Hit);
    return {false, false, l3_hit, !l3_hit};
  }

  MultiCoreAccessResult write(uint64_t address, uint32_t thread_id,
                               const std::string &file = "", uint32_t line = 0) {
    int core = get_core_for_thread(thread_id);
    track_access_for_false_sharing(address, thread_id, true, file, line);

    uint64_t line_addr = get_line_address(address);

    auto snoop = coherence.request_exclusive(core, line_addr);
    if (snoop.found) {
      coherence_invalidations++;
    }

    auto l1_info = l1_caches[core]->access(line_addr, true);
    if (l1_info.result == AccessResult::Hit) {
      return {true, false, false, false};
    }

    auto l2_info = l2.access(line_addr, false);
    if (l2_info.result == AccessResult::Hit) {
      l1_caches[core]->install(line_addr, true);
      return {false, true, false, false};
    }

    auto l3_info = l3.access(line_addr, false);
    l2.install(line_addr, false);
    l1_caches[core]->install(line_addr, true);

    bool l3_hit = (l3_info.result == AccessResult::Hit);
    return {false, false, l3_hit, !l3_hit};
  }

  MultiCoreStats get_stats() const {
    MultiCoreStats stats;
    for (const auto &l1 : l1_caches) {
      stats.l1_per_core.push_back(l1->getStats());
    }
    stats.l2 = l2.getStats();
    stats.l3 = l3.getStats();
    stats.coherence_invalidations = coherence_invalidations;
    stats.false_sharing_events = false_sharing_count;
    return stats;
  }

  std::vector<FalseSharingReport> get_false_sharing_reports() const {
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

  int get_num_cores() const { return num_cores; }
  uint32_t get_line_size() const { return line_size; }
};
