# Selective Instrumentation - Implementation Plan

## 🎯 Goal
Make Cache Explorer scale to large codebases (100K+ LOC) by instrumenting only the code that matters.

## 📊 Current Problems
- ✅ Works: Small programs (< 1K LOC)
- ⚠️ Slow: Medium programs (1K-10K LOC)
- ❌ Fails: Large programs (> 10K LOC)

**Issues:**
1. Every memory access instrumented → massive trace files
2. No sampling → 100% overhead
3. No selective instrumentation → instruments everything

## ✅ TDD Approach

### Tests Created (All currently FAIL - as expected!)

1. **Test 1: Function Annotations**
   - Mark specific functions with `__attribute__((annotate("cache_profile")))`
   - Only instrumented functions generate trace events
   - Current: FAIL (instruments everything)

2. **Test 2: Sampling Mode**
   - `--sample-rate N` flag samples 1 in N accesses
   - Reduces overhead from 50% to < 1%
   - Current: FAIL (flag doesn't exist)

3. **Test 3: File Filtering**
   - `--instrument-only` and `--exclude` flags
   - Target specific files/patterns
   - Current: FAIL (flags don't exist)

4. **Test 4: Large Codebase Performance**
   - 10K LOC, 100 functions, call only 1
   - Should compile fast, generate small trace
   - Current: FAIL (instruments all 100 functions)

## 🔧 Implementation Steps

### Phase 1: Function Annotations (Easiest)

**Files to modify:**
- `backend/llvm-pass/CacheExplorerPass.cpp`

**Changes:**
```cpp
bool shouldInstrumentFunction(Function &F) {
    // Check for cache_profile annotation
    if (F.hasFnAttribute("annotate")) {
        for (auto &attr : F.getAttributes().getFnAttrs()) {
            if (auto *strAttr = dyn_cast<StringAttr>(&attr)) {
                if (strAttr->getStringValue() == "cache_profile") {
                    return true;
                }
            }
        }
        return false; // Has annotations, but not cache_profile
    }

    return true; // No annotations = instrument by default (backward compat)
}

// In runOnModule:
for (Function &F : M) {
    if (!shouldInstrumentFunction(F)) {
        continue; // Skip this function
    }
    // ... existing instrumentation code
}
```

**Test command:**
```bash
clang++ -fpass-plugin=CacheProfiler.so annotated.cpp -o test
./test | cache-sim --json
# Should see ~200 events (only from hot_function)
```

---

### Phase 2: CLI Flags (Most Useful)

**Files to modify:**
- `backend/llvm-pass/CacheExplorerPass.cpp` (add command-line options)
- `backend/scripts/cache-explore` (pass flags through)

**LLVM Pass changes:**
```cpp
#include "llvm/Support/CommandLine.h"

static cl::list<std::string> InstrumentOnly(
    "cache-instrument-only",
    cl::desc("Only instrument functions/files matching pattern"),
    cl::ZeroOrMore
);

static cl::list<std::string> ExcludePatterns(
    "cache-exclude",
    cl::desc("Exclude functions/files matching pattern"),
    cl::ZeroOrMore
);

bool shouldInstrumentFunction(Function &F) {
    StringRef filename = F.getParent()->getSourceFileName();
    StringRef funcname = F.getName();

    // Check exclusions first
    for (const auto &pattern : ExcludePatterns) {
        if (filename.contains(pattern) || funcname.contains(pattern)) {
            return false;
        }
    }

    // If whitelist exists, only instrument matches
    if (!InstrumentOnly.empty()) {
        for (const auto &pattern : InstrumentOnly) {
            if (filename.contains(pattern) || funcname.contains(pattern)) {
                return true;
            }
        }
        return false; // Not in whitelist
    }

    return true; // No filters = instrument everything
}
```

**cache-explore script changes:**
```bash
# Add new flags
INSTRUMENT_ONLY=""
EXCLUDE_PATTERNS=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --instrument-only)
            INSTRUMENT_ONLY="$2"
            shift 2
            ;;
        --exclude)
            EXCLUDE_PATTERNS="$2"
            shift 2
            ;;
        # ... existing flags
    esac
done

# Pass to clang
if [ -n "$INSTRUMENT_ONLY" ]; then
    EXTRA_FLAGS="$EXTRA_FLAGS -mllvm -cache-instrument-only=$INSTRUMENT_ONLY"
fi
```

**Test command:**
```bash
cache-explore program.cpp --instrument-only "hot_path" --exclude "third_party/*"
```

---

### Phase 3: Sampling (Lowest Overhead)

**Files to modify:**
- `backend/llvm-pass/CacheExplorerPass.cpp`
- `backend/runtime/cache-explorer-rt.c`

**Approach 1: Compile-Time Sampling (Simple)**
```cpp
static cl::opt<unsigned> SampleRate(
    "cache-sample-rate",
    cl::desc("Sample 1 in N memory accesses (0 = no sampling)"),
    cl::init(0)
);

void instrumentMemoryAccess(Instruction *I) {
    if (SampleRate.getValue() > 0) {
        // Only instrument 1 in N instructions
        static unsigned counter = 0;
        if (counter++ % SampleRate.getValue() != 0) {
            return; // Skip this access
        }
    }

    // ... normal instrumentation
}
```

**Approach 2: Runtime Sampling (More Accurate)**
```cpp
// In runtime library
static __thread unsigned sample_counter = 0;
static unsigned sample_rate = 100;

void __tag_mem_load(void *addr, unsigned size, const char *file, unsigned line, unsigned tid) {
    if (sample_rate > 0 && (sample_counter++ % sample_rate != 0)) {
        return; // Skip this sample
    }

    // ... record access
}
```

**Test command:**
```bash
cache-explore program.cpp --sample-rate 100  # Sample 1%
```

---

## 📈 Expected Results After Implementation

| Test | Before | After | Improvement |
|------|--------|-------|-------------|
| **Annotations** | 400 events | 200 events | 2x smaller trace |
| **Sampling (1%)** | 10,000 events | 100 events | 100x smaller trace |
| **File filtering** | 200 events | 100 events | 2x smaller trace |
| **Large codebase** | 30s compile, 1M events | 3s compile, 200 events | **10x faster, 5000x smaller** |

## 🎯 Success Criteria

All 4 TDD tests pass:
- ✅ Function annotations work
- ✅ Sampling mode works
- ✅ File filtering works
- ✅ Large codebase compiles fast, generates small trace

## 📝 Implementation Order

1. **Week 1: Function Annotations** (1-2 days)
   - Easiest to implement
   - Demonstrates concept
   - Make Test 1 pass

2. **Week 2: CLI Flags** (2-3 days)
   - Most useful feature
   - Make Tests 3 & 4 pass

3. **Week 3: Sampling** (2-3 days)
   - Lowest overhead option
   - Make Test 2 pass

4. **Week 4: Integration & Documentation**
   - Update README with examples
   - Add to integration test suite
   - Performance benchmarks

## 🚀 Next Steps

1. Run TDD tests: `./test_selective.sh` (all should fail)
2. Implement Phase 1 (function annotations)
3. Re-run tests (Test 1 should pass)
4. Implement Phase 2 (CLI flags)
5. Re-run tests (Tests 3 & 4 should pass)
6. Implement Phase 3 (sampling)
7. Re-run tests (all should pass!)
8. Merge to main

---

**Current Status:** ✅ TDD tests written, all failing (as expected)
**Next:** Implement Phase 1 (function annotations)
