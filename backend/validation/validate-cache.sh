#!/bin/bash
# Cache Explorer Validation Script
# Compares simulated cache behavior against hardware performance counters (perf)
#
# Usage: validate-cache.sh <source.c> [options]
# Requires: Linux with perf access (perf_event_paranoid <= 1 or CAP_SYS_ADMIN)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
CACHE_EXPLORE="$BACKEND_DIR/scripts/cache-explore"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

usage() {
  echo "Usage: validate-cache.sh <source.c> [options]"
  echo ""
  echo "Compare Cache Explorer simulation against hardware perf counters."
  echo ""
  echo "Options:"
  echo "  --config <name>   Cache config for simulation (default: intel)"
  echo "  -O<level>         Optimization level (default: -O0)"
  echo "  --runs <n>        Number of perf runs for averaging (default: 3)"
  echo "  --help            Show this help"
  echo ""
  echo "Requirements:"
  echo "  - Linux with perf tools installed"
  echo "  - perf_event_paranoid <= 1 (or run as root)"
  echo ""
  echo "Example:"
  echo "  validate-cache.sh examples/sequential.c --config intel -O2"
}

# Check for perf
check_perf() {
  if ! command -v perf &> /dev/null; then
    echo -e "${RED}Error: perf not found${NC}"
    echo "Install with: apt-get install linux-tools-common linux-tools-\$(uname -r)"
    exit 1
  fi

  # Check if we can access perf events
  if [[ $(cat /proc/sys/kernel/perf_event_paranoid 2>/dev/null || echo 3) -gt 1 ]]; then
    echo -e "${YELLOW}Warning: perf_event_paranoid > 1, may need root access${NC}"
  fi
}

# Parse perf stat output and extract cache events
parse_perf_output() {
  local perf_output="$1"

  # Extract L1 data cache metrics
  L1D_LOADS=$(echo "$perf_output" | grep -E "L1-dcache-loads\b" | awk '{print $1}' | tr -d ',')
  L1D_LOAD_MISSES=$(echo "$perf_output" | grep -E "L1-dcache-load-misses" | awk '{print $1}' | tr -d ',')
  L1D_STORES=$(echo "$perf_output" | grep -E "L1-dcache-stores\b" | awk '{print $1}' | tr -d ',')

  # Extract LLC (Last Level Cache = L3) metrics
  LLC_LOADS=$(echo "$perf_output" | grep -E "LLC-loads\b" | awk '{print $1}' | tr -d ',')
  LLC_LOAD_MISSES=$(echo "$perf_output" | grep -E "LLC-load-misses" | awk '{print $1}' | tr -d ',')

  # Extract instruction cache if available
  L1I_LOADS=$(echo "$perf_output" | grep -E "L1-icache-loads\b" | awk '{print $1}' | tr -d ',')
  L1I_LOAD_MISSES=$(echo "$perf_output" | grep -E "L1-icache-load-misses" | awk '{print $1}' | tr -d ',')
}

# Calculate percentage difference
calc_diff() {
  local sim="$1"
  local hw="$2"

  if [[ -z "$hw" || "$hw" == "0" ]]; then
    echo "N/A"
    return
  fi

  # Use bc for floating point math
  local diff=$(echo "scale=1; (($sim - $hw) / $hw) * 100" | bc 2>/dev/null || echo "N/A")
  echo "$diff%"
}

# Main validation
INPUT_FILE=""
CONFIG="intel"
OPT_LEVEL="-O0"
NUM_RUNS=3

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) CONFIG="$2"; shift 2 ;;
    -O*) OPT_LEVEL="$1"; shift ;;
    --runs) NUM_RUNS="$2"; shift 2 ;;
    --help) usage; exit 0 ;;
    -*) echo "Unknown option: $1"; usage; exit 1 ;;
    *) INPUT_FILE="$1"; shift ;;
  esac
done

if [[ -z "$INPUT_FILE" ]]; then
  echo "Error: No input file specified"
  usage
  exit 1
fi

if [[ ! -f "$INPUT_FILE" ]]; then
  echo "Error: File not found: $INPUT_FILE"
  exit 1
fi

# Check platform
if [[ "$(uname -s)" != "Linux" ]]; then
  echo -e "${RED}Error: This validation script requires Linux with perf${NC}"
  echo "On macOS, use Instruments for hardware profiling."
  exit 1
fi

check_perf

echo "=== Cache Explorer Validation ==="
echo "Input: $INPUT_FILE"
echo "Config: $CONFIG"
echo "Optimization: $OPT_LEVEL"
echo ""

# Step 1: Run Cache Explorer simulation
echo "[1/3] Running Cache Explorer simulation..."
SIM_OUTPUT=$("$CACHE_EXPLORE" "$INPUT_FILE" --config "$CONFIG" "$OPT_LEVEL" --json 2>/dev/null)

if [[ -z "$SIM_OUTPUT" ]]; then
  echo -e "${RED}Error: Cache Explorer failed${NC}"
  exit 1
fi

# Parse simulation results
SIM_L1D_HITS=$(echo "$SIM_OUTPUT" | jq -r '.levels.l1d.hits // .levels.l1.hits')
SIM_L1D_MISSES=$(echo "$SIM_OUTPUT" | jq -r '.levels.l1d.misses // .levels.l1.misses')
SIM_L1I_HITS=$(echo "$SIM_OUTPUT" | jq -r '.levels.l1i.hits // 0')
SIM_L1I_MISSES=$(echo "$SIM_OUTPUT" | jq -r '.levels.l1i.misses // 0')
SIM_L2_HITS=$(echo "$SIM_OUTPUT" | jq -r '.levels.l2.hits')
SIM_L2_MISSES=$(echo "$SIM_OUTPUT" | jq -r '.levels.l2.misses')
SIM_L3_HITS=$(echo "$SIM_OUTPUT" | jq -r '.levels.l3.hits')
SIM_L3_MISSES=$(echo "$SIM_OUTPUT" | jq -r '.levels.l3.misses')

