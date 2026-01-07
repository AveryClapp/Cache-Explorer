#pragma once

#include <cstdint>

#include "CoherenceState.hpp"

struct CacheLine {
  uint64_t tag = 0;
  bool valid = false;
  bool dirty = false;
  uint64_t lru_time = 0;
  uint8_t rrip_value = 3;
  CoherenceState coherence_state = CoherenceState::Invalid;

  void reset() {
    tag = 0;
    valid = false;
    dirty = false;
    lru_time = 0;
    rrip_value = 3;
    coherence_state = CoherenceState::Invalid;
  }
};
