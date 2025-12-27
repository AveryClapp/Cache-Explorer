#pragma once

enum class EvictionPolicy {
  LRU,      // Least Recently Used
  PLRU,     // Pseudo-LRU (tree-based)
  RANDOM,   // Random replacement
  SRRIP,    // Static Re-Reference Interval Prediction (Intel L3)
  BRRIP,    // Bimodal RRIP (scan-resistant)
};
