#pragma once

#include <cstdint>

#include "../profiles/CacheConfig.hpp"

// Microarchitectural parameters for the out-of-order core model.
struct PipelineConfig {
  int issue_width = 4;              // instructions retired per cycle (IPC ceiling)
  int rob_size = 192;              // reorder-buffer entries (OoO instruction window)
  int branch_mispredict_penalty = 14; // front-end refill cycles on a misprediction
  LatencyConfig latency = {};      // per-level access latencies (cycles)

  // Cycles of miss latency the OoO window can hide by executing independent
  // work: draining a full ROB at the issue width.
  [[nodiscard]] int hideable_cycles() const {
    return issue_width > 0 ? rob_size / issue_width : 0;
  }
};

// Estimated cycle breakdown produced by the pipeline model.
struct PipelineStats {
  uint64_t instructions = 0;
  uint64_t base_cycles = 0;        // instructions / issue_width (perfect pipeline)
  uint64_t frontend_stall_cycles = 0; // exposed I-cache miss latency
  uint64_t l2_stall_cycles = 0;    // exposed L1-miss/L2-hit latency (data)
  uint64_t l3_stall_cycles = 0;    // exposed L2-miss/L3-hit latency (data)
  uint64_t dram_stall_cycles = 0;  // exposed LLC-miss latency (data)
  uint64_t branch_stall_cycles = 0; // misprediction refill penalty

  [[nodiscard]] uint64_t memory_stall_cycles() const {
    return l2_stall_cycles + l3_stall_cycles + dram_stall_cycles;
  }
  [[nodiscard]] uint64_t total_cycles() const {
    return base_cycles + frontend_stall_cycles + memory_stall_cycles() +
           branch_stall_cycles;
  }
  [[nodiscard]] double cpi() const {
    return instructions ? (double)total_cycles() / instructions : 0;
  }
  [[nodiscard]] double ipc() const {
    uint64_t c = total_cycles();
    return c ? (double)instructions / c : 0;
  }
};

// First-order (interval) out-of-order performance model.
//
// This is an ANALYTICAL model, not a cycle-accurate structural simulator.
// The trace provides instruction counts, memory accesses with their cache-hit
// level, and branch directions -- but no per-instruction dependency graph or
// opcodes, so a Tomasulo/ROB structural model is not derivable from it.
//
// Instead we estimate CPI as the ideal throughput (1 / issue_width) plus the
// stall cycles that the out-of-order window fails to hide:
//   - data-cache misses expose (miss_latency - rob_drain) cycles; short L2/L3
//     latencies are typically fully overlapped, LLC->DRAM misses are not;
//   - I-cache misses stall the front end and are not hidden by the OoO backend;
//   - branch mispredictions flush the pipeline (fixed refill penalty).
class PipelineModel {
public:
  explicit PipelineModel(const PipelineConfig &cfg) : cfg_(cfg) {}

  // A demand data access that hit at the given level (booleans are cumulative:
  // an L2 hit has l1_hit=false, l2_hit=true).
  uint64_t on_data_access(bool l1_hit, bool l2_hit, bool l3_hit);

  // An instruction fetch for a basic block of `instr_count` instructions,
  // hitting the instruction caches at the given level.
  uint64_t on_inst_fetch(bool l1_hit, bool l2_hit, bool l3_hit,
                         uint32_t instr_count);

  // A conditional branch; `mispredicted` from the branch predictor.
  uint64_t on_branch(bool mispredicted);

  [[nodiscard]] PipelineStats finish() const;

  void reset();

private:
  // Exposed stall for a data miss latency after OoO hiding.
  [[nodiscard]] int exposed_data_penalty(int access_latency) const;

  PipelineConfig cfg_;
  uint64_t instructions_ = 0;
  uint64_t frontend_stall_ = 0;
  uint64_t l2_stall_ = 0;
  uint64_t l3_stall_ = 0;
  uint64_t dram_stall_ = 0;
  uint64_t branch_stall_ = 0;
};
