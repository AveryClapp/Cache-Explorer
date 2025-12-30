#!/bin/bash
# Build the Cache Explorer Docker sandbox image
# Run from the project root directory

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Building Cache Explorer sandbox image..."
echo "Project root: $PROJECT_ROOT"

cd "$PROJECT_ROOT"

# Build the Docker image (multi-stage build compiles everything)
docker build \
    -t cache-explorer-sandbox:latest \
    -f docker/Dockerfile \
    .

echo ""
echo "✓ Docker image built successfully: cache-explorer-sandbox:latest"
echo ""
echo "To test the sandbox:"
echo "  docker run --rm cache-explorer-sandbox:latest /tmp/test.c c intel -O0 none 1 1000000"
echo ""
echo "To verify the image:"
echo "  docker image inspect cache-explorer-sandbox:latest"
