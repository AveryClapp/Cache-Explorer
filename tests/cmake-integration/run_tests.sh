#!/bin/bash
# Integration tests for Cache Explorer CMake integration

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SAMPLE_PROJECT="$SCRIPT_DIR/sample-project"
BUILD_DIR="$SCRIPT_DIR/build-test"
CACHE_EXPLORE="$PROJECT_ROOT/backend/scripts/cache-explore"

select_artifact() {
  local candidate
  for candidate in "$@"; do
    if [[ -e "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

PASS_PATH=$(select_artifact \
  "$PROJECT_ROOT/build/backend/llvm-pass/CacheProfiler.so" \
  "$PROJECT_ROOT/backend/llvm-pass/build/CacheProfiler.so" || true)
RUNTIME_PATH=$(select_artifact \
  "$PROJECT_ROOT/build/backend/runtime/libcache-explorer-rt.a" \
  "$PROJECT_ROOT/backend/runtime/build/libcache-explorer-rt.a" || true)
SIM_PATH=$(select_artifact \
  "$PROJECT_ROOT/build/backend/cache-simulator/cache-sim" \
  "$PROJECT_ROOT/backend/cache-simulator/build/cache-sim" || true)

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

PASSED=0
FAILED=0
FAILED_TESTS=()

pass() { echo -e "${GREEN}PASS${NC}"; PASSED=$((PASSED + 1)); }
fail() { echo -e "${RED}FAIL${NC} — $1"; FAILED=$((FAILED + 1)); FAILED_TESTS+=("$TEST_NAME"); }

cleanup() { rm -rf "$BUILD_DIR"; }
trap cleanup EXIT

echo "========================================"
echo "  CMake Integration Tests"
echo "========================================"
echo ""

# Test 1: Toolchain file configures and builds successfully
TEST_NAME="Toolchain: configure and build"
echo -n "Test: $TEST_NAME... "
rm -rf "$BUILD_DIR"
CMAKE_CONFIGURE_OUT=$(CACHE_EXPLORER_PATH="$PROJECT_ROOT/backend" \
  CACHE_EXPLORER_PASS="$PASS_PATH" \
  CACHE_EXPLORER_RUNTIME="$RUNTIME_PATH" \
  CACHE_EXPLORER_SIM="$SIM_PATH" \
  "$CACHE_EXPLORE" cmake "$SAMPLE_PROJECT" --build-dir "$BUILD_DIR" 2>&1)
CMAKE_BUILD_OUT=$(cmake --build "$BUILD_DIR" 2>&1)
if [[ $? -eq 0 ]] && [[ -f "$BUILD_DIR/cache-matrix" ]]; then
  pass
else
  fail "binary not produced or cmake failed"
  echo "  --- cmake configure output ---" >&2
  echo "$CMAKE_CONFIGURE_OUT" | tail -20 >&2
  echo "  --- cmake build output ---" >&2
  echo "$CMAKE_BUILD_OUT" | tail -20 >&2
fi

# Test 2: Instrumented binary produces valid cache-sim JSON
TEST_NAME="Trace: binary produces valid JSON"
echo -n "Test: $TEST_NAME... "
OUTPUT=$("$BUILD_DIR/cache-matrix" 2>&1 | "$SIM_PATH" --json 2>/dev/null)
if echo "$OUTPUT" | jq -e '.levels.l1d.hitRate' > /dev/null 2>&1 \
   && echo "$OUTPUT" | jq -e '.events > 0' > /dev/null 2>&1; then
  pass
else
  fail "JSON missing expected fields. Output: $(echo "$OUTPUT" | head -5)"
fi

# Test 3: CTest passes against instrumented binaries
TEST_NAME="CTest: all tests pass with instrumentation"
echo -n "Test: $TEST_NAME... "
if cmake --build "$BUILD_DIR" --target all > /dev/null 2>&1 \
   && ctest --test-dir "$BUILD_DIR" --output-on-failure > /dev/null 2>&1; then
  pass
else
  fail "ctest failed"
fi

# Test 4: find_package approach also works
TEST_NAME="find_package: configure and build"
echo -n "Test: $TEST_NAME... "
FP_BUILD="$BUILD_DIR-findpkg"
rm -rf "$FP_BUILD"
if [[ -z "$PASS_PATH" || -z "$RUNTIME_PATH" ]]; then
  fail "CacheProfiler.so or libcache-explorer-rt.a not found — build Cache Explorer first"
else
  # find_package requires LLVM Clang (Apple Clang can't load the pass plugin).
  # Prefer CACHE_EXPLORER_CC (set by CI), then clang on PATH, then Homebrew fallbacks.
  LLVM_CLANG="${CACHE_EXPLORER_CC:-}"
  if [[ -z "$LLVM_CLANG" ]] && command -v clang >/dev/null 2>&1 \
     && ! clang --version 2>/dev/null | head -1 | grep -qi apple; then
    LLVM_CLANG=$(command -v clang)
  fi
  if [[ -z "$LLVM_CLANG" ]]; then
    LLVM_CLANG=$(command -v /opt/homebrew/opt/llvm/bin/clang 2>/dev/null \
      || command -v /usr/local/opt/llvm/bin/clang 2>/dev/null || echo "")
  fi
  FP_COMPILER_ARGS=()
  if [[ -n "$LLVM_CLANG" ]]; then
    FP_COMPILER_ARGS+=("-DCMAKE_C_COMPILER=$LLVM_CLANG")
  fi
  if [[ "$(uname -s)" == "Darwin" ]]; then
    FP_COMPILER_ARGS+=("-DCMAKE_OSX_ARCHITECTURES=$(uname -m)")
  fi

  if cmake -S "$SAMPLE_PROJECT" -B "$FP_BUILD" \
       "${FP_COMPILER_ARGS[@]}" \
       -DCACHE_EXPLORER_PATH="$PROJECT_ROOT/backend" \
       -DCACHE_EXPLORER_PASS="$PASS_PATH" \
       -DCACHE_EXPLORER_RUNTIME="$RUNTIME_PATH" \
       -DUSE_FIND_PACKAGE=ON \
       > /dev/null 2>&1 \
     && cmake --build "$FP_BUILD" > /dev/null 2>&1 \
     && [[ -f "$FP_BUILD/cache-matrix" ]]; then
    pass
  else
    fail "find_package build failed"
  fi
  rm -rf "$FP_BUILD"
fi

echo ""
echo "========================================"
echo "Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}"
echo "========================================"

if [[ ${#FAILED_TESTS[@]} -gt 0 ]]; then
  echo ""
  echo "Failed tests:"
  for t in "${FAILED_TESTS[@]}"; do echo "  - $t"; done
fi
echo ""

[[ $FAILED -eq 0 ]]
