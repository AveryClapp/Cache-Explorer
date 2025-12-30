#!/bin/bash
# Hardware Validation Script
# Compares Cache Explorer simulator against real hardware (perf)
#
# Usage: ./validate-hardware.sh [--update-baseline]
#
# Requirements:
#   - Linux with perf installed
#   - perf_event_paranoid=0 (or run as root)
#   - Cache Explorer built

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

UPDATE_BASELINE=false
if [[ "$1" == "--update-baseline" ]]; then
    UPDATE_BASELINE=true
fi

# Check platform
if [[ "$(uname)" != "Linux" ]]; then
    echo -e "${RED}Error: Hardware validation requires Linux with perf${NC}"
    echo "Run this on a Linux server or use validate-against-baseline.sh locally."
    exit 1
fi

# Check perf
if ! command -v perf &> /dev/null; then
    echo -e "${RED}Error: perf not found${NC}"
    echo "Install: sudo apt install linux-tools-generic linux-tools-\$(uname -r)"
    exit 1
fi

# Check perf permissions
if ! perf stat true 2>/dev/null; then
    echo -e "${RED}Error: perf requires permissions${NC}"
    echo "Run: echo 0 | sudo tee /proc/sys/kernel/perf_event_paranoid"
    exit 1
fi

# Check cache-explore exists
if [[ ! -x "$CACHE_EXPLORE" ]]; then
    echo -e "${RED}Error: cache-explore not found at $CACHE_EXPLORE${NC}"
    echo "Run ./scripts/build.sh first"
    exit 1
fi

# Get hardware info
CPU_MODEL=$(lscpu | grep "Model name" | cut -d: -f2 | xargs)
KERNEL_VERSION=$(uname -r)
TIMESTAMP=$(date -Iseconds)

echo -e "${BLUE}=== Cache Explorer Hardware Validation ===${NC}"
echo "CPU: $CPU_MODEL"
echo "Kernel: $KERNEL_VERSION"
echo ""

# Temp directory for builds
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Benchmarks to run
BENCHMARKS=(sequential strided_16 strided_64 random matrix_row matrix_col linked_list working_set)

# Results storage
declare -A SIM_L1_HITS SIM_L1_MISSES SIM_L1_RATE
declare -A PERF_L1_LOADS PERF_L1_MISSES PERF_L1_RATE

echo -e "${YELLOW}Running benchmarks...${NC}"
echo ""

for bench in "${BENCHMARKS[@]}"; do
    BENCH_FILE="$BENCHMARKS_DIR/$bench.c"

    if [[ ! -f "$BENCH_FILE" ]]; then
        echo -e "${RED}Benchmark not found: $BENCH_FILE${NC}"
        continue
    fi

    echo -e "${BLUE}[$bench]${NC}"

    # 1. Run with Cache Explorer simulator
    echo "  Running simulator..."
    SIM_OUTPUT=$("$CACHE_EXPLORE" "$BENCH_FILE" --config intel -O2 --json 2>/dev/null || echo "{}")

    # Parse L1 data cache results from "levels": {"l1d": {"hits": N, "misses": M, ...}}
    L1D_BLOCK=$(echo "$SIM_OUTPUT" | grep -o '"l1d":[^}]*}' | head -1)
    SIM_L1_HITS[$bench]=$(echo "$L1D_BLOCK" | grep -o '"hits":[0-9]*' | grep -o '[0-9]*' || echo "0")
    SIM_L1_MISSES[$bench]=$(echo "$L1D_BLOCK" | grep -o '"misses":[0-9]*' | grep -o '[0-9]*' || echo "0")

    SIM_TOTAL=$((${SIM_L1_HITS[$bench]:-0} + ${SIM_L1_MISSES[$bench]:-0}))
    if [[ $SIM_TOTAL -gt 0 ]]; then
        SIM_L1_RATE[$bench]=$(echo "scale=1; ${SIM_L1_HITS[$bench]:-0} * 100 / $SIM_TOTAL" | bc)
    else
        SIM_L1_RATE[$bench]="0.0"
    fi

    # 2. Compile and run with perf
    echo "  Running hardware (perf)..."
    gcc -O2 "$BENCH_FILE" -o "$TEMP_DIR/$bench" 2>/dev/null

    PERF_OUTPUT=$(perf stat -e L1-dcache-loads,L1-dcache-load-misses "$TEMP_DIR/$bench" 2>&1)

    # Parse perf results
    PERF_L1_LOADS[$bench]=$(echo "$PERF_OUTPUT" | grep -i 'L1-dcache-loads' | awk '{gsub(/,/,"",$1); print $1}')
    PERF_L1_MISSES[$bench]=$(echo "$PERF_OUTPUT" | grep -i 'L1-dcache-load-misses' | awk '{gsub(/,/,"",$1); print $1}')

    PERF_LOADS=${PERF_L1_LOADS[$bench]:-0}
    PERF_MISS=${PERF_L1_MISSES[$bench]:-0}

    if [[ $PERF_LOADS -gt 0 ]]; then
        PERF_L1_RATE[$bench]=$(echo "scale=1; ($PERF_LOADS - $PERF_MISS) * 100 / $PERF_LOADS" | bc 2>/dev/null || echo "0.0")
    else
        PERF_L1_RATE[$bench]="0.0"
    fi

    echo "    Simulator: ${SIM_L1_RATE[$bench]}% hit rate"
    echo "    Hardware:  ${PERF_L1_RATE[$bench]}% hit rate"
    echo ""
