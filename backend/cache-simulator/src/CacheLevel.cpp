#include "../include/CacheLevel.hpp"

int CacheLevel::find_victim(const std::vector<CacheLine> &set) const {
  for (int i = 0; i < config.associativity; i++) {
    if (!set[i].valid)
      return i;
  }

  int victim = 0;
  uint64_t oldest = set[0].lru_time;
  for (int i = 1; i < config.associativity; i++) {
    if (set[i].lru_time < oldest) {
      oldest = set[i].lru_time;
      victim = i;
    }
  }
  return victim;
}

uint64_t CacheLevel::rebuild_address(uint64_t tag, uint64_t index) const {
  return (tag << (config.offset_bits() + config.index_bits())) |
         (index << config.offset_bits());
}

AccessInfo CacheLevel::access(uint64_t address, bool is_write) {
  uint64_t tag = config.get_tag(address);
  uint64_t index = config.get_index(address);
  std::vector<CacheLine> &set = sets[index];

  access_time++;

  for (int way = 0; way < config.associativity; way++) {
    if (set[way].valid && set[way].tag == tag) {
      set[way].lru_time = access_time;
      if (is_write)
        set[way].dirty = true;
      return {AccessResult::Hit, false, 0};
    }
  }

  int victim = find_victim(set);
  bool was_dirty = set[victim].valid && set[victim].dirty;
  uint64_t evicted_addr =
      was_dirty ? rebuild_address(set[victim].tag, index) : 0;

  set[victim].tag = tag;
  set[victim].valid = true;
  set[victim].dirty = is_write;
  set[victim].lru_time = access_time;

  AccessResult result =
      was_dirty ? AccessResult::MissWithEviction : AccessResult::Miss;
  return {result, was_dirty, evicted_addr};
}

void CacheLevel::install(uint64_t address, bool is_dirty) {
  uint64_t tag = config.get_tag(address);
  uint64_t index = config.get_index(address);
  std::vector<CacheLine> &set = sets[index];

  access_time++;

  for (int way = 0; way < config.associativity; way++) {
    if (set[way].valid && set[way].tag == tag) {
      set[way].lru_time = access_time;
      set[way].dirty |= is_dirty;
      return;
    }
  }

  int victim = find_victim(set);
  set[victim].tag = tag;
  set[victim].valid = true;
  set[victim].dirty = is_dirty;
  set[victim].lru_time = access_time;
}

bool CacheLevel::is_present(uint64_t address) const {
  uint64_t tag = config.get_tag(address);
  uint64_t index = config.get_index(address);
  const std::vector<CacheLine> &set = sets[index];

  for (int way = 0; way < config.associativity; way++) {
    if (set[way].valid && set[way].tag == tag) {
      return true;
    }
  }
  return false;
}

void CacheLevel::invalidate(uint64_t address) {
  uint64_t tag = config.get_tag(address);
  uint64_t index = config.get_index(address);
  std::vector<CacheLine> &set = sets[index];

  for (int way = 0; way < config.associativity; way++) {
    if (set[way].valid && set[way].tag == tag) {
      set[way].valid = false;
      set[way].dirty = false;
      return;
    }
  }
}

bool CacheLevel::is_dirty(uint64_t address) const {
  uint64_t tag = config.get_tag(address);
  uint64_t index = config.get_index(address);
  const std::vector<CacheLine> &set = sets[index];

  for (int way = 0; way < config.associativity; way++) {
    if (set[way].valid && set[way].tag == tag) {
      return set[way].dirty;
    }
  }
  return false;
}
