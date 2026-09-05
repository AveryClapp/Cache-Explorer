#include "include/TraceProcessor.hpp"
#include <algorithm>
#include <sstream>

namespace {

std::string severity_for_share(double share) {
  if (share >= 0.40)
    return "high";
  if (share >= 0.15)
    return "medium";
  return "low";
}

std::string format_percent(double share) {
  std::ostringstream out;
  out.setf(std::ios::fixed);
  out.precision(0);
  out << (share * 100.0) << "%";
  return out.str();
}

} // namespace

SourceStats *TraceProcessor::find_or_create_source_stats(std::string_view file,
                                                         uint32_t line) {
  if (file.empty())
    return nullptr;

  SourceKey key{std::string(file), line};
  auto it = source_stats.find(key);
  if (it == source_stats.end()) {
    SourceStats stats{.file = key.file, .line = line};
    auto [inserted_it, _] = source_stats.emplace(std::move(key), std::move(stats));
    it = inserted_it;
  }
  return &it->second;
}

void TraceProcessor::process_line_access(const TraceEvent &event,
                                         uint64_t line_addr, bool is_write,
                                         bool is_icache) {
  SystemAccessResult result;
  if (is_icache) {
    result = cache.fetch(line_addr);
  } else if (is_write) {
    result = cache.write(line_addr);
  } else {
    result = cache.read(line_addr);
  }

  // Track prefetch usefulness
  if (!is_write && prefetched_addresses.count(line_addr)) {
    sw_prefetch_stats.useful++;
    prefetched_addresses.erase(line_addr);
  }

  SourceStats *source = find_or_create_source_stats(event.file, event.line);
  if (source != nullptr) {
    if (result.l1_hit)
      source->hits++;
    else
      source->misses++;
  }

  // Feed the OoO pipeline model: instruction fetches supply the dynamic
  // instruction count and front-end stalls; data accesses supply back-end
  // memory stalls.
  if (is_icache) {
    uint32_t instructions = event.size / 4;
    uint64_t stall =
        pipeline.on_inst_fetch(result.l1_hit, result.l2_hit, result.l3_hit,
                               instructions);
    if (source != nullptr) {
      source->instructions += instructions;
      source->frontend_stall_cycles += stall;
    }
  } else {
    uint64_t stall =
        pipeline.on_data_access(result.l1_hit, result.l2_hit, result.l3_hit);
    if (source != nullptr) {
      source->memory_stall_cycles += stall;
    }
  }

  code_hotspots.record(event, is_write, result.l1_hit, result.l2_hit,
                       result.l3_hit);

  if (event_callback) {
    event_callback({result.l1_hit, result.l2_hit, result.l3_hit, line_addr,
                    event.size, event.file, event.line});
  }
}

TraceProcessor::TraceProcessor(const CacheHierarchyConfig &cfg)
    : cache(cfg),
      pipeline(PipelineConfig{
          .issue_width = cfg.issue_width,
          .rob_size = cfg.rob_size,
          .branch_mispredict_penalty = cfg.branch_mispredict_penalty,
          .latency = cfg.latency}) {}

void TraceProcessor::set_event_callback(
    std::function<void(const EventResult &)> cb) {
  event_callback = std::move(cb);
}

void TraceProcessor::enable_prefetching(PrefetchPolicy policy, int degree) {
  cache.enable_prefetching(policy, degree);
}

void TraceProcessor::disable_prefetching() { cache.disable_prefetching(); }

bool TraceProcessor::is_prefetching_enabled() const {
  return cache.is_prefetching_enabled();
}

PrefetchPolicy TraceProcessor::get_prefetch_policy() const {
  return cache.get_prefetch_policy();
}

const PrefetchStats &TraceProcessor::get_prefetch_stats() const {
  return cache.get_prefetch_stats();
}

