#!/bin/bash
# Integration test: Verify all hardware presets work correctly

# Don't use set -e because we want to collect all test failures

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_PROGRAM="$SCRIPT_DIR/simple-programs/matrix.c"
CACHE_EXPLORE="$PROJECT_ROOT/backend/scripts/cache-explore"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Hardware presets to test
PRESETS=(
    "educational"
    "intel"
    "intel14"
    "xeon"
    "amd"
    "zen3"
    "epyc"
    "apple"
    "m2"
    "m3"
    "graviton"
    "rpi4"
)

# Track results
PASSED=0
FAILED=0
FAILED_TESTS=()

echo "========================================"
echo "  Cache Explorer Integration Tests"
echo "========================================"
echo ""

# Test 1: Verify cache-explore script exists
echo -n "Test: cache-explore script exists... "
if [ ! -f "$CACHE_EXPLORE" ]; then
    echo -e "${RED}FAIL${NC}"
    echo "Error: $CACHE_EXPLORE not found"
    exit 1
fi
echo -e "${GREEN}PASS${NC}"

# Test 2: Verify test program exists
echo -n "Test: test program exists... "
if [ ! -f "$TEST_PROGRAM" ]; then
    echo -e "${RED}FAIL${NC}"
    echo "Error: $TEST_PROGRAM not found"
    exit 1
fi
echo -e "${GREEN}PASS${NC}"

echo ""
echo "Testing hardware presets:"
echo "----------------------------------------"

# Fix SDK path for macOS (work around Homebrew clang config bug)
if [[ "$(uname -s)" == "Darwin" ]]; then
    SDK_PATH=$(xcrun --show-sdk-path 2>/dev/null || echo "")
    if [[ -n "$SDK_PATH" ]]; then
        export CACHE_EXPLORER_EXTRA_FLAGS="-isysroot $SDK_PATH"
    fi
fi

# Test each preset
for preset in "${PRESETS[@]}"; do
    echo -n "  $preset... "

    # Run cache-explore with the preset
    OUTPUT=$("$CACHE_EXPLORE" "$TEST_PROGRAM" --config "$preset" --json 2>/dev/null)
    EXIT_CODE=$?

    if [ $EXIT_CODE -ne 0 ]; then
        echo -e "${RED}FAIL${NC}"
        echo "    Error: cache-explore exited with code $EXIT_CODE"
        echo "    Output:"
        echo "$OUTPUT" | head -10
        FAILED=$((FAILED + 1))
        FAILED_TESTS+=("$preset")
        continue
    fi

    # Validate JSON output
    if ! echo "$OUTPUT" | jq . > /dev/null 2>&1; then
        echo -e "${RED}FAIL${NC}"
        echo "    Error: Invalid JSON output"
        FAILED=$((FAILED + 1))
        FAILED_TESTS+=("$preset")
        continue
    fi

    # Validate required fields exist
    if ! echo "$OUTPUT" | jq -e '.config, .events, .levels.l1d' > /dev/null 2>&1; then
        echo -e "${RED}FAIL${NC}"
        echo "    Error: Missing required JSON fields"
        FAILED=$((FAILED + 1))
        FAILED_TESTS+=("$preset")
        continue
    fi

    # Validate hit rate is reasonable (0-100%)
    HIT_RATE=$(echo "$OUTPUT" | jq -r '.levels.l1d.hitRate // 0')
    if (( $(echo "$HIT_RATE < 0 || $HIT_RATE > 1" | bc -l) )); then
        echo -e "${RED}FAIL${NC}"
        echo "    Error: Invalid hit rate: $HIT_RATE"
        FAILED=$((FAILED + 1))
        FAILED_TESTS+=("$preset")
        continue
    fi

    echo -e "${GREEN}PASS${NC} (L1 hit rate: $(echo "$HIT_RATE * 100" | bc -l | xargs printf "%.1f")%)"
    PASSED=$((PASSED + 1))
done

echo ""
echo "========================================"
echo "  Test Summary"
echo "========================================"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"

if [ $FAILED -gt 0 ]; then
    echo ""
    echo "Failed presets:"
    for test in "${FAILED_TESTS[@]}"; do
        echo "  - $test"
    done
    exit 1
fi

echo ""
echo -e "${GREEN}All tests passed!${NC}"
exit 0
