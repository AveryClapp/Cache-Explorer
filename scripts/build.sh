#!/bin/bash
set -e

BUILD_TYPE="${1:-Debug}"

echo "=== Building Cache Explorer ==="
echo "Build type: $BUILD_TYPE"

mkdir -p build
cd build

if [[ "$OSTYPE" == "darwin"* ]]; then
    cmake .. -G Ninja -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
        -DLLVM_DIR="$(brew --prefix llvm)/lib/cmake/llvm"
else
    cmake .. -G Ninja -DCMAKE_BUILD_TYPE="$BUILD_TYPE"
fi

ninja

echo ""
echo "=== Build Complete ==="
echo "LLVM Pass: build/backend/llvm-pass/CacheProfiler.so (if built)"
echo "Server: build/backend/server/cache-explorer-server (if built)"
echo "CLI: build/backend/cli/cache-explorer (if built)"