void TraceProcessor::process(const TraceEvent &event) {
  // Conditional branch: feed the predictor and the pipeline; it touches no
  // cache (the branch-site id is not a memory address).
  if (event.is_branch) {
    bool mispredicted = branch_predictor.process(event.branch_id,
                                                 event.branch_taken,
                                                 event.file, event.line);
    uint64_t stall = pipeline.on_branch(mispredicted);
    if (SourceStats *source =
            find_or_create_source_stats(event.file, event.line)) {
      source->branches++;
      if (mispredicted) {
        source->branch_mispredictions++;
        source->branch_stall_cycles += stall;
      }
    }
    return;
  }

  uint32_t line_size = event.is_icache ? cache.get_l1i().get_line_size()
                                       : cache.get_l1d().get_line_size();

  // Handle software prefetch hints
  if (event.is_prefetch) {
    sw_prefetch_stats.issued++;
    // Prefetch the cache line without counting as demand access
    uint64_t line_addr = (event.address / line_size) * line_size;
    // Just warm the cache - don't count in stats
    cache.read(line_addr); // Read brings it into cache
    prefetched_addresses.insert(line_addr);
    return; // Don't process further
  }

  // Handle memcpy - generates reads from source and writes to dest
  if (event.is_memcpy || event.is_memmove) {
    if (event.is_memcpy) {
      mem_intrinsic_stats.memcpy_count++;
      mem_intrinsic_stats.memcpy_bytes += event.size;
    } else {
      mem_intrinsic_stats.memmove_count++;
      mem_intrinsic_stats.memmove_bytes += event.size;
    }

    // Process source reads
    auto src_lines = split_access_to_cache_lines(
        {event.src_address, event.size, false}, line_size);
    for (const auto &line_access : src_lines) {
      process_line_access(event, line_access.line_address, false, false);
    }

    // Process dest writes
    auto dst_lines = split_access_to_cache_lines(
        {event.address, event.size, true}, line_size);
    for (const auto &line_access : dst_lines) {
      process_line_access(event, line_access.line_address, true, false);
    }
    return;
  }

  // Handle memset - generates writes to destination
  if (event.is_memset) {
    mem_intrinsic_stats.memset_count++;
    mem_intrinsic_stats.memset_bytes += event.size;

    auto lines =
        split_access_to_cache_lines({event.address, event.size, true}, line_size);
    for (const auto &line_access : lines) {
      process_line_access(event, line_access.line_address, true, false);
    }
    return;
  }

  // Track vector statistics
  if (event.is_vector) {
    if (event.is_write) {
      vector_stats.stores++;
      vector_stats.bytes_stored += event.size;
    } else {
      vector_stats.loads++;
      vector_stats.bytes_loaded += event.size;
    }
  }

  // Track atomic statistics
  if (event.is_atomic) {
    if (event.is_cmpxchg) {
      atomic_stats.cmpxchg_count++;
    } else if (event.is_rmw) {
      atomic_stats.rmw_count++;
    } else if (event.is_write) {
      atomic_stats.store_count++;
    } else {
      atomic_stats.load_count++;
    }
  }

  // Standard processing for regular loads/stores, vectors, and atomics
  auto lines = split_access_to_cache_lines(
      {event.address, event.size, event.is_write}, line_size);

  // Track cross-line accesses for vectors
  if (event.is_vector && lines.size() > 1) {
    vector_stats.cross_line_accesses++;
  }

  for (const auto &line_access : lines) {
    process_line_access(event, line_access.line_address, event.is_write,
                        event.is_icache);
  }
}

HierarchyStats TraceProcessor::get_stats() const { return cache.get_stats(); }

std::vector<SourceStats> TraceProcessor::get_hot_lines(size_t limit) const {
  std::vector<SourceStats> sorted;
  for (const auto &[key, stats] : source_stats) {
    sorted.push_back(stats);
  }
  std::sort(sorted.begin(), sorted.end(),
            [](const auto &a, const auto &b) { return a.misses > b.misses; });
  if (sorted.size() > limit)
    sorted.resize(limit);
  return sorted;
}

std::vector<CodeHotspot>
TraceProcessor::get_code_hotspots(size_t limit) const {
  return code_hotspots.hottest(limit);
}

void TraceProcessor::reset() {
  cache.reset_stats();
  source_stats.clear();
  code_hotspots.reset();
  sw_prefetch_stats = {};
  vector_stats = {};
  atomic_stats = {};
  mem_intrinsic_stats = {};
  prefetched_addresses.clear();
  branch_predictor.reset();
  pipeline.reset();
}

const CacheSystem &TraceProcessor::get_cache_system() const { return cache; }

const SoftwarePrefetchStats &TraceProcessor::get_software_prefetch_stats() const {
  return sw_prefetch_stats;
}

const VectorStats &TraceProcessor::get_vector_stats() const {
  return vector_stats;
}

const AtomicStats &TraceProcessor::get_atomic_stats() const {
  return atomic_stats;
}

const MemoryIntrinsicStats &TraceProcessor::get_memory_intrinsic_stats() const {
  return mem_intrinsic_stats;
}

const BranchPredictionStats &TraceProcessor::get_branch_prediction_stats() const {
  return branch_predictor.stats();
}

std::vector<BranchSiteStats>
TraceProcessor::get_branch_hot_mispredicts(size_t limit) const {
  return branch_predictor.hot_mispredicts(limit);
}

PipelineStats TraceProcessor::get_pipeline_stats() const {
  return pipeline.finish();
}

