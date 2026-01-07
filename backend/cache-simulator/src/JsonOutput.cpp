#include "../include/JsonOutput.hpp"
#include <iomanip>
#include <unordered_map>

// ========== Utility Functions ==========

std::string JsonOutput::escape(std::string_view s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) {
        if (c == '"') out += "\\\"";
        else if (c == '\\') out += "\\\\";
        else out += c;
    }
    return out;
}

const char* JsonOutput::coherence_state_char(CoherenceState state) {
    switch (state) {
        case CoherenceState::Modified: return "M";
        case CoherenceState::Exclusive: return "E";
        case CoherenceState::Shared: return "S";
        case CoherenceState::Invalid: return "I";
    }
    return "I";
}

// ========== Cache State Visualization ==========

void JsonOutput::write_cache_state(std::ostream& out, const CacheLevel& cache,
                                   int core, bool first, bool multicore) {
    const auto& sets = cache.get_sets();
    int num_sets = cache.get_num_sets();
    int assoc = cache.get_associativity();

    if (!first) out << ",";
    out << "{\"core\":" << core
        << ",\"sets\":" << num_sets
        << ",\"ways\":" << assoc
        << ",\"lines\":[";

    bool first_line = true;
    for (int set = 0; set < num_sets; set++) {
        for (int way = 0; way < assoc; way++) {
            const auto& line = sets[set][way];
            if (!first_line) out << ",";
            first_line = false;

            if (line.valid) {
                const char* state;
                if (multicore) {
                    state = coherence_state_char(line.coherence_state);
                } else {
                    // Single-core: derive state from dirty bit (M=dirty, E=clean)
                    state = line.dirty ? "M" : "E";
                }
                out << "{\"s\":" << set
                    << ",\"w\":" << way
                    << ",\"v\":1"
                    << ",\"t\":\"0x" << std::hex << line.tag << std::dec << "\""
                    << ",\"st\":\"" << state << "\"}";
            } else {
                out << "{\"s\":" << set << ",\"w\":" << way << ",\"v\":0}";
            }
        }
    }
    out << "]}";
}

// ========== Cache Statistics ==========

void JsonOutput::write_cache_stats(std::ostream& out, const char* name,
                                   const CacheStats& stats, bool last) {
    out << "    \"" << name << "\": {"
        << "\"hits\": " << stats.hits << ", "
        << "\"misses\": " << stats.misses << ", "
        << "\"hitRate\": " << std::fixed << std::setprecision(3) << stats.hit_rate() << ", "
        << "\"writebacks\": " << stats.writebacks << ", "
        << "\"compulsory\": " << stats.compulsory_misses << ", "
        << "\"capacity\": " << stats.capacity_misses << ", "
        << "\"conflict\": " << stats.conflict_misses << "}"
        << (last ? "\n" : ",\n");
}

// ========== TLB Statistics ==========

void JsonOutput::write_tlb_stats(std::ostream& out, const TLBHierarchyStats& stats) {
    out << "  \"tlb\": {\n";
    out << "    \"dtlb\": {\"hits\": " << stats.dtlb.hits
        << ", \"misses\": " << stats.dtlb.misses
        << ", \"hitRate\": " << std::fixed << std::setprecision(3) << stats.dtlb.hit_rate() << "},\n";
    out << "    \"itlb\": {\"hits\": " << stats.itlb.hits
        << ", \"misses\": " << stats.itlb.misses
        << ", \"hitRate\": " << std::fixed << std::setprecision(3) << stats.itlb.hit_rate() << "}\n";
    out << "  },\n";
}

// ========== Timing Statistics ==========

void JsonOutput::write_timing_stats(std::ostream& out, const TimingStats& timing,
                                    uint64_t total_accesses,
                                    const LatencyConfig& latency) {
    out << "  \"timing\": {\n";
    out << "    \"totalCycles\": " << timing.total_cycles << ",\n";
    out << "    \"avgLatency\": " << std::fixed << std::setprecision(2)
        << timing.average_access_latency(total_accesses) << ",\n";
    out << "    \"breakdown\": {\n";
    out << "      \"l1HitCycles\": " << timing.l1_hit_cycles << ",\n";
    out << "      \"l2HitCycles\": " << timing.l2_hit_cycles << ",\n";
    out << "      \"l3HitCycles\": " << timing.l3_hit_cycles << ",\n";
    out << "      \"memoryCycles\": " << timing.memory_cycles << ",\n";
    out << "      \"tlbMissCycles\": " << timing.tlb_miss_cycles << "\n";
    out << "    },\n";
    out << "    \"latencyConfig\": {\n";
    out << "      \"l1Hit\": " << latency.l1_hit << ",\n";
    out << "      \"l2Hit\": " << latency.l2_hit << ",\n";
    out << "      \"l3Hit\": " << latency.l3_hit << ",\n";
    out << "      \"memory\": " << latency.memory << ",\n";
    out << "      \"tlbMissPenalty\": " << latency.tlb_miss_penalty << "\n";
    out << "    }\n";
    out << "  },\n";
}

