# C++ Codebase Modernization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Modernize the cache simulator C++ codebase by splitting header-only classes, refactoring main.cpp, and applying modern C++ practices.

**Architecture:** Split large header-only implementations into `.hpp`/`.cpp` pairs, extract main.cpp into focused modules (arg parsing, JSON output), and standardize on modern C++ idioms (`[[nodiscard]]`, `snake_case`, `constexpr`).

**Tech Stack:** C++17, CMake, Ninja

---

## Phase 1: Split Header-Only Classes into .hpp/.cpp Pairs

### Task 1.1: Create MultiCoreCacheSystem.cpp

**Files:**
- Modify: `include/MultiCoreCacheSystem.hpp` (keep declarations only)
- Create: `src/MultiCoreCacheSystem.cpp` (move implementations)
- Modify: `CMakeLists.txt` (add new source)

**Step 1: Create the .cpp file with implementations**

Create `src/MultiCoreCacheSystem.cpp`:

```cpp
#include "../include/MultiCoreCacheSystem.hpp"

int MultiCoreCacheSystem::get_core_for_thread(uint32_t thread_id) {
    auto it = thread_to_core.find(thread_id);
    if (it != thread_to_core.end()) {
        return it->second;
    }
    int core = next_core % num_cores;
    thread_to_core[thread_id] = core;
    next_core++;
    return core;
}

void MultiCoreCacheSystem::issue_prefetches(int core, uint64_t miss_addr, uint64_t pc) {
    if (prefetch_policy == PrefetchPolicy::NONE) return;

    auto prefetch_addrs = prefetchers[core]->on_miss(miss_addr, pc);
    for (uint64_t pf_addr : prefetch_addrs) {
        uint64_t line_addr = get_line_address(pf_addr);
        if (l1_caches[core]->is_present(line_addr)) continue;

        bool others_have_it = false;
        for (int other = 0; other < num_cores; other++) {
            if (other != core && l1_caches[other]->is_present(line_addr)) {
                others_have_it = true;
                break;
            }
        }

        CoherenceState pf_state = others_have_it ? CoherenceState::Shared : CoherenceState::Exclusive;
        if (!l2.is_present(line_addr)) {
            l3.access(line_addr, false);
            l2.install(line_addr, false);
        }
        l1_caches[core]->install_with_state(line_addr, pf_state);
    }
}

void MultiCoreCacheSystem::track_access_for_false_sharing(
    uint64_t addr, uint32_t thread_id, bool is_write,
    const std::string& file, uint32_t line) {

    uint64_t line_addr = get_line_address(addr);
    uint32_t byte_offset = addr & (line_size - 1);

    auto& accesses = line_accesses[line_addr];
    accesses.push_back({thread_id, byte_offset, is_write, file, line});

    std::unordered_set<uint32_t> threads_seen;
    std::unordered_set<uint32_t> offsets_seen;
    bool has_write = false;

    for (const auto& a : accesses) {
        threads_seen.insert(a.thread_id);
        offsets_seen.insert(a.byte_offset);
        if (a.is_write) has_write = true;
    }

    if (threads_seen.size() > 1 && offsets_seen.size() > 1 && has_write) {
        if (false_sharing_lines.insert(line_addr).second) {
            false_sharing_count++;
        }
    }
}

MultiCoreCacheSystem::MultiCoreCacheSystem(
    int cores, const CacheConfig& l1_cfg,
    const CacheConfig& l2_cfg, const CacheConfig& l3_cfg,
    PrefetchPolicy pf_policy, int pf_degree)
    : num_cores(cores), l2(l2_cfg), l3(l3_cfg), coherence(cores),
      prefetch_policy(pf_policy), prefetch_degree(pf_degree),
      line_size(l1_cfg.line_size) {

    for (int i = 0; i < cores; i++) {
        l1_caches.push_back(std::make_unique<CacheLevel>(l1_cfg));
        coherence.register_cache(i, l1_caches[i].get());
        prefetchers.push_back(std::make_unique<Prefetcher>(pf_policy, pf_degree, l1_cfg.line_size));
        dtlbs.push_back(std::make_unique<TLB>(TLBConfig{64, 4, 4096}));
    }
}

MultiCoreAccessResult MultiCoreCacheSystem::read(
    uint64_t address, uint32_t thread_id,
    const std::string& file, uint32_t line) {

    int core = get_core_for_thread(thread_id);
    track_access_for_false_sharing(address, thread_id, false, file, line);
    dtlbs[core]->access(address);

    uint64_t line_addr = get_line_address(address);

    auto l1_info = l1_caches[core]->access(line_addr, false);
    if (l1_info.result == AccessResult::Hit) {
        return {true, false, false, false};
    }

    issue_prefetches(core, line_addr);

    auto snoop = coherence.request_read(core, line_addr);
    if (snoop.was_modified) {
        coherence_invalidations++;
        l1_caches[snoop.data_source_core]->downgrade_to_shared(line_addr);
    }

    CoherenceState new_state = snoop.found ? CoherenceState::Shared : CoherenceState::Exclusive;

    auto l2_info = l2.access(line_addr, false);
    if (l2_info.result == AccessResult::Hit) {
        l1_caches[core]->install_with_state(line_addr, new_state);
        return {false, true, false, false};
    }

    auto l3_info = l3.access(line_addr, false);
    l2.install(line_addr, false);
    l1_caches[core]->install_with_state(line_addr, new_state);

    bool l3_hit = (l3_info.result == AccessResult::Hit);
    return {false, false, l3_hit, !l3_hit};
}

MultiCoreAccessResult MultiCoreCacheSystem::write(
    uint64_t address, uint32_t thread_id,
    const std::string& file, uint32_t line) {

    int core = get_core_for_thread(thread_id);
    track_access_for_false_sharing(address, thread_id, true, file, line);
    dtlbs[core]->access(address);

    uint64_t line_addr = get_line_address(address);

    auto snoop = coherence.request_exclusive(core, line_addr);
    if (snoop.found) {
        coherence_invalidations++;
    }

    auto l1_info = l1_caches[core]->access(line_addr, true);
    if (l1_info.result == AccessResult::Hit) {
        l1_caches[core]->set_coherence_state(line_addr, CoherenceState::Modified);
        return {true, false, false, false};
    }

    issue_prefetches(core, line_addr);

    auto l2_info = l2.access(line_addr, false);
    if (l2_info.result == AccessResult::Hit) {
        l1_caches[core]->install_with_state(line_addr, CoherenceState::Modified);
        return {false, true, false, false};
    }

    auto l3_info = l3.access(line_addr, false);
    l2.install(line_addr, false);
    l1_caches[core]->install_with_state(line_addr, CoherenceState::Modified);

    bool l3_hit = (l3_info.result == AccessResult::Hit);
    return {false, false, l3_hit, !l3_hit};
}

MultiCoreStats MultiCoreCacheSystem::get_stats() const {
    MultiCoreStats stats;
    for (const auto& l1 : l1_caches) {
        stats.l1_per_core.push_back(l1->getStats());
    }
    for (const auto& pf : prefetchers) {
        stats.prefetch_per_core.push_back(pf->getStats());
    }
    stats.l2 = l2.getStats();
    stats.l3 = l3.getStats();
    stats.coherence_invalidations = coherence_invalidations;
    stats.false_sharing_events = false_sharing_count;
    return stats;
}

TLBHierarchyStats MultiCoreCacheSystem::get_tlb_stats() const {
    TLBHierarchyStats stats;
    for (const auto& dtlb : dtlbs) {
        stats.dtlb += dtlb->get_stats();
    }
    return stats;
}

TLBStats MultiCoreCacheSystem::get_tlb_stats_for_core(int core) const {
    if (core < 0 || core >= num_cores) return TLBStats{};
    return dtlbs[core]->get_stats();
}

std::vector<FalseSharingReport> MultiCoreCacheSystem::get_false_sharing_reports() const {
    std::vector<FalseSharingReport> reports;
    for (uint64_t line_addr : false_sharing_lines) {
        FalseSharingReport report;
        report.cache_line_addr = line_addr;

        auto it = line_accesses.find(line_addr);
        if (it != line_accesses.end()) {
            for (const auto& a : it->second) {
                report.accesses.push_back({line_addr, a.file, a.line, a.thread_id,
                                           a.is_write, a.byte_offset});
            }
        }
        reports.push_back(report);
    }
    return reports;
}

CoherenceState MultiCoreCacheSystem::get_l1_coherence_state(int core, uint64_t address) const {
    if (core < 0 || core >= num_cores) return CoherenceState::Invalid;
    uint64_t line_addr = get_line_address(address);
    return l1_caches[core]->get_coherence_state(line_addr);
}

bool MultiCoreCacheSystem::is_line_in_l1(int core, uint64_t address) const {
    if (core < 0 || core >= num_cores) return false;
    uint64_t line_addr = get_line_address(address);
    return l1_caches[core]->is_present(line_addr);
}

const CacheLevel* MultiCoreCacheSystem::get_l1_cache(int core) const {
    if (core < 0 || core >= num_cores) return nullptr;
    return l1_caches[core].get();
}

PrefetchStats MultiCoreCacheSystem::get_prefetch_stats(int core) const {
    if (core < 0 || core >= num_cores) return PrefetchStats{};
    return prefetchers[core]->getStats();
}

void MultiCoreCacheSystem::reset_prefetch_stats() {
    for (auto& pf : prefetchers) {
        pf->resetStats();
    }
}
```

