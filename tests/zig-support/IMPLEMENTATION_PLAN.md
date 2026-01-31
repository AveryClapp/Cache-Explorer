# Zig Language Support - Implementation Plan

**Issue:** #40
**Branch:** feature/zig-support

## Overview

Add support for profiling Zig programs through the LLVM instrumentation pass. Zig uses LLVM as its backend, so the core instrumentation should work, but requires special integration.

## Background

Zig compilation pipeline:
```
.zig → zig build-exe → LLVM IR → Object files → Executable
```

Our instrumentation needs to inject between LLVM IR generation and object file creation.

## Implementation Strategy

### Approach 1: LLVM Bitcode Pipeline (Similar to Rust)

```bash
# 1. Compile Zig to LLVM bitcode
zig build-exe --emit=llvm-ir mycode.zig

# 2. Apply our LLVM pass
opt -load-pass-plugin=CacheProfiler.so -passes="cache-profiler" mycode.ll -o mycode.bc

# 3. Link with runtime and compile to executable
clang mycode.bc -L/path/to/runtime -lcache-explorer-rt -o mycode
```

**Pros:**
- Clean separation of concerns
- Works with existing LLVM pass
- Standard LLVM toolchain

**Cons:**
- Multi-step process (need to script it)
- May need to handle Zig standard library linking

### Approach 2: Zig Build System Integration

Use Zig's build system hooks to inject the pass:

```zig
// build.zig
const std = @import("std");

pub fn build(b: *std.Build) void {
    const exe = b.addExecutable(.{
        .name = "mycode",
        .root_source_file = .{ .path = "src/main.zig" },
    });

    // Add LLVM pass flag
    exe.addArg("-fpass-plugin=/path/to/CacheProfiler.so");

    // Link runtime
    exe.linkLibC();
    exe.addLibraryPath("/path/to/runtime");
    exe.linkSystemLibrary("cache-explorer-rt");
}
```

**Pros:**
- Native Zig integration
- Clean build.zig integration

**Cons:**
- Requires users to modify build.zig
- May not work if Zig doesn't expose `-fpass-plugin`

### Approach 3: Wrapper Script (Recommended)

Create `cache-explore-zig` script that handles the full pipeline:

```bash
#!/bin/bash
# cache-explore-zig wrapper

ZIG_FILE=$1
BASENAME=$(basename "$ZIG_FILE" .zig)

# 1. Compile to LLVM IR
zig build-exe --emit=llvm-ir "$ZIG_FILE" -o "$BASENAME.ll"

# 2. Apply instrumentation pass
opt -load-pass-plugin=CacheProfiler.so \
    -passes="cache-profiler" \
    "$BASENAME.ll" -o "$BASENAME.bc"

# 3. Link runtime and compile
clang "$BASENAME.bc" \
    -L./backend/runtime/build \
    -lcache-explorer-rt \
    -o "$BASENAME"

# 4. Run and capture trace
"./$BASENAME" | ./backend/cache-simulator/build/cache-sim --json
```

**Pros:**
- User-friendly
- No build system modifications
- Consistent with cache-explore for C/C++

**Cons:**
- Zig standard library linking may be complex

## Implementation Plan

### Phase 1: Basic Support (TDD)

**Test 1: Simple Zig program**
```zig
// test-programs/hello.zig
const std = @import("std");

pub fn main() void {
    var arr: [100]i32 = undefined;
    for (arr, 0..) |*item, i| {
        item.* = @intCast(i * 2);
    }
}
```

Expected: Trace output with load/store events

**Test 2: Array access patterns**
```zig
// test-programs/array.zig
pub fn main() void {
    var matrix: [10][10]i32 = undefined;
    for (0..10) |i| {
        for (0..10) |j| {
            matrix[i][j] = @intCast(i * j);
        }
    }
}
```

Expected: Cache simulation shows row-major access pattern

**Test 3: Struct access**
```zig
// test-programs/struct.zig
const Point = struct {
    x: i32,
    y: i32,
};

pub fn main() void {
    var points: [50]Point = undefined;
    for (0..50) |i| {
        points[i].x = @intCast(i);
        points[i].y = @intCast(i * 2);
    }
}
```

Expected: False sharing detection if applicable

### Phase 2: Runtime Integration

1. Verify runtime library works with Zig linkage
2. Test thread-safety with Zig's async/await
3. Handle Zig panic unwinding

### Phase 3: Build Integration

1. Create `cache-explore-zig` script
2. Update main `cache-explore` to detect .zig files
3. Add Zig detection to CLI

### Phase 4: Testing

1. Unit tests: Individual Zig programs
2. Integration tests: Full pipeline end-to-end
3. Performance tests: Compare overhead vs C/C++

## Challenges

1. **Standard Library Linking**
   - Zig's std lib is statically linked
   - May conflict with our runtime
   - Solution: Use `-lc` flag, link runtime as system library

2. **LLVM IR Compatibility**
   - Zig generates specific LLVM IR patterns
   - Our pass must handle Zig-specific constructs
   - Solution: Test with various Zig versions (0.11, 0.12, 0.13)

3. **Debug Info**
   - Need source file attribution
   - Zig may generate different debug info format
   - Solution: Test with `-g` flag, verify file:line in traces

4. **Async/Await**
   - Zig's async functions may have complex control flow
   - Instrumentation must handle coroutine state
   - Solution: Start with simple sync code, add async later

## Success Criteria

- [ ] `cache-explore file.zig` works end-to-end
- [ ] Trace output includes file:line attribution
- [ ] Cache simulation produces accurate hit/miss rates
- [ ] Works with Zig 0.11, 0.12, 0.13
- [ ] Integration tests pass
- [ ] Documentation updated

## Timeline

- Week 1: Phase 1 (Basic Support + TDD)
- Week 2: Phase 2 (Runtime Integration)
- Week 3: Phase 3 (Build Integration)
- Week 4: Phase 4 (Testing + Documentation)

## Resources

- [Zig Build System](https://ziglang.org/documentation/master/#Zig-Build-System)
- [Zig LLVM Backend](https://github.com/ziglang/zig/tree/master/src/codegen/llvm)
- [LLVM Pass Plugin Docs](https://llvm.org/docs/WritingAnLLVMNewPMPass.html)
