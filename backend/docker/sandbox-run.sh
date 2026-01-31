#!/bin/bash
# Sandboxed compilation and execution script
# Runs inside Docker container with limited privileges

set -e

INPUT_FILE="$1"
shift

# Parse remaining arguments
CONFIG="intel"
OPT_LEVEL="-O0"
JSON_OUTPUT=""
DEFINES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) CONFIG="$2"; shift 2 ;;
    --json) JSON_OUTPUT="--json"; shift ;;
    -O*) OPT_LEVEL="$1"; shift ;;
    -D) DEFINES+=("-D$2"); shift 2 ;;
    -D*) DEFINES+=("$1"); shift ;;
    *) shift ;;
  esac
done

if [[ -z "$INPUT_FILE" ]] || [[ ! -f "$INPUT_FILE" ]]; then
  if [[ -n "$JSON_OUTPUT" ]]; then
    echo '{"error": "No input file provided"}'
  else
    echo "Error: No input file provided" >&2
  fi
  exit 1
fi

# Detect language from extension
EXT="${INPUT_FILE##*.}"
case "$EXT" in
  c)
    COMPILER="clang"
    PIPELINE="clang"
    ;;
  cpp|cc|cxx|C)
    COMPILER="clang++"
    PIPELINE="clang"
    ;;
  zig)
    PIPELINE="zig"
    ;;
  *)
    if [[ -n "$JSON_OUTPUT" ]]; then
      echo '{"error": "Unsupported file type"}'
    else
      echo "Error: Unsupported file type: .$EXT" >&2
    fi
    exit 1
    ;;
esac

BINARY="/tmp/program-$$"

if [[ "$PIPELINE" == "zig" ]]; then
  # Zig compilation via LLVM IR bitcode pipeline:
  # 1. zig build-exe -> LLVM IR
  # 2. opt with our pass -> instrumented IR
  # 3. llc -> object file
  # 4. clang links object file with runtime

  LL_FILE="/tmp/code-$$.ll"
  INSTRUMENTED_IR="/tmp/instrumented-$$.ll"
  OBJ_FILE="/tmp/code-$$.o"

  # Step 1: Compile Zig to LLVM IR
  if ! zig build-exe \
    -femit-llvm-ir="$LL_FILE" \
    -fno-emit-bin \
    "$INPUT_FILE" 2>/tmp/compile-err-$$; then
    if [[ -n "$JSON_OUTPUT" ]]; then
      echo "{\"error\": \"Zig compilation failed\", \"details\": \"$(cat /tmp/compile-err-$$ | tr '\n' ' ' | sed 's/"/\\"/g')\"}"
    else
      echo "Zig compilation failed:" >&2
      cat /tmp/compile-err-$$ >&2
    fi
    rm -f /tmp/compile-err-$$
    exit 1
  fi

  # Step 2: Apply instrumentation pass
  if ! opt -load-pass-plugin="$PASS_PATH" \
    -passes="cache-explorer-module" \
    -S "$LL_FILE" \
    -o "$INSTRUMENTED_IR" 2>/tmp/compile-err-$$; then
    if [[ -n "$JSON_OUTPUT" ]]; then
      echo "{\"error\": \"Instrumentation failed\", \"details\": \"$(cat /tmp/compile-err-$$ | tr '\n' ' ' | sed 's/"/\\"/g')\"}"
    else
      echo "Instrumentation failed:" >&2
      cat /tmp/compile-err-$$ >&2
    fi
    rm -f /tmp/compile-err-$$ "$LL_FILE"
    exit 1
  fi

  # Step 3: Compile instrumented IR to object file
  if ! llc -filetype=obj "$INSTRUMENTED_IR" -o "$OBJ_FILE" 2>/tmp/compile-err-$$; then
    if [[ -n "$JSON_OUTPUT" ]]; then
      echo "{\"error\": \"Object compilation failed\", \"details\": \"$(cat /tmp/compile-err-$$ | tr '\n' ' ' | sed 's/"/\\"/g')\"}"
    else
      echo "Object compilation failed:" >&2
      cat /tmp/compile-err-$$ >&2
    fi
    rm -f /tmp/compile-err-$$ "$LL_FILE" "$INSTRUMENTED_IR"
    exit 1
  fi

  # Step 4: Link with runtime library
  # -nostartfiles: Zig's IR includes _start from std/start.zig, skip glibc's crt1.o
  # zig_stubs.o: provides __extendxftf2 (needed by Zig's UBSan on aarch64, not in libgcc)
  ZIG_STUBS="$(dirname "$RUNTIME_LIB")/zig_stubs.o"
  if ! clang -nostartfiles "$OBJ_FILE" "$ZIG_STUBS" "$RUNTIME_LIB" \
    -lc -lm \
    -o "$BINARY" 2>/tmp/compile-err-$$; then
    if [[ -n "$JSON_OUTPUT" ]]; then
      echo "{\"error\": \"Linking failed\", \"details\": \"$(cat /tmp/compile-err-$$ | tr '\n' ' ' | sed 's/"/\\"/g')\"}"
    else
      echo "Linking failed:" >&2
      cat /tmp/compile-err-$$ >&2
    fi
    rm -f /tmp/compile-err-$$ "$LL_FILE" "$INSTRUMENTED_IR" "$OBJ_FILE"
    exit 1
  fi
  rm -f /tmp/compile-err-$$ "$LL_FILE" "$INSTRUMENTED_IR" "$OBJ_FILE"