**Step 2: Update header to declarations only**

Update `include/MultiCoreCacheSystem.hpp` to contain only declarations (class definition with method signatures, no implementations).

**Step 3: Update CMakeLists.txt**

Add `src/MultiCoreCacheSystem.cpp` to the library sources.

**Step 4: Build and run tests**

```bash
cd build && ninja && ./MESICoherenceTest && ./MultiCorePrefetchTest && ./MultiCoreTLBTest
```

**Step 5: Commit**

```bash
git add src/MultiCoreCacheSystem.cpp include/MultiCoreCacheSystem.hpp CMakeLists.txt
git commit -m "refactor: split MultiCoreCacheSystem into .hpp/.cpp"
```

---

### Task 1.2: Create TraceProcessor.cpp

**Files:**
- Modify: `include/TraceProcessor.hpp`
- Create: `src/TraceProcessor.cpp`
- Modify: `CMakeLists.txt`

Follow same pattern as Task 1.1.

---

### Task 1.3: Create MultiCoreTraceProcessor.cpp

**Files:**
- Modify: `include/MultiCoreTraceProcessor.hpp`
- Create: `src/MultiCoreTraceProcessor.cpp`
- Modify: `CMakeLists.txt`

Follow same pattern as Task 1.1.

---

### Task 1.4: Create TLB.cpp

