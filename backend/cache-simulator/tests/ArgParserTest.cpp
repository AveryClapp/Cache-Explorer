#include "../include/ArgParser.hpp"
#include <cassert>
#include <cstring>
#include <iostream>
#include <vector>

// Helper to create argv-style arguments
class ArgvBuilder {
public:
  ArgvBuilder() { args.push_back(strdup("cache-sim")); }
  ~ArgvBuilder() {
    for (char* arg : args) free(arg);
  }

  ArgvBuilder& add(const char* arg) {
    args.push_back(strdup(arg));
    return *this;
  }

  int argc() const { return static_cast<int>(args.size()); }
  char** argv() { return args.data(); }

private:
  std::vector<char*> args;
};

void test_default_options() {
  ArgvBuilder builder;
  auto opts = ArgParser::parse(builder.argc(), builder.argv());

  assert(opts.config_name == "intel");
  assert(opts.verbose == false);
  assert(opts.json_output == false);
  assert(opts.stream_mode == false);
  assert(opts.show_help == false);
  // Intel preset enables prefetching by default
  assert(opts.prefetch_policy == PrefetchPolicy::ADAPTIVE);
  assert(opts.num_cores == 0);

  std::cout << "[PASS] test_default_options\n";
}

void test_config_flag() {
  ArgvBuilder builder;
  builder.add("--config").add("amd");
  auto opts = ArgParser::parse(builder.argc(), builder.argv());

  assert(opts.config_name == "amd");
  std::cout << "[PASS] test_config_flag\n";
}

void test_verbose_flag() {
  ArgvBuilder builder;
  builder.add("--verbose");
  auto opts = ArgParser::parse(builder.argc(), builder.argv());

  assert(opts.verbose == true);
  std::cout << "[PASS] test_verbose_flag\n";
}

void test_json_flag() {
  ArgvBuilder builder;
  builder.add("--json");
  auto opts = ArgParser::parse(builder.argc(), builder.argv());

  assert(opts.json_output == true);
  std::cout << "[PASS] test_json_flag\n";
}

void test_stream_flag() {
  ArgvBuilder builder;
  builder.add("--stream");
  auto opts = ArgParser::parse(builder.argc(), builder.argv());

  assert(opts.stream_mode == true);
  std::cout << "[PASS] test_stream_flag\n";
}

void test_help_flag() {
  ArgvBuilder builder;
  builder.add("--help");
  auto opts = ArgParser::parse(builder.argc(), builder.argv());

  assert(opts.show_help == true);
  std::cout << "[PASS] test_help_flag\n";
}

void test_cores_flag() {
  ArgvBuilder builder;
  builder.add("--cores").add("4");
  auto opts = ArgParser::parse(builder.argc(), builder.argv());

  assert(opts.num_cores == 4);
  std::cout << "[PASS] test_cores_flag\n";
}

void test_prefetch_policy_none() {
  auto policy = ArgParser::parse_prefetch_policy("none");
  assert(policy == PrefetchPolicy::NONE);
  std::cout << "[PASS] test_prefetch_policy_none\n";
}

void test_prefetch_policy_next() {
  auto policy = ArgParser::parse_prefetch_policy("next");
  assert(policy == PrefetchPolicy::NEXT_LINE);
  std::cout << "[PASS] test_prefetch_policy_next\n";
}

void test_prefetch_policy_stream() {
  auto policy = ArgParser::parse_prefetch_policy("stream");
  assert(policy == PrefetchPolicy::STREAM);
  std::cout << "[PASS] test_prefetch_policy_stream\n";
}

void test_prefetch_policy_stride() {
  auto policy = ArgParser::parse_prefetch_policy("stride");
  assert(policy == PrefetchPolicy::STRIDE);
  std::cout << "[PASS] test_prefetch_policy_stride\n";
}

void test_prefetch_policy_adaptive() {
  auto policy = ArgParser::parse_prefetch_policy("adaptive");
  assert(policy == PrefetchPolicy::ADAPTIVE);
  std::cout << "[PASS] test_prefetch_policy_adaptive\n";
}

void test_prefetch_policy_intel() {
  auto policy = ArgParser::parse_prefetch_policy("intel");
  assert(policy == PrefetchPolicy::INTEL);
  std::cout << "[PASS] test_prefetch_policy_intel\n";
}

void test_prefetch_policy_name_output() {
  // Test that policy names are correctly generated
  assert(ArgParser::prefetch_policy_name(PrefetchPolicy::NONE) == "none");
  assert(ArgParser::prefetch_policy_name(PrefetchPolicy::NEXT_LINE) == "next_line");
  assert(ArgParser::prefetch_policy_name(PrefetchPolicy::STREAM) == "stream");
  assert(ArgParser::prefetch_policy_name(PrefetchPolicy::STRIDE) == "stride");
  assert(ArgParser::prefetch_policy_name(PrefetchPolicy::ADAPTIVE) == "adaptive");
  assert(ArgParser::prefetch_policy_name(PrefetchPolicy::INTEL) == "intel");

  std::cout << "[PASS] test_prefetch_policy_name_output\n";
}

