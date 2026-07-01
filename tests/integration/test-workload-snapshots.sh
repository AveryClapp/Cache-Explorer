#!/bin/bash
# Integration test: product workload verification command.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CACHE_EXPLORE="$PROJECT_ROOT/backend/scripts/cache-explore"
HISTORY_FILE="${CACHE_EXPLORER_WORKLOAD_HISTORY:-}"
SHOULD_CLEAN_HISTORY=0
if [[ -z "$HISTORY_FILE" ]]; then
  HISTORY_FILE="$(mktemp "${TMPDIR:-/tmp}/cache-explorer-workload-history.XXXXXX")"
  SHOULD_CLEAN_HISTORY=1
fi

cleanup() {
  if [[ "$SHOULD_CLEAN_HISTORY" == "1" ]]; then
    rm -f "$HISTORY_FILE"
  fi
}
trap cleanup EXIT

echo "========================================"
echo "  Workload Snapshot Tests"
echo "========================================"
echo ""

OUTPUT="$("$CACHE_EXPLORE" workloads --verify --json --history "$HISTORY_FILE")"

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

echo -n "Test: workload verifier emits benchmark history artifact... "
if jq -e '
  .schemaVersion == 1
  and .generatedAt
  and .summary.failed == 0
  and .summary.passed >= 1
  and (.workloads | length) >= 1
  and all(.workloads[]; .id and (.durationMs >= 0) and (.variants | type == "object"))
' "$HISTORY_FILE" > /dev/null; then
  echo "PASS"
else
  echo "FAIL"
  cat "$HISTORY_FILE"
  exit 1
fi

echo ""
echo "========================================"
echo "  Workload Snapshot Summary"
echo "========================================"
echo "$OUTPUT" | jq -r '"Passed: \(.summary.passed)\nFailed: \(.summary.failed)\nDuration: \(.summary.durationMs)ms"'
echo ""
echo "All workload snapshot tests passed!"