echo "  Simulation L1d: $SIM_L1D_HITS hits, $SIM_L1D_MISSES misses"
echo "  Simulation L1i: $SIM_L1I_HITS hits, $SIM_L1I_MISSES misses"
echo ""

# Step 2: Compile without instrumentation for perf
echo "[2/3] Compiling for hardware profiling..."
TEMP_BINARY="/tmp/cache-validate-$$"
clang "$OPT_LEVEL" -g "$INPUT_FILE" -o "$TEMP_BINARY"

# Step 3: Run with perf
echo "[3/3] Running with perf ($NUM_RUNS runs)..."

PERF_EVENTS="L1-dcache-loads,L1-dcache-load-misses,L1-dcache-stores"
PERF_EVENTS+=",LLC-loads,LLC-load-misses"
PERF_EVENTS+=",L1-icache-loads,L1-icache-load-misses"

# Run multiple times and average
TOTAL_L1D_LOADS=0
TOTAL_L1D_MISSES=0
TOTAL_LLC_LOADS=0
TOTAL_LLC_MISSES=0
TOTAL_L1I_LOADS=0
TOTAL_L1I_MISSES=0

for i in $(seq 1 $NUM_RUNS); do
  PERF_OUTPUT=$(perf stat -e "$PERF_EVENTS" "$TEMP_BINARY" 2>&1 >/dev/null)
  parse_perf_output "$PERF_OUTPUT"

  TOTAL_L1D_LOADS=$((TOTAL_L1D_LOADS + ${L1D_LOADS:-0}))
  TOTAL_L1D_MISSES=$((TOTAL_L1D_MISSES + ${L1D_LOAD_MISSES:-0}))
  TOTAL_LLC_LOADS=$((TOTAL_LLC_LOADS + ${LLC_LOADS:-0}))
  TOTAL_LLC_MISSES=$((TOTAL_LLC_MISSES + ${LLC_LOAD_MISSES:-0}))
  TOTAL_L1I_LOADS=$((TOTAL_L1I_LOADS + ${L1I_LOADS:-0}))
  TOTAL_L1I_MISSES=$((TOTAL_L1I_MISSES + ${L1I_LOAD_MISSES:-0}))
done

# Calculate averages
AVG_L1D_LOADS=$((TOTAL_L1D_LOADS / NUM_RUNS))
AVG_L1D_MISSES=$((TOTAL_L1D_MISSES / NUM_RUNS))
AVG_LLC_LOADS=$((TOTAL_LLC_LOADS / NUM_RUNS))
AVG_LLC_MISSES=$((TOTAL_LLC_MISSES / NUM_RUNS))
AVG_L1I_LOADS=$((TOTAL_L1I_LOADS / NUM_RUNS))
AVG_L1I_MISSES=$((TOTAL_L1I_MISSES / NUM_RUNS))

# Cleanup
rm -f "$TEMP_BINARY"

echo ""
echo "=== Comparison Results ==="
echo ""
printf "%-20s %15s %15s %12s\n" "Metric" "Simulation" "Hardware" "Diff"
printf "%-20s %15s %15s %12s\n" "------" "----------" "--------" "----"

# L1 Data Cache
SIM_L1D_TOTAL=$((SIM_L1D_HITS + SIM_L1D_MISSES))
printf "%-20s %15s %15s %12s\n" "L1d Accesses" "$SIM_L1D_TOTAL" "$AVG_L1D_LOADS" "$(calc_diff $SIM_L1D_TOTAL $AVG_L1D_LOADS)"
printf "%-20s %15s %15s %12s\n" "L1d Misses" "$SIM_L1D_MISSES" "$AVG_L1D_MISSES" "$(calc_diff $SIM_L1D_MISSES $AVG_L1D_MISSES)"

# L1 Instruction Cache
SIM_L1I_TOTAL=$((SIM_L1I_HITS + SIM_L1I_MISSES))
if [[ "$AVG_L1I_LOADS" != "0" ]]; then
  printf "%-20s %15s %15s %12s\n" "L1i Accesses" "$SIM_L1I_TOTAL" "$AVG_L1I_LOADS" "$(calc_diff $SIM_L1I_TOTAL $AVG_L1I_LOADS)"
  printf "%-20s %15s %15s %12s\n" "L1i Misses" "$SIM_L1I_MISSES" "$AVG_L1I_MISSES" "$(calc_diff $SIM_L1I_MISSES $AVG_L1I_MISSES)"
fi

# LLC (L3)
SIM_L3_TOTAL=$((SIM_L3_HITS + SIM_L3_MISSES))
if [[ "$AVG_LLC_LOADS" != "0" ]]; then
  printf "%-20s %15s %15s %12s\n" "LLC Accesses" "$SIM_L3_TOTAL" "$AVG_LLC_LOADS" "$(calc_diff $SIM_L3_TOTAL $AVG_LLC_LOADS)"
  printf "%-20s %15s %15s %12s\n" "LLC Misses" "$SIM_L3_MISSES" "$AVG_LLC_MISSES" "$(calc_diff $SIM_L3_MISSES $AVG_LLC_MISSES)"
fi

echo ""
echo "Note: Hardware counters may include OS/runtime overhead not captured by simulation."
echo "Large differences (>50%) warrant investigation; small differences (<20%) are expected."
