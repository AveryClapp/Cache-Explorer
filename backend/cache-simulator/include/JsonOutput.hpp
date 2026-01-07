#pragma once

#include <ostream>
#include <string>
#include <string_view>
#include <vector>

#include "../profiles/CacheConfig.hpp"
#include "CacheLevel.hpp"
#include "CacheStats.hpp"
#include "MultiCoreCacheSystem.hpp"
#include "MultiCoreTraceProcessor.hpp"
#include "OptimizationSuggester.hpp"
#include "Prefetcher.hpp"
#include "TLB.hpp"
#include "TraceProcessor.hpp"

/**
 * JsonOutput - Utility class for generating JSON output from cache simulation results.
 *
 * This class provides static methods for formatting various cache simulation
 * statistics and data structures as JSON. It handles:
 * - String escaping for JSON compliance
 * - Cache level statistics formatting
 * - Cache state visualization data
 * - TLB statistics
 * - Timing statistics
 * - Hot line reports (single-core and multi-core)
 * - Optimization suggestions
 * - False sharing reports
 * - Prefetch statistics
 * - Streaming mode output (start, progress, complete messages)
 */
class JsonOutput {
public:
    // ========== Utility Functions ==========

    /**
     * Escape special characters in a string for JSON compliance.
     * Handles: " and \ characters
     */
    [[nodiscard]] static std::string escape(std::string_view s);

    /**
     * Get single-character representation of MESI coherence state.
     * M = Modified, E = Exclusive, S = Shared, I = Invalid
     */
    [[nodiscard]] static const char* coherence_state_char(CoherenceState state);

    // ========== Cache State Visualization ==========

    /**
     * Write L1 cache state for visualization as JSON.
     * Outputs set/way/valid/tag/state information for each cache line.
     *
     * @param out Output stream
     * @param cache The cache level to visualize
     * @param core Core number (for multi-core systems)
     * @param first Whether this is the first cache in an array (controls comma prefix)
     * @param multicore If true, use actual coherence state; if false, derive from dirty bit
     */
    static void write_cache_state(std::ostream& out, const CacheLevel& cache,
                                  int core, bool first, bool multicore = true);

    // ========== Cache Statistics ==========

    /**
     * Write statistics for a single cache level as JSON.
     * Includes hits, misses, hit rate, writebacks, and 3C miss breakdown.
     *
     * @param out Output stream
     * @param name Cache level name (e.g., "l1d", "l2", "l3")
     * @param stats The cache statistics
     * @param last Whether this is the last level (controls trailing comma)
     */
    static void write_cache_stats(std::ostream& out, const char* name,
                                  const CacheStats& stats, bool last = false);

    // ========== TLB Statistics ==========

    /**
     * Write TLB hierarchy statistics as JSON.
     * Includes DTLB and ITLB stats with hit/miss counts and rates.
     */
    static void write_tlb_stats(std::ostream& out, const TLBHierarchyStats& stats);

    // ========== Timing Statistics ==========

    /**
     * Write timing statistics as JSON.
     * Includes total cycles, average latency, and breakdown by cache level.
     *
     * @param out Output stream
     * @param timing The timing statistics
     * @param total_accesses Total number of accesses for average calculation
     * @param latency The latency configuration used
     */
    static void write_timing_stats(std::ostream& out, const TimingStats& timing,
                                   uint64_t total_accesses,
                                   const LatencyConfig& latency);

    /**
     * Write timing statistics for multi-core mode (calculated from stats).
     * Uses raw L1/L2/L3 hit counts and latency config to compute cycles.
     */
    static void write_timing_stats_multicore(std::ostream& out,
                                              const CacheStats& l1_total,
                                              const CacheStats& l2,
                                              const CacheStats& l3,
                                              const LatencyConfig& latency);

    // ========== Hot Lines ==========

    /**
     * Write single-core hot lines report as JSON array.
     */
    static void write_hot_lines(std::ostream& out, const std::vector<SourceStats>& hot);

    /**
     * Write multi-core hot lines report as JSON array.
     * Includes thread count per location.
     */
    static void write_hot_lines_multicore(std::ostream& out,
                                          const std::vector<MultiCoreSourceStats>& hot);

    // ========== Optimization Suggestions ==========

    /**
     * Write optimization suggestions as JSON array.
     */
    static void write_suggestions(std::ostream& out,
                                  const std::vector<OptimizationSuggestion>& suggestions);

    // ========== False Sharing ==========

    /**
     * Write false sharing reports as JSON array.
     * Includes detailed per-thread access information.
     */
    static void write_false_sharing(std::ostream& out,
                                    const std::vector<FalseSharingReport>& reports);

    /**
     * Write compact false sharing reports as JSON array (for streaming mode).
     */
    static void write_false_sharing_compact(std::ostream& out,
                                            const std::vector<FalseSharingReport>& reports);

    // ========== Prefetch Statistics ==========

    /**
     * Write prefetch statistics as JSON object.
     *
     * @param out Output stream
     * @param policy_name Name of the prefetch policy
     * @param degree Prefetch degree
     * @param stats The prefetch statistics
     */
    static void write_prefetch_stats(std::ostream& out, std::string_view policy_name,
                                     int degree, const PrefetchStats& stats);

    // ========== Cache Configuration ==========

    /**
     * Write cache configuration as JSON object.
     */
    static void write_cache_config(std::ostream& out, const CacheHierarchyConfig& cfg);

    // ========== Coherence Statistics ==========

    /**
     * Write coherence statistics as JSON object.
     */
    static void write_coherence_stats(std::ostream& out, uint64_t invalidations,
                                      uint64_t false_sharing_events);

    // ========== Streaming Mode Messages ==========

    /**
     * Write streaming mode start message.
     */
    static void write_stream_start(std::ostream& out, std::string_view config_name,
                                   bool multicore);

    /**
     * Timeline event for streaming progress updates.
     */
    struct TimelineEvent {
        size_t index;
        bool is_write;
        bool is_icache;
        int hit_level;  // 1=L1, 2=L2, 3=L3, 4=memory
        uint64_t address;
        std::string file;
        uint32_t line;
    };

    /**
     * Write streaming mode progress message.
     */
    static void write_stream_progress(std::ostream& out, size_t event_count,
                                      size_t thread_count, const CacheStats& l1_total,
                                      const CacheStats& l2, const CacheStats& l3,
                                      uint64_t coherence_invalidations,
                                      const std::vector<TimelineEvent>& timeline);
};