void JsonOutput::write_timing_stats_multicore(std::ostream& out,
                                               const CacheStats& l1_total,
                                               const CacheStats& l2,
                                               const CacheStats& l3,
                                               const LatencyConfig& latency) {
    uint64_t l1_hit_cycles = l1_total.hits * latency.l1_hit;
    uint64_t l2_hit_cycles = l2.hits * latency.l2_hit;
    uint64_t l3_hit_cycles = l3.hits * latency.l3_hit;
    uint64_t memory_cycles = l3.misses * latency.memory;
    uint64_t total_cycles = l1_hit_cycles + l2_hit_cycles + l3_hit_cycles + memory_cycles;
    uint64_t total_accesses = l1_total.hits + l1_total.misses;
    double avg_latency = total_accesses > 0 ? static_cast<double>(total_cycles) / total_accesses : 0.0;

    out << ",\"timing\":{"
        << "\"totalCycles\":" << total_cycles << ","
        << "\"avgLatency\":" << std::fixed << std::setprecision(2) << avg_latency << ","
        << "\"breakdown\":{\"l1HitCycles\":" << l1_hit_cycles
        << ",\"l2HitCycles\":" << l2_hit_cycles
        << ",\"l3HitCycles\":" << l3_hit_cycles
        << ",\"memoryCycles\":" << memory_cycles
        << ",\"tlbMissCycles\":0},"
        << "\"latencyConfig\":{"
        << "\"l1Hit\":" << latency.l1_hit << ","
        << "\"l2Hit\":" << latency.l2_hit << ","
        << "\"l3Hit\":" << latency.l3_hit << ","
        << "\"memory\":" << latency.memory << ","
        << "\"tlbMissPenalty\":" << latency.tlb_miss_penalty
        << "}}";
}

// ========== Hot Lines ==========

void JsonOutput::write_hot_lines(std::ostream& out, const std::vector<SourceStats>& hot) {
    out << "  \"hotLines\": [\n";
    for (size_t i = 0; i < hot.size(); i++) {
        const auto& h = hot[i];
        out << "    {\"file\": \"" << escape(h.file) << "\", "
            << "\"line\": " << h.line << ", "
            << "\"hits\": " << h.hits << ", "
            << "\"misses\": " << h.misses << ", "
            << "\"missRate\": " << std::fixed << std::setprecision(3) << h.miss_rate() << "}"
            << (i + 1 < hot.size() ? ",\n" : "\n");
    }
    out << "  ],\n";
}

void JsonOutput::write_hot_lines_multicore(std::ostream& out,
                                           const std::vector<MultiCoreSourceStats>& hot) {
    out << "  \"hotLines\": [\n";
    for (size_t i = 0; i < hot.size(); i++) {
        const auto& h = hot[i];
        out << "    {\"file\": \"" << escape(h.file) << "\", "
            << "\"line\": " << h.line << ", "
            << "\"hits\": " << h.hits << ", "
            << "\"misses\": " << h.misses << ", "
            << "\"missRate\": " << std::fixed << std::setprecision(3) << h.miss_rate() << ", "
            << "\"threads\": " << h.threads.size() << "}"
            << (i + 1 < hot.size() ? ",\n" : "\n");
    }
    out << "  ],\n";
}

// ========== Optimization Suggestions ==========

void JsonOutput::write_suggestions(std::ostream& out,
                                   const std::vector<OptimizationSuggestion>& suggestions) {
    out << "  \"suggestions\": [\n";
    for (size_t i = 0; i < suggestions.size(); i++) {
        const auto& s = suggestions[i];
        out << "    {\"type\": \"" << s.type << "\", "
            << "\"severity\": \"" << s.severity << "\", "
            << "\"location\": \"" << escape(s.location) << "\", "
            << "\"message\": \"" << escape(s.message) << "\", "
            << "\"fix\": \"" << escape(s.fix) << "\"}"
            << (i + 1 < suggestions.size() ? ",\n" : "\n");
    }
    out << "  ]";
}

// ========== False Sharing ==========

void JsonOutput::write_false_sharing(std::ostream& out,
                                     const std::vector<FalseSharingReport>& reports) {
    out << "  \"falseSharing\": [\n";
    for (size_t i = 0; i < reports.size(); i++) {
        const auto& fs = reports[i];
        out << "    {\"cacheLineAddr\": \"0x" << std::hex << fs.cache_line_addr << std::dec << "\", "
            << "\"accessCount\": " << fs.accesses.size() << ", "
            << "\"accesses\": [";

        // Group accesses by thread for cleaner output
        std::unordered_map<uint32_t, std::vector<const FalseSharingEvent*>> by_thread;
        for (const auto& a : fs.accesses) {
            by_thread[a.thread_id].push_back(&a);
        }

        bool first_thread = true;
        for (const auto& [tid, thread_accesses] : by_thread) {
            if (!first_thread) out << ", ";
            first_thread = false;

            // Show first access per thread
            const auto& a = *thread_accesses[0];
            out << "{\"threadId\": " << tid << ", "
                << "\"offset\": " << a.byte_offset << ", "
                << "\"isWrite\": " << (a.is_write ? "true" : "false") << ", "
                << "\"file\": \"" << escape(a.file) << "\", "
                << "\"line\": " << a.line << ", "
                << "\"count\": " << thread_accesses.size() << "}";
        }
        out << "]}"
            << (i + 1 < reports.size() ? ",\n" : "\n");
    }
    out << "  ],\n";
}

