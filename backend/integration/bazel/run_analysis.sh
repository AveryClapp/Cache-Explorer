#!/bin/bash
# run_analysis.sh - Run cache analysis and display results
#
# Usage: run_analysis.sh <profiled_binary>

set -e

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <profiled_binary>" >&2
    exit 1
fi

BINARY="$1"
shift

# Run the analysis
"$BINARY" "$@"
