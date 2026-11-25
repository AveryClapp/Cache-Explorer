#!/usr/bin/env bash
set -euo pipefail

BUILD_TYPE="${1:-Debug}"

find_llvm_dir() {
    if [[ -n "${LLVM_DIR:-}" ]]; then
        echo "$LLVM_DIR"
        return 0
    fi

    if command -v llvm-config >/dev/null 2>&1; then
        local cmake_dir
        cmake_dir="$(llvm-config --cmakedir 2>/dev/null || true)"
        if [[ -n "$cmake_dir" && -d "$cmake_dir" ]]; then
            echo "$cmake_dir"
            return 0
        fi
    fi

    if command -v brew >/dev/null 2>&1; then
        local formula prefix
        for formula in llvm llvm@21 llvm@20 llvm@19 llvm@18 llvm@17; do
            prefix="$(brew --prefix "$formula" 2>/dev/null || true)"
            if [[ -n "$prefix" && -d "$prefix/lib/cmake/llvm" ]]; then
                echo "$prefix/lib/cmake/llvm"
                return 0
            fi
        done
    fi

    return 1
}

echo "=== Building Hardware Explorer Preview ==="
echo "Build type: $BUILD_TYPE"

mkdir -p build
cd build

CMAKE_ARGS=(
    ..
    -G Ninja
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE"
)

if LLVM_CMAKE_DIR="$(find_llvm_dir)"; then
    echo "LLVM_DIR: $LLVM_CMAKE_DIR"
    CMAKE_ARGS+=("-DLLVM_DIR=$LLVM_CMAKE_DIR")

    LLVM_PREFIX="${LLVM_CMAKE_DIR%/lib/cmake/llvm}"
    if [[ -x "$LLVM_PREFIX/bin/clang" && -x "$LLVM_PREFIX/bin/clang++" ]]; then
        echo "Compilers: $LLVM_PREFIX/bin/clang and clang++"
        CMAKE_ARGS+=(
            "-DCMAKE_C_COMPILER=$LLVM_PREFIX/bin/clang"
            "-DCMAKE_CXX_COMPILER=$LLVM_PREFIX/bin/clang++"
        )
    fi
else
    echo "LLVM_DIR: using CMake discovery"
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
    HOST_ARCH="$(uname -m)"
    echo "macOS architecture: $HOST_ARCH"
    CMAKE_ARGS+=("-DCMAKE_OSX_ARCHITECTURES=$HOST_ARCH")
fi

cmake "${CMAKE_ARGS[@]}"
ninja

echo ""
echo "=== Build Complete ==="
echo "LLVM Pass: build/backend/llvm-pass/CacheProfiler.so (if built)"
echo "Server: build/backend/server/cache-explorer-server (if built)"
echo "CLI: build/backend/cli/cache-explorer (if built)"
