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
FAST_MODE="${8:-0}"

# Paths
PASS="/opt/cache-explorer/CacheProfiler.so"
RT="/opt/cache-explorer/libcache-explorer-rt.a"
SIM="/opt/cache-explorer/cache-sim"
OUTPUT_BIN="/tmp/instrumented"

# Validate input file exists
if [ ! -f "$CODE_FILE" ]; then
    echo '{"error": "Code file not found", "type": "server_error"}'
    exit 1
fi

# Compile with instrumentation
echo '{"type": "progress", "stage": "compiling"}' >&2

# Handle Rust separately - it requires bitcode pipeline
if [ "$LANGUAGE" = "rust" ] || [ "$LANGUAGE" = "rs" ]; then
    # Rust compilation via LLVM bitcode:
    # 1. rustc -> LLVM bitcode
    # 2. opt with our pass -> instrumented bitcode
    # 3. llc -> object file
    # 4. rustc links object file with Rust std libraries

    BITCODE="/tmp/code.bc"
    INSTRUMENTED_BC="/tmp/instrumented.bc"
    INSTRUMENTED_OBJ="/tmp/instrumented.o"
    STUB_RS="/tmp/stub.rs"

    # Map opt level for rustc
    case "$OPT_LEVEL" in
        -O0) RUST_OPT="0" ;;
        -O1) RUST_OPT="1" ;;
        -O2) RUST_OPT="2" ;;
        -O3) RUST_OPT="3" ;;
        *) RUST_OPT="0" ;;
    esac

    # Step 1: Compile Rust to LLVM bitcode
    COMPILE_OUTPUT=$(rustc --edition 2021 \
        -C opt-level=$RUST_OPT \
        -C debuginfo=2 \
        --emit=llvm-bc \
        -o "$BITCODE" \
        "$CODE_FILE" \
        2>&1) || {
        ESCAPED=$(echo "$COMPILE_OUTPUT" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr '\n' ' ')
        echo "{\"error\": \"Rust compilation failed\", \"type\": \"compile_error\", \"raw\": \"$ESCAPED\"}"
        exit 0
    }

    # Step 2: Run opt with our instrumentation pass
    COMPILE_OUTPUT=$(opt -load-pass-plugin="$PASS" \
        -passes="cache-explorer-module" \
        "$BITCODE" \
        -o "$INSTRUMENTED_BC" \
        2>&1) || {
        ESCAPED=$(echo "$COMPILE_OUTPUT" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr '\n' ' ')
        echo "{\"error\": \"Instrumentation failed\", \"type\": \"compile_error\", \"raw\": \"$ESCAPED\"}"
        exit 0
    }

    # Step 3: Compile instrumented bitcode to object file
    COMPILE_OUTPUT=$(llc -filetype=obj -o "$INSTRUMENTED_OBJ" "$INSTRUMENTED_BC" 2>&1) || {
        ESCAPED=$(echo "$COMPILE_OUTPUT" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr '\n' ' ')
        echo "{\"error\": \"Object compilation failed\", \"type\": \"compile_error\", \"raw\": \"$ESCAPED\"}"
        exit 0
    }

    # Step 4: Create a stub Rust file that links with our instrumented object
    # The stub provides no code - all code comes from the instrumented object
    cat > "$STUB_RS" << 'STUBEOF'
#![no_main]
STUBEOF

    # Step 5: Use rustc to link - it handles Rust std library linking
    # -C link-arg passes our instrumented object and runtime to the linker
    # -latomic needed for ARM outline atomics used in runtime library
    COMPILE_OUTPUT=$(rustc --edition 2021 \
        -C opt-level=$RUST_OPT \
        -C link-arg="$INSTRUMENTED_OBJ" \
        -C link-arg="$RT" \
        -C link-arg=-lpthread \
        -C link-arg=-latomic \
        -o "$OUTPUT_BIN" \
        "$STUB_RS" \
        2>&1) || {
        ESCAPED=$(echo "$COMPILE_OUTPUT" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr '\n' ' ')
        echo "{\"error\": \"Linking failed\", \"type\": \"compile_error\", \"raw\": \"$ESCAPED\"}"
        exit 0
    }
else
    # C/C++ compilation - use clang with pass plugin directly
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

    COMPILE_OUTPUT=$($COMPILER $OPT_LEVEL \
        -fpass-plugin="$PASS" \
        -g \
        "$CODE_FILE" "$RT" \
        -o "$OUTPUT_BIN" \
        -lpthread \
        -lm \
        2>&1) || {
        ESCAPED=$(echo "$COMPILE_OUTPUT" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr '\n' ' ')
        echo "{\"error\": \"Compilation failed\", \"type\": \"compile_error\", \"raw\": \"$ESCAPED\"}"
        exit 0
    }
fi

# Run instrumented binary and pipe directly to cache-sim
echo '{"type": "progress", "stage": "running"}' >&2

# Use text mode (stdout) and pipe directly to cache-sim
export CACHE_EXPLORER_OUTPUT="-"
export CACHE_EXPLORER_SAMPLE_RATE="$SAMPLE_RATE"
export CACHE_EXPLORER_MAX_EVENTS="$EVENT_LIMIT"

# Build simulator arguments
SIM_ARGS="--config $CONFIG --prefetch $PREFETCH --json --stream"
if [ "$FAST_MODE" = "1" ]; then
    SIM_ARGS="$SIM_ARGS --fast"
fi

# Run with timeout, pipe output directly to simulator
timeout 10s "$OUTPUT_BIN" 2>/dev/null | $SIM $SIM_ARGS || {
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 124 ]; then
        echo '{"error": "Execution timeout (10s limit)", "type": "timeout"}'
        exit 0
    fi
}
