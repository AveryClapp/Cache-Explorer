#include "../include/JsonOutput.hpp"
#include <cstdio>
#include "../include/PipelineModel.hpp"
#include <algorithm>
#include <iomanip>
#include <sstream>
#include <unordered_map>

namespace {

const char* inclusion_policy_name(InclusionPolicy policy) {
    switch (policy) {
        case InclusionPolicy::Inclusive: return "inclusive";
        case InclusionPolicy::Exclusive: return "exclusive";
        case InclusionPolicy::NINE: return "non-inclusive-non-exclusive";
    }
    return "unknown";
}

const char* eviction_policy_name(EvictionPolicy policy) {
    switch (policy) {
        case EvictionPolicy::LRU: return "lru";
        case EvictionPolicy::PLRU: return "pseudo-lru";
        case EvictionPolicy::RANDOM: return "random";
        case EvictionPolicy::SRRIP: return "srrip";
        case EvictionPolicy::BRRIP: return "brrip";
    }
    return "unknown";
}

const char* write_policy_name(WritePolicy policy) {
    switch (policy) {
        case WritePolicy::Through: return "write-through";
        case WritePolicy::Back: return "write-back";
        case WritePolicy::ReadOnly: return "read-only";
    }
    return "unknown";
}

void write_cache_level_detail(std::ostream& out, const char* name,
                              const CacheConfig& cfg, bool last) {
    out << "        \"" << name << "\": {"
        << "\"sizeKB\": " << cfg.kb_size
        << ", \"associativity\": " << cfg.associativity
        << ", \"lineSize\": " << cfg.line_size
        << ", \"sets\": " << cfg.num_sets()
        << ", \"replacement\": \"" << eviction_policy_name(cfg.policy) << "\""
        << ", \"writePolicy\": \"" << write_policy_name(cfg.write_policy) << "\""
        << "}" << (last ? "\n" : ",\n");
}

void write_bool_field(std::ostream& out, const char* name, bool value, bool last) {
    out << "      \"" << name << "\": " << (value ? "true" : "false")
        << (last ? "\n" : ",\n");
}

std::string hex_address(uint64_t value, int minimum_digits = 1) {
    std::ostringstream out;
    out << "0x" << std::hex << std::nouppercase << std::setfill('0')
        << std::setw(minimum_digits) << value;
    return out.str();
}

uint64_t estimated_memory_stall_cycles(const CodeHotspot& hotspot,
                                       const CacheHierarchyConfig& config) {
    const int hideable = config.issue_width > 0
                             ? config.rob_size / config.issue_width
                             : 0;
    const auto exposed = [&](int latency) -> uint64_t {
        return static_cast<uint64_t>(
            std::max(0, latency - config.latency.l1_hit - hideable));
    };
    return hotspot.l2_hits * exposed(config.latency.l2_hit) +
           hotspot.l3_hits * exposed(config.latency.l3_hit) +
           hotspot.memory_accesses * exposed(config.latency.memory);
}

} // namespace

// ========== Utility Functions ==========

std::string JsonOutput::escape(std::string_view s) {
    std::string out;
    out.reserve(s.size());
    for (unsigned char c : s) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    char encoded[7];
                    std::snprintf(encoded, sizeof(encoded), "\\u%04x", c);
                    out += encoded;
                } else {
                    out += static_cast<char>(c);
                }
        }
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

// ========== Execution Engine Statistics ==========

