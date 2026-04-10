#!/bin/bash
# Test suite for selective instrumentation

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_PROGRAMS="$SCRIPT_DIR/test-programs"
CACHE_EXPLORE="$PROJECT_ROOT/backend/scripts/cache-explore"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

PASSED=0
FAILED=0
FAILED_TESTS=()

echo "=========================================="
echo "  Selective Instrumentation Tests"
echo "=========================================="
echo ""

# Test 1: File Filtering
test_file_filtering() {
    echo -n "Test 1: File-based filtering... "

    OUTPUT=$("$CACHE_EXPLORE" "$TEST_PROGRAMS/file-filter.cpp" \
             --instrument-only "$TEST_PROGRAMS/file-filter.cpp" \
             --json 2>/dev/null)

    EVENT_COUNT=$(echo "$OUTPUT" | jq -r '.events // 0')

    # EXPECT: events from file-filter.cpp only (instrumented_function + main)
    # excluded_function (from excluded.h) should not be instrumented
    # If filtering working: 800-1100 events
    if [ "$EVENT_COUNT" -ge 800 ] && [ "$EVENT_COUNT" -le 1100 ]; then
        echo -e "${GREEN}PASS${NC} ($EVENT_COUNT events)"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}FAIL${NC} (got $EVENT_COUNT events, expected 800-1100)"
        FAILED=$((FAILED + 1))
        FAILED_TESTS+=("File filtering")
    fi
}

# Test 2: Performance - Large Codebase Simulation
test_large_codebase() {
    echo -n "Test 2: Large codebase (10K LOC simulation)... "

    # Generate large test file
    LARGE_FILE="/tmp/large_test.cpp"
    cat > "$LARGE_FILE" << 'EOF'
#include <cstdio>

// Simulate 10K LOC with many functions
EOF

    # Generate 100 functions with 100 lines each
    for i in {1..100}; do
        cat >> "$LARGE_FILE" << EOF
void func_$i() {
    int arr[100];
    for (int j = 0; j < 100; j++) {
        arr[j] = j * $i;
    }
}

EOF
    done

    cat >> "$LARGE_FILE" << 'EOF'
int main() {
    func_1();  // Only call one function
    return 0;
}
EOF

    # With selective instrumentation, should only instrument func_1
    # Without it, instruments all 100 functions (slow compile, huge trace)
    START=$(date +%s)
    OUTPUT=$("$CACHE_EXPLORE" "$LARGE_FILE" \
             --instrument-only "func_1" \
             --json 2>/dev/null)
    END=$(date +%s)
    DURATION=$((END - START))

    EVENT_COUNT=$(echo "$OUTPUT" | jq -r '.events // 0')

    # EXPECT: Fast compile (<10s), small trace (~900 events from single function)
    # If filtering works: 800-1000 events (only func_1 instrumented)
    # If broken (all 100 functions): 90,000+ events (100 functions * 900 events each)
    # Success criteria: < 2000 events (proves only 1-2 functions instrumented)
    if [ "$DURATION" -lt 10 ] && [ "$EVENT_COUNT" -lt 2000 ]; then
        echo -e "${GREEN}PASS${NC} (${DURATION}s, $EVENT_COUNT events)"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}FAIL${NC} (${DURATION}s, $EVENT_COUNT events)"
        FAILED=$((FAILED + 1))
        FAILED_TESTS+=("Large codebase")
    fi

    rm -f "$LARGE_FILE"
}

# Run all tests
echo "Running tests:"
echo ""

test_file_filtering
test_large_codebase

echo ""
echo "=========================================="
echo "  Test Summary"
echo "=========================================="
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
