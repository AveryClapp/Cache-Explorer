#!/bin/bash
# Validate Against Baseline Script
# Compares Cache Explorer simulator against saved hardware baseline
# Can run anywhere (doesn't require perf)
#
# Usage: ./validate-against-baseline.sh [baseline-file]
#
# Exit codes:
#   0 - All benchmarks within threshold
#   1 - Some benchmarks exceed threshold

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CACHE_EXPLORE="$PROJECT_ROOT/backend/scripts/cache-explore"
BENCHMARKS_DIR="$SCRIPT_DIR/benchmarks"
BASELINES_DIR="$SCRIPT_DIR/baselines"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;36m'
NC='\033[0m'

# Threshold for pass/fail (percentage points)
THRESHOLD=5

# Find baseline file
BASELINE_FILE="$1"
if [[ -z "$BASELINE_FILE" ]]; then
    # Use most recent baseline if not specified
    BASELINE_FILE=$(ls -t "$BASELINES_DIR"/*.json 2>/dev/null | head -1)
fi

if [[ -z "$BASELINE_FILE" ]] || [[ ! -f "$BASELINE_FILE" ]]; then
    echo -e "${RED}Error: No baseline file found${NC}"
    echo "Run validate-hardware.sh --update-baseline on a Linux server first,"
    echo "or specify a baseline file: $0 path/to/baseline.json"
    exit 1
fi

# Check cache-explore exists
if [[ ! -x "$CACHE_EXPLORE" ]]; then
    echo -e "${RED}Error: cache-explore not found at $CACHE_EXPLORE${NC}"
    echo "Run ./scripts/build.sh first"
    exit 1
fi

# Check for jq (used to parse JSON)
if ! command -v jq &> /dev/null; then
    echo -e "${YELLOW}Warning: jq not found, using grep-based parsing${NC}"
    USE_JQ=false
else
    USE_JQ=true
fi

# Extract baseline metadata
if $USE_JQ; then
    BASELINE_HW=$(jq -r '.hardware' "$BASELINE_FILE")
    BASELINE_DATE=$(jq -r '.date' "$BASELINE_FILE")
else
    BASELINE_HW=$(grep -o '"hardware"[[:space:]]*:[[:space:]]*"[^"]*"' "$BASELINE_FILE" | cut -d'"' -f4)
    BASELINE_DATE=$(grep -o '"date"[[:space:]]*:[[:space:]]*"[^"]*"' "$BASELINE_FILE" | cut -d'"' -f4)
fi

echo -e "${BLUE}=== Cache Explorer Baseline Validation ===${NC}"
echo "Baseline: $BASELINE_HW"
echo "Date: $BASELINE_DATE"
echo "File: $(basename "$BASELINE_FILE")"
echo ""

# Benchmarks to test
BENCHMARKS=(sequential strided_16 strided_64 random matrix_row matrix_col linked_list working_set)

# Results
declare -A SIM_RATE BASELINE_RATE
FAILURES=0

echo -e "${YELLOW}Running benchmarks...${NC}"
echo ""

for bench in "${BENCHMARKS[@]}"; do
    BENCH_FILE="$BENCHMARKS_DIR/$bench.c"

    if [[ ! -f "$BENCH_FILE" ]]; then
        echo -e "${YELLOW}Skipping $bench (file not found)${NC}"
        continue
    fi

    # Get baseline value
    if $USE_JQ; then
        BASELINE_RATE[$bench]=$(jq -r ".benchmarks.$bench.hardware_hit_rate // \"N/A\"" "$BASELINE_FILE")
    else
        # Grep-based fallback
        BASELINE_RATE[$bench]=$(grep -A5 "\"$bench\"" "$BASELINE_FILE" | grep "hardware_hit_rate" | grep -o '[0-9.]*' | head -1 || echo "N/A")
    fi

    if [[ "${BASELINE_RATE[$bench]}" == "null" ]] || [[ -z "${BASELINE_RATE[$bench]}" ]]; then
        BASELINE_RATE[$bench]="N/A"
    fi

    # Run simulator with Intel-like prefetching to match real hardware
    SIM_OUTPUT=$("$CACHE_EXPLORE" "$BENCH_FILE" --config intel -O2 --prefetch intel --json 2>/dev/null || echo "{}")

    # Parse L1 data cache results from "levels": {"l1d": {"hits": N, "misses": M, ...}}
    # Note: "l1d" appears twice (cacheConfig and levels), we need the one with "hits"
    L1D_BLOCK=$(echo "$SIM_OUTPUT" | grep -o '"l1d":[^}]*}' | grep '"hits"' | head -1)
    SIM_HITS=$(echo "$L1D_BLOCK" | grep -oE '"hits":[[:space:]]*[0-9]+' | grep -o '[0-9]*' || echo "0")
    SIM_MISSES=$(echo "$L1D_BLOCK" | grep -oE '"misses":[[:space:]]*[0-9]+' | grep -o '[0-9]*' || echo "0")

    SIM_TOTAL=$((${SIM_HITS:-0} + ${SIM_MISSES:-0}))
    if [[ $SIM_TOTAL -gt 0 ]]; then
        SIM_RATE[$bench]=$(echo "scale=1; ${SIM_HITS:-0} * 100 / $SIM_TOTAL" | bc)
    else
        SIM_RATE[$bench]="0.0"
    fi

    echo "[$bench] Simulator: ${SIM_RATE[$bench]}% | Baseline: ${BASELINE_RATE[$bench]}%"
done

echo ""

# Print summary table
echo -e "${BLUE}=== Validation Results ===${NC}"
echo ""
printf "| %-12s | %10s | %10s | %8s | %6s |\n" "Benchmark" "Simulator" "Baseline" "Delta" "Status"
printf "|--------------|------------|------------|----------|--------|\n"

for bench in "${BENCHMARKS[@]}"; do
    SIM="${SIM_RATE[$bench]:-N/A}"
    BASE="${BASELINE_RATE[$bench]:-N/A}"

    if [[ "$SIM" != "N/A" ]] && [[ "$BASE" != "N/A" ]] && [[ "$BASE" != "0" ]]; then
        DELTA=$(echo "scale=1; $SIM - $BASE" | bc 2>/dev/null)
        DELTA_ABS=$(echo "$DELTA" | sed 's/^-//')

        if (( $(echo "$DELTA_ABS > $THRESHOLD" | bc -l) )); then
            STATUS="${RED}FAIL${NC}"
            FAILURES=$((FAILURES + 1))
        else
            STATUS="${GREEN}PASS${NC}"
        fi

        printf "| %-12s | %9s%% | %9s%% | %+7s%% | " "$bench" "$SIM" "$BASE" "$DELTA"
        echo -e "$STATUS |"
    else
        printf "| %-12s | %9s%% | %9s%% | %8s | SKIP   |\n" "$bench" "$SIM" "$BASE" "N/A"
    fi
done

echo ""

if [[ $FAILURES -eq 0 ]]; then
    echo -e "${GREEN}Result: PASS - All benchmarks within ±${THRESHOLD}% of baseline${NC}"
    exit 0
else
    echo -e "${RED}Result: FAIL - $FAILURES benchmark(s) exceed ±${THRESHOLD}% threshold${NC}"
    exit 1
fi
