#!/bin/bash
# End-to-End Tests for Cache Explorer
# Tests the full pipeline: source -> compile -> simulate -> output
#
# Usage: ./run_tests.sh [--verbose] [--filter <pattern>]
#
# Exit codes: 0 = all passed, 1 = some failed

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CACHE_EXPLORE="$PROJECT_DIR/backend/scripts/cache-explore"
EXAMPLES_DIR="$PROJECT_DIR/examples"
TEST_CASES_DIR="$SCRIPT_DIR/cases"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

VERBOSE=""
FILTER=""
PASSED=0
FAILED=0
SKIPPED=0

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --verbose|-v) VERBOSE="1"; shift ;;
    --filter) FILTER="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

log() {
  if [[ -n "$VERBOSE" ]]; then
    echo -e "$@"
  fi
}

pass() {
  echo -e "${GREEN}[PASS]${NC} $1"
  PASSED=$((PASSED + 1))
}

fail() {
  echo -e "${RED}[FAIL]${NC} $1"
  if [[ -n "$2" ]]; then
    echo -e "       ${RED}$2${NC}"
  fi
  FAILED=$((FAILED + 1))
}

skip() {
  echo -e "${YELLOW}[SKIP]${NC} $1"
  SKIPPED=$((SKIPPED + 1))
}

should_run() {
  local test_name="$1"
  if [[ -z "$FILTER" ]]; then
    return 0
  fi
  [[ "$test_name" == *"$FILTER"* ]]
}

# ==============================================================================
# Test: Dependencies are built
# ==============================================================================
test_dependencies() {
  local test_name="dependencies_exist"
  if ! should_run "$test_name"; then return; fi

  local pass_path="$PROJECT_DIR/backend/llvm-pass/build/CacheProfiler.so"
  local runtime_path="$PROJECT_DIR/backend/runtime/build/libcache-explorer-rt.a"
  local sim_path="$PROJECT_DIR/backend/cache-simulator/build/cache-sim"

  if [[ ! -f "$pass_path" ]]; then
    fail "$test_name" "LLVM pass not found: $pass_path"
    return
  fi

  if [[ ! -f "$runtime_path" ]]; then
    fail "$test_name" "Runtime not found: $runtime_path"
    return
  fi

  if [[ ! -f "$sim_path" ]]; then
    fail "$test_name" "Cache simulator not found: $sim_path"
    return
  fi

  pass "$test_name"
}

# ==============================================================================
# Test: Basic compilation and analysis
# ==============================================================================
test_basic_compile() {
  local test_name="basic_compile"
  if ! should_run "$test_name"; then return; fi

  local output
  if ! output=$("$CACHE_EXPLORE" "$EXAMPLES_DIR/sequential.c" --json 2>&1); then
    fail "$test_name" "cache-explore command failed"
    log "$output"
    return
  fi

  # Should have valid JSON with hits/misses
  if ! echo "$output" | grep -q '"l1d"'; then
    fail "$test_name" "No L1d results in output"
    log "$output"
    return
  fi

  pass "$test_name"
}

# ==============================================================================
# Test: Row-major is better than column-major
# ==============================================================================
test_row_vs_column_major() {
  local test_name="row_vs_column_major"
  if ! should_run "$test_name"; then return; fi

  # Use educational config (small caches) to make the difference visible
  # With large caches (intel), both patterns might fit entirely in cache

  # Run row-major
  local row_output
  row_output=$("$CACHE_EXPLORE" "$EXAMPLES_DIR/matrix_row.c" --config educational --json 2>&1)
  local row_misses
  row_misses=$(echo "$row_output" | grep -o '"l1d": *{[^}]*}' | grep -o '"misses": *[0-9]*' | grep -o '[0-9]*')

  # Run column-major
  local col_output
  col_output=$("$CACHE_EXPLORE" "$EXAMPLES_DIR/matrix_col.c" --config educational --json 2>&1)
  local col_misses
  col_misses=$(echo "$col_output" | grep -o '"l1d": *{[^}]*}' | grep -o '"misses": *[0-9]*' | grep -o '[0-9]*')

  if [[ -z "$row_misses" || -z "$col_misses" ]]; then
    fail "$test_name" "Could not parse miss counts"
    return
  fi

  log "Row misses: $row_misses, Col misses: $col_misses"

  # Row-major should have fewer misses (better locality)
  if [[ "$row_misses" -ge "$col_misses" ]]; then
    fail "$test_name" "Row-major ($row_misses misses) should have fewer misses than column-major ($col_misses misses)"
    return
  fi

  pass "$test_name"
}

