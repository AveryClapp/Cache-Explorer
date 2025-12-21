# Cache Explorer: Path to Production-Grade Profiler

## Executive Summary

**Current Plan (CLAUDE.md):** Educational tool using LLVM interpreter (lli) for accuracy at the cost of performance (100-1000x slowdown).

**Revised Ambition:** Build toward an **industry-standard production profiler** that can compete with perf/VTune/cachegrind on real-world codebases, not just educational snippets.

**Strategy:** Dual-track development - start with educational tool to validate cache simulator, then extend to production profiler reusing core components.

## Why Industry-Standard? (Motivation)

### Current Tools Have Gaps

**perf/cachegrind:**
- Heavyweight, hard to interpret
- Batch analysis, no real-time feedback
- Poor visualization, steep learning curve
- Can't "play with code" to understand cache behavior

**VTune:**
- Commercial, expensive
- Closed source, Intel-only optimization
- Overkill for learning, complex UI

**Compiler Explorer:**
- Shows assembly, but no cache behavior analysis
- No runtime profiling, static view only

### Our Opportunity

**A cache profiler that:**
1. **Works on production code** (not just snippets) - 2-10x overhead acceptable
2. **Real-time visualization** - see cache behavior as code runs
3. **Interactive exploration** - modify code, instantly see impact
4. **Educational AND practical** - learn cache optimization, then apply to real projects
5. **Open source** - community-driven, extensible
6. **Multi-platform** - LLVM + perf support, not vendor-locked

**Portfolio Impact:** Demonstrates systems engineering at scale - compiler infrastructure, architecture, performance engineering, distributed systems.

## Technical Approaches: Tradeoffs

### Approach 0: lli Interpreter (Current Plan)

**Architecture:**
```
User code → Clang → LLVM IR → Modified lli (instrumented) → Cache sim → WebSocket
```

**Performance:** 100-1000x slowdown (interpreted execution)

**Pros:**
- Simplest to implement
- 100% accurate (every memory access tracked)
- Full control over execution
- Great for learning/exploration

**Cons:**
- Cannot handle production workloads (timeouts on real code)
- No integration with existing workflows
- Docker overhead adds latency
- Limited to small snippets

**Verdict:** ✅ Perfect for Phase 1-4 (educational MVP), validates cache simulator correctness

---

### Approach 1: LLVM Instrumentation Pass ⭐ PRIMARY PRODUCTION PATH

**Architecture:**
```
User code → Clang + CacheProfilerPass → Instrumented binary → Profiling library → Cache sim
                                      ↓
                              Native execution (fast!)
```

**Performance:** 2-5x slowdown (native code + tracking calls)

**How it works:**
```cpp
// Compiler pass inserts tracking calls at compile time
void CacheProfilerPass::visitLoadInst(LoadInst &LI) {
    IRBuilder<> B(&LI);
    B.CreateCall(cache_track_load, {
        LI.getPointerOperand(),  // Address
        getTypeSize(LI.getType()), // Size
        getSourceLocation(&LI)   // File:line for attribution
    });
}
```

Compile with: `clang -O2 -fpass-plugin=CacheProfiler.so mycode.c`

**Pros:**
- Native execution speed (acceptable overhead)
- Full source attribution (debug info preserved)
- Works with any LLVM language (C/C++/Rust/Swift)
- Can optimize instrumentation (only track hot loops, configurable sampling)
- Integrates with build systems (drop-in replacement for clang)
- Deterministic profiling (not sampling-based)

**Cons:**
- Requires recompilation with instrumentation
- Only works for LLVM-based compilers (no GCC without recompile)
- More complex than interpreter (but manageable)

**Verdict:** ✅ This is the production path. Build after educational tool validates cache simulator.

**Timeline:** Phase 5-6 (after educational MVP working)

---

### Approach 2: Binary Instrumentation (Intel Pin / DynamoRIO)

**Architecture:**
```
Existing binary → Pin/DynamoRIO → JIT with instrumentation → Cache sim
```

**Performance:** 5-20x slowdown (dynamic instrumentation overhead)

**How it works:**
```cpp
// Runtime instrumentation of any binary
VOID Instruction(INS ins, VOID *v) {
    if (INS_IsMemoryRead(ins)) {
        INS_InsertCall(ins, IPOINT_BEFORE,
            (AFUNPTR)RecordMemRead,
            IARG_MEMORYREAD_EA,    // Runtime address
            IARG_MEMORYREAD_SIZE,
            IARG_END);
    }
}

// Run: pin -t CacheProfiler.so -- ./myprogram
```

