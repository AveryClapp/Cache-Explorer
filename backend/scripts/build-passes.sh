#!/bin/bash
#
# build-passes.sh - Build CacheProfiler.so for a specific LLVM version
#
# Usage: build-passes.sh [llvm-version] [output-dir]
#   llvm-version: LLVM major version (17-21), default: 18
#   output-dir:   Directory for output .so file, default: ./passes
#
# Examples:
#   build-passes.sh              # Build for LLVM 18, output to ./passes
#   build-passes.sh 21           # Build for LLVM 21, output to ./passes
#   build-passes.sh 19 ./dist    # Build for LLVM 19, output to ./dist
#

set -e

# Configuration
LLVM_VERSION="${1:-18}"
OUTPUT_DIR="${2:-./passes}"

# Convert OUTPUT_DIR to absolute path (before we cd to temp dir)
# Handle case where parent directory doesn't exist yet
if [[ "$OUTPUT_DIR" != /* ]]; then
    OUTPUT_DIR="$(pwd)/$OUTPUT_DIR"
fi

# Validate LLVM version
if ! [[ "$LLVM_VERSION" =~ ^[0-9]+$ ]] || [ "$LLVM_VERSION" -lt 17 ] || [ "$LLVM_VERSION" -gt 21 ]; then
    echo "Error: LLVM version must be between 17 and 21"
    echo "Usage: $0 [llvm-version] [output-dir]"
    exit 1
fi

# Detect OS
case "$(uname -s)" in
    Darwin)
        OS="darwin"
        ;;
    Linux)
        OS="linux"
        ;;
    *)
        echo "Error: Unsupported operating system: $(uname -s)"
        exit 1
        ;;
esac

# Detect architecture
case "$(uname -m)" in
    x86_64)
        ARCH="x64"
        ;;
    arm64|aarch64)
        ARCH="arm64"
        ;;
    *)
        echo "Error: Unsupported architecture: $(uname -m)"
        exit 1
        ;;
esac

echo "Building CacheProfiler for LLVM $LLVM_VERSION on $OS-$ARCH"

# Find LLVM installation
LLVM_DIR=""

if [ "$OS" = "darwin" ]; then
    # macOS: Check Homebrew paths
    # Check both Apple Silicon and Intel Homebrew locations
    HOMEBREW_PREFIXES=("/opt/homebrew" "/usr/local")

    for PREFIX in "${HOMEBREW_PREFIXES[@]}"; do
        # Try versioned path first (llvm@N)
        if [ -d "$PREFIX/opt/llvm@$LLVM_VERSION" ]; then
            LLVM_DIR="$PREFIX/opt/llvm@$LLVM_VERSION/lib/cmake/llvm"
            break
        fi
        # Try unversioned path (llvm) and check version
        if [ -d "$PREFIX/opt/llvm" ]; then
            INSTALLED_VERSION=$("$PREFIX/opt/llvm/bin/llvm-config" --version 2>/dev/null | cut -d. -f1)
            if [ "$INSTALLED_VERSION" = "$LLVM_VERSION" ]; then
                LLVM_DIR="$PREFIX/opt/llvm/lib/cmake/llvm"
                break
            fi
        fi
    done
elif [ "$OS" = "linux" ]; then
    # Linux: Check standard paths
    if [ -d "/usr/lib/llvm-$LLVM_VERSION" ]; then
        LLVM_DIR="/usr/lib/llvm-$LLVM_VERSION/lib/cmake/llvm"
    elif [ -d "/usr/lib/llvm/$LLVM_VERSION" ]; then
        LLVM_DIR="/usr/lib/llvm/$LLVM_VERSION/lib/cmake/llvm"
    fi
fi

if [ -z "$LLVM_DIR" ] || [ ! -d "$LLVM_DIR" ]; then
    echo "Error: Could not find LLVM $LLVM_VERSION installation"
    echo ""
    echo "Searched locations:"
    if [ "$OS" = "darwin" ]; then
        echo "  - /opt/homebrew/opt/llvm@$LLVM_VERSION"
        echo "  - /opt/homebrew/opt/llvm (if version matches)"
        echo "  - /usr/local/opt/llvm@$LLVM_VERSION"
        echo "  - /usr/local/opt/llvm (if version matches)"
        echo ""
        echo "Install with: brew install llvm@$LLVM_VERSION"
    else
        echo "  - /usr/lib/llvm-$LLVM_VERSION"
        echo ""
        echo "Install with: apt install llvm-$LLVM_VERSION-dev"
    fi
    exit 1
fi

echo "Found LLVM at: $LLVM_DIR"

# Get script directory and source directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/../llvm-pass"

if [ ! -f "$SOURCE_DIR/CMakeLists.txt" ]; then
    echo "Error: Could not find CMakeLists.txt at $SOURCE_DIR"
    exit 1
fi

# Create temp build directory
BUILD_DIR=$(mktemp -d)
trap "rm -rf '$BUILD_DIR'" EXIT

echo "Building in temporary directory: $BUILD_DIR"

# Configure with CMake
cd "$BUILD_DIR"
cmake "$SOURCE_DIR" \
    -G Ninja \
    -DLLVM_DIR="$LLVM_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    || { echo "Error: CMake configuration failed"; exit 1; }

# Build
ninja \
    || { echo "Error: Build failed"; exit 1; }

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Copy output with versioned name
OUTPUT_NAME="CacheProfiler-llvm${LLVM_VERSION}-${OS}-${ARCH}.so"
cp "$BUILD_DIR/CacheProfiler.so" "$OUTPUT_DIR/$OUTPUT_NAME"

echo ""
echo "Success! Built: $OUTPUT_DIR/$OUTPUT_NAME"
echo ""
