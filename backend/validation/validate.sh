#!/bin/bash
# Validate Cache Explorer against cachegrind
# Usage: ./validate.sh <source.c>

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$BACKEND_DIR")"
CACHE_EXPLORE="$BACKEND_DIR/scripts/cache-explore"

IMAGE_NAME="cache-explorer-validator"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

INPUT_FILE="${1:-}"

if [[ -z "$INPUT_FILE" ]]; then
    echo "Usage: $0 <source.c>"
    echo ""
    echo "Compares Cache Explorer simulation against Valgrind's cachegrind."
    echo "Requires Docker (runs x86_64 Linux container for cachegrind)."
    exit 1
fi

if [[ ! -f "$INPUT_FILE" ]]; then
    echo -e "${RED}Error: File not found: $INPUT_FILE${NC}"
    exit 1
fi

# Get absolute path
INPUT_FILE="$(cd "$(dirname "$INPUT_FILE")" && pwd)/$(basename "$INPUT_FILE")"
INPUT_BASENAME="$(basename "$INPUT_FILE")"

echo -e "${CYAN}=== Cache Explorer Validation ===${NC}"
echo "Input: $INPUT_FILE"
echo ""

# Step 1: Build Docker image if needed
echo -e "${YELLOW}[1/4] Checking Docker image...${NC}"
if ! docker image inspect "$IMAGE_NAME" &>/dev/null; then
    echo "Building validation container (first time only)..."
    docker build --platform linux/amd64 -t "$IMAGE_NAME" "$SCRIPT_DIR"
fi
echo "  Docker image ready"

# Step 2: Run cachegrind in container
echo -e "${YELLOW}[2/4] Running cachegrind (this is slow due to x86 emulation)...${NC}"

# Create temp directory for results
TEMP_DIR=$(mktemp -d)
cp "$INPUT_FILE" "$TEMP_DIR/"

# Run cachegrind in container
# Using educational-like cache config: small caches to see more activity
# L1: 1KB, 2-way, 64-byte lines (16 sets)
# L2: 4KB, 4-way, 64-byte lines (16 sets)
# L3: not simulated by cachegrind (it only does L1 + LL)
CACHEGRIND_OUTPUT=$(docker run --rm --platform linux/amd64 \
    -v "$TEMP_DIR:/validation" \
    "$IMAGE_NAME" \
    sh -c "cd /validation && \
           clang -O0 -g '$INPUT_BASENAME' -o test_binary && \
           valgrind --tool=cachegrind \
                    --I1=1024,2,64 \
                    --D1=1024,2,64 \
                    --LL=4096,4,64 \
                    --cachegrind-out-file=/dev/null \
                    ./test_binary 2>&1" 2>&1)

# Parse cachegrind output
# Format: I   refs:      1,234  (reads + writes for I-cache)
#         D   refs:      5,678  (reads + writes for D-cache)
#         D1  misses:      123
#         LLd misses:       45

CG_I_REFS=$(echo "$CACHEGRIND_OUTPUT" | grep "I   refs:" | awk '{print $NF}' | tr -d ',')
CG_I1_MISSES=$(echo "$CACHEGRIND_OUTPUT" | grep "I1  misses:" | awk '{print $NF}' | tr -d ',')
CG_D_REFS=$(echo "$CACHEGRIND_OUTPUT" | grep "D   refs:" | awk '{print $NF}' | tr -d ',')
CG_D1_MISSES=$(echo "$CACHEGRIND_OUTPUT" | grep "D1  misses:" | awk '{print $NF}' | tr -d ',')
CG_LL_MISSES=$(echo "$CACHEGRIND_OUTPUT" | grep "LLd misses:" | awk '{print $NF}' | tr -d ',')
CG_LLI_MISSES=$(echo "$CACHEGRIND_OUTPUT" | grep "LLi misses:" | awk '{print $NF}' | tr -d ',')

echo "  Cachegrind complete"

# Step 3: Run our cache simulator
echo -e "${YELLOW}[3/4] Running Cache Explorer...${NC}"

# Use educational config to match cachegrind settings
CE_OUTPUT=$("$CACHE_EXPLORE" "$INPUT_FILE" --config educational --json 2>/dev/null)

CE_L1D_HITS=$(echo "$CE_OUTPUT" | grep -o '"l1d":{[^}]*}' | grep -o '"hits":[0-9]*' | cut -d: -f2)
CE_L1D_MISSES=$(echo "$CE_OUTPUT" | grep -o '"l1d":{[^}]*}' | grep -o '"misses":[0-9]*' | cut -d: -f2)
CE_L1I_HITS=$(echo "$CE_OUTPUT" | grep -o '"l1i":{[^}]*}' | grep -o '"hits":[0-9]*' | cut -d: -f2)
CE_L1I_MISSES=$(echo "$CE_OUTPUT" | grep -o '"l1i":{[^}]*}' | grep -o '"misses":[0-9]*' | cut -d: -f2)
CE_L2_HITS=$(echo "$CE_OUTPUT" | grep -o '"l2":{[^}]*}' | grep -o '"hits":[0-9]*' | cut -d: -f2)
CE_L2_MISSES=$(echo "$CE_OUTPUT" | grep -o '"l2":{[^}]*}' | grep -o '"misses":[0-9]*' | cut -d: -f2)

