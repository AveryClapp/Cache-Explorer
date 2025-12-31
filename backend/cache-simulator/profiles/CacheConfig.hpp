#pragma once

#include "../include/EvictionPolicy.hpp"
#include "../include/InclusionPolicy.hpp"
#include "../include/WritePolicy.hpp"

#include <cstdint>
using CacheSize = uint64_t;

// Prefetch configuration tied to hardware characteristics
struct PrefetchConfig {
  // L1 prefetcher settings
  bool l1_stream_prefetch = true;      // DCU streamer (Intel) / L1 stream (AMD)
  bool l1_stride_prefetch = true;      // IP prefetcher (Intel) / L1 stride (AMD)
  int l1_prefetch_degree = 2;          // Lines to prefetch at L1

  // L2 prefetcher settings
  bool l2_stream_prefetch = true;      // L2 streamer
  bool l2_adjacent_prefetch = false;   // Adjacent line prefetcher (Intel-specific)
  int l2_prefetch_degree = 4;          // Lines to prefetch at L2
  int l2_max_streams = 16;             // Max concurrent streams tracked
  int l2_max_distance = 20;            // How far ahead L2 can prefetch

  // L3 prefetcher settings
  bool l3_prefetch = true;             // Whether L3 generates prefetches (false for AMD)

  // Advanced features
  bool pointer_prefetch = false;       // Data-dependent prefetch (Apple DMP)
  bool dynamic_degree = false;         // Adjust degree based on bandwidth

  // Vendor presets
  static PrefetchConfig intel_default() {
    return {
      .l1_stream_prefetch = true,
      .l1_stride_prefetch = true,
      .l1_prefetch_degree = 2,
      .l2_stream_prefetch = true,
      .l2_adjacent_prefetch = true,    // Intel pairs cache lines to 128B
      .l2_prefetch_degree = 4,
      .l2_max_streams = 32,            // Intel tracks up to 32 streams
      .l2_max_distance = 20,           // Intel prefetches up to 20 lines ahead
      .l3_prefetch = true,
      .pointer_prefetch = false,
      .dynamic_degree = true           // Intel adjusts based on outstanding requests
    };
  }

  static PrefetchConfig amd_default() {
    return {
      .l1_stream_prefetch = true,
      .l1_stride_prefetch = true,
      .l1_prefetch_degree = 2,
      .l2_stream_prefetch = true,
      .l2_adjacent_prefetch = false,   // AMD doesn't pair lines
      .l2_prefetch_degree = 4,
      .l2_max_streams = 16,
      .l2_max_distance = 12,
      .l3_prefetch = false,            // AMD L3 is victim cache - no prefetch
      .pointer_prefetch = false,
      .dynamic_degree = false
    };
  }

  static PrefetchConfig apple_default() {
    return {
      .l1_stream_prefetch = true,
      .l1_stride_prefetch = true,
      .l1_prefetch_degree = 4,
      .l2_stream_prefetch = true,
      .l2_adjacent_prefetch = false,
      .l2_prefetch_degree = 8,
      .l2_max_streams = 16,
      .l2_max_distance = 16,
      .l3_prefetch = true,
      .pointer_prefetch = true,        // Apple DMP - data-dependent prefetch
      .dynamic_degree = false
    };
  }

  static PrefetchConfig none() {
    return {
      .l1_stream_prefetch = false,
      .l1_stride_prefetch = false,
      .l1_prefetch_degree = 0,
      .l2_stream_prefetch = false,
      .l2_adjacent_prefetch = false,
      .l2_prefetch_degree = 0,
      .l2_max_streams = 0,
      .l2_max_distance = 0,
      .l3_prefetch = false,
      .pointer_prefetch = false,
      .dynamic_degree = false
    };
  }
};

struct CacheConfig {
  CacheSize kb_size;
  int associativity;
  int line_size = 64;
  EvictionPolicy policy = EvictionPolicy::LRU;
  WritePolicy write_policy = WritePolicy::Back;

  bool is_valid() const {
    if (kb_size == 0 || associativity <= 0 || line_size <= 0) return false;
    if ((line_size & (line_size - 1)) != 0) return false;
    if (num_sets() <= 0) return false;
    if ((num_sets() & (num_sets() - 1)) != 0) return false;
    return true;
  }

  int num_sets() const {
    return (kb_size * 1024) / (line_size * associativity);
  }
  int num_lines() const { return (kb_size * 1024) / line_size; }

  int offset_bits() const { return __builtin_ctz(line_size); }
  int index_bits() const { return __builtin_ctz(num_sets()); }
  int tag_bits() const { return 64 - offset_bits() - index_bits(); }

  uint64_t get_offset(uint64_t addr) const {
    return addr & ((1ULL << offset_bits()) - 1);
  }
  uint64_t get_index(uint64_t addr) const {
    return (addr >> offset_bits()) & ((1ULL << index_bits()) - 1);
  }
  uint64_t get_tag(uint64_t addr) const {
    return addr >> (offset_bits() + index_bits());
  }
};

struct CacheHierarchyConfig {
  CacheConfig l1_data;
  CacheConfig l1_inst;
  CacheConfig l2;
  CacheConfig l3;
  InclusionPolicy inclusion_policy;
  PrefetchConfig prefetch = {};  // Default prefetch settings
};