void JsonOutput::write_execution_stats(
    std::ostream& out, const BranchPredictionStats& branch,
    const std::vector<BranchSiteStats>& hot_branches,
    const PipelineStats& pipeline) {
    out << "  \"execution\": {\n";
    out << "    \"available\": true,\n";
    out << "    \"model\": \"estimated\",\n";
    out << "    \"pipeline\": {\n";
    out << "      \"instructions\": " << pipeline.instructions << ",\n";
    out << "      \"cycles\": " << pipeline.total_cycles() << ",\n";
    out << "      \"ipc\": " << std::fixed << std::setprecision(3) << pipeline.ipc() << ",\n";
    out << "      \"cpi\": " << std::fixed << std::setprecision(3) << pipeline.cpi() << ",\n";
    out << "      \"breakdown\": {\n";
    out << "        \"baseCycles\": " << pipeline.base_cycles << ",\n";
    out << "        \"frontendStallCycles\": " << pipeline.frontend_stall_cycles << ",\n";
    out << "        \"l2StallCycles\": " << pipeline.l2_stall_cycles << ",\n";
    out << "        \"l3StallCycles\": " << pipeline.l3_stall_cycles << ",\n";
    out << "        \"dramStallCycles\": " << pipeline.dram_stall_cycles << ",\n";
    out << "        \"branchStallCycles\": " << pipeline.branch_stall_cycles << ",\n";
    out << "        \"memoryStallCycles\": " << pipeline.memory_stall_cycles() << "\n";
    out << "      }\n";
    out << "    },\n";
    out << "    \"branchPrediction\": {\n";
    out << "      \"total\": " << branch.total << ",\n";
    out << "      \"correct\": " << branch.correct() << ",\n";
    out << "      \"mispredictions\": " << branch.mispredictions << ",\n";
    out << "      \"accuracy\": " << std::fixed << std::setprecision(3) << branch.accuracy() << ",\n";
    out << "      \"mispredictionRate\": " << std::fixed << std::setprecision(3)
        << branch.misprediction_rate() << ",\n";
    out << "      \"hotBranches\": [\n";
    for (size_t i = 0; i < hot_branches.size(); i++) {
        const auto& site = hot_branches[i];
        out << "        {\"file\": \"" << escape(site.file) << "\", "
            << "\"line\": " << site.line << ", "
            << "\"total\": " << site.total << ", "
            << "\"mispredictions\": " << site.mispredictions << ", "
            << "\"mispredictionRate\": " << std::fixed << std::setprecision(3)
            << site.misprediction_rate() << "}"
            << (i + 1 < hot_branches.size() ? ",\n" : "\n");
    }
    out << "      ]\n";
    out << "    }\n";
    out << "  }";
}

void JsonOutput::write_execution_unavailable(std::ostream& out,
                                             std::string_view reason) {
    out << "  \"execution\": {\n";
    out << "    \"available\": false,\n";
    out << "    \"reason\": \"" << escape(reason) << "\"\n";
    out << "  }";
}

void JsonOutput::write_execution_subsystem_stats(
    std::ostream& out, const BranchPredictionStats& branch,
    const std::vector<BranchSiteStats>& hot_branches,
    const PipelineStats& pipeline) {
    out << "  \"subsystems\": {\n";
    out << "    \"execution\": {\n";
    out << "      \"available\": true,\n";
    out << "      \"model\": \"estimated\",\n";
    out << "      \"pipeline\": {\n";
    out << "        \"instructions\": " << pipeline.instructions << ",\n";
    out << "        \"cycles\": " << pipeline.total_cycles() << ",\n";
    out << "        \"ipc\": " << std::fixed << std::setprecision(3) << pipeline.ipc() << ",\n";
    out << "        \"cpi\": " << std::fixed << std::setprecision(3) << pipeline.cpi() << ",\n";
    out << "        \"breakdown\": {\n";
    out << "          \"baseCycles\": " << pipeline.base_cycles << ",\n";
    out << "          \"frontendStallCycles\": " << pipeline.frontend_stall_cycles << ",\n";
    out << "          \"l2StallCycles\": " << pipeline.l2_stall_cycles << ",\n";
    out << "          \"l3StallCycles\": " << pipeline.l3_stall_cycles << ",\n";
    out << "          \"dramStallCycles\": " << pipeline.dram_stall_cycles << ",\n";
    out << "          \"branchStallCycles\": " << pipeline.branch_stall_cycles << ",\n";
    out << "          \"memoryStallCycles\": " << pipeline.memory_stall_cycles() << "\n";
    out << "        }\n";
    out << "      },\n";
    out << "      \"branchPrediction\": {\n";
    out << "        \"total\": " << branch.total << ",\n";
    out << "        \"correct\": " << branch.correct() << ",\n";
    out << "        \"mispredictions\": " << branch.mispredictions << ",\n";
    out << "        \"accuracy\": " << std::fixed << std::setprecision(3) << branch.accuracy() << ",\n";
    out << "        \"mispredictionRate\": " << std::fixed << std::setprecision(3)
        << branch.misprediction_rate() << ",\n";
    out << "        \"hotBranches\": [\n";
    for (size_t i = 0; i < hot_branches.size(); i++) {
        const auto& site = hot_branches[i];
        out << "          {\"file\": \"" << escape(site.file) << "\", "
            << "\"line\": " << site.line << ", "
            << "\"total\": " << site.total << ", "
            << "\"mispredictions\": " << site.mispredictions << ", "
            << "\"mispredictionRate\": " << std::fixed << std::setprecision(3)
            << site.misprediction_rate() << "}"
            << (i + 1 < hot_branches.size() ? ",\n" : "\n");
    }
    out << "        ]\n";
    out << "      }\n";
    out << "    }\n";
    out << "  }";
}

