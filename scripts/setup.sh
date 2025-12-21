#!/bin/bash
set -e

echo "=== Cache Explorer Setup ==="

# Check tools
command -v cmake >/dev/null 2>&1 || { echo "Error: cmake required"; exit 1; }
command -v ninja >/dev/null 2>&1 || { echo "Error: ninja required"; exit 1; }
command -v clang >/dev/null 2>&1 || { echo "Error: clang required"; exit 1; }

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
else
    echo "Error: Unsupported OS"
    exit 1
fi

echo "Detected: $OS"

# Create build directory
mkdir -p build

echo "✓ Setup complete"
echo ""
echo "Next: Run ./scripts/build.sh"
