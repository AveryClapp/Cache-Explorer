#!/bin/bash
set -e

BUILD_TYPE=${1:-Release}

echo "Building Cache Explorer (${BUILD_TYPE})..."

# Detect LLVM installation
if [ -d "/opt/homebrew/opt/llvm" ]; then
    LLVM_DIR="/opt/homebrew/opt/llvm"
elif [ -d "/usr/local/opt/llvm" ]; then
    LLVM_DIR="/usr/local/opt/llvm"
else
    echo "ERROR: LLVM not found. Install with: brew install llvm"
    exit 1
fi

echo "Using LLVM at: $LLVM_DIR"

# Step 1: Install dependencies via Conan
echo "Installing dependencies..."
conan install . \
    --output-folder=build \
    --build=missing \
    --settings=build_type=${BUILD_TYPE}

# Step 2: Configure CMake
echo "Configuring CMake..."
cmake -S . -B build \
    -DCMAKE_TOOLCHAIN_FILE=build/build/${BUILD_TYPE}/generators/conan_toolchain.cmake \
    -DCMAKE_BUILD_TYPE=${BUILD_TYPE} \
    -DLLVM_DIR="${LLVM_DIR}/lib/cmake/llvm"

# Step 3: Build
echo "Compiling..."
cmake --build build --config ${BUILD_TYPE} -j8

echo "Build complete! Binary: build/cache_explorer_backend"
