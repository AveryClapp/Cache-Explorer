#include "../include/TraceProcessor.hpp"
#include "../include/TraceEvent.hpp"
#include "../profiles/HardwarePresets.hpp"
#include <cassert>
#include <iostream>
#include <string>

// Use educational config for predictable results
CacheHierarchyConfig make_test_hierarchy() {
  return make_educational_config();
}

void test_basic_read_event() {
  TraceProcessor processor(make_test_hierarchy());

  TraceEvent event;
  event.address = 0x1000;
  event.size = 4;
  event.is_write = false;
  event.thread_id = 0;
  event.file = "test.c";
  event.line = 10;

  processor.process(event);

  auto stats = processor.get_stats();
  assert(stats.l1d.total_accesses() == 1);
  assert(stats.l1d.misses == 1);  // First access is a miss
  std::cout << "[PASS] test_basic_read_event\n";
}

void test_basic_write_event() {
  TraceProcessor processor(make_test_hierarchy());

  TraceEvent event;
  event.address = 0x1000;
  event.size = 4;
  event.is_write = true;
  event.thread_id = 0;
  event.file = "test.c";
  event.line = 10;

  processor.process(event);

  auto stats = processor.get_stats();
  assert(stats.l1d.total_accesses() == 1);
  std::cout << "[PASS] test_basic_write_event\n";
}

void test_repeated_access_hits() {
  TraceProcessor processor(make_test_hierarchy());

  TraceEvent event;
  event.address = 0x1000;
  event.size = 4;
  event.is_write = false;
  event.thread_id = 0;

  // First access - miss
  processor.process(event);
  // Second access - hit
  processor.process(event);

  auto stats = processor.get_stats();
  assert(stats.l1d.hits == 1);
  assert(stats.l1d.misses == 1);
  std::cout << "[PASS] test_repeated_access_hits\n";
}

void test_hot_lines_tracking() {
  TraceProcessor processor(make_test_hierarchy());

  // Access from different source lines
  TraceEvent event1;
  event1.address = 0x1000;
  event1.size = 4;
  event1.is_write = false;
  event1.file = "test.c";
  event1.line = 10;

  TraceEvent event2;
  event2.address = 0x2000;
  event2.size = 4;
  event2.is_write = false;
  event2.file = "test.c";
  event2.line = 20;

  // Line 10: 3 accesses (1 miss, 2 hits)
  processor.process(event1);
  processor.process(event1);
  processor.process(event1);

  // Line 20: 5 accesses (1 miss, 4 hits)
  processor.process(event2);
  processor.process(event2);
  processor.process(event2);
  processor.process(event2);
  processor.process(event2);

  auto hot = processor.get_hot_lines(10);
  assert(hot.size() == 2);
  // Sorted by misses, both have 1 miss
  std::cout << "[PASS] test_hot_lines_tracking\n";
}

void test_source_keys_own_short_filename_storage() {
  TraceProcessor processor(make_test_hierarchy());

  for (uint32_t i = 0; i < 200; ++i) {
    TraceEvent event;
    event.address = 0x1000 + static_cast<uint64_t>(i) * 64;
    event.size = 4;
    event.file = "f" + std::to_string(i) + ".c";
    event.line = i + 1;
    processor.process(event);
  }

  const auto hot = processor.get_hot_lines(200);
  assert(hot.size() == 200);
  for (const auto &entry : hot) {
    assert(!entry.file.empty());
    assert(entry.file.front() == 'f');
    assert(entry.file.size() >= 2);
    assert(entry.file.compare(entry.file.size() - 2, 2, ".c") == 0);
  }
  std::cout << "[PASS] test_source_keys_own_short_filename_storage\n";
}

void test_bottleneck_summary_and_source_annotations() {
  TraceProcessor processor(make_test_hierarchy());

  TraceEvent event;
  event.address = 0x100000;
  event.size = 4;
  event.is_write = false;
  event.file = "pointer.c";
  event.line = 27;

  processor.process(event);

  auto summary = processor.get_bottleneck_summary();
  assert(summary.primary_bottleneck == "memory");
  assert(summary.estimated_cycles > 0);
  assert(summary.has_top_source);
  assert(summary.top_source.file == "pointer.c");
  assert(summary.top_source.line == 27);

  auto annotations = processor.get_source_annotations(4);
  assert(!annotations.empty());
  assert(annotations[0].subsystem == "memory");
  assert(annotations[0].file == "pointer.c");
  assert(annotations[0].cycles > 0);
  std::cout << "[PASS] test_bottleneck_summary_and_source_annotations\n";
}

