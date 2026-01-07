#include "include/TraceProcessor.hpp"
#include <algorithm>

std::string TraceProcessor::make_key(std::string_view file, uint32_t line) {
  return std::string(file) + ":" + std::to_string(line);
}

void TraceProcessor::process_line_access(uint64_t line_addr, bool is_write,
                                         bool is_icache, std::string_view file,
                                         uint32_t line, uint32_t event_size) {
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

  if (!file.empty()) {
    auto key = make_key(file, line);
    auto &stats = source_stats[key];
    stats.file = std::string(file);
    stats.line = line;
    if (result.l1_hit)
      stats.hits++;
    else
      stats.misses++;
  }

  if (event_callback) {
    event_callback({result.l1_hit, result.l2_hit, result.l3_hit, line_addr,
                    event_size, std::string(file), line});
  }
}

TraceProcessor::TraceProcessor(const CacheHierarchyConfig &cfg) : cache(cfg) {}

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
      process_line_access(line_access.line_address, false, false, event.file,
                          event.line, event.size);
    }

    // Process dest writes
    auto dst_lines = split_access_to_cache_lines(
        {event.address, event.size, true}, line_size);
    for (const auto &line_access : dst_lines) {
      process_line_access(line_access.line_address, true, false, event.file,
                          event.line, event.size);
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
      process_line_access(line_access.line_address, true, false, event.file,
                          event.line, event.size);
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
    process_line_access(line_access.line_address, event.is_write,
                        event.is_icache, event.file, event.line, event.size);
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

void TraceProcessor::reset() {
  cache.reset_stats();
  source_stats.clear();
  sw_prefetch_stats = {};
  vector_stats = {};
  atomic_stats = {};
  mem_intrinsic_stats = {};
  prefetched_addresses.clear();
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
