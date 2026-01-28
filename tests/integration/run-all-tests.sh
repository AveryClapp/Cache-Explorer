#!/bin/bash
# Master test runner for integration tests

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================"
echo "  Running All Integration Tests"
echo "========================================${NC}"
echo ""

TOTAL_PASSED=0
TOTAL_FAILED=0

run_test_suite() {
    local script="$1"
    local name="$2"

    echo -e "${BLUE}Running: $name${NC}"
    echo "----------------------------------------"

    if "$SCRIPT_DIR/$script"; then
        echo -e "${GREEN}✓ $name passed${NC}"
        echo ""
        return 0
    else
        echo -e "${RED}✗ $name failed${NC}"
        echo ""
        return 1
    fi
}

# Run test suites
if run_test_suite "test-all-presets.sh" "Hardware Presets"; then
    TOTAL_PASSED=$((TOTAL_PASSED + 1))
else
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
fi

if run_test_suite "test-features.sh" "Core Features"; then
    TOTAL_PASSED=$((TOTAL_PASSED + 1))
else
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
fi

# Final summary
echo -e "${BLUE}========================================"
echo "  Overall Summary"
echo "========================================${NC}"
echo -e "Test Suites Passed: ${GREEN}$TOTAL_PASSED${NC}"
echo -e "Test Suites Failed: ${RED}$TOTAL_FAILED${NC}"
echo ""

if [ $TOTAL_FAILED -gt 0 ]; then
    echo -e "${RED}Some tests failed${NC}"
    exit 1
fi

echo -e "${GREEN}All tests passed!${NC}"
exit 0
