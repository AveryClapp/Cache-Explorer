#!/bin/bash
# Integration tests for segment caching
# Uses synthetic traces so tests don't require LLVM pass or runtime to be built.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CACHE_SIM="$PROJECT_ROOT/backend/cache-simulator/build/cache-sim"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

PASSED=0
FAILED=0

echo "=========================================="
echo "  Segment Caching Integration Tests"
echo "=========================================="

pass() { echo -e "${GREEN}PASS${NC}${1:+ ($1)}"; PASSED=$((PASSED + 1)); }
fail() { echo -e "${RED}FAIL${NC} — $1"; FAILED=$((FAILED + 1)); }

# Generate a trace of N sequential writes to unique addresses (no pattern repetition)
gen_sequential_trace() {
    local count="$1"
    local base=0x2000
    for i in $(seq 0 $((count - 1))); do
        printf "S 0x%x 4 test.c:1 T0\n" $((base + i * 4))
    done
}

# Generate a repeated pattern: 'reps' repetitions of 'seg_size' loads to the same addresses.
# After the first two segments warm up the segment cache, subsequent reps are cache hits.
gen_repeated_trace() {
    local reps="$1"
    local seg_size="$2"
    for k in $(seq 1 "$reps"); do
        for j in $(seq 0 $((seg_size - 1))); do
            printf "L 0x%x 4 test.c:1 T0\n" $((0x1000 + j * 4))
        done
    done
}

# Test 1: --cache-segments produces the same hit count as normal mode (sequential, no reps)
echo -n "Test 1: Correctness (sequential, no cache hits)... "
TRACE=$(gen_sequential_trace 100)
UNCACHED=$(echo "$TRACE" | "$CACHE_SIM" --json 2>/dev/null)
CACHED=$(echo "$TRACE" | "$CACHE_SIM" --json --cache-segments 2>/dev/null)
U_HITS=$(echo "$UNCACHED" | jq '.levels.l1d.hits')
C_HITS=$(echo "$CACHED"   | jq '.levels.l1d.hits')
U_MISS=$(echo "$UNCACHED" | jq '.levels.l1d.misses')
C_MISS=$(echo "$CACHED"   | jq '.levels.l1d.misses')
if [ "$U_HITS" = "$C_HITS" ] && [ "$U_MISS" = "$C_MISS" ]; then
    pass
else
    fail "uncached hits=$U_HITS misses=$U_MISS, cached hits=$C_HITS misses=$C_MISS"
fi

# Test 2: Segment size flag is accepted and produces consistent results
echo -n "Test 2: Segment size flag (--segment-size)... "
TRACE=$(gen_sequential_trace 60)
R1=$(echo "$TRACE" | "$CACHE_SIM" --json --cache-segments --segment-size 10 2>/dev/null)
R2=$(echo "$TRACE" | "$CACHE_SIM" --json --cache-segments --segment-size 30 2>/dev/null)
H1=$(echo "$R1" | jq '.levels.l1d.hits')
H2=$(echo "$R2" | jq '.levels.l1d.hits')
M1=$(echo "$R1" | jq '.levels.l1d.misses')
M2=$(echo "$R2" | jq '.levels.l1d.misses')
if [ "$H1" = "$H2" ] && [ "$M1" = "$M2" ]; then
    pass
else
    fail "segment-size 10: hits=$H1 misses=$M1, segment-size 30: hits=$H2 misses=$M2"
fi

# Test 3: --cache-segments works alongside --json (flag compatibility)
echo -n "Test 3: Flag compatibility (--cache-segments --json)... "
TRACE=$(gen_sequential_trace 20)
OUTPUT=$(echo "$TRACE" | "$CACHE_SIM" --json --cache-segments 2>/dev/null)
EVENTS=$(echo "$OUTPUT" | jq '.events' 2>/dev/null)
if [ -n "$EVENTS" ] && [ "$EVENTS" != "null" ] && [ "$EVENTS" -gt 0 ] 2>/dev/null; then
    pass
else
    fail "expected events > 0 in JSON output, got '$EVENTS'"
fi

# Test 4: --cache-segments with --config flag works
echo -n "Test 4: Flag compatibility (--cache-segments --config amd)... "
TRACE=$(gen_sequential_trace 20)
OUTPUT=$(echo "$TRACE" | "$CACHE_SIM" --json --cache-segments --config amd 2>/dev/null)
EVENTS=$(echo "$OUTPUT" | jq '.events' 2>/dev/null)
if [ -n "$EVENTS" ] && [ "$EVENTS" != "null" ] && [ "$EVENTS" -gt 0 ] 2>/dev/null; then
    pass
