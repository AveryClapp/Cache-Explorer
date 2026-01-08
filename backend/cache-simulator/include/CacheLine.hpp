#pragma once

#include <cstdint>

#include "CoherenceState.hpp"

struct CacheLine {
  // 8-byte aligned members first
  uint64_t tag = 0;              // 8 bytes
  uint64_t lru_time = 0;         // 8 bytes
  // Pack small members together (4 bytes total + 4 padding)
  CoherenceState coherence_state = CoherenceState::Invalid;  // 4 bytes (enum class)
  uint8_t rrip_value = 3;        // 1 byte
  bool valid = false;            // 1 byte
  bool dirty = false;            // 1 byte
  // 1 byte padding to align to 4
  // Total: 24 bytes

  void reset() {
    tag = 0;
    lru_time = 0;
    coherence_state = CoherenceState::Invalid;
    rrip_value = 3;
    valid = false;
    dirty = false;
  }
};

static_assert(sizeof(CacheLine) <= 24, "CacheLine should be <= 24 bytes");
