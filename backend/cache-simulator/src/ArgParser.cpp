#include "../include/ArgParser.hpp"
#include "../profiles/HardwarePresets.hpp"
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {

unsigned long long parse_unsigned_value(const char* raw, const char* option) {
    const std::string value(raw);
    if (value.empty() || value.front() == '-') {
        throw std::invalid_argument(std::string(option) + " requires a non-negative integer");
    }
    size_t consumed = 0;
    unsigned long long parsed = 0;
    try {
        parsed = std::stoull(value, &consumed, 10);
    } catch (...) {
        throw std::invalid_argument(std::string(option) + " requires an integer");
    }
    if (consumed != value.size()) {
        throw std::invalid_argument(std::string(option) + " requires an integer");
    }
    return parsed;
}

int parse_int_value(const char* raw, const char* option, int minimum, int maximum) {
    const auto parsed = parse_unsigned_value(raw, option);
    if (parsed < static_cast<unsigned long long>(minimum) ||
        parsed > static_cast<unsigned long long>(maximum)) {
        throw std::out_of_range(std::string(option) + " is outside its supported range");
    }
    return static_cast<int>(parsed);
}

size_t parse_size_value(const char* raw, const char* option, size_t minimum, size_t maximum) {
    const auto parsed = parse_unsigned_value(raw, option);
    if (parsed < minimum || parsed > maximum || parsed > std::numeric_limits<size_t>::max()) {
        throw std::out_of_range(std::string(option) + " is outside its supported range");
    }
    return static_cast<size_t>(parsed);
}

} // namespace

void ArgParser::print_usage(const char* prog) {
    std::cerr << "Usage: " << prog << " [options]\n"
              << "Options:\n"
              << "  --config <name>   intel|amd|apple|educational|custom (default: intel)\n"
              << "  --hardware <name> Alias for --config\n"
              << "  --cores <n>       Number of cores to simulate (default: auto)\n"
              << "  --prefetch <p>    Prefetch policy: none|next|stream|stride|adaptive|intel\n"
              << "  --prefetch-degree <n>  Number of lines to prefetch (default: 2)\n"
              << "  --verbose         Print each cache event\n"
              << "  --json            Output JSON format\n"
              << "  --stream          Stream individual events as JSON (for real-time)\n"
              << "  --flamegraph      Output SVG flamegraph of cache misses\n"
              << "  --fast            Disable 3C miss classification for ~3x faster simulation\n"
              << "  --parallel [n]    Enable parallel trace parsing with n threads (default: auto)\n"
              << "  --cache-segments  Enable segment caching for repetitive code (10-100x speedup)\n"
              << "  --segment-size n  Number of events per cached segment (default: 20)\n"
              << "  --help            Show this help\n"
              << "\nCustom cache config (use with --config custom):\n"
              << "  --l1-size <bytes>   L1 cache size (default: 32768)\n"
              << "  --l1-assoc <n>      L1 associativity (default: 8)\n"
              << "  --l1-line <bytes>   Cache line size (default: 64)\n"
              << "  --l2-size <bytes>   L2 cache size (default: 262144)\n"
              << "  --l2-assoc <n>      L2 associativity (default: 8)\n"
              << "  --l3-size <bytes>   L3 cache size (default: 8388608)\n"
              << "  --l3-assoc <n>      L3 associativity (default: 16)\n";
}

PrefetchPolicy ArgParser::parse_prefetch_policy(std::string_view name) {
    if (name == "none") return PrefetchPolicy::NONE;
    if (name == "next" || name == "nextline") return PrefetchPolicy::NEXT_LINE;
    if (name == "stream") return PrefetchPolicy::STREAM;
    if (name == "stride") return PrefetchPolicy::STRIDE;
    if (name == "adaptive") return PrefetchPolicy::ADAPTIVE;
    if (name == "intel") return PrefetchPolicy::INTEL;
    return PrefetchPolicy::NONE;
}

std::string ArgParser::prefetch_policy_name(PrefetchPolicy p) {
    switch (p) {
        case PrefetchPolicy::NONE: return "none";
        case PrefetchPolicy::NEXT_LINE: return "next_line";
        case PrefetchPolicy::STREAM: return "stream";
        case PrefetchPolicy::STRIDE: return "stride";
        case PrefetchPolicy::ADAPTIVE: return "adaptive";
        case PrefetchPolicy::INTEL: return "intel";
    }
    return "unknown";
}

