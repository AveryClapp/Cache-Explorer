#pragma once
#include "CacheConfig.hpp"

inline CacheHierarchyConfig make_intel_12th_gen_config() {
  return {
      .l1_data = {.kb_size = 32,
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 32,
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 1024,
             .associativity = 8,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 32768,
             .associativity = 16,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::NINE,
      .prefetch = PrefetchConfig::intel_default(),
      .latency = LatencyConfig::intel_default()};
}

inline CacheHierarchyConfig make_amd_zen4_config() {
  return {
      .l1_data = {.kb_size = 32,
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 32,
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 1024,
             .associativity = 8,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 32768,
             .associativity = 16,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::Exclusive,
      .prefetch = PrefetchConfig::amd_default(),
      .latency = LatencyConfig::amd_default()};
}

inline CacheHierarchyConfig make_apple_m_series_config() {
  return {
      .l1_data = {.kb_size = 64,
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 128,
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 4096,
             .associativity = 16,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 32768,
             .associativity = 16,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::NINE,
      .prefetch = PrefetchConfig::apple_default(),
      .latency = LatencyConfig::apple_default()};
}

// Intel 14th Gen (Raptor Lake Refresh) - P-cores
inline CacheHierarchyConfig make_intel_14th_gen_config() {
  return {
      .l1_data = {.kb_size = 48,        // 48KB L1D per P-core
                  .associativity = 12,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 32,
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 2048,           // 2MB L2 per P-core
             .associativity = 16,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 36864,          // 36MB shared L3
             .associativity = 18,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::NINE,
      .prefetch = PrefetchConfig::intel_default()};
}

// AMD Zen 3 (Ryzen 5000 series)
inline CacheHierarchyConfig make_amd_zen3_config() {
  return {
      .l1_data = {.kb_size = 32,
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 32,
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 512,            // 512KB L2 per core
             .associativity = 8,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 32768,          // 32MB shared L3 (per CCX)
             .associativity = 16,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::Exclusive,
      .prefetch = PrefetchConfig::amd_default()};  // Zen uses victim cache
}

// AWS Graviton 3 (ARM Neoverse V1)
inline CacheHierarchyConfig make_aws_graviton3_config() {
  return {
      .l1_data = {.kb_size = 64,
                  .associativity = 4,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 64,
                  .associativity = 4,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 1024,           // 1MB L2 per core
             .associativity = 8,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 32768,          // 32MB shared L3
             .associativity = 16,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::NINE,
      .prefetch = PrefetchConfig::arm_default()};
}

// Apple M2 Pro/Max
inline CacheHierarchyConfig make_apple_m2_config() {
  return {
      .l1_data = {.kb_size = 128,       // 128KB L1D (P-cores)
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 192,       // 192KB L1I (P-cores)
                  .associativity = 6,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 16384,          // 16MB shared L2 (P-core cluster)
             .associativity = 16,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 24576,          // 24MB SLC (System Level Cache)
             .associativity = 12,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::NINE,
      .prefetch = PrefetchConfig::apple_default()};
}

// Embedded/IoT (typical Cortex-A53)
inline CacheHierarchyConfig make_embedded_config() {
  return {
      .l1_data = {.kb_size = 32,
                  .associativity = 4,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 32,
                  .associativity = 2,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 512,
             .associativity = 8,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 0,              // No L3
             .associativity = 1,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::Inclusive,
      .prefetch = PrefetchConfig::none()};  // Simple embedded, minimal prefetch
}

// Intel Xeon Scalable (Ice Lake Server)
inline CacheHierarchyConfig make_intel_xeon_config() {
  return {
      .l1_data = {.kb_size = 48,
                  .associativity = 12,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 32,
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 1280,          // 1.25MB L2 per core
             .associativity = 20,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 49152,         // 48MB shared L3
             .associativity = 12,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::NINE,
      .prefetch = PrefetchConfig::intel_default()};
}

// Intel Xeon Platinum 8488C (Sapphire Rapids) - AWS c7i instance
// Based on /sys/devices/system/cpu/cpu0/cache/
// Note: L3 adjusted for power-of-2 sets (simulator requirement)
// Real: 105MB/15-way (114688 sets) → Sim: 96MB/12-way (131072 sets)
inline CacheHierarchyConfig make_xeon_8488c_config() {
  return {
      .l1_data = {.kb_size = 48,       // 48KB L1D per core (64 sets)
                  .associativity = 12,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 32,       // 32KB L1I per core (64 sets)
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 2048,          // 2MB L2 per core (2048 sets)
             .associativity = 16,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 98304,         // 96MB shared L3 (131072 sets)
             .associativity = 12,      // Adjusted from 15 for power-of-2 sets
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::NINE,
      .prefetch = PrefetchConfig::intel_default()};
}

// AMD EPYC (Milan/Genoa)
inline CacheHierarchyConfig make_amd_epyc_config() {
  return {
      .l1_data = {.kb_size = 32,
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 32,
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 512,
             .associativity = 8,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 262144,        // 256MB shared L3 (full socket)
             .associativity = 16,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::Exclusive,
      .prefetch = PrefetchConfig::amd_default()};
}

// Raspberry Pi 4 (Cortex-A72)
inline CacheHierarchyConfig make_raspberry_pi4_config() {
  return {
      .l1_data = {.kb_size = 32,
                  .associativity = 2,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 48,
                  .associativity = 3,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 1024,          // 1MB shared L2
             .associativity = 16,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 0,             // No L3
             .associativity = 1,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::Inclusive,
      .prefetch = PrefetchConfig::arm_default()};
}

// Apple M3 Pro/Max (latest)
inline CacheHierarchyConfig make_apple_m3_config() {
  return {
      .l1_data = {.kb_size = 128,      // 128KB L1D (P-cores)
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 192,      // 192KB L1I (P-cores)
                  .associativity = 6,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 32768,         // 32MB shared L2 (P-core cluster)
             .associativity = 16,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 32768,         // 32MB SLC
             .associativity = 16,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::NINE,
      .prefetch = PrefetchConfig::apple_default()};
}

inline CacheHierarchyConfig make_educational_config() {
  return {
      .l1_data = {.kb_size = 1,
                  .associativity = 2,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 1,
                  .associativity = 2,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 4,
             .associativity = 4,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 16,
             .associativity = 8,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::Inclusive,
      .prefetch = PrefetchConfig::none(),  // Educational: no prefetch for clarity
      .latency = LatencyConfig::educational_default()};
}

// =============================================================================
// RISC-V Presets
// =============================================================================

// SiFive U74 (Application core in HiFive Unmatched, typical RISC-V application core)
// Reference: SiFive U74 Core Complex Manual
inline CacheHierarchyConfig make_sifive_u74_config() {
  return {
      .l1_data = {.kb_size = 32,        // 32KB L1D per core
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 32,        // 32KB L1I per core
                  .associativity = 4,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 2048,           // 2MB shared L2 (coherent)
             .associativity = 16,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 0,              // No L3 on U74
             .associativity = 1,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::Inclusive,
      .prefetch = PrefetchConfig::riscv_default()};
}

// SiFive P670 (High-performance RISC-V application processor)
// Reference: SiFive Performance P670 Core Complex Manual
inline CacheHierarchyConfig make_sifive_p670_config() {
  return {
      .l1_data = {.kb_size = 32,        // 32KB L1D per core
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 32,        // 32KB L1I per core
                  .associativity = 4,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 256,            // 256KB private L2 per core
             .associativity = 8,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 8192,           // 8MB shared L3 (cluster cache)
             .associativity = 16,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::NINE,
      .prefetch = PrefetchConfig::riscv_default()};
}

// =============================================================================
// Additional Intel Generations
// =============================================================================

// Intel 10th Gen (Ice Lake client) - 10nm, first client Sunny Cove
// Reference: Intel Optimization Manual, wikichip.org
inline CacheHierarchyConfig make_intel_10th_gen_config() {
  return {
      .l1_data = {.kb_size = 48,        // 48KB L1D per core (12-way)
                  .associativity = 12,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 32,        // 32KB L1I per core
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 512,            // 512KB L2 per core
             .associativity = 8,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 8192,           // 8MB shared L3 (varies by SKU)
             .associativity = 16,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::NINE,
      .prefetch = PrefetchConfig::intel_default()};
}

// Intel 11th Gen (Tiger Lake) - 10nm SuperFin, Willow Cove
// Reference: Intel Optimization Manual, wikichip.org
inline CacheHierarchyConfig make_intel_11th_gen_config() {
  return {
      .l1_data = {.kb_size = 48,        // 48KB L1D per core
                  .associativity = 12,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 32,        // 32KB L1I per core
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 1280,           // 1.25MB L2 per core (major bump from Ice Lake)
             .associativity = 20,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 12288,          // 12MB shared L3 (varies by SKU)
             .associativity = 12,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::NINE,
      .prefetch = PrefetchConfig::intel_default()};
}

// Intel 13th Gen (Raptor Lake) - P-cores (Golden Cove based)
// Reference: Intel Optimization Manual, wikichip.org
inline CacheHierarchyConfig make_intel_13th_gen_config() {
  return {
      .l1_data = {.kb_size = 48,        // 48KB L1D per P-core
                  .associativity = 12,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 32,        // 32KB L1I per P-core
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::PLRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 2048,           // 2MB L2 per P-core
             .associativity = 16,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 36864,          // 36MB shared L3 (i9-13900K)
             .associativity = 18,
             .line_size = 64,
             .policy = EvictionPolicy::PLRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::NINE,
      .prefetch = PrefetchConfig::intel_default()};
}

// =============================================================================
// Additional AMD Presets
// =============================================================================

// AMD Zen 2 (Ryzen 3000 series, Matisse)
// Reference: AMD Software Optimization Guide, wikichip.org
inline CacheHierarchyConfig make_amd_zen2_config() {
  return {
      .l1_data = {.kb_size = 32,        // 32KB L1D per core (8-way)
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 32,        // 32KB L1I per core
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 512,            // 512KB L2 per core
             .associativity = 8,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 16384,          // 16MB L3 per CCX (32MB per CCD)
             .associativity = 16,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::Exclusive,  // AMD victim cache design
      .prefetch = PrefetchConfig::amd_default()};
}

// =============================================================================
// Server Variants
// =============================================================================

// AMD EPYC Genoa (Zen 4 server, 4th Gen EPYC)
// Reference: AMD EPYC 9004 Series Processor Architecture, wikichip.org
inline CacheHierarchyConfig make_amd_epyc_genoa_config() {
  return {
      .l1_data = {.kb_size = 32,        // 32KB L1D per core
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::Back},
      .l1_inst = {.kb_size = 32,        // 32KB L1I per core
                  .associativity = 8,
                  .line_size = 64,
                  .policy = EvictionPolicy::LRU,
                  .write_policy = WritePolicy::ReadOnly},
      .l2 = {.kb_size = 1024,           // 1MB L2 per core (doubled from Milan)
             .associativity = 8,
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .l3 = {.kb_size = 98304,          // 96MB L3 per CCD (768MB total on 96-core)
             .associativity = 16,       // 12 CCDs x 8 cores x 12MB each = 96MB per CCD
             .line_size = 64,
             .policy = EvictionPolicy::LRU,
             .write_policy = WritePolicy::Back},
      .inclusion_policy = InclusionPolicy::Exclusive,  // AMD victim cache design
      .prefetch = PrefetchConfig::amd_default()};
}