else
    fail "expected events > 0 with --config amd, got '$EVENTS'"
fi

# Test 5: Cache actually gets hits when the same access pattern repeats
# 50 repetitions of the same 10 addresses → segments 2–49 are cache hits (48 total)
echo -n "Test 5: Cache gets hits on repeated pattern... "
TRACE=$(gen_repeated_trace 50 10)
VERBOSE_OUT=$(echo "$TRACE" | "$CACHE_SIM" --cache-segments --segment-size 10 --verbose 2>&1 >/dev/null)
HITS=$(echo "$VERBOSE_OUT" | grep -oE 'Hits: [0-9]+' | grep -oE '[0-9]+' | head -1)
if [ -n "$HITS" ] && [ "$HITS" -gt 0 ] 2>/dev/null; then
    pass "hits=$HITS"
else
    fail "expected segment cache hits > 0, got '${HITS}'"
fi

# Test 6: Correctness when the segment cache actually serves hits
# Stats must be identical with and without --cache-segments on a repeated pattern
echo -n "Test 6: Correctness when cache hits occur... "
TRACE=$(gen_repeated_trace 50 10)
UNCACHED=$(echo "$TRACE" | "$CACHE_SIM" --json 2>/dev/null)
CACHED=$(echo "$TRACE"   | "$CACHE_SIM" --json --cache-segments --segment-size 10 2>/dev/null)
U_HITS=$(echo "$UNCACHED" | jq '.levels.l1d.hits')
C_HITS=$(echo "$CACHED"   | jq '.levels.l1d.hits')
U_MISS=$(echo "$UNCACHED" | jq '.levels.l1d.misses')
C_MISS=$(echo "$CACHED"   | jq '.levels.l1d.misses')
if [ "$U_HITS" = "$C_HITS" ] && [ "$U_MISS" = "$C_MISS" ]; then
    pass
else
    fail "uncached: hits=$U_HITS misses=$U_MISS, cached: hits=$C_HITS misses=$C_MISS"
fi

# ── Edge cases ────────────────────────────────────────────────────────────────

# Test 7: L2 and L3 stats match (not just L1d)
# The repeated pattern warms L1 after the first rep; L2/L3 only see the cold-start misses.
echo -n "Test 7: L2 and L3 stats match with cache hits... "
TRACE=$(gen_repeated_trace 50 10)
UNCACHED=$(echo "$TRACE" | "$CACHE_SIM" --json 2>/dev/null)
CACHED=$(echo "$TRACE"   | "$CACHE_SIM" --json --cache-segments --segment-size 10 2>/dev/null)
ok=1
for level in l2 l3; do
    for stat in hits misses; do
        U=$(echo "$UNCACHED" | jq ".levels.${level}.${stat}")
        C=$(echo "$CACHED"   | jq ".levels.${level}.${stat}")
        if [ "$U" != "$C" ]; then
            fail "${level}.${stat}: uncached=$U cached=$C"; ok=0; break 2
        fi
    done
done
[ "$ok" = 1 ] && pass

# Test 8: Partial tail — trace length not divisible by segment_size
# The leftover events (< segment_size) must be simulated normally, not lost.
echo -n "Test 8: Partial tail simulated correctly... "
TRACE=$(
    gen_repeated_trace 5 10   # 50 events
    for j in $(seq 0 4); do   # 5 more unique events (tail)
        printf "L 0x%x 4 tail.c:1 T0\n" $((0x5000 + j * 4))
    done
)
UNCACHED=$(echo "$TRACE" | "$CACHE_SIM" --json 2>/dev/null)
CACHED=$(echo "$TRACE"   | "$CACHE_SIM" --json --cache-segments --segment-size 10 2>/dev/null)
U_HITS=$(echo "$UNCACHED" | jq '.levels.l1d.hits')
C_HITS=$(echo "$CACHED"   | jq '.levels.l1d.hits')
U_MISS=$(echo "$UNCACHED" | jq '.levels.l1d.misses')
C_MISS=$(echo "$CACHED"   | jq '.levels.l1d.misses')
U_EV=$(echo "$UNCACHED" | jq '.events')
C_EV=$(echo "$CACHED"   | jq '.events')
if [ "$U_HITS" = "$C_HITS" ] && [ "$U_MISS" = "$C_MISS" ] && [ "$U_EV" = "$C_EV" ]; then
    pass
else
    fail "uncached hits=$U_HITS miss=$U_MISS ev=$U_EV, cached hits=$C_HITS miss=$C_MISS ev=$C_EV"
