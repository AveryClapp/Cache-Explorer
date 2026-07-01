#!/bin/bash
# Integration test: product workload verification command.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CACHE_EXPLORE="$PROJECT_ROOT/backend/scripts/cache-explore"
HISTORY_FILE="${CACHE_EXPLORER_WORKLOAD_HISTORY:-}"
HISTORY_REPORT_FILE="${CACHE_EXPLORER_WORKLOAD_HISTORY_REPORT:-}"
SHOULD_CLEAN_HISTORY=0
SHOULD_CLEAN_HISTORY_REPORT=0
if [[ -z "$HISTORY_FILE" ]]; then
  HISTORY_FILE="$(mktemp "${TMPDIR:-/tmp}/cache-explorer-workload-history.XXXXXX")"
  SHOULD_CLEAN_HISTORY=1
fi
if [[ -z "$HISTORY_REPORT_FILE" ]]; then
  HISTORY_REPORT_FILE="$(mktemp "${TMPDIR:-/tmp}/cache-explorer-workload-history.XXXXXX.html")"
  SHOULD_CLEAN_HISTORY_REPORT=1
fi

cleanup() {
  if [[ "$SHOULD_CLEAN_HISTORY" == "1" ]]; then
    rm -f "$HISTORY_FILE"
  fi
  if [[ "$SHOULD_CLEAN_HISTORY_REPORT" == "1" ]]; then
    rm -f "$HISTORY_REPORT_FILE"
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
    and .identity.manifestSha256
    and .identity.sourceFiles["examples/conv2d_kernel.c"].sha256
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

echo -n "Test: advanced instrumentation workloads remain covered... "
if echo "$OUTPUT" | jq -e '
  (any(.workloads[]; .id == "memory-intrinsics-intel"
    and all(.checks[]; .passed == true)))
  and (any(.workloads[]; .id == "vector-width-intel"
    and any(.checks[]; .metric == "advancedStats.vector.bytesLoaded" and .missingValue == 0 and .passed == true)))
  and (any(.workloads[]; .id == "atomic-builtins-intel"
    and any(.checks[]; .metric == "advancedStats.atomic.loads" and .missingValue == 0 and .passed == true)))
' > /dev/null; then
  echo "PASS"
else
  echo "FAIL"
  echo "$OUTPUT" | jq .
  exit 1
fi

echo -n "Test: image blur stencil workload remains covered... "
if echo "$OUTPUT" | jq -e '
  any(.workloads[]; .id == "image-blur-stencil-intel"
    and (.checks | length) >= 2
    and all(.checks[]; .passed == true)
    and any(.checks[]; .metric == "levels.l1d.hitRate" and .leftVariant == "row" and .rightVariant == "column" and .leftValue > .rightValue)
    and any(.checks[]; .metric == "levels.l1d.misses" and .leftVariant == "row" and .rightVariant == "column" and .leftValue < .rightValue))
' > /dev/null; then
  echo "PASS"
else
  echo "FAIL"
  echo "$OUTPUT" | jq .
  exit 1
fi

echo -n "Test: hash probe workload remains covered... "
if echo "$OUTPUT" | jq -e '
  any(.workloads[]; .id == "hash-probe-intel"
    and (.checks | length) >= 3
    and all(.checks[]; .passed == true)
    and any(.checks[]; .metric == "levels.l1d.hitRate" and .leftVariant == "hash" and .rightVariant == "contiguous" and .leftValue < .rightValue)
    and any(.checks[]; .metric == "levels.l1d.misses" and .leftVariant == "hash" and .rightVariant == "contiguous" and .leftValue > .rightValue))
' > /dev/null; then
  echo "PASS"
else
  echo "FAIL"
  echo "$OUTPUT" | jq .
  exit 1
fi

echo -n "Test: search and sort pattern workloads remain covered... "
if echo "$OUTPUT" | jq -e '
  (any(.workloads[]; .id == "search-pattern-intel"
    and (.checks | length) >= 3
    and all(.checks[]; .passed == true)
    and any(.checks[]; .metric == "levels.l1d.hitRate" and .leftVariant == "linear" and .rightVariant == "binary" and .leftValue > .rightValue)
    and any(.checks[]; .metric == "timing.totalCycles" and .leftVariant == "linear" and .rightVariant == "binary" and .leftValue < .rightValue)))
  and (any(.workloads[]; .id == "sort-pattern-intel"
    and (.checks | length) >= 2
    and all(.checks[]; .passed == true)
    and any(.checks[]; .metric == "levels.l1d.hitRate" and .leftVariant == "insertion" and .rightVariant == "quicksort" and .leftValue > .rightValue)))
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
  and all(.workloads[]; .id
    and .identity.manifestSha256
    and (.identity.sourceFiles | type == "object")
    and (.durationMs >= 0)
    and (.variants | type == "object"))
' "$HISTORY_FILE" > /dev/null; then
  echo "PASS"
else
  echo "FAIL"
  cat "$HISTORY_FILE"
  exit 1
fi

echo -n "Test: workload history artifact can be summarized... "
if "$CACHE_EXPLORE" workloads --history-summary "$HISTORY_FILE" --json | jq -e '
  .latest.summary.failed == 0
  and .latest.summary.passed >= 1
  and (.slowestWorkloads | length) >= 1
  and (.failures | length) == 0
' > /dev/null; then
  echo "PASS"
else
  echo "FAIL"
  "$CACHE_EXPLORE" workloads --history-summary "$HISTORY_FILE" --json | jq .
  exit 1
fi

echo -n "Test: workload history artifact can render an HTML report... "
if "$CACHE_EXPLORE" workloads --history-summary "$HISTORY_FILE" --html > "$HISTORY_REPORT_FILE" \
  && grep -q "Cache Explorer Workload History" "$HISTORY_REPORT_FILE" \
  && grep -q "Per-Workload Trend" "$HISTORY_REPORT_FILE"; then
  echo "PASS"
else
  echo "FAIL"
  cat "$HISTORY_REPORT_FILE" || true
  exit 1
fi

echo ""
echo "========================================"
echo "  Workload Snapshot Summary"
echo "========================================"
echo "$OUTPUT" | jq -r '"Passed: \(.summary.passed)\nFailed: \(.summary.failed)\nDuration: \(.summary.durationMs)ms"'
echo ""
echo "All workload snapshot tests passed!"
