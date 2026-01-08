#include "../include/JsonOutput.hpp"
#include "../profiles/HardwarePresets.hpp"
#include <cassert>
#include <iostream>
#include <sstream>

void test_escape_empty() {
  assert(JsonOutput::escape("") == "");
  std::cout << "[PASS] test_escape_empty\n";
}

void test_escape_no_special() {
  assert(JsonOutput::escape("hello world") == "hello world");
  std::cout << "[PASS] test_escape_no_special\n";
}

void test_escape_quotes() {
  assert(JsonOutput::escape("say \"hello\"") == "say \\\"hello\\\"");
  std::cout << "[PASS] test_escape_quotes\n";
}

void test_escape_backslash() {
  assert(JsonOutput::escape("path\\to\\file") == "path\\\\to\\\\file");
  std::cout << "[PASS] test_escape_backslash\n";
}

void test_escape_mixed() {
  assert(JsonOutput::escape("a\"b\\c") == "a\\\"b\\\\c");
  std::cout << "[PASS] test_escape_mixed\n";
}

void test_coherence_state_char() {
  assert(std::string(JsonOutput::coherence_state_char(CoherenceState::Modified)) == "M");
  assert(std::string(JsonOutput::coherence_state_char(CoherenceState::Exclusive)) == "E");
  assert(std::string(JsonOutput::coherence_state_char(CoherenceState::Shared)) == "S");
  assert(std::string(JsonOutput::coherence_state_char(CoherenceState::Invalid)) == "I");
  std::cout << "[PASS] test_coherence_state_char\n";
}

void test_write_cache_stats() {
  std::ostringstream out;
  CacheStats stats;
  stats.hits = 100;
  stats.misses = 10;
  stats.writebacks = 5;
  stats.compulsory_misses = 3;
  stats.capacity_misses = 4;
  stats.conflict_misses = 3;

  JsonOutput::write_cache_stats(out, "l1d", stats, false);

  std::string json = out.str();
  assert(json.find("\"l1d\"") != std::string::npos);
  assert(json.find("\"hits\": 100") != std::string::npos);
  assert(json.find("\"misses\": 10") != std::string::npos);
  assert(json.find("\"hitRate\"") != std::string::npos);
  assert(json.find("\"compulsory\": 3") != std::string::npos);
  std::cout << "[PASS] test_write_cache_stats\n";
}

void test_write_tlb_stats() {
  std::ostringstream out;
  TLBHierarchyStats stats;
  stats.dtlb.hits = 1000;
  stats.dtlb.misses = 5;
  stats.itlb.hits = 500;
  stats.itlb.misses = 2;

  JsonOutput::write_tlb_stats(out, stats);

  std::string json = out.str();
  assert(json.find("\"tlb\"") != std::string::npos);
  assert(json.find("\"dtlb\"") != std::string::npos);
  assert(json.find("\"itlb\"") != std::string::npos);
  assert(json.find("\"hits\": 1000") != std::string::npos);
  std::cout << "[PASS] test_write_tlb_stats\n";
}

void test_write_timing_stats() {
  std::ostringstream out;
  TimingStats timing;
  timing.total_cycles = 10000;
  timing.l1_hit_cycles = 4000;
  timing.l2_hit_cycles = 3000;
  timing.l3_hit_cycles = 2000;
  timing.memory_cycles = 1000;

  LatencyConfig latency;
  latency.l1_hit = 4;
  latency.l2_hit = 12;
  latency.l3_hit = 40;
  latency.memory = 200;

  JsonOutput::write_timing_stats(out, timing, 1000, latency);

  std::string json = out.str();
  assert(json.find("\"timing\"") != std::string::npos);
  assert(json.find("\"totalCycles\"") != std::string::npos);
  assert(json.find("\"avgLatency\"") != std::string::npos);
  assert(json.find("\"breakdown\"") != std::string::npos);
  std::cout << "[PASS] test_write_timing_stats\n";
}

void test_write_hot_lines() {
  std::ostringstream out;
  std::vector<SourceStats> hot;

  SourceStats s1;
  s1.file = "main.c";
  s1.line = 10;
  s1.hits = 100;
  s1.misses = 5;
  hot.push_back(s1);

  SourceStats s2;
  s2.file = "util.c";
  s2.line = 20;
  s2.hits = 50;
  s2.misses = 10;
  hot.push_back(s2);

  JsonOutput::write_hot_lines(out, hot);

  std::string json = out.str();
  assert(json.find("\"hotLines\"") != std::string::npos);
  assert(json.find("\"main.c\"") != std::string::npos);
  assert(json.find("\"util.c\"") != std::string::npos);
  assert(json.find("\"line\": 10") != std::string::npos);
  assert(json.find("\"missRate\"") != std::string::npos);
  std::cout << "[PASS] test_write_hot_lines\n";
}

