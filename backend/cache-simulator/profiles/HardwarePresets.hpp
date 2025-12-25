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
