#pragma once

#include <string>
#include <string_view>

#include "../profiles/CacheConfig.hpp"
#include "Prefetcher.hpp"

struct SimulatorOptions {
    std::string config_name = "intel";
    CacheHierarchyConfig cache_config;
    int num_cores = 0;  // 0 = auto-detect from trace
    PrefetchPolicy prefetch_policy = PrefetchPolicy::NONE;
    int prefetch_degree = 2;
    bool verbose = false;
    bool json_output = false;
    bool stream_mode = false;
    bool flamegraph_output = false;
    bool fast_mode = false;  // Disable 3C miss classification for performance
    bool show_help = false;
    bool prefetch_policy_set = false;
    bool prefetch_degree_set = false;

    // Custom cache config values (used when config_name == "custom")
    size_t l1_size = 32768;
    size_t l2_size = 262144;
    size_t l3_size = 8388608;
    int l1_assoc = 8;
    int l2_assoc = 8;
    int l3_assoc = 16;
    int line_size = 64;
};

class ArgParser {
public:
    /// Parse command line arguments and return simulator options
    [[nodiscard]] static SimulatorOptions parse(int argc, char* argv[]);

    /// Print usage/help information to stderr
    static void print_usage(const char* program_name);

    /// Parse prefetch policy name string to enum
    [[nodiscard]] static PrefetchPolicy parse_prefetch_policy(std::string_view name);

    /// Convert prefetch policy enum to string name
    [[nodiscard]] static std::string prefetch_policy_name(PrefetchPolicy policy);

    /// Get cache configuration for a named preset
    [[nodiscard]] static CacheHierarchyConfig get_preset_config(std::string_view name);

    /// Build final cache config from options (handles custom vs preset)
    [[nodiscard]] static CacheHierarchyConfig build_cache_config(const SimulatorOptions& opts);

    /// Apply preset's prefetch config to options if not explicitly overridden
    static void apply_preset_prefetch(SimulatorOptions& opts);
};