**Pros:**
- Works with ANY compiler (GCC, Clang, MSVC, proprietary)
- No recompilation needed
- Can profile third-party binaries
- Mature frameworks (Pin production-tested at Intel)

**Cons:**
- Slower than compiler instrumentation (5-20x vs 2-5x)
- Harder to get source attribution (need DWARF parsing)
- Large runtime dependency (~100MB+ framework)
- Primarily x86-64 Linux (Pin), limited ARM support

**Verdict:** ⚠️ Consider for Phase 7+ to support GCC/proprietary compilers

**Use case:** When users can't recompile (vendor libraries, GCC legacy code)

---

### Approach 3: Hardware Counters + Simulation (Hybrid) 🚀 INNOVATIVE

**Architecture:**
```
User code (native, unmodified) → perf record -e cache-misses
                                        ↓
                                  Sample on miss events
                                        ↓
                    Reconstruct trace → Feed to cache simulator
                                        ↓
                            Visualization with real + simulated data
```

**Performance:** 1-5% overhead (sampling-based, hardware-assisted)

**How it works:**
```bash
# Sample on L3 cache misses
perf record -e cache-misses:u -c 10000 ./myprogram

# Parse perf.data, extract memory addresses + source locations
# Feed to your cache simulator for rich visualization
# Combine real hardware behavior + simulation insights
```

**Pros:**
- Minimal overhead (production-acceptable)
- Works with any binary (no recompilation)
- Real hardware validation (not pure simulation)
- Your cache model adds value: visualization, what-if scenarios, educational insights
- Innovation: combines perf's speed with your simulator's insights

**Cons:**
- Statistical (sampling), not complete trace
- Requires root/CAP_PERFMON capabilities
- Hardware-specific (Intel vs AMD vs ARM counters differ)
- Complex: synchronizing perf data with simulation
- May miss short-lived cache effects between samples

**Verdict:** 🎯 Phase 8+ (advanced). Most interesting for research/differentiation.

**Unique value:** "perf gives you data, Cache Explorer explains WHY"

---

### Approach 4: eBPF-based Profiling (Modern)

**Architecture:**
```
User code → eBPF hooks in kernel → Aggregate stats → Cache model
```

**Performance:** 1-3% overhead (kernel-level hooks)

**Pros:**
- Very low overhead
- Safe (eBPF verified by kernel)
- No recompilation needed
- Modern, future-proof

**Cons:**
- Linux-only
- Complex eBPF programming
- May not have full memory access visibility without kernel support
- Newer technology, less proven for detailed profiling

**Verdict:** 🔬 Research territory. Monitor as eBPF profiling matures.

---

## Recommended Dual-Track Strategy

### Track 1: Educational Tool (Phase 1-4) - Foundation

**Goal:** Validate cache simulator correctness, build visualization, prove concept

**Approach:** Modified lli interpreter (current CLAUDE.md plan)

**Deliverables:**
- Web-based editor + visualization
- Cache simulator (L1/L2/L3, coherence, replacement policies)
- Small code snippets, instant feedback
- Learning resource (blog posts, examples)

**Timeline:** 3-6 months

**Why this first:**
- Simplest to implement
- Tests cache simulator against known-good examples
- Builds domain expertise
- Creates reusable components (simulator, visualization)

### Track 2: Production Profiler (Phase 5+) - Scale

**Goal:** Handle real-world codebases, integrate with developer workflows

**Approach:** LLVM instrumentation pass (Approach 1)

**Deliverables:**
- Clang plugin for compile-time instrumentation
- CLI tool (`cache-explorer profile ./myprogram`)
- Build system integration (CMake, Bazel, Cargo)
- Reuses cache simulator from Track 1
- Performance target: 2-5x overhead

**Timeline:** 6-12 months after Track 1 complete

**Why LLVM pass:**
- Best performance/capability tradeoff
- Clean integration with modern toolchains
- Deterministic profiling (vs sampling)
- Aligns with LLVM ecosystem growth

### Track 3: Advanced Features (Phase 7+) - Differentiation

**Approach:** Hybrid (perf + simulation) or Binary instrumentation

**Deliverables:**
- GCC support via Intel Pin
- Hardware validation mode (perf integration)
- Comparative analysis: simulated vs real hardware
- Advanced visualizations (cache coherence timelines, false sharing heatmaps)

**Timeline:** 12-18 months

---

## Architectural Changes Needed

### Current Structure (Educational Focus)
```
backend/
├── cache-simulator/        # Cache model (L1/L2/L3)
├── instrumentation/        # lli hooks (interpreter)
├── server/                 # WebSocket server
└── third-party/            # LLVM interpreter source
```

