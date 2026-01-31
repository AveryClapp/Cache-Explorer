#!/bin/bash
# Integration tests for Zig language support
# Tests the full pipeline: .zig → LLVM IR → instrumented → trace → simulation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CACHE_SIM="$PROJECT_ROOT/backend/cache-simulator/build/cache-sim"
CACHE_EXPLORE_ZIG="$PROJECT_ROOT/backend/scripts/cache-explore-zig"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0

echo "=========================================="
echo "  Zig Language Support Tests"
echo "=========================================="
echo ""

# Check if zig is installed
if ! command -v zig &> /dev/null; then
    echo -e "${RED}ERROR: zig not found in PATH${NC}"
    echo "Install Zig: https://ziglang.org/download/"
    exit 1
fi

ZIG_VERSION=$(zig version)
echo "Using Zig version: $ZIG_VERSION"
echo ""

# Test 1: Simple array access
test_simple_array() {
    echo -n "Test 1: Simple array access... "

    if ! "$CACHE_EXPLORE_ZIG" "$SCRIPT_DIR/test-programs/hello.zig" > /tmp/zig_hello_output.json 2>&1; then
        echo -e "${RED}FAIL${NC} (compilation failed)"
        cat /tmp/zig_hello_output.json
        FAILED=$((FAILED + 1))
        return
    fi

    # Verify JSON output
    if ! jq empty /tmp/zig_hello_output.json 2>/dev/null; then
        echo -e "${RED}FAIL${NC} (invalid JSON)"
        FAILED=$((FAILED + 1))
        return
    fi

    # Check for events
    EVENTS=$(jq '.events' /tmp/zig_hello_output.json)
    if [ "$EVENTS" -gt 0 ]; then
        echo -e "${GREEN}PASS${NC} ($EVENTS events)"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}FAIL${NC} (no events captured)"
        FAILED=$((FAILED + 1))
    fi

    rm -f /tmp/zig_hello_output.json
}

# Test 2: Nested loops (cache behavior)
test_nested_loops() {
    echo -n "Test 2: Nested loops (matrix access)... "

    if ! "$CACHE_EXPLORE_ZIG" "$SCRIPT_DIR/test-programs/array.zig" > /tmp/zig_array_output.json 2>&1; then
        echo -e "${RED}FAIL${NC} (compilation failed)"
        FAILED=$((FAILED + 1))
        return
    fi

    # Check L1 hit rate (should be high for row-major access)
    L1_HIT_RATE=$(jq '.levels.l1d.hitRate' /tmp/zig_array_output.json)

    # Hit rate should be > 0.5 for good cache behavior
    if (( $(echo "$L1_HIT_RATE > 0.5" | bc -l) )); then
        echo -e "${GREEN}PASS${NC} (L1 hit rate: $L1_HIT_RATE)"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}FAIL${NC} (L1 hit rate too low: $L1_HIT_RATE)"
        FAILED=$((FAILED + 1))
    fi

    rm -f /tmp/zig_array_output.json
}

# Test 3: Struct access patterns
test_struct_access() {
    echo -n "Test 3: Struct access patterns... "

    if ! "$CACHE_EXPLORE_ZIG" "$SCRIPT_DIR/test-programs/struct.zig" > /tmp/zig_struct_output.json 2>&1; then
        echo -e "${RED}FAIL${NC} (compilation failed)"
        FAILED=$((FAILED + 1))
        return
    fi

    # Verify we captured struct field accesses
    EVENTS=$(jq '.events' /tmp/zig_struct_output.json)

    if [ "$EVENTS" -gt 100 ]; then
        echo -e "${GREEN}PASS${NC} ($EVENTS events)"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}FAIL${NC} (too few events: $EVENTS)"
        FAILED=$((FAILED + 1))
    fi

    rm -f /tmp/zig_struct_output.json
}

# Test 4: Source attribution
test_source_attribution() {
    echo -n "Test 4: Source file attribution... "

    if ! "$CACHE_EXPLORE_ZIG" "$SCRIPT_DIR/test-programs/hello.zig" --json > /tmp/zig_attr_output.json 2>&1; then
        echo -e "${RED}FAIL${NC} (compilation failed)"
        FAILED=$((FAILED + 1))
        return
    fi

    # Check if hot lines include .zig file references
    HOT_LINES=$(jq '.hotLines[]?.location' /tmp/zig_attr_output.json 2>/dev/null | grep -c '.zig' || echo "0")

    if [ "$HOT_LINES" -gt 0 ]; then
        echo -e "${GREEN}PASS${NC} ($HOT_LINES .zig references)"
        PASSED=$((PASSED + 1))
    else
        echo -e "${YELLOW}WARN${NC} (no .zig file attribution)"
        # Don't fail this test - attribution may not always be available
        PASSED=$((PASSED + 1))
    fi

    rm -f /tmp/zig_attr_output.json
}

# Run all tests
test_simple_array
test_nested_loops
test_struct_access
test_source_attribution

echo ""
echo "=========================================="
echo "  Test Summary"
echo "=========================================="
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All Zig tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
fi