std::vector<SourceAnnotation>
TraceProcessor::get_source_annotations(size_t limit) const {
  PipelineStats pipe = pipeline.finish();
  uint64_t total_cycles = pipe.total_cycles();
  std::vector<SourceAnnotation> annotations;
  annotations.reserve(source_stats.size());

  auto share = [total_cycles](uint64_t cycles) {
    return total_cycles ? static_cast<double>(cycles) / total_cycles : 0.0;
  };

  for (const auto &[key, stats] : source_stats) {
    (void)key;
    if (stats.memory_stall_cycles > 0) {
      double s = share(stats.memory_stall_cycles);
      annotations.push_back({
          .subsystem = "memory",
          .severity = severity_for_share(s),
          .file = stats.file,
          .line = stats.line,
          .label = "Memory stall source",
          .detail = "Memory stalls account for " + format_percent(s) +
                    " of estimated cycles at this line.",
          .cycles = stats.memory_stall_cycles,
          .misses = stats.misses,
          .branch_mispredictions = 0,
          .share = s,
      });
    }
    if (stats.frontend_stall_cycles > 0) {
      double s = share(stats.frontend_stall_cycles);
      annotations.push_back({
          .subsystem = "frontend",
          .severity = severity_for_share(s),
          .file = stats.file,
          .line = stats.line,
          .label = "Frontend stall source",
          .detail = "Instruction-cache/front-end stalls account for " +
                    format_percent(s) + " of estimated cycles at this line.",
          .cycles = stats.frontend_stall_cycles,
          .misses = stats.misses,
          .branch_mispredictions = 0,
          .share = s,
      });
    }
    if (stats.branch_stall_cycles > 0) {
      double s = share(stats.branch_stall_cycles);
      annotations.push_back({
          .subsystem = "branch",
          .severity = severity_for_share(s),
          .file = stats.file,
          .line = stats.line,
          .label = "Branch misprediction source",
          .detail = "Branch mispredictions account for " + format_percent(s) +
                    " of estimated cycles at this line.",
          .cycles = stats.branch_stall_cycles,
          .misses = 0,
          .branch_mispredictions = stats.branch_mispredictions,
          .share = s,
      });
    }
  }

  std::sort(annotations.begin(), annotations.end(),
            [](const auto &a, const auto &b) {
              if (a.cycles != b.cycles)
                return a.cycles > b.cycles;
              return a.share > b.share;
            });

  if (annotations.size() > limit)
    annotations.resize(limit);
  return annotations;
}

BottleneckSummary TraceProcessor::get_bottleneck_summary() const {
  PipelineStats pipe = pipeline.finish();
  BottleneckSummary summary;
  summary.estimated_cycles = pipe.total_cycles();

  uint64_t memory = pipe.memory_stall_cycles();
  uint64_t frontend = pipe.frontend_stall_cycles;
  uint64_t branch = pipe.branch_stall_cycles;
  uint64_t max_stall = std::max({memory, frontend, branch});

  if (summary.estimated_cycles == 0 || max_stall == 0) {
    summary.primary_bottleneck = "balanced";
    summary.reason = "No dominant estimated stall source was observed.";
    return summary;
  }

  summary.bottleneck_share =
      static_cast<double>(max_stall) / summary.estimated_cycles;
  if (summary.bottleneck_share < 0.15) {
    summary.primary_bottleneck = "balanced";
    summary.reason = "Estimated cycles are not dominated by one stall source.";
  } else if (max_stall == memory) {
    summary.primary_bottleneck = "memory";
    summary.reason = "Memory stalls account for " +
                     format_percent(summary.bottleneck_share) +
                     " of estimated cycles.";
  } else if (max_stall == branch) {
    summary.primary_bottleneck = "branch";
    summary.reason = "Branch mispredictions account for " +
                     format_percent(summary.bottleneck_share) +
                     " of estimated cycles.";
  } else {
    summary.primary_bottleneck = "frontend";
    summary.reason = "Frontend stalls account for " +
                     format_percent(summary.bottleneck_share) +
                     " of estimated cycles.";
  }

  summary.confidence = summary.bottleneck_share >= 0.40 ? "high" : "medium";

  const SourceStats *top = nullptr;
  uint64_t top_cycles = 0;
  for (const auto &[key, stats] : source_stats) {
    (void)key;
    uint64_t cycles = 0;
    if (summary.primary_bottleneck == "memory") {
      cycles = stats.memory_stall_cycles;
    } else if (summary.primary_bottleneck == "branch") {
      cycles = stats.branch_stall_cycles;
    } else if (summary.primary_bottleneck == "frontend") {
      cycles = stats.frontend_stall_cycles;
    } else {
      cycles = stats.total_stall_cycles();
    }
    if (cycles > top_cycles) {
      top = &stats;
      top_cycles = cycles;
    }
  }

  if (top != nullptr && top_cycles > 0) {
    summary.top_source.subsystem = summary.primary_bottleneck;
    summary.top_source.severity = severity_for_share(summary.bottleneck_share);
    summary.top_source.file = top->file;
    summary.top_source.line = top->line;
    summary.top_source.label = "Primary bottleneck source";
    summary.top_source.cycles = top_cycles;
    summary.top_source.misses = top->misses;
    summary.top_source.branch_mispredictions = top->branch_mispredictions;
    summary.top_source.share = summary.bottleneck_share;
    summary.has_top_source = true;
  }
  return summary;
}
