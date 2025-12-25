#pragma once
#include "CacheConfig.hpp"

inline CacheHierarchyConfig make_default_config() {
  CacheHierarchyConfig config;

  config.l1_data = {.kb_size = 32,
                    .associativity = 8,
                    .line_size = 64,
                    .policy = EvictionPolicy::LRU,
                    .write_policy = WritePolicy::Back};

  config.l1_inst = {.kb_size = 32,
                    .associativity = 8,
                    .line_size = 64,
                    .policy = EvictionPolicy::LRU,
                    .write_policy = WritePolicy::ReadOnly};

  config.l2 = {.kb_size = 256,
               .associativity = 4,
               .line_size = 64,
               .policy = EvictionPolicy::LRU};

  config.l3 = {.kb_size = 8192,
               .associativity = 16,
               .line_size = 64,
               .policy = EvictionPolicy::PLRU};

  config.inclusion_policy = InclusionPolicy::Inclusive;

  return config;
}

inline CacheHierarchyConfig make_test_config() {
  CacheHierarchyConfig config;

  config.l1_data = {.kb_size = 1,
                    .associativity = 1,
                    .line_size = 64,
                    .policy = EvictionPolicy::LRU,
                    .write_policy = WritePolicy::Back};

  config.l1_inst = {.kb_size = 1,
                    .associativity = 1,
                    .line_size = 64,
                    .policy = EvictionPolicy::LRU,
                    .write_policy = WritePolicy::ReadOnly};

  config.l2 = {
      .kb_size = 4,
      .associativity = 2,
      .line_size = 64,
      .policy = EvictionPolicy::LRU,
  };

  config.l3 = {
      .kb_size = 16,
      .associativity = 4,
      .line_size = 64,
      .policy = EvictionPolicy::LRU,
  };

  config.inclusion_policy = InclusionPolicy::Inclusive;

  return config;
}
