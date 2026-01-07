#pragma once

#include "../profiles/CacheConfig.hpp"
#include "CacheLine.hpp"
#include "CacheStats.hpp"
#include "EvictionPolicy.hpp"
#include <cstdlib>
#include <stdexcept>
#include <unordered_set>
#include <vector>

enum class AccessResult { Hit, Miss, MissWithEviction };

struct AccessInfo {
  AccessResult result;
  bool was_dirty;
  uint64_t evicted_address;
  bool had_eviction;  // True if a valid line was evicted (for inclusive cache back-invalidation)
};

class CacheLevel {
private:
  CacheConfig config;
  std::vector<std::vector<CacheLine>> sets;
  std::vector<uint64_t> plru_bits;
  uint64_t access_time = 0;
  CacheStats stats;

  // For 3C miss classification
  std::unordered_set<uint64_t> ever_accessed;  // Track compulsory misses
  uint64_t unique_lines_accessed = 0;          // For capacity estimation
  std::vector<uint64_t> set_unique_lines;      // Track unique lines per set for conflict detection

  int find_victim_lru(const std::vector<CacheLine> &set) const;
  int find_victim_plru(uint64_t set_index);
  int find_victim_random(const std::vector<CacheLine> &set) const;
  int find_victim_srrip(std::vector<CacheLine> &set);
  int find_victim_brrip(std::vector<CacheLine> &set);
  int find_victim(uint64_t set_index);

  void update_replacement_state(uint64_t set_index, int way);
  uint64_t rebuild_address(uint64_t tag, uint64_t index) const;

public:
  CacheLevel() = delete;

  explicit CacheLevel(const CacheConfig &cfg) : config(cfg) {
    if (!config.is_valid()) {
      throw std::invalid_argument("Invalid cache configuration");
    }
    int num_sets = config.num_sets();
    sets.resize(num_sets, std::vector<CacheLine>(config.associativity));
    plru_bits.resize(num_sets, 0);
    set_unique_lines.resize(num_sets, 0);
  }

  [[nodiscard]] const CacheConfig &get_config() const { return config; }
  [[nodiscard]] const CacheStats &get_stats() const { return stats; }
  void reset_stats() {
    stats.reset();
    ever_accessed.clear();
    unique_lines_accessed = 0;
    std::fill(set_unique_lines.begin(), set_unique_lines.end(), 0);
  }

  [[nodiscard]] int get_num_sets() const { return config.num_sets(); }
  [[nodiscard]] int get_associativity() const { return config.associativity; }
  [[nodiscard]] int get_size_kb() const { return config.kb_size; }
  [[nodiscard]] int get_line_size() const { return config.line_size; }
  [[nodiscard]] EvictionPolicy get_eviction_policy() const { return config.policy; }

  AccessInfo access(uint64_t address, bool is_write);
  AccessInfo install(uint64_t address, bool is_dirty = false);
  AccessInfo install_with_state(uint64_t address, CoherenceState state);
  bool is_present(uint64_t address) const;
  void invalidate(uint64_t address);
  bool is_dirty(uint64_t address) const;
  bool get_line_for_writeback(uint64_t address, bool &was_dirty);
  std::vector<uint64_t> get_all_addresses() const;
  [[nodiscard]] bool probe(uint64_t address) const { return is_present(address); }

  // Get full cache state for visualization
  [[nodiscard]] const std::vector<std::vector<CacheLine>>& get_sets() const { return sets; }

  // MESI coherence state management
  [[nodiscard]] CoherenceState get_coherence_state(uint64_t address) const;
  void set_coherence_state(uint64_t address, CoherenceState state);
  bool upgrade_to_modified(uint64_t address);  // Returns true if upgrade was needed
  void downgrade_to_shared(uint64_t address);
};
