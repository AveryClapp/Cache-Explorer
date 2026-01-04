#!/bin/bash
# check_hit_rate.sh - Run cache analysis and verify hit rate
#
# Usage: check_hit_rate.sh <profiled_binary> <min_hit_rate>
#
# Example: check_hit_rate.sh ./my_binary 0.90
#   Fails if L1 hit rate is below 90%

set -e

if [[ $# -lt 2 ]]; then
    echo "Usage: $0 <profiled_binary> <min_hit_rate>" >&2
    exit 1
fi

BINARY="$1"
MIN_HIT_RATE="$2"

# Run the profiled binary and capture JSON output
OUTPUT=$("$BINARY" 2>&1)

# Extract L1 hit rate using Python (more portable than jq)
HIT_RATE=$(echo "$OUTPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    levels = data.get('levels', {})
    l1 = levels.get('l1d', levels.get('l1', {}))
    print(l1.get('hitRate', 0))
except:
    print(0)
")

# Compare hit rates
RESULT=$(python3 -c "
min_rate = $MIN_HIT_RATE
actual_rate = $HIT_RATE
if actual_rate >= min_rate:
    print('PASS')
else:
    print('FAIL')
")

echo "L1 Hit Rate: $HIT_RATE (minimum required: $MIN_HIT_RATE)"

if [[ "$RESULT" == "FAIL" ]]; then
    echo "ERROR: Hit rate $HIT_RATE is below minimum $MIN_HIT_RATE"
    exit 1
fi

echo "Cache performance check passed!"
exit 0
