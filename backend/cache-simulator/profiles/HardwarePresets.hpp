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
      .inclusion_policy = InclusionPolicy::NINE};
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
      .inclusion_policy = InclusionPolicy::Exclusive};
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
      .inclusion_policy = InclusionPolicy::NINE};
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
      .inclusion_policy = InclusionPolicy::NINE};
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
      .inclusion_policy = InclusionPolicy::Exclusive};  // Zen uses victim cache
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
      .inclusion_policy = InclusionPolicy::NINE};
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
      .inclusion_policy = InclusionPolicy::NINE};
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
      .inclusion_policy = InclusionPolicy::Inclusive};
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
      .inclusion_policy = InclusionPolicy::Inclusive};
}
