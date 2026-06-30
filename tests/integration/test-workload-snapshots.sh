#!/bin/bash
# Integration test: product workload verification command.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CACHE_EXPLORE="$PROJECT_ROOT/backend/scripts/cache-explore"

echo "========================================"
echo "  Workload Snapshot Tests"
echo "========================================"
echo ""

OUTPUT="$("$CACHE_EXPLORE" workloads --verify --json)"

echo -n "Test: workload verifier reports all checks passing... "
if echo "$OUTPUT" | jq -e '.ok == true and .summary.failed == 0 and .summary.passed >= 1' > /dev/null; then
  echo "PASS"
else
  echo "FAIL"
  echo "$OUTPUT" | jq .
  exit 1
fi

echo -n "Test: conv2d-intel14 relationship checks remain covered... "
if echo "$OUTPUT" | jq -e '
  any(.workloads[]; .id == "conv2d-intel14"
    and (.checks | length) >= 2
    and all(.checks[]; .passed == true)
    and .variants.direct.provenance.toolchain.simulator.sha256
    and .variants.tiled.provenance.toolchain.simulator.sha256)
' > /dev/null; then
  echo "PASS"
else
  echo "FAIL"
  echo "$OUTPUT" | jq .
  exit 1
fi

echo ""
echo "========================================"
echo "  Workload Snapshot Summary"
echo "========================================"
echo "$OUTPUT" | jq -r '"Passed: \(.summary.passed)\nFailed: \(.summary.failed)\nDuration: \(.summary.durationMs)ms"'
echo ""
echo "All workload snapshot tests passed!"
