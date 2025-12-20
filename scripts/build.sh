#!/bin/bash
set -e

BUILD_TYPE="${1:-Debug}"

echo "=== Building Cache Explorer ==="
echo "Build type: $BUILD_TYPE"

mkdir -p build
cd build

if [[ "$OSTYPE" == "darwin"* ]]; then
    cmake ../backend -G Ninja -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
        -DLLVM_DIR="$(brew --prefix llvm)/lib/cmake/llvm"
else
    cmake ../backend -G Ninja -DCMAKE_BUILD_TYPE="$BUILD_TYPE"
fi

ninja

echo ""
echo "=== Build Complete ==="