CacheHierarchyConfig ArgParser::get_preset_config(std::string_view name) {
    // Intel presets
    if (name == "intel" || name == "intel12") return make_intel_12th_gen_config();
    if (name == "intel14") return make_intel_14th_gen_config();
    if (name == "xeon") return make_intel_xeon_config();
    if (name == "xeon8488c" || name == "sapphire") return make_xeon_8488c_config();

    // AMD presets
    if (name == "amd" || name == "zen4") return make_amd_zen4_config();
    if (name == "zen3") return make_amd_zen3_config();
    if (name == "epyc") return make_amd_epyc_config();

    // Apple presets
    if (name == "apple" || name == "m1") return make_apple_m_series_config();
    if (name == "m2") return make_apple_m2_config();
    if (name == "m3") return make_apple_m3_config();

    // Cloud/ARM presets
    if (name == "graviton" || name == "graviton3") return make_aws_graviton3_config();
    if (name == "embedded") return make_embedded_config();
    if (name == "rpi4" || name == "raspberry") return make_raspberry_pi4_config();

    // Educational preset
    if (name == "educational") return make_educational_config();

    // Default to Intel 12th gen
    return make_intel_12th_gen_config();
}

HardwareProfileMetadata ArgParser::get_profile_metadata(std::string_view name) {
    if (name == "custom") {
        return {"custom", "Custom Hardware", "Custom", "custom", "custom", "custom"};
    }

    if (name == "educational") {
        return {"educational", "Educational", "Learning", "teaching-model",
                "learning", "educational"};
    }

    if (name == "intel" || name == "intel12") {
        return {std::string(name), "Intel 12th Gen", "Intel", "x86_64",
                "client", "directional"};
    }
    if (name == "intel14") {
        return {"intel14", "Intel 14th Gen", "Intel", "x86_64", "client",
                "directional"};
    }
    if (name == "xeon") {
        return {"xeon", "Intel Xeon", "Intel", "x86_64", "server",
                "directional"};
    }
    if (name == "xeon8488c" || name == "sapphire") {
        return {std::string(name), "Intel Xeon Platinum 8488C", "Intel",
                "x86_64", "server", "calibrated"};
    }

    if (name == "amd" || name == "zen4") {
        return {std::string(name), "AMD Zen 4", "AMD", "x86_64", "client",
                "directional"};
    }
    if (name == "zen3") {
        return {"zen3", "AMD Zen 3", "AMD", "x86_64", "client",
                "directional"};
    }
    if (name == "epyc") {
        return {"epyc", "AMD EPYC", "AMD", "x86_64", "server",
                "directional"};
    }

    if (name == "apple" || name == "m1") {
        return {std::string(name), "Apple M1", "Apple", "arm64", "client",
                "directional"};
    }
    if (name == "m2") {
        return {"m2", "Apple M2", "Apple", "arm64", "client", "directional"};
    }
    if (name == "m3") {
        return {"m3", "Apple M3", "Apple", "arm64", "client", "directional"};
    }

    if (name == "graviton" || name == "graviton3") {
        return {std::string(name), "AWS Graviton 3", "ARM", "arm64", "cloud",
                "directional"};
    }
    if (name == "embedded") {
        return {"embedded", "Embedded ARM", "ARM", "arm64", "embedded",
                "educational"};
    }
    if (name == "rpi4" || name == "raspberry") {
        return {std::string(name), "Raspberry Pi 4", "ARM", "arm64",
                "embedded", "directional"};
    }

    return {"intel", "Intel 12th Gen", "Intel", "x86_64", "client",
            "directional"};
}

CacheHierarchyConfig ArgParser::build_cache_config(const SimulatorOptions& opts) {
    if (opts.config_name == "custom") {
        CacheHierarchyConfig cfg;
        // Convert bytes to KB for CacheConfig which expects kb_size
        size_t l1_kb = opts.l1_size / 1024;
        size_t l2_kb = opts.l2_size / 1024;
        size_t l3_kb = opts.l3_size / 1024;
        cfg.l1_data = {l1_kb, opts.l1_assoc, opts.line_size, EvictionPolicy::LRU};
        cfg.l1_inst = {l1_kb, opts.l1_assoc, opts.line_size, EvictionPolicy::LRU};  // Same as L1 data
        cfg.l2 = {l2_kb, opts.l2_assoc, opts.line_size, EvictionPolicy::LRU};
        cfg.l3 = {l3_kb, opts.l3_assoc, opts.line_size, EvictionPolicy::LRU};
        cfg.inclusion_policy = InclusionPolicy::NINE;
        return cfg;
    }
    return get_preset_config(opts.config_name);
}

