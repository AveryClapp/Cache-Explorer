#include "../include/BranchPredictor.hpp"
#include "../include/TraceEvent.hpp"
#include <cassert>
#include <iostream>

// A 2-bit counter starts weakly not-taken. The first taken branch is a
// misprediction; once warmed up, a consistently-taken branch predicts correctly.
void test_warmup_then_steady_taken() {
  BranchPredictor bp(16);
  // counter 1 -> predict NT. taken -> mispredict, counter 2.
  bp.process(0, true, "a.c", 1); // mispredict (predicted NT)
  // counter 2 -> predict T. taken -> correct, counter 3.
  bp.process(0, true, "a.c", 1); // correct
  bp.process(0, true, "a.c", 1); // correct (saturated at 3)
  bp.process(0, true, "a.c", 1); // correct

  assert(bp.stats().total == 4);
  assert(bp.stats().mispredictions == 1);
  std::cout << "[PASS] test_warmup_then_steady_taken\n";
}

// Steady not-taken: predictor starts at NT, so every outcome is correct.
void test_steady_not_taken() {
  BranchPredictor bp(16);
  for (int i = 0; i < 10; i++)
    bp.process(0, false, "a.c", 1);
  assert(bp.stats().total == 10);
  assert(bp.stats().mispredictions == 0);
  std::cout << "[PASS] test_steady_not_taken\n";
}

// 2-bit hysteresis: a single odd outcome in a taken-dominant stream should
// NOT flip the prediction (that is the point of 2 bits vs 1).
void test_hysteresis() {
  BranchPredictor bp(16);
  bp.process(0, true, "a.c", 1);  // mispredict, counter 1->2
  bp.process(0, true, "a.c", 1);  // correct, counter 2->3
  bp.process(0, false, "a.c", 1); // mispredict, counter 3->2 (still predicts T)
  bp.process(0, true, "a.c", 1);  // correct (counter 2 predicts T), 2->3
  assert(bp.stats().total == 4);
  assert(bp.stats().mispredictions == 2);
  std::cout << "[PASS] test_hysteresis\n";
}

// Strictly-alternating outcomes are the bimodal predictor's worst case.
void test_alternating_worst_case() {
  BranchPredictor bp(16);
  bool taken = false;
  for (int i = 0; i < 100; i++) {
    taken = !taken;
    bp.process(0, taken, "a.c", 1);
  }
  // A 2-bit predictor mispredicts the large majority of a strict alternation;
  // assert it does substantially worse than chance is impossible, so just
  // require a high misprediction rate.
  assert(bp.stats().misprediction_rate() > 0.4);
  std::cout << "[PASS] test_alternating_worst_case (rate="
            << bp.stats().misprediction_rate() << ")\n";
}

// Distinct branch sites must be tracked independently, and aliasing occurs
// only when ids collide modulo the table size.
void test_per_site_attribution_and_aliasing() {
  BranchPredictor bp(4); // 4 entries -> mask 0x3
  // Site 0 always taken, site 1 always not-taken: independent histories.
  for (int i = 0; i < 5; i++) {
    bp.process(0, true, "a.c", 10);
    bp.process(1, false, "a.c", 20);
  }
  auto hot = bp.hot_mispredicts();
  bool saw_site0 = false, saw_site1 = false;
  for (const auto &s : hot) {
    if (s.line == 10) {
      saw_site0 = true;
      assert(s.total == 5);
      assert(s.mispredictions == 1); // only the first taken is wrong
    }
    if (s.line == 20) {
      saw_site1 = true;
      assert(s.total == 5);
      assert(s.mispredictions == 0); // starts NT, always correct
    }
  }
  assert(saw_site0 && saw_site1);

  // Aliasing: id 0 and id 4 map to the same counter (4 & 3 == 0) but are
  // tracked as separate sites in the per-site map.
  BranchPredictor bp2(4);
  bp2.process(0, true, "a.c", 1);
  bp2.process(4, true, "a.c", 2); // sees counter already advanced by id 0
  assert(bp2.hot_mispredicts().size() == 2); // two distinct sites
  std::cout << "[PASS] test_per_site_attribution_and_aliasing\n";
}

// Non-power-of-two table size is rounded up and stays functional.
void test_table_size_rounding() {
  BranchPredictor bp(1000); // rounds to 1024
  bp.process(12345, true, "a.c", 1);
  assert(bp.stats().total == 1);
  bp.reset();
  assert(bp.stats().total == 0);
  assert(bp.hot_mispredicts().empty());
  std::cout << "[PASS] test_table_size_rounding\n";
}

// The trace parser produces branch events from `B` lines.
void test_parse_branch_event() {
  auto taken = parse_trace_event("B 0x2a 1 loop.c:7 T1");
  assert(taken.has_value());
  assert(taken->is_branch);
  assert(taken->branch_taken);
  assert(taken->branch_id == 0x2a);
  assert(taken->address == 0x2a);
  assert(taken->file == "loop.c");
  assert(taken->line == 7);

  auto not_taken = parse_trace_event("B 0x2a 0 loop.c:7 T1");
  assert(not_taken.has_value());
  assert(not_taken->is_branch);
  assert(!not_taken->branch_taken);
  assert(not_taken->branch_id == 0x2a);
  std::cout << "[PASS] test_parse_branch_event\n";
}

int main() {
  test_warmup_then_steady_taken();
  test_steady_not_taken();
  test_hysteresis();
  test_alternating_worst_case();
  test_per_site_attribution_and_aliasing();
  test_table_size_rounding();
  test_parse_branch_event();

  std::cout << "\n=== All 7 BranchPredictor tests passed! ===\n";
  return 0;
}