void test_event_callback() {
  TraceProcessor processor(make_test_hierarchy());

  int callback_count = 0;
  bool saw_miss = false;
  bool saw_hit = false;

  processor.set_event_callback([&](const EventResult& r) {
    callback_count++;
    if (r.l1_hit) saw_hit = true;
    else saw_miss = true;
  });

  TraceEvent event;
  event.address = 0x1000;
  event.size = 4;
  event.is_write = false;

  processor.process(event);  // miss
  processor.process(event);  // hit

  assert(callback_count == 2);
  assert(saw_miss);
  assert(saw_hit);
  std::cout << "[PASS] test_event_callback\n";
}

void test_prefetching_enabled() {
  TraceProcessor processor(make_test_hierarchy());
  processor.enable_prefetching(PrefetchPolicy::NEXT_LINE, 2);

  // Sequential access should trigger prefetching
  for (int i = 0; i < 10; i++) {
    TraceEvent event;
    event.address = 0x1000 + (i * 64);  // Each cache line
    event.size = 4;
    event.is_write = false;
    processor.process(event);
  }

  auto pf_stats = processor.get_prefetch_stats();
  // With next-line prefetching, we should have issued some prefetches
  assert(pf_stats.prefetches_issued > 0);
  std::cout << "[PASS] test_prefetching_enabled\n";
}

void test_parse_trace_event_read() {
  auto event = parse_trace_event("L 0x7fff1234 4 main.c:10 T0");
  assert(event.has_value());
  assert(event->address == 0x7fff1234);
  assert(event->size == 4);
  assert(event->is_write == false);
  assert(event->is_icache == false);
  assert(event->file == "main.c");
  assert(event->line == 10);
  assert(event->thread_id == 0);
  std::cout << "[PASS] test_parse_trace_event_read\n";
}

void test_parse_trace_event_write() {
  auto event = parse_trace_event("S 0xdeadbeef 8 foo.cpp:42 T1");
  assert(event.has_value());
  assert(event->address == 0xdeadbeef);
  assert(event->size == 8);
  assert(event->is_write == true);
  assert(event->file == "foo.cpp");
  assert(event->line == 42);
  assert(event->thread_id == 1);
  std::cout << "[PASS] test_parse_trace_event_write\n";
}

void test_parse_trace_event_icache() {
  auto event = parse_trace_event("I 0x400000 4 main.c:1 T0");
  assert(event.has_value());
  assert(event->is_icache == true);
  assert(event->is_write == false);
  std::cout << "[PASS] test_parse_trace_event_icache\n";
}

void test_parse_trace_event_invalid() {
  auto event = parse_trace_event("invalid line");
  assert(!event.has_value());
  assert(!parse_trace_event("L 0x1000 4 main.c:not-a-line T0").has_value());
  assert(!parse_trace_event("L 0x1000 4 main.c:10 T99999999999999999999").has_value());
  std::cout << "[PASS] test_parse_trace_event_invalid\n";
}

void test_parse_trace_event_empty() {
  auto event = parse_trace_event("");
  assert(!event.has_value());
  std::cout << "[PASS] test_parse_trace_event_empty\n";
}

void test_parse_trace_event_comment() {
  auto event = parse_trace_event("# This is a comment");
  assert(!event.has_value());
  std::cout << "[PASS] test_parse_trace_event_comment\n";
}

void test_cross_cache_line_access() {
  TraceProcessor processor(make_test_hierarchy());

  // Access that spans two cache lines
  TraceEvent event;
  event.address = 0x103C;  // Near end of cache line
  event.size = 16;         // Spans into next line
  event.is_write = false;

  processor.process(event);

  auto stats = processor.get_stats();
  // Should generate 2 cache accesses
  assert(stats.l1d.total_accesses() == 2);
  std::cout << "[PASS] test_cross_cache_line_access\n";
}

void test_stats_timing() {
  TraceProcessor processor(make_test_hierarchy());

  // Generate some hits and misses
  TraceEvent event;
  event.address = 0x1000;
  event.size = 4;
  event.is_write = false;

  processor.process(event);  // miss
  processor.process(event);  // hit

  auto stats = processor.get_stats();
  auto timing = stats.timing;

  // Should have tracked some cycles
  assert(timing.total_cycles > 0);
  assert(timing.l1_hit_cycles > 0 || timing.l2_hit_cycles > 0 ||
         timing.l3_hit_cycles > 0 || timing.memory_cycles > 0);
  std::cout << "[PASS] test_stats_timing\n";
}

void test_tlb_simulation() {
  TraceProcessor processor(make_test_hierarchy());

  TraceEvent event;
  event.address = 0x1000;
  event.size = 4;
  event.is_write = false;

  processor.process(event);

  auto& cache_sys = processor.get_cache_system();
  auto tlb_stats = cache_sys.get_tlb_stats();

  // Should have at least one TLB access
  assert(tlb_stats.dtlb.total_accesses() >= 1);
  std::cout << "[PASS] test_tlb_simulation\n";
}

