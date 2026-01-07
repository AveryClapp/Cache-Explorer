#include "include/MultiCoreTraceProcessor.hpp"
#include <algorithm>

void MultiCoreTraceProcessor::process(const TraceEvent &event) {
    seen_threads.insert(event.thread_id);

    auto lines = split_access_to_cache_lines(
        {event.address, event.size, event.is_write}, cache.get_line_size());

    for (const auto &line_access : lines) {
        MultiCoreAccessResult result;
        // Pass original address for false sharing detection (preserves byte offset)
        if (event.is_write) {
            result = cache.write(event.address, event.thread_id,
                                 event.file, event.line);
        } else {
            result = cache.read(event.address, event.thread_id,
                                event.file, event.line);
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
                            line_access.line_address, event.size, event.file,
                            event.line});
        }
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
