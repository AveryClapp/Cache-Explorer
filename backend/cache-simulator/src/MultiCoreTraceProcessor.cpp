#include "include/MultiCoreTraceProcessor.hpp"

#include <algorithm>

MultiCoreTraceProcessor::MultiCoreTraceProcessor(int num_cores, const CacheConfig &l1_cfg,
                                                   const CacheConfig &l2_cfg,
                                                   const CacheConfig &l3_cfg,
                                                   PrefetchPolicy prefetch_policy,
                                                   int prefetch_degree)
    : cache(num_cores, l1_cfg, l2_cfg, l3_cfg, prefetch_policy, prefetch_degree) {}

void MultiCoreTraceProcessor::set_event_callback(std::function<void(const EventResult &)> cb) {
    event_callback = std::move(cb);
}

std::string MultiCoreTraceProcessor::make_key(std::string_view file, uint32_t line) {
    return std::string(file) + ":" + std::to_string(line);
}

void MultiCoreTraceProcessor::process_line_access(const TraceEvent &event, uint64_t line_addr, bool is_write) {
    MultiCoreAccessResult result;
    if (is_write) {
        result = cache.write(line_addr, event.thread_id, event.file, event.line);
    } else {
        result = cache.read(line_addr, event.thread_id, event.file, event.line);
    }

    // Track prefetch usefulness
    if (!is_write && prefetched_addresses.count(line_addr)) {
        sw_prefetch_stats.useful++;
        prefetched_addresses.erase(line_addr);
    }

    if (!event.file.empty()) {
        auto key = make_key(event.file, event.line);
        auto &stats = source_stats[key];
        stats.file = event.file;
        stats.line = event.line;
        stats.threads.insert(event.thread_id);
        if (result.l1_hit)
            stats.hits++;
        else
            stats.misses++;
    }

    if (event_callback) {
        event_callback({result.l1_hit, result.l2_hit, result.l3_hit,
                        line_addr, event.size, event.file, event.line});
    }
}

void MultiCoreTraceProcessor::process(const TraceEvent &event) {
    seen_threads.insert(event.thread_id);

    uint32_t line_size = cache.get_line_size();

    // Handle software prefetch hints
    if (event.is_prefetch) {
        sw_prefetch_stats.issued++;
        uint64_t line_addr = (event.address / line_size) * line_size;
        cache.read(line_addr, event.thread_id, event.file, event.line);
        prefetched_addresses.insert(line_addr);
        return;
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
            process_line_access(event, line_access.line_address, false);
        }

        // Process dest writes
        auto dst_lines = split_access_to_cache_lines(
            {event.address, event.size, true}, line_size);
        for (const auto &line_access : dst_lines) {
            process_line_access(event, line_access.line_address, true);
        }
        return;
    }

    // Handle memset - generates writes to destination
    if (event.is_memset) {
        mem_intrinsic_stats.memset_count++;
        mem_intrinsic_stats.memset_bytes += event.size;

        auto lines = split_access_to_cache_lines(
            {event.address, event.size, true}, line_size);
        for (const auto &line_access : lines) {
            process_line_access(event, line_access.line_address, true);
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
        process_line_access(event, line_access.line_address, event.is_write);
    }
}

std::vector<MultiCoreSourceStats> MultiCoreTraceProcessor::get_hot_lines(size_t limit) const {
    std::vector<MultiCoreSourceStats> sorted;
    sorted.reserve(source_stats.size());

    for (const auto &[key, stats] : source_stats) {
        sorted.push_back(stats);
    }

    std::sort(sorted.begin(), sorted.end(),
              [](const auto &a, const auto &b) { return a.misses > b.misses; });

    if (sorted.size() > limit) {
        sorted.resize(limit);
    }

    return sorted;
}

std::vector<FalseSharingReport> MultiCoreTraceProcessor::get_false_sharing_reports() const {
    return cache.get_false_sharing_reports();
}
