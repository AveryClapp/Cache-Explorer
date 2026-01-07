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
  // Multi-core version with false sharing analysis
  static std::vector<OptimizationSuggestion>
  analyze(const std::vector<FalseSharingReport> &false_sharing,
          const std::vector<MultiCoreSourceStats> &hot_lines,
          const MultiCoreStats &stats, uint32_t line_size);

  // Single-core version
  static std::vector<OptimizationSuggestion>
  analyze(const std::vector<SourceStats> &hot_lines, const CacheStats &l1_stats,
          const CacheStats &l2_stats);
};