void JsonOutput::write_execution_subsystem_unavailable(std::ostream& out,
                                                       std::string_view reason) {
    out << "  \"subsystems\": {\n";
    out << "    \"execution\": {\n";
    out << "      \"available\": false,\n";
    out << "      \"reason\": \"" << escape(reason) << "\"\n";
    out << "    }\n";
    out << "  }";
}

void JsonOutput::write_bottleneck_summary(std::ostream& out,
                                          const BottleneckSummary& summary) {
    out << "  \"summary\": {\n";
    out << "    \"primaryBottleneck\": \"" << escape(summary.primary_bottleneck) << "\",\n";
    out << "    \"estimatedCycles\": " << summary.estimated_cycles << ",\n";
    out << "    \"bottleneckShare\": " << std::fixed << std::setprecision(3)
        << summary.bottleneck_share << ",\n";
    out << "    \"confidence\": \"" << escape(summary.confidence) << "\",\n";
    out << "    \"reason\": \"" << escape(summary.reason) << "\",\n";
    out << "    \"topSource\": ";
    if (summary.has_top_source) {
        out << "{\"file\": \"" << escape(summary.top_source.file)
            << "\", \"line\": " << summary.top_source.line
            << ", \"subsystem\": \"" << escape(summary.top_source.subsystem)
            << "\", \"cycles\": " << summary.top_source.cycles << "}\n";
    } else {
        out << "null\n";
    }
    out << "  }";
}