void JsonOutput::write_false_sharing_compact(std::ostream& out,
                                             const std::vector<FalseSharingReport>& reports) {
    out << ",\"falseSharing\":[";
    for (size_t i = 0; i < reports.size(); i++) {
        if (i > 0) out << ",";
        const auto& fs = reports[i];
        out << "{\"addr\":\"0x" << std::hex << fs.cache_line_addr << std::dec << "\""
            << ",\"accesses\":" << fs.accesses.size() << "}";
    }
    out << "]";
}

// ========== Prefetch Statistics ==========

void JsonOutput::write_prefetch_stats(std::ostream& out, std::string_view policy_name,
                                      int degree, const PrefetchStats& stats) {
    out << ",\n  \"prefetch\": {\n"
        << "    \"policy\": \"" << policy_name << "\",\n"
        << "    \"degree\": " << degree << ",\n"
        << "    \"issued\": " << stats.prefetches_issued << ",\n"
        << "    \"useful\": " << stats.prefetches_useful << ",\n"
        << "    \"accuracy\": " << std::fixed << std::setprecision(3) << stats.accuracy() << "\n"
        << "  }";
}

// ========== Cache Configuration ==========

void JsonOutput::write_cache_config(std::ostream& out, const CacheHierarchyConfig& cfg) {
    out << "  \"cacheConfig\": {\n";
    out << "    \"l1d\": {\"sizeKB\": " << cfg.l1_data.kb_size
        << ", \"assoc\": " << cfg.l1_data.associativity
        << ", \"lineSize\": " << cfg.l1_data.line_size
        << ", \"sets\": " << cfg.l1_data.num_sets() << "},\n";
    out << "    \"l1i\": {\"sizeKB\": " << cfg.l1_inst.kb_size
        << ", \"assoc\": " << cfg.l1_inst.associativity
        << ", \"lineSize\": " << cfg.l1_inst.line_size
        << ", \"sets\": " << cfg.l1_inst.num_sets() << "},\n";
    out << "    \"l2\": {\"sizeKB\": " << cfg.l2.kb_size
        << ", \"assoc\": " << cfg.l2.associativity
        << ", \"lineSize\": " << cfg.l2.line_size
        << ", \"sets\": " << cfg.l2.num_sets() << "},\n";
    out << "    \"l3\": {\"sizeKB\": " << cfg.l3.kb_size
        << ", \"assoc\": " << cfg.l3.associativity
        << ", \"lineSize\": " << cfg.l3.line_size
        << ", \"sets\": " << cfg.l3.num_sets() << "}\n";
    out << "  },\n";
}

// ========== Coherence Statistics ==========

void JsonOutput::write_coherence_stats(std::ostream& out, uint64_t invalidations,
                                       uint64_t false_sharing_events) {
    out << "  \"coherence\": {\n";
    out << "    \"invalidations\": " << invalidations << ",\n";
    out << "    \"falseSharingEvents\": " << false_sharing_events << "\n";
    out << "  },\n";
}

// ========== Streaming Mode Messages ==========

void JsonOutput::write_stream_start(std::ostream& out, std::string_view config_name,
                                    bool multicore) {
    out << "{\"type\":\"start\",\"config\":\"" << config_name
        << "\",\"multicore\":" << (multicore ? "true" : "false") << "}\n" << std::flush;
}

void JsonOutput::write_stream_progress(std::ostream& out, size_t event_count,
                                       size_t thread_count, const CacheStats& l1_total,
                                       const CacheStats& l2, const CacheStats& l3,
                                       uint64_t coherence_invalidations,
                                       const std::vector<TimelineEvent>& timeline) {
    out << "{\"type\":\"progress\""
        << ",\"events\":" << event_count
        << ",\"threads\":" << thread_count
        << ",\"l1d\":{\"hits\":" << l1_total.hits << ",\"misses\":" << l1_total.misses << "}"
        << ",\"l2\":{\"hits\":" << l2.hits << ",\"misses\":" << l2.misses << "}"
        << ",\"l3\":{\"hits\":" << l3.hits << ",\"misses\":" << l3.misses << "}"
        << ",\"coherence\":" << coherence_invalidations
        << ",\"timeline\":[";

    for (size_t i = 0; i < timeline.size(); i++) {
        if (i > 0) out << ",";
        const auto& e = timeline[i];
        out << "{\"i\":" << e.index
            << ",\"t\":\"" << (e.is_icache ? "I" : (e.is_write ? "W" : "R")) << "\""
            << ",\"l\":" << e.hit_level
            << ",\"a\":" << e.address;
        if (!e.file.empty()) {
            out << ",\"f\":\"" << escape(e.file) << "\",\"n\":" << e.line;
        }
        out << "}";
    }
    out << "]}\n" << std::flush;
}
