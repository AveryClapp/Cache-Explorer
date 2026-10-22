#include "include/ArgParser.hpp"
#include "include/BranchPredictor.hpp"
#include "include/TraceProcessor.hpp"
#include "include/TraceParser.hpp"
#include "include/FastIO.hpp"
#include "include/JsonOutput.hpp"
#include <cassert>
#include <iostream>
#include <sstream>

static SimulatorOptions parse(std::vector<std::string> args) {
    args.insert(args.begin(), "cache-sim");
    std::vector<char*> argv;
    for (auto& value : args) argv.push_back(value.data());
    return ArgParser::parse(static_cast<int>(argv.size()), argv.data());
}
static void invalid(const std::vector<std::string>& args) {
    bool rejected = false;
    try { parse(args); } catch (const std::exception&) { rejected = true; }
    assert(rejected);
}
static void overrides() {
    const auto original = parse({"--config", "educational"});
    const auto scenario = parse({"--config", "educational", "--lab", "l1d.sizeKB=64", "--lab", "dtlb.entries=128", "--lab", "tlb.pageSize=2097152", "--lab", "branch.predictor=gshare", "--lab", "prefetch.policy=stride", "--check-config"});
    assert(scenario.cache_config.l1_data.kb_size == 64);
    assert(scenario.cache_config.dtlb.entries == 128);
    assert(scenario.cache_config.itlb.page_size == 2097152);
    assert(scenario.cache_config.branch_predictor == "gshare");
    assert(scenario.prefetch_policy == PrefetchPolicy::STRIDE);
    assert(scenario.check_config);
    assert(parse({"--config", "educational"}).cache_config.l1_data.kb_size == original.cache_config.l1_data.kb_size);
    invalid({"--lab"}); invalid({"--lab", "unknown=1"}); invalid({"--lab", "l1d.sizeKB=-1"});
    invalid({"--lab", "l1d.sizeKB=1;touch x"}); invalid({"--lab", "cache.lineSize=63"});
    invalid({"--lab", "tlb.pageSize=5000"}); invalid({"--lab", "dtlb.entries=5"});
    invalid({"--lab", "dtlb.associativity=1024"}); invalid({"--lab", "memory.assumedMlp=0"});
    invalid({"--lab", "l1d.sizeKB=64", "--lab", "l1d.sizeKB=32"});
    invalid({"--lab", "l1d.sizeKB=64", "--cores", "2"});
    invalid({"--lab", "l1d.sizeKB=64", "--cache-segments"});
    bool rejected = false;
    try { TLB invalid_tlb({0, 0, 4096}); } catch (const std::invalid_argument&) { rejected = true; }
    assert(rejected);
}
static void predictors() {
    BranchPredictor static_model(1024, "static-not-taken"), bimodal, gshare(1024, "gshare"), btfnt(1024, "btfnt");
    for (int i = 0; i < 200; ++i) {
        bool taken = i % 2 == 0;
        static_model.process(1, taken, "main.c", 4);
        bimodal.process(1, taken, "main.c", 4);
        gshare.process(1, taken, "main.c", 4);
        btfnt.process(1, taken, "main.c", 4, taken);
    }
    assert(static_model.stats().mispredictions == 100);
    assert(bimodal.stats().mispredictions == 200);
    assert(gshare.stats().mispredictions < 20);
    assert(btfnt.stats().mispredictions == 0);
    bool rejected = false;
    try { btfnt.process(1, true, "main.c", 4); } catch (const std::invalid_argument&) { rejected = true; }
    assert(rejected && btfnt.stats().total == 200);
    auto old_misses = gshare.stats().mispredictions;
    gshare.reset();
    for (int i = 0; i < 200; ++i) gshare.process(1, i % 2 == 0, "main.c", 4);
    assert(gshare.stats().mispredictions == old_misses);
    const auto branch = parse_trace_event("B 0x1234 1 main.c:4 T1 D1");
    assert(branch && branch->branch_backward == true);
    assert(!parse_trace_event("B 0x1234 1 main.c:4 T1 D1 D0"));
    assert(!parse_trace_event("L 0x1234 4 main.c:4 T1 D1"));
    assert(!parse_trace_event("B 0x1234 1 main.c:4 T1 D2"));
}
static void translation_and_memory() {
    auto cfg = parse({"--config", "educational"}).cache_config;
    TraceProcessor baseline(cfg);
    cfg.dtlb.page_size = cfg.itlb.page_size = 2097152;
    cfg.assumed_mlp = 4;
    TraceProcessor scenario(cfg);
    for (int i = 0; i < 8; ++i) {
        TraceEvent event;
        event.address = 0x200000 + i * 4096; event.size = 4; event.file = "main.c"; event.line = 7;
        baseline.process(event); scenario.process(event);
    }
    assert(baseline.get_cache_system().get_tlb_stats().dtlb.misses == 8);
    assert(scenario.get_cache_system().get_tlb_stats().dtlb.misses == 1);
    assert(baseline.get_stats().l1d.misses == scenario.get_stats().l1d.misses);
    assert(baseline.get_pipeline_stats().memory_stall_cycles() > scenario.get_pipeline_stats().memory_stall_cycles());
    const auto rows = baseline.get_memory_evidence().hottest();
    assert(rows.size() == 1 && rows[0].accesses == 8 && rows[0].misses == 8);
    assert(rows[0].sample.stride_bytes == 4096);
    assert(rows[0].sample.competing_address.has_value());
    std::ostringstream json;
    JsonOutput::write_memory_observations(json, baseline);
    assert(json.str().find("\"pressureAvailable\":false") != std::string::npos);
    assert(json.str().find("\"bandwidthPressure\":null") != std::string::npos);
    baseline.reset();
    assert(baseline.get_memory_evidence().hottest().empty());
    assert(baseline.get_memory_evidence().accesses == 0);
    for (int i = 0; i < 600; ++i) {
        TraceEvent event;
        event.address = i * 64; event.size = 4; event.file = "many.c"; event.line = i + 1;
        baseline.process(event);
    }
    assert(baseline.get_memory_evidence().hottest(1000).size() == 512);
    assert(baseline.get_memory_evidence().omitted_accesses == 88);
}
static void coherence_history() {
    auto cfg = parse({"--config", "educational"}).cache_config;
    MultiCoreCacheSystem cache(2, cfg.l1_data, cfg.l2, cfg.l3);
    for (int i = 0; i < 400; ++i) cache.write(0x1000 + (i % 2) * 4, i % 2 + 1, "sharing.c", 5);
    const auto& controller = cache.get_coherence_controller();
    assert(controller.observed_events() == 399);
    assert(controller.history().size() == 256);
    assert(controller.history().front().sequence == 144);
    assert(controller.history().back().sequence == 399);
    assert(controller.history().back().address == 0x1000);
    assert(controller.history().back().source_core != controller.history().back().target_core);
    std::ostringstream json;
    JsonOutput::write_topology(json, &cache, true);
    assert(json.str().find("\"omittedEvents\":143") != std::string::npos);
    assert(json.str().find("invalidate-for-write") != std::string::npos);
}
int main() {
    overrides(); predictors(); translation_and_memory(); coherence_history();
    std::cout << "Hardware Lab validation, predictors, translation, evidence and coherence tests passed\n";
}