else
  # C/C++ compilation - use clang with pass plugin directly

  # Extra flags for -O0
  EXTRA_FLAGS=""
  if [[ "$OPT_LEVEL" == "-O0" ]]; then
    EXTRA_FLAGS="-Xclang -disable-O0-optnone"
  fi

  # Compile with instrumentation
  if ! $COMPILER $OPT_LEVEL $EXTRA_FLAGS -g \
    -fpass-plugin="$PASS_PATH" \
    -I"$RUNTIME_INC" \
    "${DEFINES[@]}" \
    "$INPUT_FILE" \
    "$RUNTIME_LIB" \
    -o "$BINARY" 2>/tmp/compile-err-$$; then

    if [[ -n "$JSON_OUTPUT" ]]; then
      echo "{\"error\": \"Compilation failed\", \"details\": \"$(cat /tmp/compile-err-$$ | tr '\n' ' ' | sed 's/"/\\"/g')\"}"
    else
      echo "Compilation failed:" >&2
      cat /tmp/compile-err-$$ >&2
    fi
    rm -f /tmp/compile-err-$$
    exit 1
  fi
  rm -f /tmp/compile-err-$$
fi

# Run the instrumented binary with timeout
# Capture trace output
if ! timeout 10s "$BINARY" > /tmp/trace-$$ 2>&1; then
  EXIT_CODE=$?
  if [[ $EXIT_CODE -eq 124 ]]; then
    if [[ -n "$JSON_OUTPUT" ]]; then
      echo '{"error": "Execution timeout (10s limit exceeded)"}'
    else
      echo "Error: Execution timed out (10s limit)" >&2
    fi
  else
    if [[ -n "$JSON_OUTPUT" ]]; then
      echo "{\"error\": \"Runtime error\", \"details\": \"$(cat /tmp/trace-$$ | head -20 | tr '\n' ' ' | sed 's/"/\\"/g')\"}"
    else
      echo "Runtime error:" >&2
      cat /tmp/trace-$$ >&2
    fi
  fi
  rm -f "$BINARY" /tmp/trace-$$
  exit 1
fi

# Process trace through cache simulator
cat /tmp/trace-$$ | "$CACHE_SIM" --config "$CONFIG" $JSON_OUTPUT

# Cleanup
rm -f "$BINARY" /tmp/trace-$$
