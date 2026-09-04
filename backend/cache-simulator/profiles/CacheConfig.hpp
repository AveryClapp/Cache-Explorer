#pragma once

#include <cstdint>
#include <limits>

#include "../include/EvictionPolicy.hpp"
#include "../include/InclusionPolicy.hpp"
#include "../include/WritePolicy.hpp"
using CacheSize = uint64_t;

// Latency configuration for timing simulation (in CPU cycles)
struct LatencyConfig {
  int l1_hit = 4;           // L1 cache hit latency
  int l2_hit = 12;          // L2 cache hit latency
  int l3_hit = 40;          // L3 cache hit latency
  int memory = 200;         // Main memory latency
  int tlb_miss_penalty = 7; // Additional cycles for TLB miss (page walk)

  // Vendor-specific latency presets (realistic values from architecture manuals)
  static LatencyConfig intel_default() {
    // Intel Alder Lake / Golden Cove (12th gen)
    return {
      .l1_hit = 5,          // 5 cycles for L1D
      .l2_hit = 14,         // ~14 cycles for L2
      .l3_hit = 50,         // ~50 cycles for L3
      .memory = 200,        // ~200 cycles for DRAM
      .tlb_miss_penalty = 7 // Page table walk overhead
    };
  }

  static LatencyConfig amd_default() {
    // AMD Zen 4 (Ryzen 7000 series)
    return {
      .l1_hit = 4,          // 4 cycles for L1D
      .l2_hit = 14,         // ~14 cycles for L2
      .l3_hit = 46,         // ~46 cycles for L3
      .memory = 190,        // Slightly better memory controller
      .tlb_miss_penalty = 8 // Page table walk overhead
    };
  }

  static LatencyConfig apple_default() {
    // Apple M1/M2/M3 (performance cores)
    return {
      .l1_hit = 3,          // Very fast L1 (192KB size helps)
      .l2_hit = 15,         // ~15 cycles for shared L2
      .l3_hit = 0,          // M-series has SLC, not traditional L3
      .memory = 100,        // Unified memory is faster than DDR
      .tlb_miss_penalty = 5 // Efficient page tables
    };
  }

  static LatencyConfig educational_default() {
    // Simple round numbers for learning
    return {
      .l1_hit = 1,
      .l2_hit = 10,
      .l3_hit = 30,
      .memory = 100,
      .tlb_miss_penalty = 10
    };
  }

