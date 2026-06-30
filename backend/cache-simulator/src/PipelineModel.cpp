#include "include/PipelineModel.hpp"

#include <algorithm>

int PipelineModel::exposed_data_penalty(int access_latency) const {
  // Latency beyond an L1 hit is the stall source; the rest is pipelined.
  int penalty = access_latency - cfg_.latency.l1_hit;
  if (penalty <= 0)
    return 0;
  // The OoO window hides up to rob_drain cycles of it.
  return std::max(0, penalty - cfg_.hideable_cycles());
}

void PipelineModel::on_data_access(bool l1_hit, bool l2_hit, bool l3_hit) {
  if (l1_hit)
    return; // hidden in the base pipeline
  if (l2_hit)
    l2_stall_ += exposed_data_penalty(cfg_.latency.l2_hit);
  else if (l3_hit)
    l3_stall_ += exposed_data_penalty(cfg_.latency.l3_hit);
  else
    dram_stall_ += exposed_data_penalty(cfg_.latency.memory);
}

void PipelineModel::on_inst_fetch(bool l1_hit, bool l2_hit, bool l3_hit,
                                  uint32_t instr_count) {
  instructions_ += instr_count;
  if (l1_hit)
    return; // front end keeps up
  // Front-end misses stall fetch and are not hidden by the OoO backend.
  int latency = l2_hit ? cfg_.latency.l2_hit
                       : (l3_hit ? cfg_.latency.l3_hit : cfg_.latency.memory);
  frontend_stall_ += std::max(0, latency - cfg_.latency.l1_hit);
}

void PipelineModel::on_branch(bool mispredicted) {
  if (mispredicted)
    branch_stall_ += cfg_.branch_mispredict_penalty;
}

PipelineStats PipelineModel::finish() const {
  PipelineStats s;
  s.instructions = instructions_;
  // Ceiling division: even a partial issue group costs a cycle.
  s.base_cycles =
      cfg_.issue_width > 0
          ? (instructions_ + cfg_.issue_width - 1) / cfg_.issue_width
          : instructions_;
  s.frontend_stall_cycles = frontend_stall_;
  s.l2_stall_cycles = l2_stall_;
  s.l3_stall_cycles = l3_stall_;
  s.dram_stall_cycles = dram_stall_;
  s.branch_stall_cycles = branch_stall_;
  return s;
}

void PipelineModel::reset() {
  instructions_ = 0;
  frontend_stall_ = 0;
  l2_stall_ = 0;
  l3_stall_ = 0;
  dram_stall_ = 0;
  branch_stall_ = 0;
}
