#!/usr/bin/env bash
set -u -o pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STRICT=0
FAILURES=0
WARNINGS=0

usage() {
  cat <<'USAGE'
Usage: ./scripts/doctor.sh [--strict]

Checks the local Hardware Explorer toolchain, build artifacts, npm dependencies,
and product-facing CLI entrypoints.

Options:
  --strict   Treat warnings as failures
  --help     Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict)
      STRICT=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

ok() {
  printf '[ok]   %s\n' "$1"
}

warn() {
  WARNINGS=$((WARNINGS + 1))
  printf '[warn] %s\n' "$1"
}

fail() {
  FAILURES=$((FAILURES + 1))
  printf '[fail] %s\n' "$1"
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

require_command() {
  local command_name="$1"
  local hint="$2"
  if has_command "$command_name"; then
    ok "$command_name found: $(command -v "$command_name")"
  else
    fail "$command_name missing. $hint"
  fi
}

optional_command() {
  local command_name="$1"
  local hint="$2"
  if has_command "$command_name"; then
    ok "$command_name found: $(command -v "$command_name")"
  else
    warn "$command_name missing. $hint"
  fi
}

find_llvm_cmake_dir() {
  if [[ -n "${LLVM_DIR:-}" && -d "$LLVM_DIR" ]]; then
    echo "$LLVM_DIR"
    return 0
  fi

  if has_command llvm-config; then
    local cmake_dir
    cmake_dir="$(llvm-config --cmakedir 2>/dev/null || true)"
    if [[ -n "$cmake_dir" && -d "$cmake_dir" ]]; then
      echo "$cmake_dir"
      return 0
    fi
  fi

  if has_command brew; then
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

command_exists() {
  local candidate="$1"
  if [[ "$candidate" == */* ]]; then
    [[ -x "$candidate" ]]
  else
    command -v "$candidate" >/dev/null 2>&1
  fi
}

is_upstream_clang() {
  local candidate="$1"
  command_exists "$candidate" || return 1
  ! "$candidate" --version 2>/dev/null | head -1 | grep -qi "apple"
}

find_upstream_clang() {
  local candidate=""

  if [[ -n "${CACHE_EXPLORER_CC:-}" ]]; then
    candidate="$CACHE_EXPLORER_CC"
    is_upstream_clang "$candidate" && { echo "$candidate"; return 0; }
  fi

  if is_upstream_clang clang; then
    command -v clang
    return 0
  fi

  for version in 21 20 19 18 17; do
    candidate="clang-$version"
    if is_upstream_clang "$candidate"; then
      command -v "$candidate"
      return 0
    fi
  done

  if has_command llvm-config; then
    candidate="$(llvm-config --bindir 2>/dev/null)/clang"
    is_upstream_clang "$candidate" && { echo "$candidate"; return 0; }
  fi

  if has_command brew; then
    local formula prefix
    for formula in llvm llvm@21 llvm@20 llvm@19 llvm@18 llvm@17; do
      prefix="$(brew --prefix "$formula" 2>/dev/null || true)"
      candidate="$prefix/bin/clang"
      is_upstream_clang "$candidate" && { echo "$candidate"; return 0; }
    done
  fi

  return 1
}

check_path() {
  local path="$1"
  local label="$2"
  local hint="$3"
  if [[ -e "$ROOT_DIR/$path" ]]; then
    ok "$label present"
  else
    warn "$label missing. $hint"
  fi
}

check_npm_deps() {
  local dir="$1"
  local label="$2"
  if [[ -d "$ROOT_DIR/$dir/node_modules" ]]; then
    ok "$label npm dependencies installed"
  else
    warn "$label npm dependencies missing. ./scripts/dev.sh will install them, or run npm install in $dir"
  fi
}

check_cli() {
  local label="$1"
  shift
  if "$ROOT_DIR/backend/scripts/cache-explore" "$@" >/dev/null 2>&1; then
    ok "$label"
  else
    warn "$label failed. Build artifacts may be missing or the CLI entrypoint may be unhealthy"
  fi
}

echo "=== Hardware Explorer Preview Doctor ==="
echo "Root: $ROOT_DIR"
echo ""

echo "Toolchain"
require_command cmake "Install CMake 3.20+."
require_command ninja "Install Ninja, or adjust scripts/build.sh to use another generator."
require_command node "Install Node.js 18+."
require_command npm "Install npm."
optional_command curl "Used for faster dev-server health checks."
optional_command lsof "Used to find occupied dev ports."

if LLVM_CLANG="$(find_upstream_clang)"; then
  ok "upstream LLVM clang found: $LLVM_CLANG ($("$LLVM_CLANG" --version | head -1))"
  export CACHE_EXPLORER_CC="$LLVM_CLANG"
  LLVM_CLANG_DIR="$(dirname "$LLVM_CLANG")"
  if [[ -x "$LLVM_CLANG_DIR/clang++" ]]; then
    export CACHE_EXPLORER_CXX="$LLVM_CLANG_DIR/clang++"
  fi
else
  fail "upstream LLVM clang missing. Apple Clang cannot load Hardware Explorer LLVM passes; install LLVM 17-21."
fi

if LLVM_CMAKE_DIR="$(find_llvm_cmake_dir)"; then
  ok "LLVM CMake package found: $LLVM_CMAKE_DIR"
else
  warn "LLVM CMake package not found. Set LLVM_DIR or install llvm/llvm@18."
fi

echo ""
echo "Build Artifacts"
check_path "build/backend/cache-simulator/cache-sim" "cache simulator" "Run ./scripts/build.sh"
check_path "build/backend/llvm-pass/CacheProfiler.so" "LLVM pass" "Run ./scripts/build.sh"
check_path "build/backend/runtime/libcache-explorer-rt.a" "runtime library" "Run ./scripts/build.sh"

echo ""
echo "Node Workspaces"
check_npm_deps "backend/server" "backend server"
check_npm_deps "frontend" "frontend"

echo ""
echo "Product Entrypoints"
check_cli "hardware profiles CLI responds" profiles --ids
check_cli "workload catalog CLI responds" workloads --ids
if PRODUCT_DOCTOR_OUTPUT="$("$ROOT_DIR/backend/scripts/cache-explore" doctor 2>&1)"; then
  ok "compiler, pass, simulator, and server compatibility"
else
  fail "product doctor failed: $(echo "$PRODUCT_DOCTOR_OUTPUT" | tail -1)"
fi

echo ""
if [[ "$STRICT" == "1" && "$WARNINGS" -gt 0 ]]; then
  FAILURES=$((FAILURES + WARNINGS))
fi

if [[ "$FAILURES" -gt 0 ]]; then
  echo "Doctor finished with $FAILURES failure(s) and $WARNINGS warning(s)."
  exit 1
fi

echo "Doctor finished with 0 failure(s) and $WARNINGS warning(s)."
echo "Next: ./scripts/dev.sh"
