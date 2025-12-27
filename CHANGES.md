# Cache Explorer - Change Log

## 2024-12-26: C++ Support Fixes

### Bug Fixes

#### 1. C++ Exception Handling Broken (Critical)
**Problem:** Inserting `__tag_bb_entry` at the start of exception handler blocks broke C++ exception handling. The `landingpad` instruction MUST be the first non-PHI instruction in landing pad blocks.

**Error:** `LandingPadInst not the first non-PHI instruction in the block`

**Fix:** Skip basic block instrumentation for landing pad blocks:
```cpp
// Skip PHI nodes to find the first real instruction
while (isa<PHINode>(firstInst))
  firstInst = firstInst->getNextNode();

// Don't instrument exception handler blocks (C++ exception handling)
if (isa<LandingPadInst>(firstInst))
  continue;
```
**File:** `backend/llvm-pass/CacheExplorerPass.cpp:228-234`

---

#### 2. STL Template Instrumentation Slowdown
**Problem:** C++ with STL headers (iostream, vector, etc.) caused extremely slow compilation because the pass was processing hundreds of template instantiations.

**Fix:** Added two-tier filtering:

1. **Fast function name check** (avoids debug info lookup):
```cpp
bool isLibraryFunctionName(StringRef Name) {
  if (Name.starts_with("_ZNSt") || Name.starts_with("_ZSt"))  // libc++/libstdc++
    return true;
  if (Name.starts_with("__clang_") || Name.starts_with("__cxx_"))
    return true;
  return false;
}
```

2. **System header path check:**
```cpp
bool isSystemHeader(StringRef Filename) {
  if (Filename.starts_with("/usr/include") ||
      Filename.starts_with("/opt/homebrew") ||
      Filename.contains("/include/c++/"))
    return true;
  return false;
}
```
**File:** `backend/llvm-pass/CacheExplorerPass.cpp:16-70`

**Result:** Compilation time with STL: ~0.46s (was infinite hang)

---

#### 3. Pass Not Running at -O0
**Problem:** `registerOptimizerLastEPCallback` doesn't properly trigger at -O0 when using `createModuleToFunctionPassAdaptor`.

**Fix:** Created a `CacheExplorerModulePass` that manually iterates over functions:
```cpp
class CacheExplorerModulePass : public PassInfoMixin<CacheExplorerModulePass> {
public:
  PreservedAnalyses run(Module &M, ModuleAnalysisManager &AM);
};
```
**Files:**
- `backend/llvm-pass/CacheExplorerPass.hpp:11-15`
- `backend/llvm-pass/CacheExplorerPass.cpp:244-273`

---

#### 4. BlockAddress ARM64 Issues
**Problem:** Using `BlockAddress::get(&BB)` for I-cache tracking caused ARM64 codegen failures.

**Error:** `fatal error: error in backend: Not supported instr`

**Fix:** Changed `__tag_bb_entry` signature from `void*` to `uint64_t` and use a unique counter instead:
```cpp
// Old: Value *BBAddr = BlockAddress::get(&BB);
// New: Use unique counter
Value *BBID = ConstantInt::get(Type::getInt64Ty(Ctx), GlobalBBCounter++);
```
**Files:**
- `backend/llvm-pass/CacheExplorerPass.cpp:238-239`
- `backend/runtime/cache-explorer-rt.h:28`
- `backend/runtime/cache-explorer-rt.c:83-88`

---

### Features Added

#### 1. C++ Language Support
- Added C++ file extension detection (`.cpp`, `.cc`, `.cxx`, `.C`)
- Language selector in frontend UI
- C++ examples (struct, AoS vs SoA, templates)

**Files:**
- `backend/scripts/cache-explore`
- `backend/server/server.js`
- `frontend/src/App.tsx`

#### 2. Debug Output for Pass
Added `CACHE_EXPLORER_DEBUG=1` environment variable for debugging:
```bash
CACHE_EXPLORER_DEBUG=1 clang++ -fpass-plugin=... file.cpp
# Output: [INSTRUMENT] main @ /tmp/file.cpp
#         [SKIP libfunc] _ZNSt3__16vectorIiE...
```

#### 3. Optional STL/Standard Library Instrumentation
Added `CACHE_EXPLORER_INCLUDE_STL=1` to instrument standard library functions:
```bash
# Default: STL filtered (instruments ~2 functions for simple program)
clang++ -fpass-plugin=... file.cpp

# With STL: Full instrumentation (instruments ~150 functions for same program)
CACHE_EXPLORER_INCLUDE_STL=1 clang++ -fpass-plugin=... file.cpp
```

**Use cases for STL instrumentation:**
- Understanding `std::vector` reallocation behavior
- Detecting false sharing in `std::atomic`
- Comparing cache behavior of `std::map` vs `std::unordered_map`
- Educational: See how STL containers access memory

**Trade-offs:**
- More detailed cache analysis
- Slower compilation (75x more functions to process)
- Larger trace files
- Noisier output (harder to find user code hotspots)

#### 4. Rust Standard Library Filtering
Added filtering for Rust std/core/alloc crates:
```cpp
// Rust mangled names
if (Name.starts_with("_ZN3std") ||   // std::*
    Name.starts_with("_ZN4core") ||  // core::*
    Name.starts_with("_ZN5alloc"))   // alloc::*
  return true;
```

---

## What's Working Now

| Feature | Status |
|---------|--------|
| C code | Working |
| C++ without STL | Working |
| C++ with STL (iostream, vector, etc.) | Working |
| C++ classes with member functions | Working |
| I-cache tracking | Working |
| D-cache tracking | Working |
| ARM64 (Apple Silicon) | Working |

## Known Limitations

1. **Rust support** - On roadmap (see FUTURE_DEV.md)
   - LLVM pass works on Rust IR, but linking is complex
   - Rust std library filtering already implemented
2. **Multi-threading visualization** - Planned feature
3. **Assembly view** - Planned feature
4. **Security sandboxing** - Not yet implemented (needed for web app)
