#pragma once

#include "CacheStats.hpp"
#include "MultiCoreCacheSystem.hpp"
#include "MultiCoreTraceProcessor.hpp"
#include "TraceProcessor.hpp"
#include <string>
#include <vector>

struct OptimizationSuggestion {
  std::string type;      // "false_sharing", "high_miss_rate", "strided_access"
  std::string severity;  // "high", "medium", "low"
  std::string location;  // file:line or cache line address
  std::string message;
  std::string fix;
};

class OptimizationSuggester {
public:
  static std::vector<OptimizationSuggestion>
  analyze(const std::vector<FalseSharingReport> &false_sharing,
          const std::vector<MultiCoreSourceStats> &hot_lines,
          const MultiCoreStats &stats, uint32_t line_size) {

    std::vector<OptimizationSuggestion> suggestions;

    // Analyze false sharing
    for (const auto &fs : false_sharing) {
      if (fs.accesses.size() < 2) continue;

      // Find unique threads and their byte offsets
      std::unordered_map<uint32_t, std::pair<uint32_t, uint32_t>> thread_offsets;
      for (const auto &a : fs.accesses) {
        auto &range = thread_offsets[a.thread_id];
        if (range.first == 0 && range.second == 0) {
          range = {a.byte_offset, a.byte_offset};
        } else {
          range.first = std::min(range.first, a.byte_offset);
          range.second = std::max(range.second, a.byte_offset);
        }
      }

      if (thread_offsets.size() < 2) continue;

      // Calculate padding needed
      uint32_t min_offset = line_size, max_offset = 0;
      for (const auto &[tid, range] : thread_offsets) {
        min_offset = std::min(min_offset, range.first);
        max_offset = std::max(max_offset, range.second);
      }
      uint32_t padding_needed = line_size - (max_offset - min_offset + 4);

      std::string loc;
      for (const auto &a : fs.accesses) {
        if (!a.file.empty()) {
          loc = a.file + ":" + std::to_string(a.line);
          break;
        }
      }

      suggestions.push_back({
          "false_sharing",
          "high",
          loc.empty() ? ("0x" + std::to_string(fs.cache_line_addr)) : loc,
          "Multiple threads writing to same cache line causes invalidations",
          "Add " + std::to_string(padding_needed) +
              " bytes padding between fields accessed by different threads"});
    }

    // Analyze hot lines with high miss rates
    for (const auto &line : hot_lines) {
      if (line.miss_rate() > 0.5 && line.misses > 100) {
        std::string loc = line.file + ":" + std::to_string(line.line);

        suggestions.push_back({
            "high_miss_rate",
            line.miss_rate() > 0.8 ? "high" : "medium",
            loc,
            "High cache miss rate (" +
                std::to_string(static_cast<int>(line.miss_rate() * 100)) +
                "%) indicates poor cache utilization",
            "Consider restructuring data access pattern or improving spatial "
            "locality"});
      }

      // Multi-threaded hot spots
      if (line.threads.size() > 1 && line.misses > 50) {
        std::string loc = line.file + ":" + std::to_string(line.line);
        suggestions.push_back({
            "contention",
            "medium",
            loc,
            "Multiple threads (" + std::to_string(line.threads.size()) +
                ") accessing this location",
            "Consider thread-local copies or reducing shared data access"});
      }
    }

    // Overall cache efficiency suggestions
    double l1_miss_rate =
        1.0 - (stats.l1_per_core.empty()
                   ? 0
                   : stats.l1_per_core[0].hit_rate());
    if (l1_miss_rate > 0.3) {
      suggestions.push_back(
          {"poor_locality",
           "medium",
           "overall",
           "L1 cache miss rate is high (" +
               std::to_string(static_cast<int>(l1_miss_rate * 100)) + "%)",
           "Review data structures for cache-friendly layout (arrays vs linked "
           "lists, struct of arrays vs array of structs)"});
    }

    // High coherence traffic
    if (stats.coherence_invalidations > 1000) {
      suggestions.push_back(
          {"coherence_traffic",
           "high",
           "overall",
           "High coherence traffic (" +
               std::to_string(stats.coherence_invalidations) +
               " invalidations)",
           "Reduce sharing between threads or use read-only data where "
           "possible"});
    }

    return suggestions;
  }

  // Simpler version for single-core
  static std::vector<OptimizationSuggestion>
  analyze(const std::vector<SourceStats> &hot_lines, const CacheStats &l1_stats,
          const CacheStats &l2_stats) {

    std::vector<OptimizationSuggestion> suggestions;

    for (const auto &line : hot_lines) {
      if (line.miss_rate() > 0.5 && line.misses > 100) {
        std::string loc = line.file + ":" + std::to_string(line.line);

        suggestions.push_back({
            "high_miss_rate",
            line.miss_rate() > 0.8 ? "high" : "medium",
            loc,
            "High cache miss rate (" +
                std::to_string(static_cast<int>(line.miss_rate() * 100)) +
                "%) at this location",
            "Consider improving data locality or prefetching"});
      }
    }

    if (l1_stats.hit_rate() < 0.7) {
      suggestions.push_back(
          {"poor_locality",
           "medium",
           "overall",
           "L1 cache hit rate is low (" +
               std::to_string(static_cast<int>(l1_stats.hit_rate() * 100)) +
               "%)",
           "Review loop structure and data access patterns"});
    }

    return suggestions;
  }
};
