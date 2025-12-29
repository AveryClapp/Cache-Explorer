#!/bin/bash
# Hardware Validation Script
# Compares Cache Explorer simulator results against real hardware (perf)
#
# REQUIREMENTS:
#   - Linux with perf installed (sudo apt install linux-tools-generic)
#   - Root or perf_event_paranoid=0 (echo 0 | sudo tee /proc/sys/kernel/perf_event_paranoid)
#   - Cache Explorer built

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CACHE_EXPLORE="$PROJECT_ROOT/backend/scripts/cache-explore"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;36m'
NC='\033[0m'

# Check if we're on Linux
if [[ "$(uname)" != "Linux" ]]; then
    echo -e "${YELLOW}Warning: Hardware validation requires Linux with perf.${NC}"
    echo "This script will only work on Linux systems."
    echo ""
    echo "To run on Linux:"
    echo "  1. Ensure perf is installed: sudo apt install linux-tools-generic"
    echo "  2. Enable perf counters: echo 0 | sudo tee /proc/sys/kernel/perf_event_paranoid"
    echo "  3. Run this script: ./scripts/validate-accuracy.sh"
    exit 0
fi

# Check perf
if ! command -v perf &> /dev/null; then
    echo -e "${RED}Error: perf not found${NC}"
    echo "Install with: sudo apt install linux-tools-generic linux-tools-\$(uname -r)"
    exit 1
fi

# Check perf permissions
if ! perf stat true 2>/dev/null; then
    echo -e "${RED}Error: perf requires permissions${NC}"
    echo "Run: echo 0 | sudo tee /proc/sys/kernel/perf_event_paranoid"
    exit 1
fi

echo -e "${BLUE}=== Cache Explorer Hardware Validation ===${NC}"
echo ""

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Test programs for validation
declare -A TEST_PROGRAMS

# Sequential access - should have high L1 hit rate
TEST_PROGRAMS["sequential"]='
#include <stdio.h>
#define N 100000
int arr[N];
int main() {
    int sum = 0;
    for (int i = 0; i < N; i++) arr[i] = i;
    for (int rep = 0; rep < 10; rep++)
        for (int i = 0; i < N; i++) sum += arr[i];
    printf("sum=%d\n", sum);
    return 0;
}
'

# Strided access - moderate hit rate
TEST_PROGRAMS["strided"]='
#include <stdio.h>
#define N 100000
int arr[N];
int main() {
    int sum = 0;
    for (int i = 0; i < N; i++) arr[i] = i;
    for (int rep = 0; rep < 10; rep++)
        for (int i = 0; i < N; i += 16) sum += arr[i];
    printf("sum=%d\n", sum);
    return 0;
}
'

# Random access - low hit rate
TEST_PROGRAMS["random"]='
#include <stdio.h>
#include <stdlib.h>
#define N 100000
int arr[N];
int indices[1000];
int main() {
    srand(42);
    for (int i = 0; i < 1000; i++) indices[i] = rand() % N;
    for (int i = 0; i < N; i++) arr[i] = i;
    int sum = 0;
    for (int rep = 0; rep < 100; rep++)
        for (int i = 0; i < 1000; i++) sum += arr[indices[i]];
    printf("sum=%d\n", sum);
    return 0;
}
'

# Matrix row-major - cache friendly
TEST_PROGRAMS["matrix_row"]='
#include <stdio.h>
#define N 500
int matrix[N][N];
int main() {
    int sum = 0;
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            matrix[i][j] = i + j;
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            sum += matrix[i][j];
    printf("sum=%d\n", sum);
    return 0;
}
'

# Matrix column-major - cache unfriendly
TEST_PROGRAMS["matrix_col"]='
#include <stdio.h>
#define N 500
int matrix[N][N];
int main() {
    int sum = 0;
    for (int j = 0; j < N; j++)
        for (int i = 0; i < N; i++)
            matrix[i][j] = i + j;
    for (int j = 0; j < N; j++)
        for (int i = 0; i < N; i++)
            sum += matrix[i][j];
    printf("sum=%d\n", sum);
    return 0;
}
'

# Results storage
declare -A SIM_L1_HITS
declare -A SIM_L1_MISSES
declare -A PERF_L1_HITS
declare -A PERF_L1_MISSES

echo "Running validation tests..."
echo ""

