#include "../include/MultiCoreTraceProcessor.hpp"
#include "../include/OptimizationSuggester.hpp"
#include "../include/TraceProcessor.hpp"
#include "../profiles/HardwarePresets.hpp"
#include <iomanip>
#include <iostream>
#include <unordered_set>
#include <vector>

void print_usage(const char *prog) {
  std::cerr << "Usage: " << prog << " [options]\n"
            << "Options:\n"
            << "  --config <name>   intel|amd|apple|educational|custom (default: intel)\n"
            << "  --cores <n>       Number of cores to simulate (default: auto)\n"
            << "  --prefetch <p>    Prefetch policy: none|next|stream|stride|adaptive|intel\n"
            << "  --prefetch-degree <n>  Number of lines to prefetch (default: 2)\n"
            << "  --verbose         Print each cache event\n"
            << "  --json            Output JSON format\n"
            << "  --stream          Stream individual events as JSON (for real-time)\n"
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

PrefetchPolicy parse_prefetch_policy(const std::string &name) {
  if (name == "none") return PrefetchPolicy::NONE;
  if (name == "next" || name == "nextline") return PrefetchPolicy::NEXT_LINE;
  if (name == "stream") return PrefetchPolicy::STREAM;
  if (name == "stride") return PrefetchPolicy::STRIDE;
  if (name == "adaptive") return PrefetchPolicy::ADAPTIVE;
  if (name == "intel") return PrefetchPolicy::INTEL;
  return PrefetchPolicy::NONE;
}

std::string prefetch_policy_name(PrefetchPolicy p) {
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

CacheHierarchyConfig get_config(const std::string &name) {
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

std::string escape_json(const std::string &s) {
  std::string out;
  for (char c : s) {
    if (c == '"') out += "\\\"";
    else if (c == '\\') out += "\\\\";
    else out += c;
  }
  return out;
}

int main(int argc, char *argv[]) {
  std::string config_name = "intel";
  int num_cores = 0; // 0 = auto-detect
  bool verbose = false;
  bool json_output = false;
  bool stream_mode = false;

  // Prefetching options - will be set from preset config unless overridden
  PrefetchPolicy prefetch_policy = PrefetchPolicy::NONE;
  int prefetch_degree = 2;
  bool prefetch_policy_set = false;  // Track if user explicitly set prefetch
  bool prefetch_degree_set = false;

  // Custom config defaults
  size_t l1_size = 32768, l2_size = 262144, l3_size = 8388608;
  int l1_assoc = 8, l2_assoc = 8, l3_assoc = 16, line_size = 64;

  for (int i = 1; i < argc; i++) {
    std::string arg = argv[i];
    if (arg == "--config" && i + 1 < argc) {
      config_name = argv[++i];
    } else if (arg == "--cores" && i + 1 < argc) {
      num_cores = std::stoi(argv[++i]);
    } else if (arg == "--verbose") {
      verbose = true;
    } else if (arg == "--json") {
      json_output = true;
    } else if (arg == "--stream") {
      stream_mode = true;
      json_output = true;  // Streaming implies JSON
    } else if (arg == "--l1-size" && i + 1 < argc) {
      l1_size = std::stoull(argv[++i]);
    } else if (arg == "--l1-assoc" && i + 1 < argc) {
      l1_assoc = std::stoi(argv[++i]);
    } else if (arg == "--l1-line" && i + 1 < argc) {
      line_size = std::stoi(argv[++i]);
    } else if (arg == "--l2-size" && i + 1 < argc) {
      l2_size = std::stoull(argv[++i]);
    } else if (arg == "--l2-assoc" && i + 1 < argc) {
      l2_assoc = std::stoi(argv[++i]);
    } else if (arg == "--l3-size" && i + 1 < argc) {
      l3_size = std::stoull(argv[++i]);
    } else if (arg == "--l3-assoc" && i + 1 < argc) {
      l3_assoc = std::stoi(argv[++i]);
    } else if (arg == "--prefetch" && i + 1 < argc) {
      prefetch_policy = parse_prefetch_policy(argv[++i]);
      prefetch_policy_set = true;
    } else if (arg == "--prefetch-degree" && i + 1 < argc) {
      prefetch_degree = std::stoi(argv[++i]);
      prefetch_degree_set = true;
    } else if (arg == "--help") {
      print_usage(argv[0]);
      return 0;
    }
  }

  // Build cache config
  CacheHierarchyConfig cfg;
  if (config_name == "custom") {
    cfg.l1_data = {l1_size, l1_assoc, line_size, EvictionPolicy::LRU};
    cfg.l2 = {l2_size, l2_assoc, line_size, EvictionPolicy::LRU};
    cfg.l3 = {l3_size, l3_assoc, line_size, EvictionPolicy::LRU};
  } else {
    cfg = get_config(config_name);
  }

  // Apply preset's prefetch config unless user explicitly overrode
  if (!prefetch_policy_set) {
    // Use the preset's prefetch settings
    const PrefetchConfig& pf = cfg.prefetch;
    if (pf.l2_stream_prefetch || pf.l1_stream_prefetch) {
      prefetch_policy = PrefetchPolicy::ADAPTIVE;  // Use adaptive for stream+stride
    }
    if (!prefetch_degree_set) {
      // Use L2's max distance as the degree (it's the most aggressive)
      prefetch_degree = pf.l2_max_distance;
    }
  }

  // Streaming mode: process events as they arrive and output JSON for each
  // Uses MultiCoreTraceProcessor to handle both single and multi-threaded code
  if (stream_mode) {
    // Use 8 cores max - handles both single and multi-threaded transparently
    MultiCoreTraceProcessor processor(8, cfg.l1_data, cfg.l2, cfg.l3);
    // TODO: Add prefetching support to MultiCoreCacheSystem
    // For now, prefetching only works in single-core batch mode

    size_t event_count = 0;
    size_t batch_size = 50;  // Batch events for efficiency
    size_t batch_count = 0;

    // Buffer for recent events to include in progress updates
    struct TimelineEvent {
      size_t index;
      bool is_write;
      bool is_icache;
      int hit_level;  // 1=L1, 2=L2, 3=L3, 4=memory
      uint64_t address;  // Memory address for cache visualization
      std::string file;
      uint32_t line;
    };
    std::vector<TimelineEvent> recent_events;
    recent_events.reserve(batch_size);

    // Track current event for callback
    const TraceEvent* current_event = nullptr;
    size_t current_index = 0;

    // Set up callback to capture hit level for each access
    processor.set_event_callback([&](const EventResult& result) {
      if (current_event) {
        int level = 4;  // memory by default
        if (result.l1_hit) level = 1;
        else if (result.l2_hit) level = 2;
        else if (result.l3_hit) level = 3;

        recent_events.push_back({
          current_index,
          current_event->is_write,
          current_event->is_icache,
          level,
          current_event->address,
          current_event->file,
          current_event->line
        });
      }
    });

    // Output header with multicore info
    std::cout << "{\"type\":\"start\",\"config\":\"" << config_name << "\",\"multicore\":true}\n" << std::flush;

    std::string line;
    while (std::getline(std::cin, line)) {
      auto event = parse_trace_event(line);
      if (!event) continue;

      event_count++;
      current_index = event_count;
      current_event = &(*event);
      processor.process(*event);
      current_event = nullptr;
      batch_count++;

      // Output batch of events periodically
      if (batch_count >= batch_size) {
        auto stats = processor.get_stats();
        // Aggregate L1 stats from all cores
        CacheStats l1_total;
        for (const auto &l1 : stats.l1_per_core) {
          l1_total.hits += l1.hits;
          l1_total.misses += l1.misses;
          l1_total.writebacks += l1.writebacks;
        }
        std::cout << "{\"type\":\"progress\""
                  << ",\"events\":" << event_count
                  << ",\"threads\":" << processor.get_thread_count()
                  << ",\"l1d\":{\"hits\":" << l1_total.hits << ",\"misses\":" << l1_total.misses << "}"
                  << ",\"l2\":{\"hits\":" << stats.l2.hits << ",\"misses\":" << stats.l2.misses << "}"
                  << ",\"l3\":{\"hits\":" << stats.l3.hits << ",\"misses\":" << stats.l3.misses << "}"
                  << ",\"coherence\":" << stats.coherence_invalidations
                  << ",\"timeline\":[";
        // Note: l1i stats not tracked separately in multi-core mode

        // Output recent events for timeline
        for (size_t i = 0; i < recent_events.size(); i++) {
          if (i > 0) std::cout << ",";
          const auto& e = recent_events[i];
          std::cout << "{\"i\":" << e.index
                    << ",\"t\":\"" << (e.is_icache ? "I" : (e.is_write ? "W" : "R")) << "\""
                    << ",\"l\":" << e.hit_level
                    << ",\"a\":" << e.address;
          if (!e.file.empty()) {
            std::cout << ",\"f\":\"" << escape_json(e.file) << "\",\"n\":" << e.line;
          }
          std::cout << "}";
        }
        std::cout << "]}\n" << std::flush;

        recent_events.clear();
        batch_count = 0;
      }
    }

    // Output any remaining events as final progress
    if (!recent_events.empty()) {
      auto stats = processor.get_stats();
      CacheStats l1_total;
      for (const auto &l1 : stats.l1_per_core) {
        l1_total.hits += l1.hits;
        l1_total.misses += l1.misses;
        l1_total.writebacks += l1.writebacks;
      }
      std::cout << "{\"type\":\"progress\""
                << ",\"events\":" << event_count
                << ",\"threads\":" << processor.get_thread_count()
                << ",\"l1d\":{\"hits\":" << l1_total.hits << ",\"misses\":" << l1_total.misses << "}"
                << ",\"l2\":{\"hits\":" << stats.l2.hits << ",\"misses\":" << stats.l2.misses << "}"
                << ",\"l3\":{\"hits\":" << stats.l3.hits << ",\"misses\":" << stats.l3.misses << "}"
                << ",\"coherence\":" << stats.coherence_invalidations
                << ",\"timeline\":[";
      for (size_t i = 0; i < recent_events.size(); i++) {
        if (i > 0) std::cout << ",";
        const auto& e = recent_events[i];
        std::cout << "{\"i\":" << e.index
                  << ",\"t\":\"" << (e.is_icache ? "I" : (e.is_write ? "W" : "R")) << "\""
                  << ",\"l\":" << e.hit_level
                  << ",\"a\":" << e.address;
        if (!e.file.empty()) {
          std::cout << ",\"f\":\"" << escape_json(e.file) << "\",\"n\":" << e.line;
        }
        std::cout << "}";
      }
      std::cout << "]}\n" << std::flush;
    }

    // Output final results
    auto stats = processor.get_stats();
    auto hot = processor.get_hot_lines(10);
    auto false_sharing = processor.get_false_sharing_reports();

    // Aggregate L1 stats
    CacheStats l1_total;
    for (const auto &l1 : stats.l1_per_core) {
      l1_total.hits += l1.hits;
      l1_total.misses += l1.misses;
      l1_total.writebacks += l1.writebacks;
    }

    std::cout << "{\"type\":\"complete\""
              << ",\"events\":" << event_count
              << ",\"threads\":" << processor.get_thread_count()
              << ",\"cores\":" << processor.get_num_cores()
              << ",\"levels\":{";
    std::cout << "\"l1d\":{\"hits\":" << l1_total.hits << ",\"misses\":" << l1_total.misses
              << ",\"hitRate\":" << std::fixed << std::setprecision(3) << l1_total.hit_rate()
              << ",\"compulsory\":" << l1_total.compulsory_misses
              << ",\"capacity\":" << l1_total.capacity_misses
              << ",\"conflict\":" << l1_total.conflict_misses << "},";
    std::cout << "\"l2\":{\"hits\":" << stats.l2.hits << ",\"misses\":" << stats.l2.misses
              << ",\"hitRate\":" << std::fixed << std::setprecision(3) << stats.l2.hit_rate()
              << ",\"compulsory\":" << stats.l2.compulsory_misses
              << ",\"capacity\":" << stats.l2.capacity_misses
              << ",\"conflict\":" << stats.l2.conflict_misses << "},";
    std::cout << "\"l3\":{\"hits\":" << stats.l3.hits << ",\"misses\":" << stats.l3.misses
              << ",\"hitRate\":" << std::fixed << std::setprecision(3) << stats.l3.hit_rate()
              << ",\"compulsory\":" << stats.l3.compulsory_misses
              << ",\"capacity\":" << stats.l3.capacity_misses
              << ",\"conflict\":" << stats.l3.conflict_misses << "}";
    std::cout << "}";

    // Coherence stats
    std::cout << ",\"coherence\":{\"invalidations\":" << stats.coherence_invalidations
              << ",\"falseSharingEvents\":" << stats.false_sharing_events << "}";

    std::cout << ",\"hotLines\":[";
    for (size_t i = 0; i < hot.size(); i++) {
      if (i > 0) std::cout << ",";
      std::cout << "{\"file\":\"" << escape_json(hot[i].file) << "\""
                << ",\"line\":" << hot[i].line
                << ",\"hits\":" << hot[i].hits
                << ",\"misses\":" << hot[i].misses
                << ",\"missRate\":" << std::fixed << std::setprecision(3) << hot[i].miss_rate()
                << ",\"threads\":" << hot[i].threads.size() << "}";
    }
    std::cout << "]";

    // False sharing reports (if any)
    if (!false_sharing.empty()) {
      std::cout << ",\"falseSharing\":[";
      for (size_t i = 0; i < false_sharing.size(); i++) {
        if (i > 0) std::cout << ",";
        const auto &fs = false_sharing[i];
        std::cout << "{\"addr\":\"0x" << std::hex << fs.cache_line_addr << std::dec << "\""
                  << ",\"accesses\":" << fs.accesses.size() << "}";
      }
      std::cout << "]";
    }

    // Generate suggestions (use aggregated L1 stats)
    std::cout << ",\"suggestions\":[";
    auto suggestions = OptimizationSuggester::analyze(false_sharing, hot, stats, cfg.l1_data.line_size);
    for (size_t i = 0; i < suggestions.size(); i++) {
      const auto &s = suggestions[i];
      if (i > 0) std::cout << ",";
      std::cout << "{\"type\":\"" << s.type << "\""
                << ",\"severity\":\"" << s.severity << "\""
                << ",\"location\":\"" << escape_json(s.location) << "\""
                << ",\"message\":\"" << escape_json(s.message) << "\""
                << ",\"fix\":\"" << escape_json(s.fix) << "\"}";
    }
    std::cout << "]";

    // Note: Prefetching not yet supported in multi-core streaming mode
    std::cout << "}\n" << std::flush;
    return 0;
  }

  // Batch mode: Read all events first to detect thread count
  std::vector<TraceEvent> events;
  std::unordered_set<uint32_t> threads;
  std::string line;

  while (std::getline(std::cin, line)) {
    auto event = parse_trace_event(line);
    if (event) {
      threads.insert(event->thread_id);
      events.push_back(*event);
    }
  }

  bool multicore = threads.size() > 1;
  if (num_cores == 0) {
    num_cores = multicore ? std::min((int)threads.size(), 8) : 1;
  }

  if (multicore) {
    // Multi-core mode with coherence and false sharing detection
    MultiCoreTraceProcessor processor(num_cores, cfg.l1_data, cfg.l2, cfg.l3);

    if (verbose && !json_output) {
      processor.set_event_callback([](const EventResult &r) {
        std::cout << (r.l1_hit ? "L1_HIT" : r.l2_hit ? "L2_HIT" : r.l3_hit ? "L3_HIT" : "MISS")
                  << " 0x" << std::hex << r.address << std::dec;
        if (!r.file.empty())
          std::cout << " " << r.file << ":" << r.line;
        std::cout << "\n";
      });
    }

    for (const auto &event : events) {
      processor.process(event);
    }

    auto stats = processor.get_stats();
    auto hot = processor.get_hot_lines(10);
    auto false_sharing = processor.get_false_sharing_reports();

    if (json_output) {
      std::cout << "{\n";
      std::cout << "  \"config\": \"" << config_name << "\",\n";
      std::cout << "  \"multicore\": true,\n";
      std::cout << "  \"cores\": " << num_cores << ",\n";
      std::cout << "  \"threads\": " << threads.size() << ",\n";
      std::cout << "  \"events\": " << events.size() << ",\n";

      // Aggregate L1 stats
      CacheStats l1_total;
      for (const auto &l1 : stats.l1_per_core) {
        l1_total += l1;
      }

      std::cout << "  \"levels\": {\n";
      auto json_level = [](const char *name, const CacheStats &s, bool last) {
        std::cout << "    \"" << name << "\": {"
                  << "\"hits\": " << s.hits << ", "
                  << "\"misses\": " << s.misses << ", "
                  << "\"hitRate\": " << std::fixed << std::setprecision(3) << s.hit_rate() << ", "
                  << "\"writebacks\": " << s.writebacks << ", "
                  << "\"compulsory\": " << s.compulsory_misses << ", "
                  << "\"capacity\": " << s.capacity_misses << ", "
                  << "\"conflict\": " << s.conflict_misses << "}"
                  << (last ? "\n" : ",\n");
      };
      json_level("l1", l1_total, false);
      json_level("l2", stats.l2, false);
      json_level("l3", stats.l3, true);
      std::cout << "  },\n";

      std::cout << "  \"coherence\": {\n";
      std::cout << "    \"invalidations\": " << stats.coherence_invalidations << ",\n";
      std::cout << "    \"falseSharingEvents\": " << stats.false_sharing_events << "\n";
      std::cout << "  },\n";

      std::cout << "  \"hotLines\": [\n";
      for (size_t i = 0; i < hot.size(); i++) {
        const auto &h = hot[i];
        std::cout << "    {\"file\": \"" << escape_json(h.file) << "\", "
                  << "\"line\": " << h.line << ", "
                  << "\"hits\": " << h.hits << ", "
                  << "\"misses\": " << h.misses << ", "
                  << "\"missRate\": " << std::fixed << std::setprecision(3) << h.miss_rate() << ", "
                  << "\"threads\": " << h.threads.size() << "}"
                  << (i + 1 < hot.size() ? ",\n" : "\n");
      }
      std::cout << "  ],\n";

      std::cout << "  \"falseSharing\": [\n";
      for (size_t i = 0; i < false_sharing.size(); i++) {
        const auto &fs = false_sharing[i];
        std::cout << "    {\"cacheLineAddr\": \"0x" << std::hex << fs.cache_line_addr << std::dec << "\", "
                  << "\"accessCount\": " << fs.accesses.size() << ", "
                  << "\"accesses\": [";

        // Group accesses by thread for cleaner output
        std::unordered_map<uint32_t, std::vector<const FalseSharingEvent*>> by_thread;
        for (const auto &a : fs.accesses) {
          by_thread[a.thread_id].push_back(&a);
        }

        bool first_thread = true;
        for (const auto &[tid, thread_accesses] : by_thread) {
          if (!first_thread) std::cout << ", ";
          first_thread = false;

          // Show first access per thread
          const auto &a = *thread_accesses[0];
          std::cout << "{\"threadId\": " << tid << ", "
                    << "\"offset\": " << a.byte_offset << ", "
                    << "\"isWrite\": " << (a.is_write ? "true" : "false") << ", "
                    << "\"file\": \"" << escape_json(a.file) << "\", "
                    << "\"line\": " << a.line << ", "
                    << "\"count\": " << thread_accesses.size() << "}";
        }
        std::cout << "]}"
                  << (i + 1 < false_sharing.size() ? ",\n" : "\n");
      }
      std::cout << "  ],\n";

      // Generate optimization suggestions
      auto suggestions = OptimizationSuggester::analyze(
          false_sharing, hot, stats, cfg.l1_data.line_size);

      std::cout << "  \"suggestions\": [\n";
      for (size_t i = 0; i < suggestions.size(); i++) {
        const auto &s = suggestions[i];
        std::cout << "    {\"type\": \"" << s.type << "\", "
                  << "\"severity\": \"" << s.severity << "\", "
                  << "\"location\": \"" << escape_json(s.location) << "\", "
                  << "\"message\": \"" << escape_json(s.message) << "\", "
                  << "\"fix\": \"" << escape_json(s.fix) << "\"}"
                  << (i + 1 < suggestions.size() ? ",\n" : "\n");
      }
      std::cout << "  ]\n";
      std::cout << "}\n";
    } else {
      std::cout << "\n=== Multi-Core Cache Simulation ===\n";
      std::cout << "Config: " << config_name << "\n";
      std::cout << "Cores: " << num_cores << ", Threads: " << threads.size() << "\n";
      std::cout << "Events: " << events.size() << "\n\n";

      CacheStats l1_total;
      for (const auto &l1 : stats.l1_per_core) {
        l1_total.hits += l1.hits;
        l1_total.misses += l1.misses;
        l1_total.writebacks += l1.writebacks;
      }

      std::cout << "Level     Hits       Misses     Hit Rate   Writebacks\n";
      std::cout << "-------   --------   --------   --------   ----------\n";

      auto print_level = [](const char *name, const CacheStats &s) {
        std::cout << std::left << std::setw(10) << name
                  << std::setw(11) << s.hits
                  << std::setw(11) << s.misses
                  << std::fixed << std::setprecision(1) << (s.hit_rate() * 100) << "%"
                  << std::setw(8) << ""
                  << s.writebacks << "\n";
      };

      print_level("L1", l1_total);
      print_level("L2", stats.l2);
      print_level("L3", stats.l3);

      std::cout << "\n=== Coherence ===\n";
      std::cout << "Invalidations: " << stats.coherence_invalidations << "\n";

      if (!false_sharing.empty()) {
        std::cout << "\n=== FALSE SHARING DETECTED ===\n";
        for (const auto &fs : false_sharing) {
          std::cout << "Cache line 0x" << std::hex << fs.cache_line_addr << std::dec << ":\n";
          std::unordered_set<uint32_t> threads_involved;
          for (const auto &a : fs.accesses) {
            threads_involved.insert(a.thread_id);
          }
          std::cout << "  Threads involved: ";
          bool first = true;
          for (uint32_t t : threads_involved) {
            if (!first) std::cout << ", ";
            std::cout << "T" << t;
            first = false;
          }
          std::cout << "\n";

          // Show first few accesses
          int shown = 0;
          for (const auto &a : fs.accesses) {
            if (shown >= 4) {
              std::cout << "  ... and " << (fs.accesses.size() - 4) << " more accesses\n";
              break;
            }
            std::cout << "  T" << a.thread_id << " " << (a.is_write ? "WRITE" : "READ")
                      << " offset " << a.byte_offset;
            if (!a.file.empty()) {
              std::cout << " (" << a.file << ":" << a.line << ")";
            }
            std::cout << "\n";
            shown++;
          }
        }
      }

      if (!hot.empty()) {
        std::cout << "\n=== Hottest Lines ===\n";
        for (const auto &s : hot) {
          std::cout << s.file << ":" << s.line << " - "
                    << s.misses << " misses, "
                    << s.threads.size() << " thread(s)\n";
        }
      }
    }
  } else {
    // Single-core mode (original behavior)
    TraceProcessor processor(cfg);
    if (prefetch_policy != PrefetchPolicy::NONE) {
      processor.enable_prefetching(prefetch_policy, prefetch_degree);
    }

    if (verbose && !json_output) {
      processor.set_event_callback([](const EventResult &r) {
        std::cout << (r.l1_hit ? "L1_HIT" : r.l2_hit ? "L2_HIT" : r.l3_hit ? "L3_HIT" : "MISS")
                  << " 0x" << std::hex << r.address << std::dec;
        if (!r.file.empty())
          std::cout << " " << r.file << ":" << r.line;
        std::cout << "\n";
      });
    }

    for (const auto &event : events) {
      processor.process(event);
    }

    auto stats = processor.get_stats();
    auto hot = processor.get_hot_lines(10);

    if (json_output) {
      std::cout << "{\n";
      std::cout << "  \"config\": \"" << config_name << "\",\n";
      std::cout << "  \"events\": " << events.size() << ",\n";

      // Output cache configuration for visualization
      std::cout << "  \"cacheConfig\": {\n";
      std::cout << "    \"l1d\": {\"sizeKB\": " << cfg.l1_data.kb_size
                << ", \"assoc\": " << cfg.l1_data.associativity
                << ", \"lineSize\": " << cfg.l1_data.line_size
                << ", \"sets\": " << cfg.l1_data.num_sets() << "},\n";
      std::cout << "    \"l1i\": {\"sizeKB\": " << cfg.l1_inst.kb_size
                << ", \"assoc\": " << cfg.l1_inst.associativity
                << ", \"lineSize\": " << cfg.l1_inst.line_size
                << ", \"sets\": " << cfg.l1_inst.num_sets() << "},\n";
      std::cout << "    \"l2\": {\"sizeKB\": " << cfg.l2.kb_size
                << ", \"assoc\": " << cfg.l2.associativity
                << ", \"lineSize\": " << cfg.l2.line_size
                << ", \"sets\": " << cfg.l2.num_sets() << "},\n";
      std::cout << "    \"l3\": {\"sizeKB\": " << cfg.l3.kb_size
                << ", \"assoc\": " << cfg.l3.associativity
                << ", \"lineSize\": " << cfg.l3.line_size
                << ", \"sets\": " << cfg.l3.num_sets() << "}\n";
      std::cout << "  },\n";

      std::cout << "  \"levels\": {\n";

      auto json_level = [](const char *name, const CacheStats &s, bool last) {
        std::cout << "    \"" << name << "\": {"
                  << "\"hits\": " << s.hits << ", "
                  << "\"misses\": " << s.misses << ", "
                  << "\"hitRate\": " << std::fixed << std::setprecision(3) << s.hit_rate() << ", "
                  << "\"writebacks\": " << s.writebacks << ", "
                  << "\"compulsory\": " << s.compulsory_misses << ", "
                  << "\"capacity\": " << s.capacity_misses << ", "
                  << "\"conflict\": " << s.conflict_misses << "}"
                  << (last ? "\n" : ",\n");
      };

      json_level("l1d", stats.l1d, false);
      json_level("l1i", stats.l1i, false);
      json_level("l2", stats.l2, false);
      json_level("l3", stats.l3, true);

      std::cout << "  },\n";
      std::cout << "  \"hotLines\": [\n";

      for (size_t i = 0; i < hot.size(); i++) {
        const auto &h = hot[i];
        std::cout << "    {\"file\": \"" << escape_json(h.file) << "\", "
                  << "\"line\": " << h.line << ", "
                  << "\"hits\": " << h.hits << ", "
                  << "\"misses\": " << h.misses << ", "
                  << "\"missRate\": " << std::fixed << std::setprecision(3) << h.miss_rate() << "}"
                  << (i + 1 < hot.size() ? ",\n" : "\n");
      }

      std::cout << "  ],\n";

      // Generate optimization suggestions for single-core
      auto suggestions =
          OptimizationSuggester::analyze(hot, stats.l1d, stats.l2);

      std::cout << "  \"suggestions\": [\n";
      for (size_t i = 0; i < suggestions.size(); i++) {
        const auto &s = suggestions[i];
        std::cout << "    {\"type\": \"" << s.type << "\", "
                  << "\"severity\": \"" << s.severity << "\", "
                  << "\"location\": \"" << escape_json(s.location) << "\", "
                  << "\"message\": \"" << escape_json(s.message) << "\", "
                  << "\"fix\": \"" << escape_json(s.fix) << "\"}"
                  << (i + 1 < suggestions.size() ? ",\n" : "\n");
      }
      std::cout << "  ]";
      // Add prefetch stats if enabled
      if (prefetch_policy != PrefetchPolicy::NONE) {
        auto pf_stats = processor.get_prefetch_stats();
        std::cout << ",\n  \"prefetch\": {\n"
                  << "    \"policy\": \"" << prefetch_policy_name(prefetch_policy) << "\",\n"
                  << "    \"degree\": " << prefetch_degree << ",\n"
                  << "    \"issued\": " << pf_stats.prefetches_issued << ",\n"
                  << "    \"useful\": " << pf_stats.prefetches_useful << ",\n"
                  << "    \"accuracy\": " << std::fixed << std::setprecision(3) << pf_stats.accuracy() << "\n"
                  << "  }";
      }
      std::cout << "\n}\n";
    } else {
      std::cout << "\n=== Cache Simulation Results ===\n";
      std::cout << "Config: " << config_name << "\n";
      std::cout << "Events: " << events.size() << "\n\n";

      std::cout << "Level     Hits       Misses     Hit Rate   Writebacks\n";
      std::cout << "-------   --------   --------   --------   ----------\n";

      auto print_level = [](const char *name, const CacheStats &s) {
        std::cout << std::left << std::setw(10) << name
                  << std::setw(11) << s.hits
                  << std::setw(11) << s.misses
                  << std::fixed << std::setprecision(1) << (s.hit_rate() * 100) << "%"
                  << std::setw(8) << ""
                  << s.writebacks << "\n";
      };

      print_level("L1d", stats.l1d);
      print_level("L1i", stats.l1i);
      print_level("L2", stats.l2);
      print_level("L3", stats.l3);

      if (!hot.empty()) {
        std::cout << "\n=== Hottest Lines ===\n";
        for (const auto &s : hot) {
          std::cout << s.file << ":" << s.line << " - "
                    << s.misses << " misses\n";
        }
      }
    }
  }

  return 0;
}