void JsonOutput::write_source_annotations(
    std::ostream& out, const std::vector<SourceAnnotation>& annotations) {
    out << "  \"sourceAnnotations\": [\n";
    for (size_t i = 0; i < annotations.size(); i++) {
        const auto& annotation = annotations[i];
        out << "    {\"subsystem\": \"" << escape(annotation.subsystem) << "\", "
            << "\"severity\": \"" << escape(annotation.severity) << "\", "
            << "\"file\": \"" << escape(annotation.file) << "\", "
            << "\"line\": " << annotation.line << ", "
            << "\"label\": \"" << escape(annotation.label) << "\", "
            << "\"detail\": \"" << escape(annotation.detail) << "\", "
            << "\"metrics\": {"
            << "\"cycles\": " << annotation.cycles << ", "
            << "\"share\": " << std::fixed << std::setprecision(3)
            << annotation.share << ", "
            << "\"misses\": " << annotation.misses << ", "
            << "\"branchMispredictions\": "
            << annotation.branch_mispredictions << "}}"
            << (i + 1 < annotations.size() ? ",\n" : "\n");
    }
    out << "  ]";
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

void JsonOutput::write_binary_attribution(
    std::ostream& out, const TraceManifest& manifest,
    const std::vector<CodeHotspot>& hotspots,
    const CacheHierarchyConfig& config) {
    out << "\"capture\":{\"traceFormat\":" << manifest.version;
    if (manifest.capture) {
        const auto& capture = *manifest.capture;
        out << ",\"kind\":\"" << escape(capture.kind) << "\""
            << ",\"target\":\"" << escape(capture.target) << "\""
            << ",\"addressWidth\":" << capture.address_width
            << ",\"sampleRate\":" << capture.sample_rate
            << ",\"eventLimit\":" << capture.event_limit
            << ",\"truncated\":" << (capture.truncated ? "true" : "false");
    }
    out << "},";
    out << "\"images\":[";
    for (size_t i = 0; i < manifest.images.size(); ++i) {
        const auto& image = manifest.images[i];
        if (i > 0) out << ",";
        out << "{\"id\":\"" << escape(image.image_id) << "\""
            << ",\"name\":\"" << escape(image.name) << "\""
            << ",\"sha256\":\"" << escape(image.image_id.substr(7)) << "\""
            << ",\"imageSize\":" << image.end_address - image.loaded_base
            << ",\"loadedBase\":\"" << hex_address(image.loaded_base) << "\""
            << ",\"endAddress\":\"" << hex_address(image.end_address) << "\"}";
    }
    out << "],\"codeHotspots\":[";
    bool first_hotspot = true;
    for (size_t i = 0; i < hotspots.size(); ++i) {
        const auto& hotspot = hotspots[i];
        const auto image = std::find_if(
            manifest.images.begin(), manifest.images.end(), [&](const auto& candidate) {
                return candidate.table_id == hotspot.location.image_table_id;
            });
        if (image == manifest.images.end()) continue;
        if (!first_hotspot) out << ",";
        first_hotspot = false;
        out << "{\"location\":{\"imageId\":\""
            << escape(image->image_id) << "\",\"rva\":\""
            << hex_address(hotspot.location.rva, 8) << "\"}"
            << ",\"navigationConfidence\":\"unresolved\""
            << ",\"metrics\":{\"accesses\":" << hotspot.accesses
            << ",\"reads\":" << hotspot.reads
            << ",\"writes\":" << hotspot.writes
            << ",\"l1dHits\":" << hotspot.l1d_hits
            << ",\"l1dMisses\":" << hotspot.l1d_misses
            << ",\"l1dMissRate\":" << std::fixed << std::setprecision(4)
            << hotspot.l1d_miss_rate()
            << ",\"l2Hits\":" << hotspot.l2_hits
            << ",\"l3Hits\":" << hotspot.l3_hits
            << ",\"memoryAccesses\":" << hotspot.memory_accesses
            << ",\"estimatedMemoryStallCycles\":"
            << estimated_memory_stall_cycles(hotspot, config) << "}}";
    }
    out << "]";
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
            << "\"accessCount\": " << fs.total_accesses << ", "
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
            << ",\"accesses\":" << fs.total_accesses << "}";
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

void JsonOutput::write_profile_metadata(std::ostream& out,
                                        const HardwareProfileMetadata& profile) {
    out << "  \"profile\": {\n";
    out << "    \"id\": \"" << escape(profile.id) << "\",\n";
    out << "    \"displayName\": \"" << escape(profile.display_name) << "\",\n";
    out << "    \"vendor\": \"" << escape(profile.vendor) << "\",\n";
    out << "    \"architecture\": \"" << escape(profile.architecture) << "\",\n";
    out << "    \"class\": \"" << escape(profile.profile_class) << "\",\n";
    out << "    \"modelConfidence\": \"" << escape(profile.model_confidence) << "\"\n";
    out << "  }";
}

void JsonOutput::write_profile_metadata(std::ostream& out,
                                        const HardwareProfileMetadata& profile,
                                        const CacheHierarchyConfig& cfg,
                                        std::string_view prefetch_policy_name,
                                        int prefetch_degree,
                                        int active_cores) {
    const auto& pf = cfg.prefetch;
    const auto& latency = cfg.latency;
    const PipelineConfig pipeline_cfg{
        .issue_width = cfg.issue_width,
        .rob_size = cfg.rob_size,
        .branch_mispredict_penalty = cfg.branch_mispredict_penalty,
        .latency = latency};
    const int cores = active_cores > 0 ? active_cores : 1;
    const char* l2_scope = cores > 1 ? "shared-across-modeled-cores"
                                     : "private-to-modeled-core";
    const char* l3_scope = cfg.l3.kb_size > 0 ? "shared-last-level" : "none";
    const char* coherence = cores > 1 ? "mesi" : "not-applicable";

    out << "  \"profile\": {\n";
    out << "    \"id\": \"" << escape(profile.id) << "\",\n";
    out << "    \"displayName\": \"" << escape(profile.display_name) << "\",\n";
    out << "    \"vendor\": \"" << escape(profile.vendor) << "\",\n";
    out << "    \"architecture\": \"" << escape(profile.architecture) << "\",\n";
    out << "    \"class\": \"" << escape(profile.profile_class) << "\",\n";
    out << "    \"modelConfidence\": \"" << escape(profile.model_confidence) << "\",\n";
    out << "    \"details\": {\n";
    out << "      \"cache\": {\n";
    out << "        \"inclusion\": \"" << inclusion_policy_name(cfg.inclusion_policy) << "\",\n";
    out << "        \"levels\": {\n";
    write_cache_level_detail(out, "l1d", cfg.l1_data, false);
    write_cache_level_detail(out, "l1i", cfg.l1_inst, false);
    write_cache_level_detail(out, "l2", cfg.l2, false);
    write_cache_level_detail(out, "l3", cfg.l3, true);
    out << "        }\n";
    out << "      },\n";
    out << "      \"tlb\": {\n";
    out << "        \"dtlb\": {\"entries\": 64, \"associativity\": 4, \"pageSize\": 4096},\n";
    out << "        \"itlb\": {\"entries\": 64, \"associativity\": 4, \"pageSize\": 4096}\n";
    out << "      },\n";
    out << "      \"prefetch\": {\n";
    out << "        \"activePolicy\": \"" << escape(prefetch_policy_name) << "\",\n";
    out << "        \"activeDegree\": " << prefetch_degree << ",\n";
    write_bool_field(out, "l1Stream", pf.l1_stream_prefetch, false);
    write_bool_field(out, "l1Stride", pf.l1_stride_prefetch, false);
    out << "        \"l1Degree\": " << pf.l1_prefetch_degree << ",\n";
    write_bool_field(out, "l2Stream", pf.l2_stream_prefetch, false);
    write_bool_field(out, "l2Adjacent", pf.l2_adjacent_prefetch, false);
    out << "        \"l2Degree\": " << pf.l2_prefetch_degree << ",\n";
    out << "        \"l2Streams\": " << pf.l2_max_streams << ",\n";
    out << "        \"l2MaxDistance\": " << pf.l2_max_distance << ",\n";
    write_bool_field(out, "l3Prefetch", pf.l3_prefetch, false);
    write_bool_field(out, "pointerPrefetch", pf.pointer_prefetch, false);
    write_bool_field(out, "dynamicDegree", pf.dynamic_degree, true);
    out << "      },\n";
    out << "      \"executionCore\": {\n";
    out << "        \"model\": \"analytical-ooo\",\n";
    out << "        \"issueWidth\": " << pipeline_cfg.issue_width << ",\n";
    out << "        \"robSize\": " << pipeline_cfg.rob_size << ",\n";
    out << "        \"hideableCycles\": " << pipeline_cfg.hideable_cycles() << ",\n";
    out << "        \"branchMispredictPenalty\": "
        << pipeline_cfg.branch_mispredict_penalty << ",\n";
    out << "        \"branchPredictor\": \"bimodal-2bit\",\n";
    out << "        \"branchPredictorEntries\": 1024\n";
    out << "      },\n";
    out << "      \"memory\": {\n";
    out << "        \"l1HitCycles\": " << latency.l1_hit << ",\n";
    out << "        \"l2HitCycles\": " << latency.l2_hit << ",\n";
    out << "        \"l3HitCycles\": " << latency.l3_hit << ",\n";
    out << "        \"dramCycles\": " << latency.memory << ",\n";
    out << "        \"tlbMissPenaltyCycles\": " << latency.tlb_miss_penalty << "\n";
    out << "      },\n";
    out << "      \"topology\": {\n";
    out << "        \"activeCores\": " << cores << ",\n";
    out << "        \"l1Scope\": \"private-per-core\",\n";
    out << "        \"l2Scope\": \"" << l2_scope << "\",\n";
    out << "        \"l3Scope\": \"" << l3_scope << "\",\n";
    out << "        \"coherence\": \"" << coherence << "\"\n";
    out << "      }\n";
    out << "    }\n";
    out << "  }";
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
    out << "{\"type\":\"start\",\"config\":\"" << escape(config_name)
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