void ArgParser::apply_preset_prefetch(SimulatorOptions& opts) {
    if (!opts.prefetch_policy_set) {
        // Use the preset's prefetch settings
        const PrefetchConfig& pf = opts.cache_config.prefetch;
        if (pf.l2_stream_prefetch || pf.l1_stream_prefetch) {
            opts.prefetch_policy = PrefetchPolicy::ADAPTIVE;
        }
        if (!opts.prefetch_degree_set) {
            // Use L2's max distance as the degree (it's the most aggressive)
            opts.prefetch_degree = pf.l2_max_distance;
        }
    }
}

SimulatorOptions ArgParser::parse(int argc, char* argv[]) {
    SimulatorOptions opts;

    for (int i = 1; i < argc; i++) {
        std::string arg = argv[i];

        if ((arg == "--config" || arg == "--hardware") && i + 1 < argc) {
            opts.config_name = argv[++i];
        } else if (arg == "--cores" && i + 1 < argc) {
            opts.num_cores = parse_int_value(argv[++i], "--cores", 0, 256);
        } else if (arg == "--verbose") {
            opts.verbose = true;
        } else if (arg == "--json") {
            opts.json_output = true;
        } else if (arg == "--stream") {
            opts.stream_mode = true;
            opts.json_output = true;  // Streaming implies JSON
        } else if (arg == "--flamegraph") {
            opts.flamegraph_output = true;
        } else if (arg == "--fast") {
            opts.fast_mode = true;
        } else if (arg == "--l1-size" && i + 1 < argc) {
            opts.l1_size = parse_size_value(argv[++i], "--l1-size", 1024, 16ULL * 1024 * 1024);
        } else if (arg == "--l1-assoc" && i + 1 < argc) {
            opts.l1_assoc = parse_int_value(argv[++i], "--l1-assoc", 1, 1024);
        } else if (arg == "--l1-line" && i + 1 < argc) {
            opts.line_size = parse_int_value(argv[++i], "--l1-line", 1, 4096);
        } else if (arg == "--l2-size" && i + 1 < argc) {
            opts.l2_size = parse_size_value(argv[++i], "--l2-size", 1024, 64ULL * 1024 * 1024);
        } else if (arg == "--l2-assoc" && i + 1 < argc) {
            opts.l2_assoc = parse_int_value(argv[++i], "--l2-assoc", 1, 1024);
        } else if (arg == "--l3-size" && i + 1 < argc) {
            opts.l3_size = parse_size_value(argv[++i], "--l3-size", 1024, 128ULL * 1024 * 1024);
        } else if (arg == "--l3-assoc" && i + 1 < argc) {
            opts.l3_assoc = parse_int_value(argv[++i], "--l3-assoc", 1, 1024);
        } else if (arg == "--prefetch" && i + 1 < argc) {
            opts.prefetch_policy = parse_prefetch_policy(argv[++i]);
            opts.prefetch_policy_set = true;
        } else if (arg == "--prefetch-degree" && i + 1 < argc) {
            opts.prefetch_degree = parse_int_value(argv[++i], "--prefetch-degree", 0, 64);
            opts.prefetch_degree_set = true;
        } else if (arg == "--parallel") {
            opts.parallel_parsing = true;
            // Optional thread count argument
            if (i + 1 < argc && argv[i + 1][0] != '-') {
                opts.parallel_threads = parse_size_value(argv[++i], "--parallel", 1, 256);
            }
        } else if (arg == "--cache-segments") {
            opts.cache_segments = true;
        } else if (arg == "--segment-size" && i + 1 < argc) {
            opts.segment_size = parse_size_value(argv[++i], "--segment-size", 1, 1000000);
        } else if (arg == "--help") {
            opts.show_help = true;
        }
    }

    if ((opts.line_size & (opts.line_size - 1)) != 0) {
        throw std::invalid_argument("--l1-line must be a power of two");
    }

    // Build the cache config from options
    opts.cache_config = build_cache_config(opts);

    // Apply preset prefetch settings if not overridden
    apply_preset_prefetch(opts);

    return opts;
}