CE_L1D_TOTAL=$((CE_L1D_HITS + CE_L1D_MISSES))
CE_L1I_TOTAL=$((CE_L1I_HITS + CE_L1I_MISSES))

echo "  Cache Explorer complete"

# Cleanup
rm -rf "$TEMP_DIR"

# Step 4: Compare results
echo -e "${YELLOW}[4/4] Comparing results...${NC}"
echo ""

# Calculate differences
calc_diff() {
    local ours="$1"
    local theirs="$2"
    if [[ -z "$theirs" || "$theirs" == "0" ]]; then
        echo "N/A"
        return
    fi
    local diff=$(( (ours - theirs) * 100 / theirs ))
    if [[ $diff -ge 0 ]]; then
        echo "+${diff}%"
    else
        echo "${diff}%"
    fi
}

calc_miss_rate() {
    local misses="$1"
    local total="$2"
    if [[ -z "$total" || "$total" == "0" ]]; then
        echo "N/A"
        return
    fi
    echo "scale=1; $misses * 100 / $total" | bc
}

echo -e "${CYAN}=== Results Comparison ===${NC}"
echo ""
echo "Cache configuration: educational (L1: 1KB 2-way, L2: 4KB 4-way, 64B lines)"
echo ""

printf "%-25s %15s %15s %10s\n" "Metric" "Cache Explorer" "Cachegrind" "Diff"
printf "%-25s %15s %15s %10s\n" "-------------------------" "---------------" "---------------" "----------"

# Data cache
printf "%-25s %15s %15s %10s\n" "D-cache accesses" "$CE_L1D_TOTAL" "$CG_D_REFS" "$(calc_diff $CE_L1D_TOTAL $CG_D_REFS)"
printf "%-25s %15s %15s %10s\n" "D-cache (L1) misses" "$CE_L1D_MISSES" "$CG_D1_MISSES" "$(calc_diff $CE_L1D_MISSES $CG_D1_MISSES)"

CE_D_MISS_RATE=$(calc_miss_rate $CE_L1D_MISSES $CE_L1D_TOTAL)
CG_D_MISS_RATE=$(calc_miss_rate $CG_D1_MISSES $CG_D_REFS)
printf "%-25s %14s%% %14s%%\n" "D-cache miss rate" "$CE_D_MISS_RATE" "$CG_D_MISS_RATE"

echo ""

# Instruction cache
printf "%-25s %15s %15s %10s\n" "I-cache accesses" "$CE_L1I_TOTAL" "$CG_I_REFS" "$(calc_diff $CE_L1I_TOTAL $CG_I_REFS)"
printf "%-25s %15s %15s %10s\n" "I-cache (L1) misses" "$CE_L1I_MISSES" "$CG_I1_MISSES" "$(calc_diff $CE_L1I_MISSES $CG_I1_MISSES)"

CE_I_MISS_RATE=$(calc_miss_rate $CE_L1I_MISSES $CE_L1I_TOTAL)
CG_I_MISS_RATE=$(calc_miss_rate $CG_I1_MISSES $CG_I_REFS)
printf "%-25s %14s%% %14s%%\n" "I-cache miss rate" "$CE_I_MISS_RATE" "$CG_I_MISS_RATE"

echo ""

# L2/LL comparison
printf "%-25s %15s %15s %10s\n" "L2/LL misses (data)" "$CE_L2_MISSES" "$CG_LL_MISSES" "$(calc_diff $CE_L2_MISSES $CG_LL_MISSES)"

echo ""
echo -e "${CYAN}=== Interpretation ===${NC}"
echo ""
echo "Expected differences:"
echo "  - Access counts differ because cachegrind tracks ALL instructions,"
echo "    while we only track user code (no libc/runtime)."
echo "  - Miss rates should be similar for the user code portion."
echo "  - Large miss count differences are expected; focus on RATES."
echo ""

# Evaluate results
D_RATE_DIFF=$(echo "scale=1; $CE_D_MISS_RATE - $CG_D_MISS_RATE" | bc 2>/dev/null || echo "0")
D_RATE_DIFF_ABS=${D_RATE_DIFF#-}  # absolute value

if (( $(echo "$D_RATE_DIFF_ABS < 5" | bc -l 2>/dev/null || echo 0) )); then
    echo -e "${GREEN}D-cache miss rate within 5% - GOOD${NC}"
elif (( $(echo "$D_RATE_DIFF_ABS < 15" | bc -l 2>/dev/null || echo 0) )); then
    echo -e "${YELLOW}D-cache miss rate within 15% - ACCEPTABLE${NC}"
else
    echo -e "${RED}D-cache miss rate differs by >15% - INVESTIGATE${NC}"
fi

echo ""
echo "Raw cachegrind output saved for reference."
echo "$CACHEGRIND_OUTPUT" > /tmp/cachegrind-last-run.txt
echo "See: /tmp/cachegrind-last-run.txt"
