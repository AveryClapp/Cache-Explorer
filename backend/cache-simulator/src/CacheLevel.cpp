#include "../include/CacheLevel.hpp"

int CacheLevel::find_victim_lru(const std::vector<CacheLine> &set) const {
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

int CacheLevel::find_victim_plru(uint64_t set_index) {
  const std::vector<CacheLine> &set = sets[set_index];

  for (int i = 0; i < config.associativity; i++) {
    if (!set[i].valid)
      return i;
  }

  uint64_t bits = plru_bits[set_index];
  int assoc = config.associativity;
  int node = 0;
  int way = 0;

  for (int level = assoc / 2; level >= 1; level /= 2) {
    if (bits & (1ULL << node)) {
      way += level;
      node = 2 * node + 2;
    } else {
      node = 2 * node + 1;
    }
  }

  return way;
}

void CacheLevel::update_replacement_state(uint64_t set_index, int way) {
  if (config.policy != EvictionPolicy::PLRU)
    return;

  uint64_t &bits = plru_bits[set_index];
  int assoc = config.associativity;
  int node = 0;
  int range_start = 0;
  int range_size = assoc;

  while (range_size > 1) {
    int mid = range_start + range_size / 2;
    if (way < mid) {
      bits |= (1ULL << node);
      range_size /= 2;
      node = 2 * node + 1;
    } else {
      bits &= ~(1ULL << node);
      range_start = mid;
      range_size /= 2;
      node = 2 * node + 2;
    }
  }
}

int CacheLevel::find_victim_random(const std::vector<CacheLine> &set) const {
  for (int i = 0; i < config.associativity; i++) {
    if (!set[i].valid)
      return i;
  }
  return std::rand() % config.associativity;
}

// Static RRIP: Insert with RRPV=2 (long re-reference), hit sets RRPV=0
// Evict line with RRPV=3, increment all if none found
int CacheLevel::find_victim_srrip(std::vector<CacheLine> &set) {
  // First check for invalid lines
  for (int i = 0; i < config.associativity; i++) {
    if (!set[i].valid)
      return i;
  }

  // Find line with RRPV=3 (distant re-reference)
  while (true) {
    for (int i = 0; i < config.associativity; i++) {
      if (set[i].rrip_value >= 3)
        return i;
    }
    // No line with max RRPV, increment all
    for (int i = 0; i < config.associativity; i++) {
      if (set[i].rrip_value < 3)
        set[i].rrip_value++;
    }
  }
}

// Bimodal RRIP: Most inserts with RRPV=3 (distant), occasional RRPV=2
// Better for scan-resistant behavior
int CacheLevel::find_victim_brrip(std::vector<CacheLine> &set) {
  // First check for invalid lines
  for (int i = 0; i < config.associativity; i++) {
    if (!set[i].valid)
      return i;
  }

  // Same eviction as SRRIP
  while (true) {
    for (int i = 0; i < config.associativity; i++) {
      if (set[i].rrip_value >= 3)
        return i;
    }
    for (int i = 0; i < config.associativity; i++) {
      if (set[i].rrip_value < 3)
        set[i].rrip_value++;
    }
  }
}

int CacheLevel::find_victim(uint64_t set_index) {
  std::vector<CacheLine> &set = sets[set_index];

  switch (config.policy) {
  case EvictionPolicy::LRU:
    return find_victim_lru(set);
  case EvictionPolicy::PLRU:
    return find_victim_plru(set_index);
  case EvictionPolicy::RANDOM:
    return find_victim_random(set);
  case EvictionPolicy::SRRIP:
    return find_victim_srrip(set);
  case EvictionPolicy::BRRIP:
    return find_victim_brrip(set);
  default:
    return find_victim_lru(set);
  }
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
      // RRIP: promote to near-immediate on hit
      if (config.policy == EvictionPolicy::SRRIP || config.policy == EvictionPolicy::BRRIP) {
        set[way].rrip_value = 0;
      }
      update_replacement_state(index, way);
      if (is_write)
        set[way].dirty = true;
      stats.hits++;
      return {AccessResult::Hit, false, 0};
    }
  }

  stats.misses++;
  int victim = find_victim(index);
  bool was_dirty = set[victim].valid && set[victim].dirty;
  uint64_t evicted_addr =
      was_dirty ? rebuild_address(set[victim].tag, index) : 0;

  if (was_dirty)
    stats.writebacks++;

  set[victim].tag = tag;
  set[victim].valid = true;
  set[victim].dirty = is_write;
  set[victim].lru_time = access_time;
  // RRIP: insert with long re-reference prediction
  if (config.policy == EvictionPolicy::SRRIP) {
    set[victim].rrip_value = 2;  // SRRIP inserts at 2
  } else if (config.policy == EvictionPolicy::BRRIP) {
    // BRRIP: mostly insert at 3, occasionally at 2 (1/32 chance)
    set[victim].rrip_value = (std::rand() % 32 == 0) ? 2 : 3;
  }
  update_replacement_state(index, victim);

  AccessResult result =
      was_dirty ? AccessResult::MissWithEviction : AccessResult::Miss;
  return {result, was_dirty, evicted_addr};
}