void test_write_suggestions() {
  std::ostringstream out;
  std::vector<OptimizationSuggestion> suggestions;

  OptimizationSuggestion s;
  s.type = "cache_miss";
  s.severity = "high";
  s.location = "main.c:10";
  s.message = "High miss rate detected";
  s.fix = "Consider blocking";
  suggestions.push_back(s);

  JsonOutput::write_suggestions(out, suggestions);

  std::string json = out.str();
  assert(json.find("\"suggestions\"") != std::string::npos);
  assert(json.find("\"type\": \"cache_miss\"") != std::string::npos);
  assert(json.find("\"severity\": \"high\"") != std::string::npos);
  std::cout << "[PASS] test_write_suggestions\n";
}

void test_write_coherence_stats() {
  std::ostringstream out;
  JsonOutput::write_coherence_stats(out, 42, 3);

  std::string json = out.str();
  assert(json.find("\"coherence\"") != std::string::npos);
  assert(json.find("\"invalidations\": 42") != std::string::npos);
  assert(json.find("\"falseSharingEvents\": 3") != std::string::npos);
  std::cout << "[PASS] test_write_coherence_stats\n";
}

void test_write_prefetch_stats() {
  std::ostringstream out;
  PrefetchStats stats;
  stats.prefetches_issued = 100;
  stats.prefetches_useful = 80;

  JsonOutput::write_prefetch_stats(out, "stream", 4, stats);

  std::string json = out.str();
  assert(json.find("\"prefetch\"") != std::string::npos);
  assert(json.find("\"policy\": \"stream\"") != std::string::npos);
  assert(json.find("\"degree\": 4") != std::string::npos);
  assert(json.find("\"issued\": 100") != std::string::npos);
  assert(json.find("\"accuracy\"") != std::string::npos);
  std::cout << "[PASS] test_write_prefetch_stats\n";
}

void test_write_cache_config() {
  std::ostringstream out;
  auto cfg = make_educational_config();

  JsonOutput::write_cache_config(out, cfg);

  std::string json = out.str();
  assert(json.find("\"cacheConfig\"") != std::string::npos);
  assert(json.find("\"l1d\"") != std::string::npos);
  assert(json.find("\"l2\"") != std::string::npos);
  assert(json.find("\"l3\"") != std::string::npos);
  assert(json.find("\"sizeKB\"") != std::string::npos);
  assert(json.find("\"assoc\"") != std::string::npos);
  assert(json.find("\"lineSize\"") != std::string::npos);
  std::cout << "[PASS] test_write_cache_config\n";
}

void test_write_stream_start() {
  std::ostringstream out;
  JsonOutput::write_stream_start(out, "intel", true);

  std::string json = out.str();
  assert(json.find("\"type\":\"start\"") != std::string::npos);
  assert(json.find("\"config\":\"intel\"") != std::string::npos);
  assert(json.find("\"multicore\":true") != std::string::npos);
  std::cout << "[PASS] test_write_stream_start\n";
}

void test_write_stream_progress() {
  std::ostringstream out;
  CacheStats l1, l2, l3;
  l1.hits = 100;
  l1.misses = 10;
  l2.hits = 8;
  l2.misses = 2;
  l3.hits = 1;
  l3.misses = 1;

  std::vector<JsonOutput::TimelineEvent> timeline;
  JsonOutput::TimelineEvent e;
  e.index = 1;
  e.is_write = false;
  e.is_icache = false;
  e.hit_level = 1;
  e.address = 0x1000;
  e.file = "test.c";
  e.line = 10;
  timeline.push_back(e);

  JsonOutput::write_stream_progress(out, 110, 2, l1, l2, l3, 5, timeline);

  std::string json = out.str();
  assert(json.find("\"type\":\"progress\"") != std::string::npos);
  assert(json.find("\"events\":110") != std::string::npos);
  assert(json.find("\"threads\":2") != std::string::npos);
  assert(json.find("\"timeline\"") != std::string::npos);
  std::cout << "[PASS] test_write_stream_progress\n";
}

void test_escape_file_paths() {
  // Test file paths with special characters
  std::string path = "C:\\Users\\test\\file.cpp";
  std::string escaped = JsonOutput::escape(path);
  assert(escaped == "C:\\\\Users\\\\test\\\\file.cpp");
  std::cout << "[PASS] test_escape_file_paths\n";
}

int main() {
  std::cout << "Running JsonOutput tests...\n\n";

  // Escape function tests
  test_escape_empty();
  test_escape_no_special();
  test_escape_quotes();
  test_escape_backslash();
  test_escape_mixed();
  test_escape_file_paths();

  // State helpers
  test_coherence_state_char();

  // Output formatting tests
  test_write_cache_stats();
  test_write_tlb_stats();
  test_write_timing_stats();
  test_write_hot_lines();
  test_write_suggestions();
  test_write_coherence_stats();
  test_write_prefetch_stats();
  test_write_cache_config();

  // Streaming mode tests
  test_write_stream_start();
  test_write_stream_progress();

  std::cout << "\n=== All 18 JsonOutput tests passed! ===\n";
  return 0;
}
