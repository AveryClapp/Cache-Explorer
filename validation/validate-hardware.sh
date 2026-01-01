#!/bin/bash
# Hardware Validation Script
# Compares Cache Explorer simulator against real hardware (perf)
#
# Usage: ./validate-hardware.sh [--update-baseline] [--config <config>]
#
# Supported architectures:
#   - Intel (auto-detected): Uses xeon8488c config
#   - AMD (auto-detected): Uses zen4 config
#   - ARM/Graviton (auto-detected): Uses graviton3 config
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
FORCE_CONFIG=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --update-baseline)
            UPDATE_BASELINE=true
            shift
            ;;
        --config)
            FORCE_CONFIG="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

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
ARCH=$(uname -m)

# Auto-detect CPU vendor and set config + perf counters
detect_cpu_vendor() {
    local vendor=$(lscpu | grep "Vendor ID" | cut -d: -f2 | xargs)

    case "$vendor" in
        GenuineIntel)
            echo "intel"
            ;;
        AuthenticAMD)
            echo "amd"
            ;;
        *)
            # Check architecture for ARM
            if [[ "$ARCH" == "aarch64" ]] || [[ "$ARCH" == "arm64" ]]; then
                echo "arm"
            else
                echo "unknown"
            fi
            ;;
    esac
}

CPU_VENDOR=$(detect_cpu_vendor)

# Set config and perf counters based on vendor
if [[ -n "$FORCE_CONFIG" ]]; then
    SIM_CONFIG="$FORCE_CONFIG"
    echo -e "${YELLOW}Using forced config: $SIM_CONFIG${NC}"
else
    case "$CPU_VENDOR" in
        intel)
            SIM_CONFIG="xeon8488c"
            ;;
        amd)
            SIM_CONFIG="zen4"
            ;;
        arm)
            SIM_CONFIG="graviton3"
            ;;
        *)
            SIM_CONFIG="intel"
            echo -e "${YELLOW}Warning: Unknown CPU vendor, using intel config${NC}"
            ;;
    esac
fi

# Set perf counters based on vendor
# L1 counters are usually the same across vendors
L1_LOAD_COUNTER="L1-dcache-loads"
L1_MISS_COUNTER="L1-dcache-load-misses"

case "$CPU_VENDOR" in
    intel)
        # Intel-specific L2 counters
        L2_HIT_COUNTER="l2_rqsts.demand_data_rd_hit"
        L2_MISS_COUNTER="l2_rqsts.demand_data_rd_miss"
        L2_MODE="hit_miss"  # Separate hit and miss counters
        ;;
    amd)
        # AMD uses different L2 counter names
        # Try AMD-specific counters first, fall back to generic
        if perf list 2>/dev/null | grep -q "l2_cache_accesses_from_dc_misses"; then
            L2_HIT_COUNTER="l2_cache_hits_from_dc_misses"
            L2_MISS_COUNTER="l2_cache_misses_from_dc_misses"
            L2_MODE="hit_miss"
        else
            # Fallback to generic cache counters
            L2_HIT_COUNTER="cache-references"
            L2_MISS_COUNTER="cache-misses"
            L2_MODE="ref_miss"  # References and misses (not pure L2)
        fi
        ;;
    arm)
        # ARM PMU counters
        L2_HIT_COUNTER="l2d_cache"
        L2_MISS_COUNTER="l2d_cache_refill"
        L2_MODE="access_refill"  # Total accesses and refills (misses)
        ;;
    *)
        # Generic fallback
        L2_HIT_COUNTER="cache-references"
        L2_MISS_COUNTER="cache-misses"
        L2_MODE="ref_miss"
        ;;
esac

echo -e "${BLUE}=== Cache Explorer Hardware Validation ===${NC}"
echo "CPU: $CPU_MODEL"
echo "Vendor: $CPU_VENDOR"
echo "Architecture: $ARCH"
echo "Kernel: $KERNEL_VERSION"
echo "Simulator config: $SIM_CONFIG"
echo "L2 counter mode: $L2_MODE"
echo ""

# Temp directory for builds
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Benchmarks to run
BENCHMARKS=(sequential strided_16 strided_64 random matrix_row matrix_col linked_list working_set)

# Results storage - L1
declare -A SIM_L1_HITS SIM_L1_MISSES SIM_L1_RATE
declare -A PERF_L1_LOADS PERF_L1_MISSES PERF_L1_RATE