**Files:**
- Modify: `include/TLB.hpp`
- Create: `src/TLB.cpp`
- Modify: `CMakeLists.txt`

Follow same pattern as Task 1.1.

---

### Task 1.5: Create CoherenceController.cpp

**Files:**
- Modify: `include/CoherenceController.hpp`
- Create: `src/CoherenceController.cpp`
- Modify: `CMakeLists.txt`

Follow same pattern as Task 1.1.

---

### Task 1.6: Create OptimizationSuggester.cpp

**Files:**
- Modify: `include/OptimizationSuggester.hpp`
- Create: `src/OptimizationSuggester.cpp`
- Modify: `CMakeLists.txt`

Follow same pattern as Task 1.1.

---

### Task 1.7: Delete empty ReplacementPolicy.cpp

**Files:**
- Delete: `src/ReplacementPolicy.cpp`
- Modify: `CMakeLists.txt` (if referenced)

---

## Phase 2: Refactor main.cpp into Modules

### Task 2.1: Create ArgParser module

**Files:**
- Create: `include/ArgParser.hpp`
- Create: `src/ArgParser.cpp`
- Modify: `src/main.cpp`
- Modify: `CMakeLists.txt`

**Step 1: Create ArgParser.hpp**

```cpp
#pragma once

#include "../profiles/CacheConfig.hpp"
#include "Prefetcher.hpp"
#include <string>
#include <string_view>

struct SimulatorOptions {
    std::string config_name = "intel";
    CacheHierarchyConfig cache_config;
    int num_cores = 0;
    PrefetchPolicy prefetch_policy = PrefetchPolicy::NONE;
    int prefetch_degree = 2;
    bool verbose = false;
    bool json_output = false;
    bool stream_mode = false;
    bool flamegraph_output = false;
    bool show_help = false;
};

class ArgParser {
public:
    [[nodiscard]] static SimulatorOptions parse(int argc, char* argv[]);
    static void print_usage(std::string_view program_name);

    [[nodiscard]] static PrefetchPolicy parse_prefetch_policy(std::string_view name);
    [[nodiscard]] static std::string prefetch_policy_name(PrefetchPolicy policy);
    [[nodiscard]] static CacheHierarchyConfig get_preset_config(std::string_view name);
};
```

