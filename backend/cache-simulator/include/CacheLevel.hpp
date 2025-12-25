#pragma once

#include "../profiles/CacheConfig.hpp"
#include "CacheLine.hpp"
#include "EvictionPolicy.hpp"
#include <stdexcept>
#include <vector>

enum class AccessResult { Hit, Miss, MissWithEviction };

struct AccessInfo {
  AccessResult result;
  bool was_dirty;
  uint64_t evicted_address;
};

struct AddressComponents {
  int offset;
  int index;
  int tag;
};

class CacheLevel {
private:
  CacheConfig config;
  std::vector<std::vector<CacheLine>> sets;
  uint64_t access_time = 0;

  int find_victim(const std::vector<CacheLine>& set) const;
  uint64_t rebuild_address(uint64_t tag, uint64_t index) const;

public:
  CacheLevel() = delete;

  explicit CacheLevel(const CacheConfig &cfg) : config(cfg) {
    if (!config.is_valid()) {
      throw std::invalid_argument("Invalid cache configuration");
    }
    int num_sets = config.num_sets();
    sets.resize(num_sets, std::vector<CacheLine>(config.associativity));
  }

  const CacheConfig &getConfig() const { return config; }

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
};
