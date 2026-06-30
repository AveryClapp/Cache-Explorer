#include "../include/PipelineModel.hpp"
#include <cassert>
#include <iostream>

// Educational latencies give clean round numbers: l1=1, l2=10, l3=30, mem=100.
static PipelineConfig make_config(int issue_width, int rob_size) {
  PipelineConfig cfg;
  cfg.issue_width = issue_width;
  cfg.rob_size = rob_size;
  cfg.branch_mispredict_penalty = 14;
  cfg.latency = LatencyConfig::educational_default();
  return cfg;
}

// Perfect pipeline: all fetches/accesses hit L1, no branches. CPI = 1/width.
void test_ideal_throughput() {
  PipelineModel pm(make_config(4, 192));
  pm.on_inst_fetch(true, false, false, 100); // 100 instructions, L1I hit
  auto s = pm.finish();
  assert(s.instructions == 100);
  assert(s.base_cycles == 25); // ceil(100/4)
  assert(s.memory_stall_cycles() == 0);
  assert(s.frontend_stall_cycles == 0);
  assert(s.branch_stall_cycles == 0);
  assert(s.total_cycles() == 25);
  assert(s.ipc() == 4.0);
  std::cout << "[PASS] test_ideal_throughput\n";
}

// Ceiling division: a partial issue group still costs a whole cycle.
void test_ceiling_division() {
  PipelineModel pm(make_config(4, 192));
  pm.on_inst_fetch(true, false, false, 10); // ceil(10/4) = 3
  assert(pm.finish().base_cycles == 3);
  std::cout << "[PASS] test_ceiling_division\n";
}

// L1 data hits never stall.
void test_l1_data_hit_no_stall() {
  PipelineModel pm(make_config(4, 192));
  for (int i = 0; i < 50; i++)
    pm.on_data_access(true, false, false);
  assert(pm.finish().memory_stall_cycles() == 0);
  std::cout << "[PASS] test_l1_data_hit_no_stall\n";
}

// With a large OoO window, short L2/L3 latencies are fully hidden but an
// LLC->DRAM miss is not. hideable = rob/width = 192/4 = 48.
void test_ooo_hides_short_misses_exposes_dram() {
  PipelineModel pm(make_config(4, 192));
  pm.on_data_access(false, true, false);  // L2 hit: penalty 10-1=9  < 48 -> hidden
  pm.on_data_access(false, false, true);  // L3 hit: penalty 30-1=29 < 48 -> hidden
  pm.on_data_access(false, false, false); // DRAM:   penalty 100-1=99 -> 99-48 = 51
  auto s = pm.finish();
  assert(s.l2_stall_cycles == 0);
  assert(s.l3_stall_cycles == 0);
  assert(s.dram_stall_cycles == 51);
  std::cout << "[PASS] test_ooo_hides_short_misses_exposes_dram\n";
}

// A tiny ROB hides almost nothing, exposing every miss level. hideable = 4/4 = 1.
void test_small_window_exposes_all_levels() {
  PipelineModel pm(make_config(4, 4));
  pm.on_data_access(false, true, false);  // L2: 9 - 1 = 8
  pm.on_data_access(false, false, true);  // L3: 29 - 1 = 28
  pm.on_data_access(false, false, false); // DRAM: 99 - 1 = 98
  auto s = pm.finish();
  assert(s.l2_stall_cycles == 8);
  assert(s.l3_stall_cycles == 28);
  assert(s.dram_stall_cycles == 98);
  std::cout << "[PASS] test_small_window_exposes_all_levels\n";
}

// Front-end (I-cache) misses are not hidden by the OoO backend.
void test_frontend_miss_not_hidden() {
  PipelineModel pm(make_config(4, 192)); // hideable 48 (irrelevant to front end)
  pm.on_inst_fetch(false, true, false, 4);  // L2I: 10-1 = 9 stall
  pm.on_inst_fetch(false, false, false, 4); // DRAM: 100-1 = 99 stall
  auto s = pm.finish();
  assert(s.instructions == 8);
  assert(s.frontend_stall_cycles == 9 + 99);
  std::cout << "[PASS] test_frontend_miss_not_hidden\n";
}

// Branch mispredictions add a fixed refill penalty; correct predictions don't.
void test_branch_misprediction_penalty() {
  PipelineModel pm(make_config(4, 192));
  pm.on_branch(false); // correct
  pm.on_branch(true);  // mispredict: +14
  pm.on_branch(true);  // mispredict: +14
  assert(pm.finish().branch_stall_cycles == 28);
  std::cout << "[PASS] test_branch_misprediction_penalty\n";
}

// All components sum into total cycles and CPI.
void test_combined_cpi() {
  PipelineModel pm(make_config(4, 192));
  pm.on_inst_fetch(true, false, false, 100); // base ceil(100/4)=25
  pm.on_data_access(false, false, false);    // DRAM stall 51
  pm.on_branch(true);                         // branch stall 14
  auto s = pm.finish();
  assert(s.base_cycles == 25);
  assert(s.dram_stall_cycles == 51);
  assert(s.branch_stall_cycles == 14);
  assert(s.total_cycles() == 25 + 51 + 14); // 90
  assert(s.instructions == 100);
  // CPI = 90/100 = 0.9
  assert(s.cpi() > 0.89 && s.cpi() < 0.91);
  std::cout << "[PASS] test_combined_cpi\n";
}

// reset() returns the model to a clean state.
void test_reset() {
  PipelineModel pm(make_config(4, 192));
  pm.on_inst_fetch(true, false, false, 40);
  pm.on_branch(true);
  pm.reset();
  auto s = pm.finish();
  assert(s.instructions == 0);
  assert(s.total_cycles() == 0);
  std::cout << "[PASS] test_reset\n";
}

int main() {
  test_ideal_throughput();
  test_ceiling_division();
  test_l1_data_hit_no_stall();
  test_ooo_hides_short_misses_exposes_dram();
  test_small_window_exposes_all_levels();
  test_frontend_miss_not_hidden();
  test_branch_misprediction_penalty();
  test_combined_cpi();
  test_reset();

  std::cout << "\n=== All 9 PipelineModel tests passed! ===\n";
  return 0;
}
