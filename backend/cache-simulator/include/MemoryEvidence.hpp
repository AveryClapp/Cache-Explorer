#pragma once
#include "CacheSystem.hpp"
#include "TraceEvent.hpp"
#include <algorithm>
#include <map>
#include <optional>

struct AccessEvidence {
    uint64_t address = 0, set = 0, tag = 0;
    int hit_level = 0;
    std::string miss_class;
    std::optional<int64_t> stride_bytes;
    std::optional<uint64_t> reuse_gap;
    std::optional<uint64_t> competing_address;
    std::string competing_file;
    uint32_t competing_line = 0;
    bool prefetched = false;
};
struct LineEvidence {
    std::string file;
    uint32_t line = 0;
    uint64_t accesses = 0, misses = 0, dram_fills = 0, tlb_misses = 0;
    uint64_t compulsory = 0, capacity = 0, conflict = 0, unclassified = 0;
    uint64_t previous_address = 0;
    AccessEvidence sample;
};

// Bounded explanatory observations, collected during simulation, never by
// replaying a second cache model. Reuse gap is temporal distance in demand
// accesses, NOT unique-line stack distance; set competitors are observations,
// not proof that one particular line caused an eviction.
class MemoryEvidence {
    CacheHierarchyConfig config_;
    std::map<std::pair<std::string, uint32_t>, LineEvidence> lines_;
    struct Previous { uint64_t address; std::string file; uint32_t line; };
    std::map<uint64_t, Previous> sets_;
    std::map<uint64_t, uint64_t> seen_;
public:
    uint64_t accesses = 0, dram_fills = 0, omitted_accesses = 0;
    explicit MemoryEvidence(const CacheHierarchyConfig& config) : config_(config) {}
    const CacheHierarchyConfig& config() const { return config_; }
    void reset() { lines_.clear(); sets_.clear(); seen_.clear(); accesses = dram_fills = omitted_accesses = 0; }
    void record(const TraceEvent& event, uint64_t address, const SystemAccessResult& result,
                const CacheStats& before, const CacheStats& after, bool prefetched) {
        ++accesses;
        if (result.memory_access) ++dram_fills;
        AccessEvidence sample;
        sample.address = address;
        sample.set = config_.l1_data.get_index(address);
        sample.tag = config_.l1_data.get_tag(address);
        sample.hit_level = result.l1_hit ? 1 : result.l2_hit ? 2 : result.l3_hit ? 3 : 4;
        sample.prefetched = prefetched;
        sample.miss_class = result.l1_hit ? "hit" : after.compulsory_misses > before.compulsory_misses ? "compulsory" :
            after.capacity_misses > before.capacity_misses ? "capacity-heuristic" :
            after.conflict_misses > before.conflict_misses ? "conflict-heuristic" : "unclassified";
        if (auto previous = seen_.find(address); previous != seen_.end()) sample.reuse_gap = accesses - previous->second - 1;
        if (seen_.size() >= 65536) seen_.clear();
        seen_[address] = accesses;
        auto competitor = sets_.find(sample.set);
        if (competitor != sets_.end() && competitor->second.address != address) {
            sample.competing_address = competitor->second.address;
            sample.competing_file = competitor->second.file;
            sample.competing_line = competitor->second.line;
        }
        if (sets_.size() < 65536 || competitor != sets_.end()) sets_[sample.set] = {address, event.file, event.line};
        const auto key = std::make_pair(event.file, event.line);
        if (!lines_.count(key) && lines_.size() >= 512) { ++omitted_accesses; return; }
        auto& line = lines_[key];
        line.file = event.file; line.line = event.line;
        if (line.accesses) {
            const auto distance = address > line.previous_address ? address - line.previous_address : line.previous_address - address;
            if (distance <= INT64_MAX) sample.stride_bytes = address >= line.previous_address ? int64_t(distance) : -int64_t(distance);
        }
        line.previous_address = address;
        ++line.accesses;
        if (!result.dtlb_hit) ++line.tlb_misses;
        if (result.memory_access) ++line.dram_fills;
        if (!result.l1_hit) {
            ++line.misses;
            if (sample.miss_class == "compulsory") ++line.compulsory;
            else if (sample.miss_class == "capacity-heuristic") ++line.capacity;
            else if (sample.miss_class == "conflict-heuristic") ++line.conflict;
            else ++line.unclassified;
        }
        if (!result.l1_hit || line.accesses == 1) line.sample = std::move(sample);
    }
    std::vector<LineEvidence> hottest(size_t limit = 24) const {
        std::vector<LineEvidence> rows;
        for (const auto& [_, row] : lines_) rows.push_back(row);
        std::sort(rows.begin(), rows.end(), [](const auto& a, const auto& b) {
            if (a.misses != b.misses) return a.misses > b.misses;
            return std::tie(a.file, a.line) < std::tie(b.file, b.line);
        });
        if (rows.size() > limit) rows.resize(limit);
        return rows;
    }
};