  static LatencyConfig arm_default() {
    // ARM Neoverse V1 / Graviton 3
    return {
      .l1_hit = 4,
      .l2_hit = 11,
      .l3_hit = 38,
      .memory = 150,
      .tlb_miss_penalty = 6
    };
  }
};

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
      .l2_max_distance = 4,            // Conservative: our prefetcher lacks Intel's smart backoff
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
      .l2_max_distance = 4,            // Conservative without smart backoff
      .l3_prefetch = false,            // AMD L3 is victim cache - no prefetch
      .pointer_prefetch = false,
      .dynamic_degree = false
    };
  }

  static PrefetchConfig apple_default() {
    return {
      .l1_stream_prefetch = true,
      .l1_stride_prefetch = true,
      .l1_prefetch_degree = 2,
      .l2_stream_prefetch = true,
      .l2_adjacent_prefetch = false,
      .l2_prefetch_degree = 4,
      .l2_max_streams = 16,
      .l2_max_distance = 4,            // Conservative without smart backoff
      .l3_prefetch = true,
      .pointer_prefetch = true,        // Apple DMP - data-dependent prefetch
      .dynamic_degree = false
    };
  }

  static PrefetchConfig arm_default() {
    // ARM Neoverse V1 (Graviton 3) / Cortex-A series
    // Has L1 Data Prefetcher (DPF) and L2 prefetcher
    return {
      .l1_stream_prefetch = true,
      .l1_stride_prefetch = true,      // ARM has stride detection
      .l1_prefetch_degree = 2,
      .l2_stream_prefetch = true,
      .l2_adjacent_prefetch = false,   // No adjacent line pairing
      .l2_prefetch_degree = 4,
      .l2_max_streams = 8,             // ARM typically fewer streams than Intel
      .l2_max_distance = 4,            // Conservative without smart backoff
      .l3_prefetch = true,             // Neoverse V1 has L3 prefetch
      .pointer_prefetch = false,
      .dynamic_degree = false
    };
  }

  static PrefetchConfig riscv_default() {
    // RISC-V prefetching varies by implementation
    // SiFive cores generally have simpler prefetching than x86
    return {
      .l1_stream_prefetch = true,
      .l1_stride_prefetch = false,     // Most RISC-V implementations lack stride detection
      .l1_prefetch_degree = 1,
      .l2_stream_prefetch = true,
      .l2_adjacent_prefetch = false,
      .l2_prefetch_degree = 2,
      .l2_max_streams = 4,             // RISC-V typically simpler prefetching
      .l2_max_distance = 2,
      .l3_prefetch = false,
      .pointer_prefetch = false,
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
  static constexpr uint64_t max_modeled_lines = 4ULL * 1024 * 1024;
  CacheSize kb_size;
  int associativity;
  int line_size = 64;
  EvictionPolicy policy = EvictionPolicy::LRU;
  WritePolicy write_policy = WritePolicy::Back;

  [[nodiscard]] constexpr bool is_valid() const noexcept {
    if (kb_size == 0 || associativity <= 0 || line_size <= 0) return false;
    if ((line_size & (line_size - 1)) != 0) return false;
    if (kb_size > std::numeric_limits<uint64_t>::max() / 1024) return false;
    const uint64_t bytes = kb_size * 1024;
    const uint64_t denominator = static_cast<uint64_t>(line_size) *
                                 static_cast<uint64_t>(associativity);
    if (denominator == 0 || bytes % denominator != 0) return false;
    const uint64_t sets = bytes / denominator;
    const uint64_t lines = bytes / static_cast<uint64_t>(line_size);
    if (sets == 0 || sets > static_cast<uint64_t>(std::numeric_limits<int>::max())) return false;
    if (lines == 0 || lines > max_modeled_lines) return false;
    if ((sets & (sets - 1)) != 0) return false;
    return true;
  }

  [[nodiscard]] constexpr int num_sets() const noexcept {
    if (kb_size > std::numeric_limits<uint64_t>::max() / 1024 ||
        line_size <= 0 || associativity <= 0)
      return 0;
    const uint64_t bytes = kb_size * 1024;
    const uint64_t lines = bytes / static_cast<uint64_t>(line_size);
    if (lines > max_modeled_lines)
      return 0;
    const uint64_t sets = bytes /
        (static_cast<uint64_t>(line_size) * static_cast<uint64_t>(associativity));
    return sets <= static_cast<uint64_t>(std::numeric_limits<int>::max())
               ? static_cast<int>(sets)
               : 0;
  }
  [[nodiscard]] constexpr int num_lines() const noexcept {
    if (kb_size > std::numeric_limits<uint64_t>::max() / 1024 || line_size <= 0)
      return 0;
    const uint64_t lines = (kb_size * 1024) / static_cast<uint64_t>(line_size);
    return lines <= max_modeled_lines
               ? static_cast<int>(lines)
               : 0;
  }

  [[nodiscard]] constexpr int offset_bits() const noexcept {
    return line_size > 0 ? __builtin_ctz(static_cast<unsigned>(line_size)) : 0;
  }
  [[nodiscard]] constexpr int index_bits() const noexcept {
    const int sets = num_sets();
    return sets > 0 ? __builtin_ctz(static_cast<unsigned>(sets)) : 0;
  }
  [[nodiscard]] constexpr int tag_bits() const noexcept { return 64 - offset_bits() - index_bits(); }

  [[nodiscard]] constexpr uint64_t get_offset(uint64_t addr) const noexcept {
    return addr & ((1ULL << offset_bits()) - 1);
  }
  [[nodiscard]] constexpr uint64_t get_index(uint64_t addr) const noexcept {
    return (addr >> offset_bits()) & ((1ULL << index_bits()) - 1);
  }
  [[nodiscard]] constexpr uint64_t get_tag(uint64_t addr) const noexcept {
    return addr >> (offset_bits() + index_bits());
  }
};

struct CacheHierarchyConfig {
  CacheConfig l1_data;
  CacheConfig l1_inst;
  CacheConfig l2;
  CacheConfig l3;
  InclusionPolicy inclusion_policy;
  PrefetchConfig prefetch = {};   // Default prefetch settings
  LatencyConfig latency = {};     // Default latency settings

  // Execution-core parameters consumed by the analytical pipeline model.
  int issue_width = 4;
  int rob_size = 192;
  int branch_mispredict_penalty = 14;
};