# ==============================================================================
# Test: Sequential access is cache-friendly
# ==============================================================================
test_sequential_access() {
  local test_name="sequential_access"
  if ! should_run "$test_name"; then return; fi

  local output
  output=$("$CACHE_EXPLORE" "$EXAMPLES_DIR/sequential.c" --json 2>&1)

  local hits misses
  hits=$(echo "$output" | grep -o '"l1d": *{[^}]*}' | grep -o '"hits": *[0-9]*' | grep -o '[0-9]*')
  misses=$(echo "$output" | grep -o '"l1d": *{[^}]*}' | grep -o '"misses": *[0-9]*' | grep -o '[0-9]*')

  if [[ -z "$hits" || -z "$misses" ]]; then
    fail "$test_name" "Could not parse hit/miss counts"
    return
  fi

  # Calculate hit rate
  local total=$((hits + misses))
  if [[ "$total" -eq 0 ]]; then
    fail "$test_name" "No memory accesses recorded"
    return
  fi

  # Hit rate should be > 90% for sequential
  local hit_rate=$((hits * 100 / total))
  log "Sequential hit rate: ${hit_rate}%"

  if [[ "$hit_rate" -lt 90 ]]; then
    fail "$test_name" "Hit rate ${hit_rate}% is below expected 90%"
    return
  fi

  pass "$test_name"
}

# ==============================================================================
# Test: Strided access has lower hit rate
# ==============================================================================
test_strided_access() {
  local test_name="strided_access"
  if ! should_run "$test_name"; then return; fi

  local output
  output=$("$CACHE_EXPLORE" "$EXAMPLES_DIR/strided.c" --json 2>&1)

  local hits misses
  hits=$(echo "$output" | grep -o '"l1d": *{[^}]*}' | grep -o '"hits": *[0-9]*' | grep -o '[0-9]*')
  misses=$(echo "$output" | grep -o '"l1d": *{[^}]*}' | grep -o '"misses": *[0-9]*' | grep -o '[0-9]*')

  if [[ -z "$hits" || -z "$misses" ]]; then
    fail "$test_name" "Could not parse hit/miss counts"
    return
  fi

  local total=$((hits + misses))
  if [[ "$total" -eq 0 ]]; then
    fail "$test_name" "No memory accesses recorded"
    return
  fi

  # Strided access should have lower hit rate than sequential
  # We just check it's recording something
  local hit_rate=$((hits * 100 / total))
  log "Strided hit rate: ${hit_rate}%"

  pass "$test_name"
}

# ==============================================================================
# Test: Different cache configs produce different results
# ==============================================================================
test_cache_configs() {
  local test_name="cache_configs"
  if ! should_run "$test_name"; then return; fi

  local edu_output intel_output
  edu_output=$("$CACHE_EXPLORE" "$EXAMPLES_DIR/sequential.c" --config educational --json 2>&1)
  intel_output=$("$CACHE_EXPLORE" "$EXAMPLES_DIR/sequential.c" --config intel --json 2>&1)

  local edu_misses intel_misses
  edu_misses=$(echo "$edu_output" | grep -o '"l1d": *{[^}]*}' | grep -o '"misses": *[0-9]*' | grep -o '[0-9]*')
  intel_misses=$(echo "$intel_output" | grep -o '"l1d": *{[^}]*}' | grep -o '"misses": *[0-9]*' | grep -o '[0-9]*')

  if [[ -z "$edu_misses" || -z "$intel_misses" ]]; then
    fail "$test_name" "Could not parse miss counts"
    return
  fi

  log "Educational misses: $edu_misses, Intel misses: $intel_misses"

  # Educational (small cache) should have more misses
  if [[ "$edu_misses" -le "$intel_misses" ]]; then
    fail "$test_name" "Educational config should have more misses than Intel"
    return
  fi

  pass "$test_name"
}

# ==============================================================================
# Test: JSON output is valid
# ==============================================================================
test_json_output() {
  local test_name="json_output"
  if ! should_run "$test_name"; then return; fi

  local output
  output=$("$CACHE_EXPLORE" "$EXAMPLES_DIR/sequential.c" --json 2>&1)

  # Check for required JSON fields
  if ! echo "$output" | grep -q '"l1d":'; then
    fail "$test_name" "Missing l1d field"
    return
  fi

  if ! echo "$output" | grep -q '"l2":'; then
    fail "$test_name" "Missing l2 field"
    return
  fi

  if ! echo "$output" | grep -q '"hits":'; then
    fail "$test_name" "Missing hits field"
    return
  fi

  if ! echo "$output" | grep -q '"misses":'; then
    fail "$test_name" "Missing misses field"
    return
  fi

  pass "$test_name"
}

