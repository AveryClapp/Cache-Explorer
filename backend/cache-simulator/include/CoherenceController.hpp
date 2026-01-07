#pragma once

#include <cstdint>
#include <unordered_map>
#include <vector>

#include "CacheLevel.hpp"
#include "CoherenceState.hpp"

struct SnoopResult {
  bool found;
  bool was_modified;
  uint64_t data_source_core;
};

struct CoherenceEvent {
  enum Type { BusRead, BusReadX, BusUpgrade, Invalidate, Writeback };
  Type type;
  uint64_t address;
  int source_core;
};

class CoherenceController {
private:
  int num_cores;
  std::vector<CacheLevel *> l1_caches;

  // Directory: tracks which cores have each line
  std::unordered_map<uint64_t, std::vector<int>> sharers;
  std::unordered_map<uint64_t, int> owner;

public:
  explicit CoherenceController(int cores);

  void register_cache(int core_id, CacheLevel *cache);

  // Called when a core wants to read
  SnoopResult request_read(int requesting_core, uint64_t address);

  // Called when a core wants exclusive access (write)
  SnoopResult request_exclusive(int requesting_core, uint64_t address);

  // Detect false sharing: different cores accessing different bytes in same
  // line
  [[nodiscard]] bool detect_false_sharing(uint64_t address, int line_size);

  void evict_line(int core_id, uint64_t address);

  [[nodiscard]] int get_sharer_count(uint64_t address) const;
};