# Results storage - L2
declare -A SIM_L2_HITS SIM_L2_MISSES SIM_L2_RATE
declare -A PERF_L2_HITS PERF_L2_MISSES PERF_L2_RATE

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
    # Preset config auto-applies vendor-specific prefetch
    SIM_OUTPUT=$("$CACHE_EXPLORE" "$BENCH_FILE" --config "$SIM_CONFIG" -O2 --json 2>/dev/null || echo "{}")

    # Parse L1 data cache results
    L1D_BLOCK=$(echo "$SIM_OUTPUT" | grep -o '"l1d":[^}]*}' | grep '"hits"' | head -1)
    SIM_L1_HITS[$bench]=$(echo "$L1D_BLOCK" | grep -oE '"hits":[[:space:]]*[0-9]+' | grep -o '[0-9]*' || echo "0")
    SIM_L1_MISSES[$bench]=$(echo "$L1D_BLOCK" | grep -oE '"misses":[[:space:]]*[0-9]+' | grep -o '[0-9]*' || echo "0")

    SIM_L1_TOTAL=$((${SIM_L1_HITS[$bench]:-0} + ${SIM_L1_MISSES[$bench]:-0}))
    if [[ $SIM_L1_TOTAL -gt 0 ]]; then
        SIM_L1_RATE[$bench]=$(echo "scale=1; ${SIM_L1_HITS[$bench]:-0} * 100 / $SIM_L1_TOTAL" | bc)
    else
        SIM_L1_RATE[$bench]="0.0"
    fi

    # Parse L2 cache results
    L2_BLOCK=$(echo "$SIM_OUTPUT" | grep -o '"l2":[^}]*}' | grep '"hits"' | head -1)
    SIM_L2_HITS[$bench]=$(echo "$L2_BLOCK" | grep -oE '"hits":[[:space:]]*[0-9]+' | grep -o '[0-9]*' || echo "0")
    SIM_L2_MISSES[$bench]=$(echo "$L2_BLOCK" | grep -oE '"misses":[[:space:]]*[0-9]+' | grep -o '[0-9]*' || echo "0")

    SIM_L2_TOTAL=$((${SIM_L2_HITS[$bench]:-0} + ${SIM_L2_MISSES[$bench]:-0}))
    if [[ $SIM_L2_TOTAL -gt 0 ]]; then
        SIM_L2_RATE[$bench]=$(echo "scale=1; ${SIM_L2_HITS[$bench]:-0} * 100 / $SIM_L2_TOTAL" | bc)
    else
        SIM_L2_RATE[$bench]="0.0"
    fi

    # 2. Compile and run with perf (L1 + L2 counters)
    echo "  Running hardware (perf)..."
    gcc -O2 "$BENCH_FILE" -o "$TEMP_DIR/$bench" 2>/dev/null

    PERF_OUTPUT=$(perf stat -e "$L1_LOAD_COUNTER,$L1_MISS_COUNTER,$L2_HIT_COUNTER,$L2_MISS_COUNTER" "$TEMP_DIR/$bench" 2>&1)

    # Parse L1 perf results (same across all vendors)
    PERF_L1_LOADS[$bench]=$(echo "$PERF_OUTPUT" | grep -i "$L1_LOAD_COUNTER" | awk '{gsub(/,/,"",$1); print $1}')
    PERF_L1_MISSES[$bench]=$(echo "$PERF_OUTPUT" | grep -i "$L1_MISS_COUNTER" | awk '{gsub(/,/,"",$1); print $1}')

    PERF_L1_LOAD=${PERF_L1_LOADS[$bench]:-0}
    PERF_L1_MISS=${PERF_L1_MISSES[$bench]:-0}

    if [[ $PERF_L1_LOAD -gt 0 ]]; then
        PERF_L1_RATE[$bench]=$(echo "scale=1; ($PERF_L1_LOAD - $PERF_L1_MISS) * 100 / $PERF_L1_LOAD" | bc 2>/dev/null || echo "0.0")
    else
        PERF_L1_RATE[$bench]="0.0"
    fi

    # Parse L2 perf results (vendor-specific)
    L2_VAL1=$(echo "$PERF_OUTPUT" | grep -i "$L2_HIT_COUNTER" | head -1 | awk '{gsub(/,/,"",$1); print $1}')
    L2_VAL2=$(echo "$PERF_OUTPUT" | grep -i "$L2_MISS_COUNTER" | head -1 | awk '{gsub(/,/,"",$1); print $1}')

    # Calculate L2 hit rate based on counter mode
    case "$L2_MODE" in
        hit_miss)
            # Intel: separate hit and miss counters
            PERF_L2_HITS[$bench]=${L2_VAL1:-0}
            PERF_L2_MISSES[$bench]=${L2_VAL2:-0}
            PERF_L2_TOTAL=$((${PERF_L2_HITS[$bench]} + ${PERF_L2_MISSES[$bench]}))
            if [[ $PERF_L2_TOTAL -gt 0 ]]; then
                PERF_L2_RATE[$bench]=$(echo "scale=1; ${PERF_L2_HITS[$bench]} * 100 / $PERF_L2_TOTAL" | bc 2>/dev/null || echo "0.0")
            else
                PERF_L2_RATE[$bench]="0.0"
            fi
            ;;
        access_refill)
            # ARM: total accesses and refills (misses)
            L2_ACCESSES=${L2_VAL1:-0}
            L2_REFILLS=${L2_VAL2:-0}
            PERF_L2_HITS[$bench]=$((L2_ACCESSES - L2_REFILLS))
            PERF_L2_MISSES[$bench]=$L2_REFILLS
            if [[ $L2_ACCESSES -gt 0 ]]; then
                PERF_L2_RATE[$bench]=$(echo "scale=1; (${PERF_L2_HITS[$bench]}) * 100 / $L2_ACCESSES" | bc 2>/dev/null || echo "0.0")
            else
                PERF_L2_RATE[$bench]="0.0"
            fi
            ;;
        ref_miss)
            # Generic: cache-references and cache-misses (includes all levels)
            CACHE_REFS=${L2_VAL1:-0}
            CACHE_MISSES=${L2_VAL2:-0}
            PERF_L2_HITS[$bench]=$((CACHE_REFS - CACHE_MISSES))
            PERF_L2_MISSES[$bench]=$CACHE_MISSES
            if [[ $CACHE_REFS -gt 0 ]]; then
                PERF_L2_RATE[$bench]=$(echo "scale=1; (${PERF_L2_HITS[$bench]}) * 100 / $CACHE_REFS" | bc 2>/dev/null || echo "0.0")
            else
                PERF_L2_RATE[$bench]="0.0"
            fi
            echo -e "    ${YELLOW}(Note: Using generic cache counters - L2 accuracy may vary)${NC}"
            ;;
    esac

    echo "    L1: Sim ${SIM_L1_RATE[$bench]}% | HW ${PERF_L1_RATE[$bench]}%"
    echo "    L2: Sim ${SIM_L2_RATE[$bench]}% | HW ${PERF_L2_RATE[$bench]}%"
    echo ""