// =====================================================================
// Pin tool trace format compatibility tests
// These verify that output produced by cache_profiler.cpp is parseable.
// =====================================================================

void test_pin_load_format_no_source() {
  // Pin emits unknown:0 when no debug info available
  auto event = parse_trace_event("L 0x7fff5fbff8e0 4 unknown:0 T0");
  assert(event.has_value());
  assert(event->address == 0x7fff5fbff8e0ULL);
  assert(event->size == 4);
  assert(!event->is_write);
  assert(event->thread_id == 0);
  assert(event->file == "unknown");
  assert(event->line == 0);
  std::cout << "[PASS] test_pin_load_format_no_source\n";
}

void test_pin_store_format_no_source() {
  // Pin store with no debug info
  auto event = parse_trace_event("S 0xdeadbeef00 8 unknown:0 T1");
  assert(event.has_value());
  assert(event->address == 0xdeadbeef00ULL);
  assert(event->size == 8);
  assert(event->is_write);
  assert(event->thread_id == 1);
  std::cout << "[PASS] test_pin_store_format_no_source\n";
}

void test_pin_load_path_qualified_source() {
  // Pin often records absolute paths for system library accesses
  auto event = parse_trace_event("L 0x400100 4 /usr/lib/libc.so.6:0 T0");
  assert(event.has_value());
  assert(event->address == 0x400100ULL);
  assert(event->size == 4);
  assert(!event->is_write);
  assert(event->file == "/usr/lib/libc.so.6");
  assert(event->line == 0);
  assert(event->thread_id == 0);
  std::cout << "[PASS] test_pin_load_path_qualified_source\n";
}

void test_pin_store_format_with_source() {
  // Pin store with debug info
  auto event = parse_trace_event("S 0x600200 8 foo.cpp:99 T2");
  assert(event.has_value());
  assert(event->address == 0x600200ULL);
  assert(event->size == 8);
  assert(event->is_write);
  assert(event->file == "foo.cpp");
  assert(event->line == 99);
  assert(event->thread_id == 2);
  std::cout << "[PASS] test_pin_store_format_with_source\n";
}

void test_pin_windows_path_source() {
  auto event = parse_trace_event(
      "L 0x401000 4 C:\\games\\engine\\renderer.cpp:314 T3");
  assert(event.has_value());
  assert(event->address == 0x401000ULL);
  assert(event->file == "C:\\games\\engine\\renderer.cpp");
  assert(event->line == 314);
  assert(event->thread_id == 3);
  std::cout << "[PASS] test_pin_windows_path_source\n";
}

void test_pin_multibyte_access() {
  // 16-byte access (e.g. XMM register load)
  auto event = parse_trace_event("L 0x1000 16 memops.c:7 T0");
  assert(event.has_value());
  assert(event->address == 0x1000ULL);
  assert(event->size == 16);
  assert(!event->is_write);
  assert(event->file == "memops.c");
  assert(event->line == 7);
  assert(event->thread_id == 0);
  std::cout << "[PASS] test_pin_multibyte_access\n";
}

void test_pin_high_thread_id() {
  // Multi-threaded workload with thread 15
  auto event = parse_trace_event("L 0x1000 4 thread.c:1 T15");
  assert(event.has_value());
  assert(event->address == 0x1000ULL);
  assert(event->size == 4);
  assert(!event->is_write);
  assert(event->file == "thread.c");
  assert(event->line == 1);
  assert(event->thread_id == 15);
  std::cout << "[PASS] test_pin_high_thread_id\n";
}

int main() {
  std::cout << "Running TraceProcessor tests...\n\n";

  // Basic processing
  test_basic_read_event();
  test_basic_write_event();
  test_repeated_access_hits();
  test_hot_lines_tracking();
  test_source_keys_own_short_filename_storage();
  test_bottleneck_summary_and_source_annotations();
  test_event_callback();
  test_prefetching_enabled();

  // Trace parsing
  test_parse_trace_event_read();
  test_parse_trace_event_write();
  test_parse_trace_event_icache();
  test_parse_trace_event_invalid();
  test_parse_trace_event_empty();
  test_parse_trace_event_comment();

  // Advanced features
  test_cross_cache_line_access();
  test_stats_timing();
  test_tlb_simulation();

  // Pin tool trace format compatibility
  test_pin_load_format_no_source();
  test_pin_store_format_no_source();
  test_pin_load_path_qualified_source();
  test_pin_store_format_with_source();
  test_pin_windows_path_source();
  test_pin_multibyte_access();
  test_pin_high_thread_id();

  std::cout << "\n=== All 24 TraceProcessor tests passed! ===\n";
  return 0;
}
