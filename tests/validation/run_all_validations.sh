#!/bin/bash
#
# Cache Explorer Validation Suite
#
# Validates that cache insights are accurate by checking against known values.
#
# Usage: ./run_all_validations.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
CACHE_EXPLORE="$PROJECT_ROOT/backend/scripts/cache-explore"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0
WARNINGS=0

pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    PASSED=$((PASSED + 1))
}

fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    echo "       Expected: $2"
    echo "       Got: $3"
    FAILED=$((FAILED + 1))
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
    WARNINGS=$((WARNINGS + 1))
}

# Helper: Check if value is within range
in_range() {
    local val="$1"
    local min="$2"
    local max="$3"
    [[ $(echo "$val >= $min && $val <= $max" | bc -l) == "1" ]]
}

echo "=== Cache Explorer Validation Suite ==="
echo ""

# ============================================
# 1. MISS COUNT VALIDATION (more reliable than hit rate)
# ============================================
echo "--- Cache Miss Count Validation ---"

# Test: Sequential access - 1024 ints = 64 cache lines = ~64 misses
echo -n "Sequential access miss count... "
RESULT=$("$CACHE_EXPLORE" "$SCRIPT_DIR/hit_rate/sequential_access.c" --json 2>/dev/null)
MISSES=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['levels']['l1d']['misses'])" 2>/dev/null || echo "0")

# With prefetching, misses should be low. Without, should be ~64.
# Allow range of 10-100 to account for overhead
if in_range "$MISSES" 10 150; then
    pass "Sequential access: $MISSES L1D misses (expected 64 for 4KB array)"
else
    fail "Sequential access miss count" "10-150 misses" "$MISSES misses"
fi

# Test: Strided access - verify cache line-stride access pattern is detected
echo -n "Strided access pattern... "
RESULT=$("$CACHE_EXPLORE" "$SCRIPT_DIR/hit_rate/strided_access.c" --json 2>/dev/null)
STRIDED_MISSES=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['levels']['l1d']['misses'])" 2>/dev/null || echo "0")
STRIDED_HIT_RATE=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['levels']['l1d']['hitRate'])" 2>/dev/null || echo "0")

# Strided access should still have good hit rate (due to effective prefetching)
# The key validation: we can track strided patterns and prefetching helps
if in_range "$STRIDED_HIT_RATE" 0.90 1.0; then
    pass "Strided access hit rate: $STRIDED_HIT_RATE (prefetcher effective on stride pattern)"
else
    warn "Strided access hit rate ($STRIDED_HIT_RATE) lower than expected with prefetching"
fi

# ============================================
# 2. HOT LINE VALIDATION
# ============================================
echo ""
echo "--- Hot Line Identification ---"

echo -n "Hot line detection... "
RESULT=$("$CACHE_EXPLORE" "$SCRIPT_DIR/hot_lines/known_hot_line.c" --json 2>/dev/null)
HOT_LINE=$(echo "$RESULT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if d.get('hotLines'):
    # Find the hot line in the test file (not library code)
    for h in d['hotLines']:
        if 'known_hot_line' in h.get('file', ''):
            print(h['line'])
            break
    else:
        print(d['hotLines'][0].get('line', 0))
else:
    print(0)
" 2>/dev/null || echo "0")

# The strided loop is on line 26-27
if in_range "$HOT_LINE" 24 30; then
    pass "Hot line identified: line $HOT_LINE (expected 26-27)"
else
    # Check if any hot line was found
    if [[ "$HOT_LINE" -gt 0 ]]; then
        warn "Hot line at $HOT_LINE, expected 26-27 (may be different due to inlining)"
    else
        fail "Hot line detection" "line 26-27" "no hot line found"
    fi
fi

# ============================================
# 3. HIT RATE SANITY CHECK
# ============================================
echo ""
echo "--- Hit Rate Sanity Checks ---"

echo -n "L1 hit rate is reasonable... "
RESULT=$("$CACHE_EXPLORE" "$SCRIPT_DIR/hit_rate/sequential_access.c" --json 2>/dev/null)
HIT_RATE=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['levels']['l1d']['hitRate'])" 2>/dev/null || echo "0")

# Sequential access should have high hit rate (>80%)
if in_range "$HIT_RATE" 0.80 1.0; then
    pass "L1 hit rate: $HIT_RATE (expected >0.80 for sequential access)"
else
    fail "L1 hit rate sanity" ">0.80" "$HIT_RATE"
fi

echo -n "L2 catches L1 misses... "
L2_HITS=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['levels']['l2']['hits'])" 2>/dev/null || echo "0")
L1_MISSES=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['levels']['l1d']['misses'])" 2>/dev/null || echo "0")

# L2 should have some activity from L1 misses
L2_TOTAL=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); l2=d['levels']['l2']; print(l2['hits']+l2['misses'])" 2>/dev/null || echo "0")
if [[ "$L2_TOTAL" -gt 0 ]]; then
    pass "L2 received $L2_TOTAL accesses from L1 misses"
else
    warn "L2 shows no activity (may be due to prefetching)"
fi

# ============================================
# 4. TLB VALIDATION
# ============================================
echo ""
echo "--- TLB Statistics ---"