done

# Print L1 summary table
echo -e "${BLUE}=== L1 Cache Validation ===${NC}"
echo ""
printf "| %-12s | %10s | %10s | %8s |\n" "Benchmark" "Simulator" "Hardware" "Delta"
printf "|--------------|------------|------------|----------|\n"

L1_TOTAL_DELTA=0
L1_COUNT=0
L1_MAX_DELTA=0
L1_ALL_PASS=true

for bench in "${BENCHMARKS[@]}"; do
    SIM="${SIM_L1_RATE[$bench]:-N/A}"
    PERF="${PERF_L1_RATE[$bench]:-N/A}"

    if [[ "$SIM" != "N/A" ]] && [[ "$PERF" != "N/A" ]] && [[ "$PERF" != "0.0" ]]; then
        DELTA=$(echo "scale=1; $SIM - $PERF" | bc 2>/dev/null)
        DELTA_ABS=$(echo "$DELTA" | sed 's/^-//')

        L1_TOTAL_DELTA=$(echo "$L1_TOTAL_DELTA + $DELTA_ABS" | bc)
        L1_COUNT=$((L1_COUNT + 1))

        if (( $(echo "$DELTA_ABS > $L1_MAX_DELTA" | bc -l) )); then
            L1_MAX_DELTA=$DELTA_ABS
        fi

        if (( $(echo "$DELTA_ABS > 5" | bc -l) )); then
            L1_ALL_PASS=false
            printf "| %-12s | %9s%% | %9s%% | ${RED}%+7s%%${NC} |\n" "$bench" "$SIM" "$PERF" "$DELTA"
        else
            printf "| %-12s | %9s%% | %9s%% | ${GREEN}%+7s%%${NC} |\n" "$bench" "$SIM" "$PERF" "$DELTA"
        fi
    else
        printf "| %-12s | %9s%% | %9s%% | %8s |\n" "$bench" "$SIM" "$PERF" "N/A"
    fi
done

echo ""
if [[ $L1_COUNT -gt 0 ]]; then
    L1_AVG_DELTA=$(echo "scale=1; $L1_TOTAL_DELTA / $L1_COUNT" | bc)
    echo "L1 Average delta: ±${L1_AVG_DELTA}%"
    echo "L1 Max delta: ${L1_MAX_DELTA}%"