fi

# Test 9: Segment size = 1 — every event is its own segment
# 50 loads to the same address; from event 2 onwards every event is a cache hit.
echo -n "Test 9: Segment size 1 (extreme)... "
TRACE=$(for i in $(seq 1 50); do echo "L 0x1000 4 test.c:1 T0"; done)
UNCACHED=$(echo "$TRACE" | "$CACHE_SIM" --json 2>/dev/null)
CACHED=$(echo "$TRACE"   | "$CACHE_SIM" --json --cache-segments --segment-size 1 2>/dev/null)
U_HITS=$(echo "$UNCACHED" | jq '.levels.l1d.hits')
C_HITS=$(echo "$CACHED"   | jq '.levels.l1d.hits')
U_MISS=$(echo "$UNCACHED" | jq '.levels.l1d.misses')
C_MISS=$(echo "$CACHED"   | jq '.levels.l1d.misses')
if [ "$U_HITS" = "$C_HITS" ] && [ "$U_MISS" = "$C_MISS" ]; then
    pass
else
    fail "uncached hits=$U_HITS miss=$U_MISS, cached hits=$C_HITS miss=$C_MISS"
fi

# Test 10: Segment size larger than the entire trace — no cache entries ever stored
echo -n "Test 10: Segment size > trace length (no caching possible)... "
TRACE=$(gen_sequential_trace 5)
UNCACHED=$(echo "$TRACE" | "$CACHE_SIM" --json 2>/dev/null)
CACHED=$(echo "$TRACE"   | "$CACHE_SIM" --json --cache-segments --segment-size 1000 2>/dev/null)
U_HITS=$(echo "$UNCACHED" | jq '.levels.l1d.hits')
C_HITS=$(echo "$CACHED"   | jq '.levels.l1d.hits')
U_MISS=$(echo "$UNCACHED" | jq '.levels.l1d.misses')
C_MISS=$(echo "$CACHED"   | jq '.levels.l1d.misses')
if [ "$U_HITS" = "$C_HITS" ] && [ "$U_MISS" = "$C_MISS" ]; then
    pass
else
    fail "uncached hits=$U_HITS miss=$U_MISS, cached hits=$C_HITS miss=$C_MISS"
fi

# Test 11: 3 repetitions → 0 cache hits (2-segment history means warmup takes 3 segments)
echo -n "Test 11: 3 reps → 0 cache hits (2-seg history warmup)... "
TRACE=$(gen_repeated_trace 3 10)
VERBOSE=$(echo "$TRACE" | "$CACHE_SIM" --cache-segments --segment-size 10 --verbose 2>&1 >/dev/null)
HITS=$(echo "$VERBOSE" | grep -oE 'Hits: [0-9]+' | grep -oE '[0-9]+' | head -1)
if [ "$HITS" = "0" ]; then
    pass
else
    fail "expected 0 hits, got '$HITS'"
fi

# Test 12: Exactly 4 repetitions → exactly 1 cache hit (first hit after 3-segment warmup)
echo -n "Test 12: Exactly 4 reps → exactly 1 cache hit... "
TRACE=$(gen_repeated_trace 4 10)
VERBOSE=$(echo "$TRACE" | "$CACHE_SIM" --cache-segments --segment-size 10 --verbose 2>&1 >/dev/null)
HITS=$(echo "$VERBOSE" | grep -oE 'Hits: [0-9]+' | grep -oE '[0-9]+' | head -1)
if [ "$HITS" = "1" ]; then
    pass
else
    fail "expected 1 hit, got '$HITS'"
fi

# Test 13: Stats correct when exactly 1 cache hit occurs (4 reps)
echo -n "Test 13: Correctness with exactly 1 cache hit... "
TRACE=$(gen_repeated_trace 4 10)
UNCACHED=$(echo "$TRACE" | "$CACHE_SIM" --json 2>/dev/null)
CACHED=$(echo "$TRACE"   | "$CACHE_SIM" --json --cache-segments --segment-size 10 2>/dev/null)
U_HITS=$(echo "$UNCACHED" | jq '.levels.l1d.hits')
C_HITS=$(echo "$CACHED"   | jq '.levels.l1d.hits')
U_MISS=$(echo "$UNCACHED" | jq '.levels.l1d.misses')
C_MISS=$(echo "$CACHED"   | jq '.levels.l1d.misses')
if [ "$U_HITS" = "$C_HITS" ] && [ "$U_MISS" = "$C_MISS" ]; then
    pass
else
    fail "uncached hits=$U_HITS miss=$U_MISS, cached hits=$C_HITS miss=$C_MISS"
