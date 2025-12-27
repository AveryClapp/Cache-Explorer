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
    ;;
  cpp|cc|cxx|C)
    COMPILER="clang++"
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