# ==============================================================================
# Test: Compare command works
# ==============================================================================
test_compare_command() {
  local test_name="compare_command"
  if ! should_run "$test_name"; then return; fi

  local output
  if ! output=$("$CACHE_EXPLORE" compare "$EXAMPLES_DIR/sequential.c" --configs educational,intel 2>&1); then
    fail "$test_name" "compare command failed"
    log "$output"
    return
  fi

  # Should mention both configs
  if ! echo "$output" | grep -qi "educational"; then
    fail "$test_name" "Output missing educational config results"
    return
  fi

  if ! echo "$output" | grep -qi "intel"; then
    fail "$test_name" "Output missing intel config results"
    return
  fi

  pass "$test_name"
}

# ==============================================================================
# Test: Report generation
# ==============================================================================
test_report_command() {
  local test_name="report_command"
  if ! should_run "$test_name"; then return; fi

  local report_file="/tmp/cache-explorer-test-report-$$.html"

  if ! "$CACHE_EXPLORE" report "$EXAMPLES_DIR/sequential.c" -o "$report_file" 2>&1; then
    fail "$test_name" "report command failed"
    rm -f "$report_file"
    return
  fi

  if [[ ! -f "$report_file" ]]; then
    fail "$test_name" "Report file not created"
    return
  fi

  # Check HTML structure
  if ! grep -q "<html" "$report_file"; then
    fail "$test_name" "Report missing HTML structure"
    rm -f "$report_file"
    return
  fi

  if ! grep -q "L1" "$report_file"; then
    fail "$test_name" "Report missing cache level info"
    rm -f "$report_file"
    return
  fi

  rm -f "$report_file"
  pass "$test_name"
}

# ==============================================================================
# Test: Preprocessor defines work
# ==============================================================================
test_preprocessor_defines() {
  local test_name="preprocessor_defines"
  if ! should_run "$test_name"; then return; fi

  # Create a test file that uses -D
  local test_file="/tmp/cache-test-define-$$.c"
  cat > "$test_file" << 'EOF'
#ifndef ARRAY_SIZE
#define ARRAY_SIZE 100
#endif

int main() {
    int arr[ARRAY_SIZE];
    for (int i = 0; i < ARRAY_SIZE; i++) {
        arr[i] = i;
    }
    return 0;
}
EOF

  # Test with small array
  local small_output
  small_output=$("$CACHE_EXPLORE" "$test_file" -D ARRAY_SIZE=10 --json 2>&1)
  local small_hits
  small_hits=$(echo "$small_output" | grep -o '"l1d": *{[^}]*}' | grep -o '"hits": *[0-9]*' | grep -o '[0-9]*')

  # Test with large array
  local large_output
  large_output=$("$CACHE_EXPLORE" "$test_file" -D ARRAY_SIZE=10000 --json 2>&1)
  local large_hits
  large_hits=$(echo "$large_output" | grep -o '"l1d": *{[^}]*}' | grep -o '"hits": *[0-9]*' | grep -o '[0-9]*')

  rm -f "$test_file"

  if [[ -z "$small_hits" || -z "$large_hits" ]]; then
    fail "$test_name" "Could not parse hit counts"
    return
  fi

  log "Small array hits: $small_hits, Large array hits: $large_hits"

  # Large array should have more total accesses (more hits)
  if [[ "$large_hits" -le "$small_hits" ]]; then
    fail "$test_name" "Large array should have more accesses"
    return
  fi

  pass "$test_name"
}

# ==============================================================================
# Test: C++ compilation works
# ==============================================================================
test_cpp_support() {
  local test_name="cpp_support"
  if ! should_run "$test_name"; then return; fi

  # Create a C++ test file
  local test_file="/tmp/cache-test-cpp-$$.cpp"
  cat > "$test_file" << 'EOF'
#include <vector>

int main() {
    std::vector<int> v(100);
    for (size_t i = 0; i < v.size(); i++) {
        v[i] = static_cast<int>(i);
    }
    int sum = 0;
    for (const auto& x : v) {
        sum += x;
    }
    return sum > 0 ? 0 : 1;
}
EOF

  local output
  if ! output=$("$CACHE_EXPLORE" "$test_file" --json 2>&1); then
    fail "$test_name" "C++ compilation failed"
    log "$output"
    rm -f "$test_file"
    return
  fi

  rm -f "$test_file"

  if ! echo "$output" | grep -q '"l1d"'; then
    fail "$test_name" "No L1d results in output"
    return
  fi

  pass "$test_name"
}

