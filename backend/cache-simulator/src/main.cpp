#include "../include/ArgParser.hpp"
#include "../include/JsonOutput.hpp"
#include "../include/MultiCoreTraceProcessor.hpp"
#include "../include/OptimizationSuggester.hpp"
#include "../include/TraceProcessor.hpp"
#include <iomanip>
#include <iostream>
#include <unordered_set>
#include <vector>

// Generate SVG flamegraph showing cache miss distribution
template<typename HotLineType>
void output_flamegraph_svg(const std::vector<HotLineType>& hot_lines, const std::string& title) {
  if (hot_lines.empty()) {
    std::cout << "<!-- No cache misses to display -->\n";
    return;
  }

  // SVG dimensions
  const int width = 800;
  const int bar_height = 20;
  const int margin = 40;
  const int title_height = 30;
  const int legend_height = 40;

  // Calculate max misses for scaling
  uint64_t max_misses = 0;
  uint64_t total_misses = 0;
  for (const auto& h : hot_lines) {
    if (h.misses > max_misses) max_misses = h.misses;
    total_misses += h.misses;
  }

  int height = title_height + (hot_lines.size() * (bar_height + 4)) + legend_height + margin;

  // SVG header
  std::cout << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
  std::cout << "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 " << width << " " << height << "\">\n";
  std::cout << "<style>\n";
  std::cout << "  .title { font: bold 16px sans-serif; fill: #333; }\n";
  std::cout << "  .label { font: 11px monospace; fill: #fff; }\n";
  std::cout << "  .count { font: 10px sans-serif; fill: #666; }\n";
  std::cout << "  .legend { font: 12px sans-serif; fill: #666; }\n";
  std::cout << "  .bar { cursor: pointer; }\n";
  std::cout << "  .bar:hover { opacity: 0.8; }\n";
  std::cout << "</style>\n";

  // Background
  std::cout << "<rect width=\"100%\" height=\"100%\" fill=\"#fafafa\"/>\n";

  // Title
  std::cout << "<text x=\"" << margin << "\" y=\"24\" class=\"title\">"
            << title << " - Cache Miss Distribution</text>\n";

  // Bars
  int y = title_height + 10;
  for (const auto& h : hot_lines) {
    double bar_width = (double)(h.misses) / max_misses * (width - 2 * margin - 100);
    if (bar_width < 1) bar_width = 1;

    // Color based on miss rate
    std::string color;
    double miss_rate = h.miss_rate();
    if (miss_rate > 0.5) color = "#e74c3c";       // Red - high miss rate
    else if (miss_rate > 0.2) color = "#f39c12";  // Orange - medium
    else color = "#27ae60";                        // Green - low

    // Bar
    std::cout << "<g class=\"bar\">\n";
    std::cout << "  <rect x=\"" << margin << "\" y=\"" << y
              << "\" width=\"" << bar_width << "\" height=\"" << bar_height
              << "\" fill=\"" << color << "\" rx=\"2\"/>\n";

    // Label (file:line)
    std::string label = h.file + ":" + std::to_string(h.line);
    if (label.length() > 30) {
      label = "..." + label.substr(label.length() - 27);
    }
    std::cout << "  <text x=\"" << (margin + 4) << "\" y=\"" << (y + 14)
              << "\" class=\"label\">" << label << "</text>\n";

    // Count on right
    std::cout << "  <text x=\"" << (width - margin + 5) << "\" y=\"" << (y + 14)
              << "\" class=\"count\">" << h.misses << " ("
              << std::fixed << std::setprecision(1) << (miss_rate * 100) << "%)</text>\n";
    std::cout << "</g>\n";

    y += bar_height + 4;
  }

  // Legend
  y += 10;
  std::cout << "<text x=\"" << margin << "\" y=\"" << y
            << "\" class=\"legend\">Total: " << total_misses << " misses across "
            << hot_lines.size() << " locations</text>\n";

  std::cout << "</svg>\n";
}