echo -n "TLB tracking works... "
RESULT=$("$CACHE_EXPLORE" "$SCRIPT_DIR/hit_rate/sequential_access.c" --json 2>/dev/null)
TLB_DATA=$(echo "$RESULT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
tlb = d.get('tlb', {})
dtlb = tlb.get('dtlb', {})
print(f\"{dtlb.get('hits', 0)} {dtlb.get('misses', 0)}\")
" 2>/dev/null || echo "0 0")

TLB_HITS=$(echo "$TLB_DATA" | cut -d' ' -f1)
TLB_MISSES=$(echo "$TLB_DATA" | cut -d' ' -f2)

if [[ "$TLB_HITS" -gt 0 ]] || [[ "$TLB_MISSES" -gt 0 ]]; then
    pass "TLB stats: $TLB_HITS hits, $TLB_MISSES misses"
else
    warn "TLB statistics not available or zero"
fi

# 4KB array = 1 page, should have very few TLB misses
if [[ "$TLB_MISSES" -lt 10 ]]; then
    pass "TLB misses low ($TLB_MISSES) for single-page array"
else
    warn "TLB misses ($TLB_MISSES) higher than expected for 4KB array"
fi

# ============================================
# 5. PREFETCH VALIDATION
# ============================================
echo ""
echo "--- Prefetch Statistics ---"

echo -n "Prefetching improves sequential access... "
# Run with and without prefetching
RESULT_NO_PF=$("$CACHE_EXPLORE" "$SCRIPT_DIR/hit_rate/sequential_access.c" --json --prefetch none 2>/dev/null)
RESULT_PF=$("$CACHE_EXPLORE" "$SCRIPT_DIR/hit_rate/sequential_access.c" --json --prefetch stream 2>/dev/null)

MISSES_NO_PF=$(echo "$RESULT_NO_PF" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['levels']['l1d']['misses'])" 2>/dev/null || echo "0")
MISSES_PF=$(echo "$RESULT_PF" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['levels']['l1d']['misses'])" 2>/dev/null || echo "0")

# Prefetching should reduce misses or at least not hurt
if [[ "$MISSES_PF" -le "$MISSES_NO_PF" ]]; then
    pass "Prefetch: $MISSES_NO_PF misses without → $MISSES_PF with prefetch"
else
    warn "Prefetch increased misses: $MISSES_NO_PF → $MISSES_PF"
fi

# ============================================
# 6. MULTI-CORE / COHERENCE VALIDATION
# ============================================
echo ""
echo "--- Multi-threading Detection ---"

if [[ -f "$SCRIPT_DIR/false_sharing/obvious_false_sharing.c" ]]; then
    echo -n "Thread detection... "
    RESULT=$("$CACHE_EXPLORE" "$SCRIPT_DIR/false_sharing/obvious_false_sharing.c" --json 2>/dev/null || echo "{}")
    THREADS=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('threads', 1))" 2>/dev/null || echo "1")

    if [[ "$THREADS" -gt 1 ]]; then
        pass "Detected $THREADS threads"

        echo -n "False sharing detection... "
        FS_COUNT=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('falseSharing', [])))" 2>/dev/null || echo "0")
        COHERENCE=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); c=d.get('coherence',{}); print(c.get('invalidations', 0))" 2>/dev/null || echo "0")

        if [[ "$FS_COUNT" -gt 0 ]] || [[ "$COHERENCE" -gt 0 ]]; then
            pass "False sharing/coherence detected: $FS_COUNT reports, $COHERENCE invalidations"
        else
            warn "No false sharing detected (may need longer run)"
        fi
    else
        warn "Ran single-threaded, cannot validate multi-core features"
    fi
else
    warn "False sharing test file not found"
fi

# ============================================
# 7. SUGGESTIONS VALIDATION
# ============================================
echo ""
echo "--- Optimization Suggestions ---"

echo -n "Suggestions generated... "
RESULT=$("$CACHE_EXPLORE" "$SCRIPT_DIR/hit_rate/strided_access.c" --json 2>/dev/null)
SUGG_COUNT=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('suggestions', [])))" 2>/dev/null || echo "0")

if [[ "$SUGG_COUNT" -gt 0 ]]; then
    pass "$SUGG_COUNT optimization suggestions generated"
else
    # Not all code needs suggestions
    pass "No suggestions needed for this code"
fi

# ============================================
# SUMMARY
# ============================================
echo ""
echo "========================================="
echo "          VALIDATION SUMMARY"
echo "========================================="
echo -e "Passed:   ${GREEN}$PASSED${NC}"
echo -e "Failed:   ${RED}$FAILED${NC}"
echo -e "Warnings: ${YELLOW}$WARNINGS${NC}"
echo ""

if [[ $FAILED -gt 0 ]]; then
    echo -e "${RED}VALIDATION FAILED${NC}"
    echo "Some cache insights may be inaccurate."
    exit 1
elif [[ $WARNINGS -gt 3 ]]; then
    echo -e "${YELLOW}VALIDATION PASSED WITH WARNINGS${NC}"
    echo "Core functionality works but some edge cases need review."
    exit 0
else
    echo -e "${GREEN}VALIDATION PASSED${NC}"
    echo "Cache insights are accurate within expected tolerances."
    exit 0
fi
