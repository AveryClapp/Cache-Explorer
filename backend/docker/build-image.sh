#!/bin/bash
# Build the Cache Explorer sandbox Docker image
# Run from the backend directory

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Building Cache Explorer Sandbox Image ==="
echo ""

# Check that all required files exist
echo "[1/4] Checking dependencies..."

if [[ ! -f "$BACKEND_DIR/llvm-pass/build/CacheProfiler.so" ]]; then
  echo "Error: LLVM pass not built. Run: ./scripts/build.sh first"
  exit 1
fi

if [[ ! -f "$BACKEND_DIR/runtime/build/libcache-explorer-rt.a" ]]; then
  echo "Error: Runtime not built. Run: ./scripts/build.sh first"
  exit 1
fi

if [[ ! -f "$BACKEND_DIR/cache-simulator/build/cache-sim" ]]; then
  echo "Error: Cache simulator not built. Run: ./scripts/build.sh first"
  exit 1
fi

echo "  All dependencies found."
echo ""

# Build for the appropriate architecture
echo "[2/4] Detecting architecture..."
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" ]] || [[ "$ARCH" == "aarch64" ]]; then
  PLATFORM="linux/arm64"
  echo "  Building for ARM64 (Apple Silicon compatible)"
else
  PLATFORM="linux/amd64"
  echo "  Building for AMD64"
fi
echo ""

# Create build context with required files
echo "[3/4] Preparing build context..."
BUILD_CONTEXT="$SCRIPT_DIR/build-context"
rm -rf "$BUILD_CONTEXT"
mkdir -p "$BUILD_CONTEXT/llvm-pass/build"
mkdir -p "$BUILD_CONTEXT/runtime/build"
mkdir -p "$BUILD_CONTEXT/cache-simulator/build"
mkdir -p "$BUILD_CONTEXT/docker"

cp "$BACKEND_DIR/llvm-pass/build/CacheProfiler.so" "$BUILD_CONTEXT/llvm-pass/build/"
cp "$BACKEND_DIR/runtime/build/libcache-explorer-rt.a" "$BUILD_CONTEXT/runtime/build/"
cp "$BACKEND_DIR/runtime/cache-explorer-rt.h" "$BUILD_CONTEXT/runtime/"
cp "$BACKEND_DIR/cache-simulator/build/cache-sim" "$BUILD_CONTEXT/cache-simulator/build/"
cp "$SCRIPT_DIR/sandbox-run.sh" "$BUILD_CONTEXT/docker/"
cp "$SCRIPT_DIR/Dockerfile" "$BUILD_CONTEXT/"

echo "  Build context prepared."
echo ""

# Build Docker image
echo "[4/4] Building Docker image..."
cd "$BUILD_CONTEXT"
docker build --platform "$PLATFORM" -t cache-explorer-sandbox:latest .

# Cleanup
rm -rf "$BUILD_CONTEXT"

echo ""
echo "=== Done ==="
echo "Image: cache-explorer-sandbox:latest"
echo ""
echo "Test with:"
echo "  echo 'int main() { int x[100]; for(int i=0;i<100;i++) x[i]=i; return 0; }' > /tmp/test.c"
echo "  docker run --rm -v /tmp/test.c:/workspace/input.c:ro cache-explorer-sandbox:latest /workspace/input.c --json"