for name in "${!TEST_PROGRAMS[@]}"; do
    echo -e "${BLUE}[$name]${NC}"

    # Write test program
    echo "${TEST_PROGRAMS[$name]}" > "$TEMP_DIR/$name.c"

    # 1. Run with Cache Explorer simulator
    echo "  Simulator..."
    SIM_OUTPUT=$("$CACHE_EXPLORE" "$TEMP_DIR/$name.c" --config intel -O2 --json 2>/dev/null || echo "{}")

    # Parse simulator results
    SIM_L1_HITS[$name]=$(echo "$SIM_OUTPUT" | grep -o '"l1d":{[^}]*"hits":[0-9]*' | grep -o 'hits":[0-9]*' | grep -o '[0-9]*' | head -1 || echo "0")
    SIM_L1_MISSES[$name]=$(echo "$SIM_OUTPUT" | grep -o '"l1d":{[^}]*"misses":[0-9]*' | grep -o 'misses":[0-9]*' | grep -o '[0-9]*' | head -1 || echo "0")

    # 2. Compile normally and run with perf
    echo "  Hardware (perf)..."
    gcc -O2 "$TEMP_DIR/$name.c" -o "$TEMP_DIR/$name" 2>/dev/null

    PERF_OUTPUT=$(perf stat -e L1-dcache-loads,L1-dcache-load-misses "$TEMP_DIR/$name" 2>&1 || echo "")

    # Parse perf results
    PERF_L1_HITS[$name]=$(echo "$PERF_OUTPUT" | grep -i 'L1-dcache-loads' | awk '{gsub(/,/,"",$1); print $1}' || echo "0")
    PERF_L1_MISSES[$name]=$(echo "$PERF_OUTPUT" | grep -i 'L1-dcache-load-misses' | awk '{gsub(/,/,"",$1); print $1}' || echo "0")

    # Calculate hit rates
    SIM_TOTAL=$((${SIM_L1_HITS[$name]} + ${SIM_L1_MISSES[$name]}))
    PERF_TOTAL=$((${PERF_L1_HITS[$name]} + ${PERF_L1_MISSES[$name]}))

    if [[ $SIM_TOTAL -gt 0 ]]; then
        SIM_RATE=$(echo "scale=1; ${SIM_L1_HITS[$name]} * 100 / $SIM_TOTAL" | bc)
    else
        SIM_RATE="N/A"
    fi

    if [[ $PERF_TOTAL -gt 0 ]] && [[ ${PERF_L1_HITS[$name]} -gt 0 ]]; then
        PERF_RATE=$(echo "scale=1; (${PERF_L1_HITS[$name]} - ${PERF_L1_MISSES[$name]}) * 100 / ${PERF_L1_HITS[$name]}" | bc 2>/dev/null || echo "N/A")
    else
        PERF_RATE="N/A"
    fi

    echo "    Simulator L1 hit rate: ${SIM_RATE}%"
    echo "    Hardware L1 hit rate:  ${PERF_RATE}%"
    echo ""
done

echo -e "${BLUE}=== Validation Summary ===${NC}"
echo ""
echo "| Test | Simulator | Hardware | Delta |"
echo "|------|-----------|----------|-------|"

for name in sequential strided random matrix_row matrix_col; do
    SIM_TOTAL=$((${SIM_L1_HITS[$name]} + ${SIM_L1_MISSES[$name]}))
    PERF_TOTAL=$((${PERF_L1_HITS[$name]}))

    if [[ $SIM_TOTAL -gt 0 ]]; then
        SIM_RATE=$(echo "scale=1; ${SIM_L1_HITS[$name]} * 100 / $SIM_TOTAL" | bc)
    else
        SIM_RATE="N/A"
    fi

    if [[ $PERF_TOTAL -gt 0 ]] && [[ ${PERF_L1_HITS[$name]} -gt 0 ]]; then
        PERF_RATE=$(echo "scale=1; (${PERF_L1_HITS[$name]} - ${PERF_L1_MISSES[$name]}) * 100 / ${PERF_L1_HITS[$name]}" | bc 2>/dev/null || echo "N/A")
        if [[ "$SIM_RATE" != "N/A" ]] && [[ "$PERF_RATE" != "N/A" ]]; then
            DELTA=$(echo "scale=1; $SIM_RATE - $PERF_RATE" | bc 2>/dev/null | sed 's/^-//' || echo "N/A")
        else
            DELTA="N/A"
        fi
    else
        PERF_RATE="N/A"
        DELTA="N/A"
    fi

    printf "| %-12s | %8s%% | %8s%% | %5s%% |\n" "$name" "$SIM_RATE" "$PERF_RATE" "$DELTA"
done

echo ""
echo -e "${GREEN}Validation complete.${NC}"
echo ""
echo "Notes:"
echo "  - Small delta (<5%) indicates good accuracy"
echo "  - Larger deltas may be due to:"
echo "    * Different hardware configurations"
echo "    * OS noise and background processes"
echo "    * Instruction cache effects (not tracked by perf L1-dcache)"
echo "    * Compiler differences between simulator and native build"
echo ""
echo "See docs/VALIDATION.md for detailed accuracy analysis."
