#pragma once

#include "../profiles/CacheConfig.hpp"
#include "CacheLine.hpp"
#include "CacheStats.hpp"
#include "EvictionPolicy.hpp"
#include <cstdlib>
#include <stdexcept>
#include <vector>

enum class AccessResult { Hit, Miss, MissWithEviction };

struct AccessInfo {
  AccessResult result;
  bool was_dirty;
  uint64_t evicted_address;
};

class CacheLevel {
private:
  CacheConfig config;
  std::vector<std::vector<CacheLine>> sets;
  std::vector<uint64_t> plru_bits;
  uint64_t access_time = 0;
  CacheStats stats;

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
  }

  const CacheConfig &getConfig() const { return config; }
  const CacheStats &getStats() const { return stats; }
  void resetStats() { stats.reset(); }

  int getNumSets() const { return config.num_sets(); }
  int getAssociativity() const { return config.associativity; }
  int getSizeKB() const { return config.kb_size; }
  int getLineSize() const { return config.line_size; }
  EvictionPolicy getEvictionPolicy() const { return config.policy; }

  AccessInfo access(uint64_t address, bool is_write);
  AccessInfo install(uint64_t address, bool is_dirty = false);
  bool is_present(uint64_t address) const;
  void invalidate(uint64_t address);
  bool is_dirty(uint64_t address) const;
  bool get_line_for_writeback(uint64_t address, bool &was_dirty);
  std::vector<uint64_t> get_all_addresses() const;
  bool probe(uint64_t address) const { return is_present(address); }
};