int main(int argc, char *argv[]) {
  // Parse command line arguments
  SimulatorOptions opts = ArgParser::parse(argc, argv);

  if (opts.show_help) {
    ArgParser::print_usage(argv[0]);
    return 0;
  }

  // Extract commonly used values for readability
  const std::string& config_name = opts.config_name;
  int num_cores = opts.num_cores;
  bool verbose = opts.verbose;
  bool json_output = opts.json_output;
  bool stream_mode = opts.stream_mode;
  bool flamegraph_output = opts.flamegraph_output;
  PrefetchPolicy prefetch_policy = opts.prefetch_policy;
  int prefetch_degree = opts.prefetch_degree;
  CacheHierarchyConfig cfg = opts.cache_config;

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
            std::cout << ",\"f\":\"" << JsonOutput::escape(e.file) << "\",\"n\":" << e.line;
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
          std::cout << ",\"f\":\"" << JsonOutput::escape(e.file) << "\",\"n\":" << e.line;
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
      std::cout << "{\"file\":\"" << JsonOutput::escape(hot[i].file) << "\""
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
                << ",\"location\":\"" << JsonOutput::escape(s.location) << "\""
                << ",\"message\":\"" << JsonOutput::escape(s.message) << "\""
                << ",\"fix\":\"" << JsonOutput::escape(s.fix) << "\"}";
    }
    std::cout << "]";

    // TLB statistics from multi-core system
    auto tlb_stats = processor.get_cache_system().get_tlb_stats();
    std::cout << ",\"tlb\":{\"dtlb\":{\"hits\":" << tlb_stats.dtlb.hits
              << ",\"misses\":" << tlb_stats.dtlb.misses
              << ",\"hitRate\":" << std::fixed << std::setprecision(3) << tlb_stats.dtlb.hit_rate()
              << "},\"itlb\":{\"hits\":" << tlb_stats.itlb.hits
              << ",\"misses\":" << tlb_stats.itlb.misses
              << ",\"hitRate\":" << std::fixed << std::setprecision(3) << tlb_stats.itlb.hit_rate()
              << "}}";

    // Timing estimate based on hit counts and latency config
    uint64_t l1_hit_cycles = l1_total.hits * cfg.latency.l1_hit;
    uint64_t l2_hit_cycles = stats.l2.hits * cfg.latency.l2_hit;
    uint64_t l3_hit_cycles = stats.l3.hits * cfg.latency.l3_hit;
    uint64_t memory_cycles = stats.l3.misses * cfg.latency.memory;
    uint64_t total_cycles = l1_hit_cycles + l2_hit_cycles + l3_hit_cycles + memory_cycles;
    uint64_t total_accesses = l1_total.hits + l1_total.misses;
    double avg_latency = total_accesses > 0 ? static_cast<double>(total_cycles) / total_accesses : 0.0;

    std::cout << ",\"timing\":{"
              << "\"totalCycles\":" << total_cycles << ","
              << "\"avgLatency\":" << std::fixed << std::setprecision(2) << avg_latency << ","
              << "\"breakdown\":{\"l1HitCycles\":" << l1_hit_cycles
              << ",\"l2HitCycles\":" << l2_hit_cycles
              << ",\"l3HitCycles\":" << l3_hit_cycles
              << ",\"memoryCycles\":" << memory_cycles
              << ",\"tlbMissCycles\":0},"
              << "\"latencyConfig\":{"
              << "\"l1Hit\":" << cfg.latency.l1_hit << ","
              << "\"l2Hit\":" << cfg.latency.l2_hit << ","
              << "\"l3Hit\":" << cfg.latency.l3_hit << ","
              << "\"memory\":" << cfg.latency.memory << ","
              << "\"tlbMissPenalty\":" << cfg.latency.tlb_miss_penalty
              << "}}";

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
    auto hot = processor.get_hot_lines(flamegraph_output ? 20 : 10);  // More lines for flamegraph
    auto false_sharing = processor.get_false_sharing_reports();

    if (flamegraph_output) {
      output_flamegraph_svg(hot, config_name + " (multi-core)");
      return 0;
    }

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

      // Note: TLB stats not yet available in multi-core mode (per-core TLBs)
      // TODO: Aggregate TLB stats from all cores when MultiCoreCacheSystem supports TLB

      std::cout << "  \"coherence\": {\n";
      std::cout << "    \"invalidations\": " << stats.coherence_invalidations << ",\n";
      std::cout << "    \"falseSharingEvents\": " << stats.false_sharing_events << "\n";
      std::cout << "  },\n";

      std::cout << "  \"hotLines\": [\n";
      for (size_t i = 0; i < hot.size(); i++) {
        const auto &h = hot[i];
        std::cout << "    {\"file\": \"" << JsonOutput::escape(h.file) << "\", "
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
                    << "\"file\": \"" << JsonOutput::escape(a.file) << "\", "
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
                  << "\"location\": \"" << JsonOutput::escape(s.location) << "\", "
                  << "\"message\": \"" << JsonOutput::escape(s.message) << "\", "
                  << "\"fix\": \"" << JsonOutput::escape(s.fix) << "\"}"
                  << (i + 1 < suggestions.size() ? ",\n" : "\n");
      }
      std::cout << "  ],\n";

      // Output L1 cache state for visualization
      std::cout << "  \"cacheState\": {\"l1d\": [";
      const auto& cache_sys = processor.get_cache_system();
      for (int core = 0; core < num_cores; core++) {
        const CacheLevel* l1 = cache_sys.get_l1_cache(core);
        if (l1) {
          JsonOutput::write_cache_state(std::cout, *l1, core, core == 0);
        }
      }
      std::cout << "]}\n";

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
    auto hot = processor.get_hot_lines(20);  // Get more for flamegraph

    if (flamegraph_output) {
      output_flamegraph_svg(hot, config_name);
      return 0;
    }

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

      // TLB statistics
      auto tlb_stats = processor.get_cache_system().get_tlb_stats();
      std::cout << "  \"tlb\": {\n";
      std::cout << "    \"dtlb\": {\"hits\": " << tlb_stats.dtlb.hits
                << ", \"misses\": " << tlb_stats.dtlb.misses
                << ", \"hitRate\": " << std::fixed << std::setprecision(3) << tlb_stats.dtlb.hit_rate() << "},\n";
      std::cout << "    \"itlb\": {\"hits\": " << tlb_stats.itlb.hits
                << ", \"misses\": " << tlb_stats.itlb.misses
                << ", \"hitRate\": " << std::fixed << std::setprecision(3) << tlb_stats.itlb.hit_rate() << "}\n";
      std::cout << "  },\n";

      // Timing statistics
      auto timing = stats.timing;
      auto latency_cfg = processor.get_cache_system().get_latency_config();
      uint64_t total_accesses = stats.l1d.total_accesses() + stats.l1i.total_accesses();
      std::cout << "  \"timing\": {\n";
      std::cout << "    \"totalCycles\": " << timing.total_cycles << ",\n";
      std::cout << "    \"avgLatency\": " << std::fixed << std::setprecision(2) << timing.average_access_latency(total_accesses) << ",\n";
      std::cout << "    \"breakdown\": {\n";
      std::cout << "      \"l1HitCycles\": " << timing.l1_hit_cycles << ",\n";
      std::cout << "      \"l2HitCycles\": " << timing.l2_hit_cycles << ",\n";
      std::cout << "      \"l3HitCycles\": " << timing.l3_hit_cycles << ",\n";
      std::cout << "      \"memoryCycles\": " << timing.memory_cycles << ",\n";
      std::cout << "      \"tlbMissCycles\": " << timing.tlb_miss_cycles << "\n";
      std::cout << "    },\n";
      std::cout << "    \"latencyConfig\": {\n";
      std::cout << "      \"l1Hit\": " << latency_cfg.l1_hit << ",\n";
      std::cout << "      \"l2Hit\": " << latency_cfg.l2_hit << ",\n";
      std::cout << "      \"l3Hit\": " << latency_cfg.l3_hit << ",\n";
      std::cout << "      \"memory\": " << latency_cfg.memory << ",\n";
      std::cout << "      \"tlbMissPenalty\": " << latency_cfg.tlb_miss_penalty << "\n";
      std::cout << "    }\n";
      std::cout << "  },\n";
      std::cout << "  \"hotLines\": [\n";

      for (size_t i = 0; i < hot.size(); i++) {
        const auto &h = hot[i];
        std::cout << "    {\"file\": \"" << JsonOutput::escape(h.file) << "\", "
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
                  << "\"location\": \"" << JsonOutput::escape(s.location) << "\", "
                  << "\"message\": \"" << JsonOutput::escape(s.message) << "\", "
                  << "\"fix\": \"" << JsonOutput::escape(s.fix) << "\"}"
                  << (i + 1 < suggestions.size() ? ",\n" : "\n");
      }
      std::cout << "  ]";
      // Add prefetch stats if enabled
      if (prefetch_policy != PrefetchPolicy::NONE) {
        auto pf_stats = processor.get_prefetch_stats();
        std::cout << ",\n  \"prefetch\": {\n"
                  << "    \"policy\": \"" << ArgParser::prefetch_policy_name(prefetch_policy) << "\",\n"
                  << "    \"degree\": " << prefetch_degree << ",\n"
                  << "    \"issued\": " << pf_stats.prefetches_issued << ",\n"
                  << "    \"useful\": " << pf_stats.prefetches_useful << ",\n"
                  << "    \"accuracy\": " << std::fixed << std::setprecision(3) << pf_stats.accuracy() << "\n"
                  << "  }";
      }

      // Output L1 cache state for visualization (single core = core 0)
      std::cout << ",\n  \"cacheState\": {\"l1d\": [";
      const auto& cache_sys = processor.get_cache_system();
      JsonOutput::write_cache_state(std::cout, cache_sys.get_l1d(), 0, true, false);  // false = single-core mode
      std::cout << "]}";

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
