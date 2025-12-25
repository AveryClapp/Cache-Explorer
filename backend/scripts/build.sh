#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Building Cache Explorer ==="

# Build LLVM pass
echo "[1/3] Building LLVM pass..."
cd "$BACKEND_DIR/llvm-pass"
mkdir -p build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release > /dev/null
make -j$(nproc 2>/dev/null || sysctl -n hw.ncpu) > /dev/null
echo "      -> CacheProfiler.so"

# Build runtime library
echo "[2/3] Building runtime library..."
cd "$BACKEND_DIR/runtime"
mkdir -p build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release > /dev/null
make -j$(nproc 2>/dev/null || sysctl -n hw.ncpu) > /dev/null
echo "      -> libcache-explorer-rt.a"

# Build cache simulator
echo "[3/3] Building cache simulator..."
cd "$BACKEND_DIR/cache-simulator"
mkdir -p build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release > /dev/null
make -j$(nproc 2>/dev/null || sysctl -n hw.ncpu) > /dev/null
echo "      -> cache-sim"

echo ""
echo "=== Build complete ==="
echo ""
echo "Components:"
echo "  LLVM Pass: $BACKEND_DIR/llvm-pass/build/CacheProfiler.so"
echo "  Runtime:   $BACKEND_DIR/runtime/build/libcache-explorer-rt.a"
echo "  Simulator: $BACKEND_DIR/cache-simulator/build/cache-sim"