fi

# Print L2 summary table
echo ""
echo -e "${BLUE}=== L2 Cache Validation ===${NC}"
echo ""
printf "| %-12s | %10s | %10s | %8s |\n" "Benchmark" "Simulator" "Hardware" "Delta"
printf "|--------------|------------|------------|----------|\n"

L2_TOTAL_DELTA=0
L2_COUNT=0
L2_MAX_DELTA=0
L2_ALL_PASS=true

for bench in "${BENCHMARKS[@]}"; do
    SIM="${SIM_L2_RATE[$bench]:-N/A}"
    PERF="${PERF_L2_RATE[$bench]:-N/A}"

    if [[ "$SIM" != "N/A" ]] && [[ "$PERF" != "N/A" ]] && [[ "$PERF" != "0.0" ]]; then
        DELTA=$(echo "scale=1; $SIM - $PERF" | bc 2>/dev/null)
        DELTA_ABS=$(echo "$DELTA" | sed 's/^-//')

        L2_TOTAL_DELTA=$(echo "$L2_TOTAL_DELTA + $DELTA_ABS" | bc)
        L2_COUNT=$((L2_COUNT + 1))

        if (( $(echo "$DELTA_ABS > $L2_MAX_DELTA" | bc -l) )); then
            L2_MAX_DELTA=$DELTA_ABS
        fi

        if (( $(echo "$DELTA_ABS > 10" | bc -l) )); then
            L2_ALL_PASS=false
            printf "| %-12s | %9s%% | %9s%% | ${RED}%+7s%%${NC} |\n" "$bench" "$SIM" "$PERF" "$DELTA"
        else
            printf "| %-12s | %9s%% | %9s%% | ${GREEN}%+7s%%${NC} |\n" "$bench" "$SIM" "$PERF" "$DELTA"
        fi
    else
        printf "| %-12s | %9s%% | %9s%% | %8s |\n" "$bench" "$SIM" "$PERF" "N/A"
    fi
done

echo ""
if [[ $L2_COUNT -gt 0 ]]; then
    L2_AVG_DELTA=$(echo "scale=1; $L2_TOTAL_DELTA / $L2_COUNT" | bc)
    echo "L2 Average delta: ±${L2_AVG_DELTA}%"
    echo "L2 Max delta: ${L2_MAX_DELTA}%"
fi

echo ""

# Overall status
if $L1_ALL_PASS && $L2_ALL_PASS; then
    echo -e "${GREEN}Status: PASS (L1 within 5%, L2 within 10%)${NC}"
else
    echo -e "${RED}Status: FAIL (some benchmarks exceed threshold)${NC}"
fi

# Update baseline if requested
if $UPDATE_BASELINE; then
    echo ""
    echo -e "${YELLOW}Updating baseline...${NC}"

    MACHINE_ID=$(echo "$CPU_MODEL" | tr ' ' '-' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]//g' | head -c 40)
    BASELINE_FILE="$BASELINES_DIR/$MACHINE_ID.json"

    mkdir -p "$BASELINES_DIR"

    cat > "$BASELINE_FILE" << EOF
{
  "hardware": "$CPU_MODEL",
  "vendor": "$CPU_VENDOR",
  "architecture": "$ARCH",
  "kernel": "$KERNEL_VERSION",
  "simulator_config": "$SIM_CONFIG",
  "l2_counter_mode": "$L2_MODE",
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
      "l1": {
        "simulator_hit_rate": ${SIM_L1_RATE[$bench]:-0},
        "hardware_hit_rate": ${PERF_L1_RATE[$bench]:-0},
        "simulator_hits": ${SIM_L1_HITS[$bench]:-0},
        "simulator_misses": ${SIM_L1_MISSES[$bench]:-0},
        "hardware_loads": ${PERF_L1_LOADS[$bench]:-0},
        "hardware_misses": ${PERF_L1_MISSES[$bench]:-0}
      },
      "l2": {
        "simulator_hit_rate": ${SIM_L2_RATE[$bench]:-0},
        "hardware_hit_rate": ${PERF_L2_RATE[$bench]:-0},
        "simulator_hits": ${SIM_L2_HITS[$bench]:-0},
        "simulator_misses": ${SIM_L2_MISSES[$bench]:-0},
        "hardware_hits": ${PERF_L2_HITS[$bench]:-0},
        "hardware_misses": ${PERF_L2_MISSES[$bench]:-0}
      }
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
