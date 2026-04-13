// Compiler-rt builtins referenced by Zig's UBSan runtime on aarch64.
// Only called in UBSan error formatting paths, never in user code.

// Converts 80-bit x87 long double to 128-bit IEEE quad float.
// On aarch64, long double is already 128-bit so this is an identity operation.
long double __extendxftf2(long double x) { return x; }

// Converts double to 128-bit IEEE quad float.
long double __extenddftf2(double x) { return (long double)x; }
