#!/bin/bash
# Integration test: golden kernel relationships that should remain true.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CACHE_EXPLORE="$PROJECT_ROOT/backend/scripts/cache-explore"
EXAMPLES_DIR="$PROJECT_ROOT/examples"

PASSED=0
FAILED=0

pass() {
  echo "PASS"
  PASSED=$((PASSED + 1))
}

fail() {
  echo "FAIL"
  echo "    $1"
  FAILED=$((FAILED + 1))
}

run_final_json() {
  "$CACHE_EXPLORE" "$@" --json 2>/dev/null |
    jq -s 'map(select(.levels? and .timing?))[-1]'
}

json_number() {
  jq -r "$1"
}

less_than() {
  awk "BEGIN { exit !($1 < $2) }"
}

echo "========================================"
echo "  Golden Kernel Tests"
echo "========================================"
echo ""

echo -n "Test: row-major has fewer L1D misses than column-major... "
ROW_JSON=$(run_final_json "$EXAMPLES_DIR/matrix_row.c" --config educational)
COL_JSON=$(run_final_json "$EXAMPLES_DIR/matrix_col.c" --config educational)
ROW_MISSES=$(printf '%s\n' "$ROW_JSON" | json_number '.levels.l1d.misses')
COL_MISSES=$(printf '%s\n' "$COL_JSON" | json_number '.levels.l1d.misses')
if [[ "$ROW_MISSES" =~ ^[0-9]+$ && "$COL_MISSES" =~ ^[0-9]+$ && "$ROW_MISSES" -lt "$COL_MISSES" ]]; then
  pass
else
  fail "expected row misses ($ROW_MISSES) < column misses ($COL_MISSES)"
fi

echo -n "Test: row-major models fewer cycles than column-major... "
ROW_CYCLES=$(printf '%s\n' "$ROW_JSON" | json_number '.timing.totalCycles')
COL_CYCLES=$(printf '%s\n' "$COL_JSON" | json_number '.timing.totalCycles')
if [[ "$ROW_CYCLES" =~ ^[0-9]+$ && "$COL_CYCLES" =~ ^[0-9]+$ && "$ROW_CYCLES" -lt "$COL_CYCLES" ]]; then
  pass
else
  fail "expected row cycles ($ROW_CYCLES) < column cycles ($COL_CYCLES)"
fi

echo -n "Test: sequential scan has lower average latency than pointer chasing... "
SEQ_JSON=$(run_final_json "$EXAMPLES_DIR/sequential.c" --config intel --limit 200000)
PTR_JSON=$(run_final_json "$EXAMPLES_DIR/pointer_chasing.c" --config intel --limit 200000)
SEQ_AVG=$(printf '%s\n' "$SEQ_JSON" | json_number '.timing.avgLatency')
PTR_AVG=$(printf '%s\n' "$PTR_JSON" | json_number '.timing.avgLatency')
if less_than "$SEQ_AVG" "$PTR_AVG"; then
  pass
else
  fail "expected sequential avg latency ($SEQ_AVG) < pointer-chasing avg latency ($PTR_AVG)"
fi

echo ""
echo "========================================"
echo "  Golden Kernel Summary"
echo "========================================"
echo "Passed: $PASSED"
echo "Failed: $FAILED"

if [[ "$FAILED" -gt 0 ]]; then
  exit 1
fi

echo ""
echo "All golden kernel tests passed!"