**Step 2: Create ArgParser.cpp with implementation**

Move argument parsing logic from main.cpp.

**Step 3: Update main.cpp to use ArgParser**

**Step 4: Build and test**

**Step 5: Commit**

---

### Task 2.2: Create JsonOutput module

**Files:**
- Create: `include/JsonOutput.hpp`
- Create: `src/JsonOutput.cpp`
- Modify: `src/main.cpp`
- Modify: `CMakeLists.txt`

**Step 1: Create JsonOutput.hpp**

```cpp
#pragma once

#include "CacheStats.hpp"
#include "MultiCoreCacheSystem.hpp"
#include "MultiCoreTraceProcessor.hpp"
#include "OptimizationSuggester.hpp"
#include "TLB.hpp"
#include "TraceProcessor.hpp"
#include <ostream>
#include <string>
#include <string_view>
#include <vector>

class JsonOutput {
public:
    // Utility
    [[nodiscard]] static std::string escape(std::string_view s);
    [[nodiscard]] static const char* coherence_state_char(CoherenceState state);

    // Streaming mode output
    static void write_start_event(std::ostream& out, std::string_view config_name, bool multicore);
    static void write_progress_event(std::ostream& out, size_t event_count, size_t thread_count,
                                     const CacheStats& l1_total, const CacheStats& l2,
                                     const CacheStats& l3, uint64_t coherence_invalidations);
    static void write_complete_event(std::ostream& out, const MultiCoreTraceProcessor& processor,
                                     const CacheHierarchyConfig& config, std::string_view config_name);

    // Batch mode output
    static void write_multicore_results(std::ostream& out, const MultiCoreTraceProcessor& processor,
                                        const CacheHierarchyConfig& config, std::string_view config_name,
                                        int num_cores, size_t num_threads, size_t event_count);
    static void write_singlecore_results(std::ostream& out, const TraceProcessor& processor,
                                         const CacheHierarchyConfig& config, std::string_view config_name,
                                         size_t event_count, PrefetchPolicy prefetch_policy, int prefetch_degree);

    // Component output helpers
    static void write_cache_stats(std::ostream& out, const char* name, const CacheStats& stats, bool last = false);
    static void write_tlb_stats(std::ostream& out, const TLBHierarchyStats& stats);
    static void write_timing_stats(std::ostream& out, const TimingStats& timing, const LatencyConfig& latency,
                                   uint64_t total_accesses);
    static void write_hot_lines(std::ostream& out, const std::vector<SourceStats>& hot_lines);
    static void write_hot_lines(std::ostream& out, const std::vector<MultiCoreSourceStats>& hot_lines);
    static void write_suggestions(std::ostream& out, const std::vector<OptimizationSuggestion>& suggestions);
    static void write_cache_state(std::ostream& out, const CacheLevel& cache, int core, bool first = true, bool multicore = true);
};
```

**Step 2: Create JsonOutput.cpp with implementation**

Move all JSON output logic from main.cpp.

**Step 3: Update main.cpp to use JsonOutput**

**Step 4: Build and test**

**Step 5: Commit**

---

## Phase 3: Apply Modern C++ Practices

### Task 3.1: Add [[nodiscard]] to all getters

**Files to modify:**
- `include/CacheLevel.hpp`
- `include/CacheSystem.hpp`
- `include/CacheStats.hpp`
- `include/MultiCoreCacheSystem.hpp`
- `include/TraceProcessor.hpp`
- `include/TLB.hpp`
- `include/Prefetcher.hpp`
- All other headers with getter methods

