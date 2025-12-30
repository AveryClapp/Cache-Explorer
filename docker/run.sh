#!/bin/bash
# Cache Explorer Sandbox Entrypoint
# Compiles user code with instrumentation and runs cache simulation

set -e

# Arguments
CODE_FILE="$1"
LANGUAGE="${2:-c}"
CONFIG="${3:-intel}"
OPT_LEVEL="${4:--O0}"
PREFETCH="${5:-none}"
SAMPLE_RATE="${6:-1}"
EVENT_LIMIT="${7:-5000000}"

# Paths
PASS="/opt/cache-explorer/CacheProfiler.so"
RT="/opt/cache-explorer/libcache-explorer-rt.a"
SIM="/opt/cache-explorer/cache-sim"
OUTPUT_BIN="/tmp/instrumented"
TRACE_FILE="/tmp/trace.bin"

# Validate input file exists
if [ ! -f "$CODE_FILE" ]; then
    echo '{"error": "Code file not found", "type": "server_error"}'
    exit 1
fi

# Select compiler based on language
case "$LANGUAGE" in
    c)
        COMPILER="clang"
        ;;
    cpp|c++)
        COMPILER="clang++"
        ;;
    *)
        echo '{"error": "Unsupported language", "type": "validation_error"}'
        exit 1
        ;;
esac

# Compile with instrumentation
echo '{"type": "progress", "stage": "compiling"}' >&2

COMPILE_OUTPUT=$($COMPILER $OPT_LEVEL \
    -fpass-plugin="$PASS" \
    -g \
    "$CODE_FILE" "$RT" \
    -o "$OUTPUT_BIN" \
    -lpthread \
    -lm \
    2>&1) || {
    # Compilation failed - output error as JSON
    ESCAPED=$(echo "$COMPILE_OUTPUT" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr '\n' ' ')
    echo "{\"error\": \"Compilation failed\", \"type\": \"compile_error\", \"raw\": \"$ESCAPED\"}"
    exit 0
}

# Run instrumented binary
echo '{"type": "progress", "stage": "running"}' >&2

export CACHE_EXPLORER_OUTPUT="$TRACE_FILE"
export CACHE_EXPLORER_SAMPLE_RATE="$SAMPLE_RATE"
export CACHE_EXPLORER_EVENT_LIMIT="$EVENT_LIMIT"

# Run with timeout, capture any runtime errors
RUN_OUTPUT=$(timeout 10s "$OUTPUT_BIN" 2>&1) || {
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 124 ]; then
        echo '{"error": "Execution timeout (10s limit)", "type": "timeout"}'
        exit 0
    elif [ $EXIT_CODE -eq 137 ]; then
        echo '{"error": "Out of memory", "type": "runtime_error"}'
        exit 0
    else
        ESCAPED=$(echo "$RUN_OUTPUT" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr '\n' ' ')
        echo "{\"error\": \"Runtime error (exit code $EXIT_CODE)\", \"type\": \"runtime_error\", \"raw\": \"$ESCAPED\"}"
        exit 0
    fi
}

# Check if trace was generated
if [ ! -f "$TRACE_FILE" ]; then
    echo '{"error": "No trace data generated - program may not have executed memory operations", "type": "runtime_error"}'
    exit 0
fi

# Simulate cache behavior
echo '{"type": "progress", "stage": "simulating"}' >&2

$SIM \
    --config "$CONFIG" \
    --prefetch "$PREFETCH" \
    --json \
    --stream \
    "$TRACE_FILE"
