#!/bin/bash
# Integration test: Verify core features work correctly

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_PROGRAM="$SCRIPT_DIR/simple-programs/matrix.c"
CACHE_EXPLORE="$PROJECT_ROOT/backend/scripts/cache-explore"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

PASSED=0
FAILED=0
FAILED_TESTS=()

echo "========================================"
echo "  Cache Explorer Feature Tests"
echo "========================================"
echo ""

# Fix SDK path for macOS
if [[ "$(uname -s)" == "Darwin" ]]; then
    SDK_PATH=$(xcrun --show-sdk-path 2>/dev/null || echo "")
    if [[ -n "$SDK_PATH" && ! -e "/opt/homebrew/etc/clang/arm64-apple-darwin25.cfg" ]]; then
        # Config doesn't exist, set it
        echo "-isysroot $SDK_PATH" > /opt/homebrew/etc/clang/arm64-apple-darwin25.cfg 2>/dev/null || true
    fi
fi

test_feature() {
    local name="$1"
    shift
    local args=("$@")

    echo -n "Test: $name... "

    OUTPUT=$("$CACHE_EXPLORE" "$TEST_PROGRAM" "${args[@]}" --json 2>&1)
    EXIT_CODE=$?

    if [ $EXIT_CODE -ne 0 ]; then
        echo -e "${RED}FAIL${NC}"
        echo "    Error: exited with code $EXIT_CODE"
        echo "    Output:"
        echo "$OUTPUT" | head -10
        FAILED=$((FAILED + 1))
        FAILED_TESTS+=("$name")
        return 1
    fi

    if ! echo "$OUTPUT" | jq . > /dev/null 2>&1; then
        echo -e "${RED}FAIL${NC}"
        echo "    Error: Invalid JSON output"
        FAILED=$((FAILED + 1))
        FAILED_TESTS+=("$name")
        return 1
    fi

    echo -e "${GREEN}PASS${NC}"
    PASSED=$((PASSED + 1))
    return 0
}

# Test prefetching policies
test_feature "Prefetch: none" --config intel --prefetch none
test_feature "Prefetch: next" --config intel --prefetch next
test_feature "Prefetch: stream" --config intel --prefetch stream
test_feature "Prefetch: stride" --config intel --prefetch stride
test_feature "Prefetch: adaptive" --config intel --prefetch adaptive
test_feature "Prefetch: intel" --config intel --prefetch intel

# Test fast mode (just verify it completes successfully)
test_feature "Fast mode" --config intel --fast

# Test JSON output format
echo -n "Test: JSON output structure... "
OUTPUT=$("$CACHE_EXPLORE" "$TEST_PROGRAM" --config intel --json 2>&1)
if echo "$OUTPUT" | jq -e '.config, .events, .levels.l1d.hits, .levels.l1d.misses, .levels.l1d.hitRate' > /dev/null 2>&1; then
    echo -e "${GREEN}PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}FAIL${NC}"
    echo "    Error: Missing required JSON fields"
    FAILED=$((FAILED + 1))
    FAILED_TESTS+=("JSON structure")
fi

# Test TLB stats
echo -n "Test: TLB simulation... "
OUTPUT=$("$CACHE_EXPLORE" "$TEST_PROGRAM" --config intel --json 2>&1)
if echo "$OUTPUT" | jq -e '.tlb.dtlb' > /dev/null 2>&1; then
    echo -e "${GREEN}PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}FAIL${NC}"
    echo "    Error: TLB stats missing"
    FAILED=$((FAILED + 1))
    FAILED_TESTS+=("TLB simulation")
fi

# Test timing model
echo -n "Test: Timing model... "
OUTPUT=$("$CACHE_EXPLORE" "$TEST_PROGRAM" --config intel --json 2>&1)
if echo "$OUTPUT" | jq -e '.timing.totalCycles' > /dev/null 2>&1; then
    echo -e "${GREEN}PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}FAIL${NC}"
    echo "    Error: Timing stats missing"
    FAILED=$((FAILED + 1))
    FAILED_TESTS+=("Timing model")
fi

echo ""
echo "========================================"
echo "  Test Summary"
echo "========================================"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"

if [ $FAILED -gt 0 ]; then
    echo ""
    echo "Failed tests:"
    for test in "${FAILED_TESTS[@]}"; do
        echo "  - $test"
    done
    exit 1
fi

echo ""
echo -e "${GREEN}All tests passed!${NC}"
exit 0
