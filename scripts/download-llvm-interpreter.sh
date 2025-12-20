#!/bin/bash
set -e

LLVM_VERSION="main"
BASE_URL="https://raw.githubusercontent.com/llvm/llvm-project/${LLVM_VERSION}"
TARGET="backend/third-party/llvm-interpreter"

mkdir -p "$TARGET"

declare -a FILES=(
    "llvm/lib/ExecutionEngine/Interpreter/Interpreter.h"
    "llvm/lib/ExecutionEngine/Interpreter/Interpreter.cpp"
    "llvm/lib/ExecutionEngine/Interpreter/Execution.cpp"
    "llvm/lib/ExecutionEngine/Interpreter/ExternalFunctions.cpp"
)

for file in "${FILES[@]}"; do
    name=$(basename "$file")
    echo "Downloading $name..."
    curl -sL -o "${TARGET}/${name}" "${BASE_URL}/${file}"
done

curl -sL -o "${TARGET}/../LLVM-LICENSE.txt" \
    "https://raw.githubusercontent.com/llvm/llvm-project/main/llvm/LICENSE.TXT"

echo "✓ Downloaded LLVM Interpreter source"
echo ""
echo "IMPORTANT: Edit Interpreter.h and make these methods virtual:"
echo "  - executeLoadInst"
echo "  - executeStoreInst"
echo "  - executeCallInst"
