#pragma once
#include "ArgParser.hpp"
#include <stdexcept>

// One validation/application seam for native callers. Overrides are applied to a
// copy of the selected preset; invalid scenarios never partly mutate that preset.
inline void apply_hardware_lab(SimulatorOptions& options) {
    auto cfg = options.cache_config;
    if (options.lab.size() > 16) throw std::invalid_argument("At most 16 Hardware Lab overrides are allowed");
    for (const auto& entry : options.lab) {
        const auto eq = entry.find('=');
        if (eq == std::string::npos || entry.size() > 128) throw std::invalid_argument("--lab expects field=value");
        const auto key = entry.substr(0, eq), value = entry.substr(eq + 1);
        if (!cfg.lab_overrides.emplace(key, value).second) throw std::invalid_argument("Duplicate Hardware Lab field: " + key);
        if (key == "branch.predictor") {
            if (value != "bimodal-2bit" && value != "static-not-taken" && value != "gshare" && value != "btfnt")
                throw std::invalid_argument("Unsupported branch predictor; branch direction requires trace target metadata");
            cfg.branch_predictor = value;
            continue;
        }
        if (key == "prefetch.policy") {
            if (value != "none" && value != "next" && value != "stream" && value != "stride" && value != "adaptive" && value != "intel")
                throw std::invalid_argument("Unsupported Hardware Lab prefetch policy");
            options.prefetch_policy = ArgParser::parse_prefetch_policy(value);
            options.prefetch_policy_set = true;
            continue;
        }
        if (value.empty() || value.size() > 10 || value.find_first_not_of("0123456789") != std::string::npos)
            throw std::invalid_argument("Hardware Lab numeric fields require positive integers");
        const auto number = std::stoull(value);
        auto bounded = [&](uint64_t minimum, uint64_t maximum) {
            if (number < minimum || number > maximum) throw std::invalid_argument("Hardware Lab field outside supported range: " + key);
            return static_cast<int>(number);
        };
        if (key == "l1d.sizeKB") cfg.l1_data.kb_size = bounded(1, 16384);
        else if (key == "l1d.associativity") cfg.l1_data.associativity = bounded(1, 1024);
        else if (key == "cache.lineSize") {
            const auto size = bounded(16, 4096);
            cfg.l1_data.line_size = cfg.l1_inst.line_size = cfg.l2.line_size = cfg.l3.line_size = size;
        } else if (key == "tlb.pageSize") cfg.dtlb.page_size = cfg.itlb.page_size = bounded(4096, 1073741824);
        else if (key == "dtlb.entries") cfg.dtlb.entries = bounded(1, 65536);
        else if (key == "dtlb.associativity") cfg.dtlb.associativity = bounded(1, 1024);
        else if (key == "itlb.entries") cfg.itlb.entries = bounded(1, 65536);
        else if (key == "itlb.associativity") cfg.itlb.associativity = bounded(1, 1024);
        else if (key == "tlb.missPenaltyCycles") cfg.latency.tlb_miss_penalty = bounded(1, 100000);
        else if (key == "memory.dramCycles") cfg.latency.memory = bounded(1, 100000);
        else if (key == "memory.assumedMlp") cfg.assumed_mlp = bounded(1, 64);
        else if (key == "memory.bandwidthBytesPerCycle") cfg.bandwidth_bytes_per_cycle = bounded(1, 1024);
        else if (key == "execution.robSize") cfg.rob_size = bounded(1, 8192);
        else if (key == "execution.issueWidth") cfg.issue_width = bounded(1, 32);
        else throw std::invalid_argument("Unknown Hardware Lab field: " + key);
    }
    if (!cfg.lab_overrides.empty()) {
        if (!cfg.l1_data.is_valid() || !cfg.l1_inst.is_valid() || !cfg.l2.is_valid() ||
            (cfg.l3.kb_size && !cfg.l3.is_valid()) || !cfg.dtlb.is_valid() || !cfg.itlb.is_valid())
            throw std::invalid_argument("Hardware Lab geometry must form valid cache/TLB sets");
        if (options.cache_segments) throw std::invalid_argument("Hardware Lab requires detailed simulation; disable segment caching");
        if (options.stream_mode) throw std::invalid_argument("Hardware Lab requires batch simulation, not streaming");
        if (options.num_cores > 1) throw std::invalid_argument("Hardware Lab sensitivity is currently single-core only");
    }
    options.cache_config = std::move(cfg);
}
