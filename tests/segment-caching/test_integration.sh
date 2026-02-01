#!/bin/bash
# Integration tests for segment caching
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CACHE_SIM="$PROJECT_ROOT/backend/cache-simulator/build/cache-sim"
CACHE_EXPLORE="$PROJECT_ROOT/backend/scripts/cache-explore"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

PASSED=0
FAILED=0

echo "=========================================="
echo "  Segment Caching Integration Tests"
echo "=========================================="

# Test 1
test_correctness_simple() {
    echo -n "Test 1: Correctness (simple loop)... "
    cat > /tmp/loop_simple.c << 'EOF'
int main() {
    int arr[100];
    for (int i = 0; i < 100; i++) arr[i] = i * 2;
    return 0;
}
EOF
    "$CACHE_EXPLORE" /tmp/loop_simple.c > /tmp/loop_simple_trace.txt 2>&1
    UNCACHED=$("$CACHE_SIM" --json < /tmp/loop_simple_trace.txt 2>&1)
    CACHED=$("$CACHE_SIM" --json --cache-segments < /tmp/loop_simple_trace.txt 2>&1)
    UNCACHED_HITS=$(echo "$UNCACHED" | jq '.levels.l1d.hits')
    CACHED_HITS=$(echo "$CACHED" | jq '.levels.l1d.hits')
    if [ "$UNCACHED_HITS" == "$CACHED_HITS" ]; then
        echo -e "${GREEN}PASS${NC}"; PASSED=$((PASSED + 1))
    else
        echo -e "${RED}FAIL${NC}"; FAILED=$((FAILED + 1))
    fi
    rm -f /tmp/loop_simple.c /tmp/loop_simple_trace.txt
}

# Test 2
test_correctness_nested() {
    echo -n "Test 2: Correctness (nested loops)... "
    cat > /tmp/loop_nested.c << 'EOF'
int main() {
    int matrix[10][10];
    for (int i = 0; i < 10; i++)
        for (int j = 0; j < 10; j++)
            matrix[i][j] = i * j;
    return 0;
}
EOF
    "$CACHE_EXPLORE" /tmp/loop_nested.c > /tmp/loop_nested_trace.txt 2>&1
    UNCACHED=$("$CACHE_SIM" --json < /tmp/loop_nested_trace.txt 2>&1)
    CACHED=$("$CACHE_SIM" --json --cache-segments < /tmp/loop_nested_trace.txt 2>&1)
    UNCACHED_L1=$(echo "$UNCACHED" | jq '.levels.l1d.hits')
    CACHED_L1=$(echo "$CACHED" | jq '.levels.l1d.hits')
    if [ "$UNCACHED_L1" == "$CACHED_L1" ]; then
        echo -e "${GREEN}PASS${NC}"; PASSED=$((PASSED + 1))
    else
        echo -e "${RED}FAIL${NC}"; FAILED=$((FAILED + 1))
    fi
    rm -f /tmp/loop_nested.c /tmp/loop_nested_trace.txt
}

# Test 3
test_segment_size() {
    echo -n "Test 3: Segment size configuration... "
    cat > /tmp/loop_segments.c << 'EOF'
int main() {
    int arr[50];
    for (int i = 0; i < 50; i++) arr[i] = i;
    return 0;
}
EOF
    "$CACHE_EXPLORE" /tmp/loop_segments.c > /tmp/loop_segments_trace.txt 2>&1
    RESULT1=$("$CACHE_SIM" --json --cache-segments --segment-size 10 < /tmp/loop_segments_trace.txt 2>&1)
    RESULT2=$("$CACHE_SIM" --json --cache-segments --segment-size 50 < /tmp/loop_segments_trace.txt 2>&1)
    HITS1=$(echo "$RESULT1" | jq '.levels.l1d.hits')
    HITS2=$(echo "$RESULT2" | jq '.levels.l1d.hits')
    if [ "$HITS1" == "$HITS2" ]; then
        echo -e "${GREEN}PASS${NC}"; PASSED=$((PASSED + 1))
    else
        echo -e "${RED}FAIL${NC}"; FAILED=$((FAILED + 1))
    fi
    rm -f /tmp/loop_segments.c /tmp/loop_segments_trace.txt
}

# Test 4
test_flag_compatibility() {
    echo -n "Test 4: Flag compatibility... "
    cat > /tmp/loop_simple2.c << 'EOF'
int main() {
    int arr[20];
    for (int i = 0; i < 20; i++) arr[i] = i * 3;
    return 0;
}
EOF
    "$CACHE_EXPLORE" /tmp/loop_simple2.c > /tmp/loop_simple2_trace.txt 2>&1
    if OUTPUT=$("$CACHE_SIM" --json --cache-segments < /tmp/loop_simple2_trace.txt 2>&1); then
        EVENTS=$(echo "$OUTPUT" | jq '.events' 2>/dev/null)
        if [ -n "$EVENTS" ] && [ "$EVENTS" != "null" ]; then
            echo -e "${GREEN}PASS${NC}"; PASSED=$((PASSED + 1))
        else
            echo -e "${RED}FAIL${NC}"; FAILED=$((FAILED + 1))
        fi
    else
        echo -e "${RED}FAIL${NC}"; FAILED=$((FAILED + 1))
    fi
    rm -f /tmp/loop_simple2.c /tmp/loop_simple2_trace.txt
}

test_correctness_simple
test_correctness_nested
test_segment_size
test_flag_compatibility

echo ""
echo "Passed: ${GREEN}$PASSED${NC}"
echo "Failed: ${RED}$FAILED${NC}"
[ $FAILED -eq 0 ] && echo -e "${GREEN}✅ All tests passed!${NC}" && exit 0
echo -e "${RED}❌ Some tests failed${NC}" && exit 1