void test_prefetch_flag() {
  ArgvBuilder builder;
  builder.add("--prefetch").add("stream");
  auto opts = ArgParser::parse(builder.argc(), builder.argv());

  assert(opts.prefetch_policy == PrefetchPolicy::STREAM);
  assert(opts.prefetch_policy_set == true);
  std::cout << "[PASS] test_prefetch_flag\n";
}

void test_prefetch_degree_flag() {
  ArgvBuilder builder;
  builder.add("--prefetch-degree").add("8");
  auto opts = ArgParser::parse(builder.argc(), builder.argv());

  assert(opts.prefetch_degree == 8);
  assert(opts.prefetch_degree_set == true);
  std::cout << "[PASS] test_prefetch_degree_flag\n";
}

void test_preset_config_intel() {
  auto cfg = ArgParser::get_preset_config("intel");
  assert(cfg.l1_data.kb_size == 32);
  assert(cfg.l1_data.associativity == 8);
  assert(cfg.l1_data.line_size == 64);
  std::cout << "[PASS] test_preset_config_intel\n";
}

void test_preset_config_amd() {
  auto cfg = ArgParser::get_preset_config("amd");
  assert(cfg.l1_data.kb_size == 32);
  std::cout << "[PASS] test_preset_config_amd\n";
}

void test_preset_config_apple() {
  auto cfg = ArgParser::get_preset_config("apple");
  // Apple has large L1 caches
  assert(cfg.l1_data.kb_size > 0);
  assert(cfg.l1_data.is_valid());
  std::cout << "[PASS] test_preset_config_apple\n";
}

void test_preset_config_educational() {
  auto cfg = ArgParser::get_preset_config("educational");
  // Educational has small caches for learning
  assert(cfg.l1_data.kb_size <= 8);
  assert(cfg.l2.kb_size <= 64);
  assert(cfg.l3.kb_size <= 512);
  assert(cfg.l1_data.is_valid());
  std::cout << "[PASS] test_preset_config_educational\n";
}

void test_custom_config_l1_size() {
  ArgvBuilder builder;
  builder.add("--config").add("custom");
  builder.add("--l1-size").add("32768");  // 32KB in bytes
  auto opts = ArgParser::parse(builder.argc(), builder.argv());

  assert(opts.config_name == "custom");
  assert(opts.l1_size == 32768);
  // Note: build_cache_config passes bytes directly to kb_size field
  std::cout << "[PASS] test_custom_config_l1_size\n";
}

void test_custom_config_line_size() {
  ArgvBuilder builder;
  builder.add("--config").add("custom");
  builder.add("--l1-line").add("128");
  auto opts = ArgParser::parse(builder.argc(), builder.argv());

  assert(opts.line_size == 128);
  std::cout << "[PASS] test_custom_config_line_size\n";
}

void test_flamegraph_flag() {
  ArgvBuilder builder;
  builder.add("--flamegraph");
  auto opts = ArgParser::parse(builder.argc(), builder.argv());

  assert(opts.flamegraph_output == true);
  std::cout << "[PASS] test_flamegraph_flag\n";
}

void test_combined_flags() {
  ArgvBuilder builder;
  builder.add("--config").add("apple");
  builder.add("--json");
  builder.add("--prefetch").add("intel");
  builder.add("--cores").add("8");
  auto opts = ArgParser::parse(builder.argc(), builder.argv());

  assert(opts.config_name == "apple");
  assert(opts.json_output == true);
  assert(opts.prefetch_policy == PrefetchPolicy::INTEL);
  assert(opts.num_cores == 8);
  std::cout << "[PASS] test_combined_flags\n";
}

void test_unknown_config_defaults_to_intel() {
  auto cfg = ArgParser::get_preset_config("nonexistent");
  auto intel_cfg = ArgParser::get_preset_config("intel");
  assert(cfg.l1_data.kb_size == intel_cfg.l1_data.kb_size);
  std::cout << "[PASS] test_unknown_config_defaults_to_intel\n";
}

int main() {
  std::cout << "Running ArgParser tests...\n\n";

  // Default and basic flags
  test_default_options();
  test_config_flag();
  test_verbose_flag();
  test_json_flag();
  test_stream_flag();
  test_help_flag();
  test_cores_flag();
  test_flamegraph_flag();

  // Prefetch parsing
  test_prefetch_policy_none();
  test_prefetch_policy_next();
  test_prefetch_policy_stream();
  test_prefetch_policy_stride();
  test_prefetch_policy_adaptive();
  test_prefetch_policy_intel();
  test_prefetch_policy_name_output();
  test_prefetch_flag();
  test_prefetch_degree_flag();

  // Preset configs
  test_preset_config_intel();
  test_preset_config_amd();
  test_preset_config_apple();
  test_preset_config_educational();
  test_unknown_config_defaults_to_intel();

  // Custom configs
  test_custom_config_l1_size();
  test_custom_config_line_size();

  // Combined flags
  test_combined_flags();

  std::cout << "\n=== All 26 ArgParser tests passed! ===\n";
  return 0;
}