done

# Print summary table
echo -e "${BLUE}=== Validation Summary ===${NC}"
echo ""
printf "| %-12s | %10s | %10s | %8s |\n" "Benchmark" "Simulator" "Hardware" "Delta"
printf "|--------------|------------|------------|----------|\n"

TOTAL_DELTA=0
COUNT=0
MAX_DELTA=0
ALL_PASS=true

for bench in "${BENCHMARKS[@]}"; do
    SIM="${SIM_L1_RATE[$bench]:-N/A}"
    PERF="${PERF_L1_RATE[$bench]:-N/A}"

    if [[ "$SIM" != "N/A" ]] && [[ "$PERF" != "N/A" ]] && [[ "$PERF" != "0.0" ]]; then
        DELTA=$(echo "scale=1; $SIM - $PERF" | bc 2>/dev/null)
        DELTA_ABS=$(echo "$DELTA" | sed 's/^-//')

        # Track for average
        TOTAL_DELTA=$(echo "$TOTAL_DELTA + $DELTA_ABS" | bc)
        COUNT=$((COUNT + 1))

        # Track max
        if (( $(echo "$DELTA_ABS > $MAX_DELTA" | bc -l) )); then
            MAX_DELTA=$DELTA_ABS
        fi

        # Check threshold
        if (( $(echo "$DELTA_ABS > 5" | bc -l) )); then
            ALL_PASS=false
            printf "| %-12s | %9s%% | %9s%% | ${RED}%+7s%%${NC} |\n" "$bench" "$SIM" "$PERF" "$DELTA"
        else
            printf "| %-12s | %9s%% | %9s%% | ${GREEN}%+7s%%${NC} |\n" "$bench" "$SIM" "$PERF" "$DELTA"
        fi
    else
        printf "| %-12s | %9s%% | %9s%% | %8s |\n" "$bench" "$SIM" "$PERF" "N/A"
    fi
done

echo ""

# Calculate average delta
if [[ $COUNT -gt 0 ]]; then
    AVG_DELTA=$(echo "scale=1; $TOTAL_DELTA / $COUNT" | bc)
    echo "Average delta: ±${AVG_DELTA}%"
    echo "Max delta: ${MAX_DELTA}%"
fi

echo ""

if $ALL_PASS; then
    echo -e "${GREEN}Status: PASS (all benchmarks within 5% threshold)${NC}"
else
    echo -e "${RED}Status: FAIL (some benchmarks exceed 5% threshold)${NC}"
fi

# Update baseline if requested
if $UPDATE_BASELINE; then
    echo ""
    echo -e "${YELLOW}Updating baseline...${NC}"

    # Create machine-specific baseline filename
    MACHINE_ID=$(echo "$CPU_MODEL" | tr ' ' '-' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]//g' | head -c 40)
    BASELINE_FILE="$BASELINES_DIR/$MACHINE_ID.json"

    mkdir -p "$BASELINES_DIR"

    # Generate JSON
    cat > "$BASELINE_FILE" << EOF
{
  "hardware": "$CPU_MODEL",
  "kernel": "$KERNEL_VERSION",
  "date": "$TIMESTAMP",
  "benchmarks": {
EOF

    FIRST=true
    for bench in "${BENCHMARKS[@]}"; do
        if ! $FIRST; then
            echo "," >> "$BASELINE_FILE"
        fi
        FIRST=false

        cat >> "$BASELINE_FILE" << EOF
    "$bench": {
      "simulator_hit_rate": ${SIM_L1_RATE[$bench]:-0},
      "hardware_hit_rate": ${PERF_L1_RATE[$bench]:-0},
      "simulator_hits": ${SIM_L1_HITS[$bench]:-0},
      "simulator_misses": ${SIM_L1_MISSES[$bench]:-0},
      "hardware_loads": ${PERF_L1_LOADS[$bench]:-0},
      "hardware_misses": ${PERF_L1_MISSES[$bench]:-0}
    }
EOF
    done

    cat >> "$BASELINE_FILE" << EOF

  }
}
EOF

    echo -e "${GREEN}Baseline saved to: $BASELINE_FILE${NC}"
fi

echo ""
echo "Done."