**Pattern:**
```cpp
// Before
const CacheStats& getStats() const { return stats; }

// After
[[nodiscard]] const CacheStats& get_stats() const { return stats; }
```

---

### Task 3.2: Standardize naming to snake_case

**All public methods should use snake_case:**

| Before | After |
|--------|-------|
| `getStats()` | `get_stats()` |
| `getConfig()` | `get_config()` |
| `getNumSets()` | `get_num_sets()` |
| `getAssociativity()` | `get_associativity()` |
| `getSizeKB()` | `get_size_kb()` |
| `getLineSize()` | `get_line_size()` |
| `getEvictionPolicy()` | `get_eviction_policy()` |
| `resetStats()` | `reset_stats()` |

Note: Keep `getStats()` as an alias temporarily for backward compatibility with tests.

---

### Task 3.3: Add constexpr where applicable

**Files:**
- `include/CacheStats.hpp` - rate calculation methods
- `include/TLB.hpp` - TLBConfig methods
- `profiles/CacheConfig.hpp` - CacheConfig methods

**Pattern:**
```cpp
// Before
size_t num_sets() const { return entries / associativity; }

// After
[[nodiscard]] constexpr size_t num_sets() const noexcept {
    return entries / associativity;
}
```

---

### Task 3.4: Use std::string_view for string parameters

**Files:**
- `include/MultiCoreCacheSystem.hpp` - read/write methods
- `include/TraceProcessor.hpp` - methods taking file names
- `include/JsonOutput.hpp` - all string parameters

**Pattern:**
```cpp
// Before
void process(const std::string& file, uint32_t line);

// After
void process(std::string_view file, uint32_t line);
```

Note: Only for read-only string parameters. Keep `std::string` for stored members.

---

### Task 3.5: Final cleanup and formatting

**Steps:**
1. Remove any remaining inline implementations in headers that should be in .cpp
2. Ensure consistent include order (system, then local)
3. Add `#pragma once` to any files missing it
4. Remove unused includes
5. Run all tests to verify nothing broke

**Final test command:**
```bash
cd build && ninja && \
  ./CacheLevelTest && \
  ./CacheSystemTest && \
  ./MESICoherenceTest && \
  ./MultiCorePrefetchTest && \
  ./MultiCoreTLBTest && \
  ./AdvancedInstrumentationTest
```

---

## Summary of Files Changed

**New files created:**
- `src/MultiCoreCacheSystem.cpp`
- `src/TraceProcessor.cpp`
- `src/MultiCoreTraceProcessor.cpp`
- `src/TLB.cpp`
- `src/CoherenceController.cpp`
- `src/OptimizationSuggester.cpp`
- `include/ArgParser.hpp`
- `src/ArgParser.cpp`
- `include/JsonOutput.hpp`
- `src/JsonOutput.cpp`

**Files modified:**
- `include/MultiCoreCacheSystem.hpp` (declarations only)
- `include/TraceProcessor.hpp` (declarations only)
- `include/MultiCoreTraceProcessor.hpp` (declarations only)
- `include/TLB.hpp` (declarations only)
- `include/CoherenceController.hpp` (declarations only)
- `include/OptimizationSuggester.hpp` (declarations only)
- `include/CacheLevel.hpp` (modern C++ additions)
- `include/CacheSystem.hpp` (modern C++ additions)
- `include/CacheStats.hpp` (modern C++ additions)
- `include/Prefetcher.hpp` (modern C++ additions)
- `src/main.cpp` (use new modules)
- `CMakeLists.txt` (add new sources)

**Files deleted:**
- `src/ReplacementPolicy.cpp` (empty)

---

## Expected Outcomes

1. **Faster compilation**: Changes to implementations don't recompile all dependents
2. **Cleaner separation**: Headers show API, cpp files show implementation
3. **Modern idioms**: `[[nodiscard]]`, `constexpr`, `string_view` catch bugs at compile time
4. **Consistent naming**: `snake_case` matches STL conventions
5. **main.cpp reduced**: From 990 lines to ~200 lines