### Production-Ready Structure (Dual-Track)
```
backend/
├── cache-simulator/        # 🔄 SHARED: Cache model (both tracks use this)
│   ├── CacheSimulator.{h,cpp}
│   ├── CacheLevel.{h,cpp}
│   ├── ReplacementPolicy.{h,cpp}
│   └── CoherenceProtocol.{h,cpp}
│
├── instrumentation/
│   ├── lli-hooks/         # Track 1: Educational (interpreter)
│   │   └── CacheExplorerInterpreter.{h,cpp}
│   └── llvm-pass/         # Track 2: Production (compiler pass) - Phase 5
│       ├── CacheProfilerPass.{h,cpp}
│       └── RuntimeLibrary.{h,cpp}  # Lightweight tracking lib
│
├── server/                 # Track 1: WebSocket for browser UI
│   └── WebSocketServer.{h,cpp}
│
├── cli/                    # Track 2: Production CLI tool - Phase 5
│   ├── main.cpp
│   ├── ProfileRunner.{h,cpp}
│   └── ReportGenerator.{h,cpp}
│
└── third-party/
    ├── llvm-interpreter/   # Track 1: lli source
    └── perf-parser/        # Track 3: perf.data integration - Phase 8
```

**Key insight:** Cache simulator is the crown jewel - both tracks depend on it being correct.

---

## Updated CLAUDE.md Additions

Add this section to CLAUDE.md:

```markdown
## Long-Term Vision: Industry-Standard Profiler

**Cache Explorer will be TWO tools:**

### 1. Interactive Learning Tool (Phase 1-4)
- **Technology:** Modified LLVM interpreter (lli)
- **Use case:** Students, developers learning cache optimization
- **Performance:** Slow (100-1000x), but 100% accurate
- **Interface:** Web browser, instant visualization
- **Timeline:** 3-6 months

### 2. Production Profiler (Phase 5+)
- **Technology:** LLVM instrumentation pass
- **Use case:** Profiling real applications (production codebases)
- **Performance:** Fast (2-5x overhead), production-acceptable
- **Interface:** CLI tool, integrates with build systems
- **Timeline:** 6-12 months after learning tool

**Why both?**
- Learning tool validates cache simulator correctness
- Production tool reuses simulator for real-world impact
- Together: learn cache behavior, then optimize production code
- Competes with perf/VTune as open-source alternative

**Shared components:**
- Cache simulator (L1/L2/L3 hierarchy, coherence, replacement policies)
- Visualization library (web + terminal)
- Source attribution (DWARF debug info parsing)

**Differentiation from perf/VTune:**
- Interactive "what-if" exploration (perf is batch-only)
- Educational AND practical (VTune is experts-only)
- Open source, community-driven
- Real-time visualization during profiling
```

---

## Success Criteria

### Educational Tool (Track 1)
- ✅ User pastes code, sees cache behavior within 2 seconds
- ✅ Handles snippets up to ~200 lines
- ✅ Visualization clearly shows hit/miss patterns
- ✅ Used in university courses / cited in blog posts

### Production Profiler (Track 2)
- ✅ Profiles real applications (10K+ LOC) with <5x overhead
- ✅ Integrates with CMake/Cargo/Bazel
- ✅ Developers find and fix cache issues in production code
- ✅ Benchmarked against perf/VTune (comparable insights, better UX)
- ✅ GitHub stars > 1000, production users

### Industry Recognition (Track 3)
- ✅ Conference talks (LLVM Dev Meeting, systems conferences)
- ✅ Adopted by companies for performance engineering
- ✅ Cited in research papers
- ✅ Contributions from external developers

---

## Next Actions

1. **Complete educational MVP (Phase 1-4)** - current CLAUDE.md plan
2. **Document LLVM pass architecture** - design Phase 5 while building Phase 1
3. **Build production profiler** - reuse validated cache simulator
4. **Expand with advanced features** - perf integration, GCC support

**The educational tool teaches you.
The production tool proves you can scale it.
Together, they're an industry-standard solution.**

---

## References

- [LLVM Pass Development](https://llvm.org/docs/WritingAnLLVMPass.html)
- [Intel Pin](https://www.intel.com/content/www/us/en/developer/articles/tool/pin-a-dynamic-binary-instrumentation-tool.html)
- [perf Examples](http://www.brendangregg.com/perf.html)
- [cachegrind](https://valgrind.org/docs/manual/cg-manual.html) - reference implementation
- [VTune](https://www.intel.com/content/www/us/en/developer/tools/oneapi/vtune-profiler.html) - commercial competitor

---

**Last updated:** December 2025
**Status:** Educational MVP in progress → Production profiler planned for Phase 5