fi

# Test 14: Two different alternating patterns (ABABAB...) — both get independently cached
# Pattern A: addresses 0x1000-0x1024, Pattern B: addresses 0x4000-0x4024
# After 3 reps of each, both patterns should hit the segment cache.
echo -n "Test 14: Two alternating patterns both cached correctly... "
TRACE=$(
    for k in $(seq 1 10); do
        for j in $(seq 0 9); do printf "L 0x%x 4 a.c:1 T0\n" $((0x1000 + j * 4)); done
        for j in $(seq 0 9); do printf "L 0x%x 4 b.c:1 T0\n" $((0x4000 + j * 4)); done
    done
)
UNCACHED=$(echo "$TRACE" | "$CACHE_SIM" --json 2>/dev/null)
CACHED=$(echo "$TRACE"   | "$CACHE_SIM" --json --cache-segments --segment-size 10 2>/dev/null)
U_HITS=$(echo "$UNCACHED" | jq '.levels.l1d.hits')
C_HITS=$(echo "$CACHED"   | jq '.levels.l1d.hits')
U_MISS=$(echo "$UNCACHED" | jq '.levels.l1d.misses')
C_MISS=$(echo "$CACHED"   | jq '.levels.l1d.misses')
VERBOSE=$(echo "$TRACE" | "$CACHE_SIM" --cache-segments --segment-size 10 --verbose 2>&1 >/dev/null)
SC_HITS=$(echo "$VERBOSE" | grep -oE 'Hits: [0-9]+' | grep -oE '[0-9]+' | head -1)
if [ "$U_HITS" = "$C_HITS" ] && [ "$U_MISS" = "$C_MISS" ] && [ "${SC_HITS:-0}" -gt 0 ] 2>/dev/null; then
    pass "seg_cache_hits=$SC_HITS"
else
    fail "uncached hits=$U_HITS miss=$U_MISS, cached hits=$C_HITS miss=$C_MISS, seg_hits=$SC_HITS"
fi

# Test 15: TLB stats match with and without --cache-segments
# All 50 reps access the same page; only 1 DTLB miss expected in both cases.
echo -n "Test 15: TLB stats correct when cache hits occur... "
TRACE=$(gen_repeated_trace 50 10)
UNCACHED=$(echo "$TRACE" | "$CACHE_SIM" --json 2>/dev/null)
CACHED=$(echo "$TRACE"   | "$CACHE_SIM" --json --cache-segments --segment-size 10 2>/dev/null)
U_TH=$(echo "$UNCACHED" | jq '.tlb.dtlb.hits')
C_TH=$(echo "$CACHED"   | jq '.tlb.dtlb.hits')
U_TM=$(echo "$UNCACHED" | jq '.tlb.dtlb.misses')
C_TM=$(echo "$CACHED"   | jq '.tlb.dtlb.misses')
if [ "$U_TH" = "$C_TH" ] && [ "$U_TM" = "$C_TM" ]; then
    pass
else
    fail "uncached dtlb hits=$U_TH misses=$U_TM, cached dtlb hits=$C_TH misses=$C_TM"
fi

# Test 16: Write-heavy repeated pattern — stores must accumulate correctly too
echo -n "Test 16: Write-heavy repeated pattern (stores)... "
TRACE=$(
    for k in $(seq 1 50); do
        for j in $(seq 0 9); do printf "S 0x%x 4 test.c:1 T0\n" $((0x3000 + j * 4)); done
    done
)
UNCACHED=$(echo "$TRACE" | "$CACHE_SIM" --json 2>/dev/null)
CACHED=$(echo "$TRACE"   | "$CACHE_SIM" --json --cache-segments --segment-size 10 2>/dev/null)
U_HITS=$(echo "$UNCACHED" | jq '.levels.l1d.hits')
C_HITS=$(echo "$CACHED"   | jq '.levels.l1d.hits')
U_MISS=$(echo "$UNCACHED" | jq '.levels.l1d.misses')
C_MISS=$(echo "$CACHED"   | jq '.levels.l1d.misses')
if [ "$U_HITS" = "$C_HITS" ] && [ "$U_MISS" = "$C_MISS" ]; then
    pass
else
    fail "uncached hits=$U_HITS miss=$U_MISS, cached hits=$C_HITS miss=$C_MISS"
fi

echo ""
echo "Passed: $PASSED"
echo "Failed: $FAILED"
[ $FAILED -eq 0 ] && echo -e "${GREEN}All tests passed!${NC}" && exit 0
echo -e "${RED}Some tests failed${NC}" && exit 1
