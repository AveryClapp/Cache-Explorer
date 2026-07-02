#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
JOBS="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)"

build_component() {
    local name="$1"
    local source_dir="$2"
    local artifact="$3"

    echo "$name"
    cmake -S "$source_dir" -B "$source_dir/build" -DCMAKE_BUILD_TYPE=Release > /dev/null
    cmake --build "$source_dir/build" --parallel "$JOBS" > /dev/null
    echo "      -> $artifact"
}

echo "=== Building Cache Explorer ==="

# Build LLVM pass
build_component "[1/3] Building LLVM pass..." "$BACKEND_DIR/llvm-pass" "CacheProfiler.so"

# Build runtime library
build_component "[2/3] Building runtime library..." "$BACKEND_DIR/runtime" "libcache-explorer-rt.a"

# Build cache simulator
build_component "[3/3] Building cache simulator..." "$BACKEND_DIR/cache-simulator" "cache-sim"

echo ""
echo "=== Build complete ==="
echo ""
echo "Components:"
echo "  LLVM Pass: $BACKEND_DIR/llvm-pass/build/CacheProfiler.so"
echo "  Runtime:   $BACKEND_DIR/runtime/build/libcache-explorer-rt.a"
echo "  Simulator: $BACKEND_DIR/cache-simulator/build/cache-sim"
