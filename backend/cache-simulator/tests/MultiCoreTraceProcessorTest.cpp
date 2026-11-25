#include "../include/MultiCoreTraceProcessor.hpp"
#include "../profiles/CacheConfig.hpp"
#include <cassert>
#include <iostream>

CacheConfig make_test_l1_config() {
  return {.kb_size = 1, .associativity = 2, .line_size = 64,
          .policy = EvictionPolicy::LRU, .write_policy = WritePolicy::Back};
}

CacheConfig make_test_l2_config() {
  return {.kb_size = 4, .associativity = 4, .line_size = 64,
          .policy = EvictionPolicy::LRU, .write_policy = WritePolicy::Back};
}

CacheConfig make_test_l3_config() {
  return {.kb_size = 16, .associativity = 8, .line_size = 64,
          .policy = EvictionPolicy::LRU, .write_policy = WritePolicy::Back};
}

void test_false_sharing_preserves_byte_offsets() {
  MultiCoreTraceProcessor processor(2, make_test_l1_config(),
                                    make_test_l2_config(),
                                    make_test_l3_config());

  TraceEvent first;
  first.address = 0x1000;
  first.size = 4;
  first.is_write = true;
  first.thread_id = 1;
  first.file = "packed.c";
  first.line = 10;

  TraceEvent second = first;
  second.address = 0x1004;
  second.thread_id = 2;
  second.line = 11;

  processor.process(first);
  processor.process(second);

  auto stats = processor.get_stats();
  assert(stats.false_sharing_events == 1);

  auto reports = processor.get_false_sharing_reports();
  assert(reports.size() == 1);
  assert(reports[0].accesses.size() == 2);
  assert(reports[0].accesses[0].byte_offset != reports[0].accesses[1].byte_offset);

  std::cout << "[PASS] test_false_sharing_preserves_byte_offsets\n";
}

void test_same_offset_is_not_false_sharing() {
  MultiCoreTraceProcessor processor(2, make_test_l1_config(),
                                    make_test_l2_config(),
                                    make_test_l3_config());

  TraceEvent first;
  first.address = 0x2000;
  first.size = 4;
  first.is_write = true;
  first.thread_id = 1;

  TraceEvent second = first;
  second.thread_id = 2;

  processor.process(first);
  processor.process(second);

  auto stats = processor.get_stats();
  assert(stats.false_sharing_events == 0);

  std::cout << "[PASS] test_same_offset_is_not_false_sharing\n";
}

void test_false_sharing_history_is_sampled_and_counted() {
  MultiCoreTraceProcessor processor(2, make_test_l1_config(),
                                    make_test_l2_config(),
                                    make_test_l3_config());
  for (uint32_t i = 0; i < 1000; ++i) {
    TraceEvent event;
    event.address = 0x3000 + (i % 2) * 4;
    event.size = 4;
    event.is_write = true;
    event.thread_id = (i % 2) + 1;
    event.file = "threaded.c";
    event.line = i + 1;
    processor.process(event);
  }

  const auto reports = processor.get_false_sharing_reports();
  assert(reports.size() == 1);
  assert(reports[0].total_accesses == 1000);
  assert(reports[0].accesses.size() <= 64);
  std::cout << "[PASS] test_false_sharing_history_is_sampled_and_counted\n";
}

int main() {
  std::cout << "=== Multi-Core Trace Processor Tests ===\n\n";

  test_false_sharing_preserves_byte_offsets();
  test_same_offset_is_not_false_sharing();
  test_false_sharing_history_is_sampled_and_counted();

  std::cout << "\n=== All Multi-Core Trace Processor tests passed! ===\n";
  return 0;
}