AccessInfo CacheLevel::install(uint64_t address, bool is_dirty) {
  uint64_t tag = config.get_tag(address);
  uint64_t index = config.get_index(address);
  std::vector<CacheLine> &set = sets[index];

  access_time++;

  for (int way = 0; way < config.associativity; way++) {
    if (set[way].valid && set[way].tag == tag) {
      set[way].lru_time = access_time;
      set[way].dirty |= is_dirty;
      // RRIP: promote to near-immediate on hit
      if (config.policy == EvictionPolicy::SRRIP || config.policy == EvictionPolicy::BRRIP) {
        set[way].rrip_value = 0;
      }
      update_replacement_state(index, way);
      return {AccessResult::Hit, false, 0};
    }
  }

  int victim = find_victim(index);
  bool was_dirty = set[victim].valid && set[victim].dirty;
  uint64_t evicted_addr =
      was_dirty ? rebuild_address(set[victim].tag, index) : 0;

  if (was_dirty)
    stats.writebacks++;

  set[victim].tag = tag;
  set[victim].valid = true;
  set[victim].dirty = is_dirty;
  set[victim].lru_time = access_time;
  // RRIP: insert with long re-reference prediction
  if (config.policy == EvictionPolicy::SRRIP) {
    set[victim].rrip_value = 2;  // SRRIP inserts at 2
  } else if (config.policy == EvictionPolicy::BRRIP) {
    // BRRIP: mostly insert at 3, occasionally at 2 (1/32 chance)
    set[victim].rrip_value = (std::rand() % 32 == 0) ? 2 : 3;
  }
  update_replacement_state(index, victim);

  AccessResult result =
      was_dirty ? AccessResult::MissWithEviction : AccessResult::Miss;
  return {result, was_dirty, evicted_addr};
}

bool CacheLevel::is_present(uint64_t address) const {
  uint64_t tag = config.get_tag(address);
  uint64_t index = config.get_index(address);
  const std::vector<CacheLine> &set = sets[index];

  for (int way = 0; way < config.associativity; way++) {
    if (set[way].valid && set[way].tag == tag)
      return true;
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
      stats.invalidations++;
      return;
    }
  }
}

bool CacheLevel::is_dirty(uint64_t address) const {
  uint64_t tag = config.get_tag(address);
  uint64_t index = config.get_index(address);
  const std::vector<CacheLine> &set = sets[index];

  for (int way = 0; way < config.associativity; way++) {
    if (set[way].valid && set[way].tag == tag)
      return set[way].dirty;
  }
  return false;
}

bool CacheLevel::get_line_for_writeback(uint64_t address, bool &was_dirty) {
  uint64_t tag = config.get_tag(address);
  uint64_t index = config.get_index(address);
  std::vector<CacheLine> &set = sets[index];

  for (int way = 0; way < config.associativity; way++) {
    if (set[way].valid && set[way].tag == tag) {
      was_dirty = set[way].dirty;
      set[way].dirty = false;
      return true;
    }
  }
  was_dirty = false;
  return false;
}

std::vector<uint64_t> CacheLevel::get_all_addresses() const {
  std::vector<uint64_t> addresses;
  for (uint64_t index = 0; index < sets.size(); index++) {
    for (int way = 0; way < config.associativity; way++) {
      if (sets[index][way].valid)
        addresses.push_back(rebuild_address(sets[index][way].tag, index));
    }
  }
  return addresses;
}