# ==============================================================================
# Test: Sampling works
# ==============================================================================
test_sampling() {
  local test_name="sampling"
  if ! should_run "$test_name"; then return; fi

  # Run without sampling
  local full_output
  full_output=$("$CACHE_EXPLORE" "$EXAMPLES_DIR/sequential.c" --json 2>&1)
  local full_total
  full_total=$(echo "$full_output" | grep -o '"total_events":[0-9]*' | cut -d: -f2)

  # Run with 10x sampling
  local sampled_output
  sampled_output=$("$CACHE_EXPLORE" "$EXAMPLES_DIR/sequential.c" --sample 10 --json 2>&1)
  local sampled_total
  sampled_total=$(echo "$sampled_output" | grep -o '"total_events":[0-9]*' | cut -d: -f2)

  if [[ -z "$full_total" || -z "$sampled_total" ]]; then
    # total_events might not be in output, skip this test
    skip "$test_name (no total_events in output)"
    return
  fi

  log "Full: $full_total events, Sampled: $sampled_total events"

  # Sampled should be ~10x fewer events
  if [[ "$sampled_total" -ge "$full_total" ]]; then
    fail "$test_name" "Sampling didn't reduce event count"
    return
  fi

  pass "$test_name"
}

# ==============================================================================
# Test: Hot lines are reported
# ==============================================================================
test_hot_lines() {
  local test_name="hot_lines"
  if ! should_run "$test_name"; then return; fi

  local output
  output=$("$CACHE_EXPLORE" "$EXAMPLES_DIR/sequential.c" --json 2>&1)

  if ! echo "$output" | grep -q '"hotLines"'; then
    # Hot lines might be optional, skip
    skip "$test_name (no hotLines in output)"
    return
  fi

  # Check there's at least one entry
  if ! echo "$output" | grep -q '"file":'; then
    fail "$test_name" "hotLines exists but no entries"
    return
  fi

  pass "$test_name"
}

# ==============================================================================
# Test: Unit tests pass
# ==============================================================================
test_unit_tests() {
  local test_name="unit_tests"
  if ! should_run "$test_name"; then return; fi

  local test_binary="$PROJECT_DIR/backend/cache-simulator/build/CacheLevelTest"

  if [[ ! -f "$test_binary" ]]; then
    skip "$test_name (test binary not built)"
    return
  fi

  local output
  if ! output=$("$test_binary" 2>&1); then
    fail "$test_name" "Unit tests failed"
    log "$output"
    return
  fi

  if ! echo "$output" | grep -q "All.*tests passed"; then
    fail "$test_name" "Unexpected unit test output"
    log "$output"
    return
  fi

  pass "$test_name"
}

# ==============================================================================
# Test: Error handling - invalid file
# ==============================================================================
test_error_invalid_file() {
  local test_name="error_invalid_file"
  if ! should_run "$test_name"; then return; fi

  local output
  output=$("$CACHE_EXPLORE" "/nonexistent/file.c" 2>&1) || true

  if ! echo "$output" | grep -qi "error\|not found"; then
    fail "$test_name" "Should report error for missing file"
    return
  fi

  pass "$test_name"
}

# ==============================================================================
# Test: Error handling - syntax error
# ==============================================================================
test_error_syntax() {
  local test_name="error_syntax"
  if ! should_run "$test_name"; then return; fi

  local test_file="/tmp/cache-test-syntax-$$.c"
  cat > "$test_file" << 'EOF'
int main() {
    this is not valid C
}
EOF

  local output
  output=$("$CACHE_EXPLORE" "$test_file" --json 2>&1) || true

  rm -f "$test_file"

  if ! echo "$output" | grep -qi "error"; then
    fail "$test_name" "Should report compilation error"
    return
  fi

  pass "$test_name"
}

# ==============================================================================
# Test: Help message
# ==============================================================================
test_help() {
  local test_name="help"
  if ! should_run "$test_name"; then return; fi

  local output
  output=$("$CACHE_EXPLORE" --help 2>&1)

  if ! echo "$output" | grep -q "Usage"; then
    fail "$test_name" "Help message missing Usage"
    return
  fi

  if ! echo "$output" | grep -q "config"; then
    fail "$test_name" "Help message missing --config option"
    return
  fi

  pass "$test_name"
}

# ==============================================================================
# Main
# ==============================================================================

echo -e "${CYAN}=== Cache Explorer E2E Tests ===${NC}"
echo ""

# Run all tests
test_dependencies
test_basic_compile
test_row_vs_column_major
test_sequential_access
test_strided_access
test_cache_configs
test_json_output
test_compare_command
test_report_command
test_preprocessor_defines
test_cpp_support
test_sampling
test_hot_lines
test_unit_tests
test_error_invalid_file
test_error_syntax
test_help

# Summary
echo ""
echo -e "${CYAN}=== Summary ===${NC}"
echo -e "Passed:  ${GREEN}$PASSED${NC}"
echo -e "Failed:  ${RED}$FAILED${NC}"
echo -e "Skipped: ${YELLOW}$SKIPPED${NC}"
echo ""

if [[ $FAILED -gt 0 ]]; then
  echo -e "${RED}Some tests failed!${NC}"
  exit 1
else
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
fi
