#include "../include/MultiCoreTraceProcessor.hpp"
#include "../include/TraceProcessor.hpp"
#include "../profiles/HardwarePresets.hpp"
#include <iomanip>
#include <iostream>
#include <unordered_set>
#include <vector>

void print_usage(const char *prog) {
  std::cerr << "Usage: " << prog << " [options]\n"
            << "Options:\n"
            << "  --config <name>   intel|amd|apple|educational (default: intel)\n"
            << "  --cores <n>       Number of cores to simulate (default: auto)\n"
            << "  --verbose         Print each cache event\n"
            << "  --json            Output JSON format\n"
            << "  --help            Show this help\n";
}

CacheHierarchyConfig get_config(const std::string &name) {
  if (name == "amd") return make_amd_zen4_config();
  if (name == "apple") return make_apple_m_series_config();
  if (name == "educational") return make_educational_config();
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
    } else if (arg == "--help") {
      print_usage(argv[0]);
      return 0;
    }
  }

  // Read all events first to detect thread count
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

  auto cfg = get_config(config_name);

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
        l1_total.hits += l1.hits;
        l1_total.misses += l1.misses;
        l1_total.writebacks += l1.writebacks;
      }

      std::cout << "  \"levels\": {\n";
      auto json_level = [](const char *name, const CacheStats &s, bool last) {
        std::cout << "    \"" << name << "\": {"
                  << "\"hits\": " << s.hits << ", "
                  << "\"misses\": " << s.misses << ", "
                  << "\"hitRate\": " << std::fixed << std::setprecision(3) << s.hit_rate() << ", "
                  << "\"writebacks\": " << s.writebacks << "}"
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
                  << "\"accessCount\": " << fs.accesses.size() << "}"
                  << (i + 1 < false_sharing.size() ? ",\n" : "\n");
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
      std::cout << "  \"levels\": {\n";

      auto json_level = [](const char *name, const CacheStats &s, bool last) {
        std::cout << "    \"" << name << "\": {"
                  << "\"hits\": " << s.hits << ", "
                  << "\"misses\": " << s.misses << ", "
                  << "\"hitRate\": " << std::fixed << std::setprecision(3) << s.hit_rate() << ", "
                  << "\"writebacks\": " << s.writebacks << "}"
                  << (last ? "\n" : ",\n");
      };

      json_level("l1d", stats.l1d, false);
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

      std::cout << "  ]\n";
      std::cout << "}\n";
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
