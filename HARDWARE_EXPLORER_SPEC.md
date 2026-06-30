# Hardware Explorer Spec

**Date:** 2026-06-25
**Status:** Proposed product and architecture roadmap
**Starting point:** Cache Explorer v1.x with memory hierarchy simulation, TLB
stats, timing estimates, multi-core coherence, false sharing detection, hardware
presets, validation scripts, and an in-progress execution-engine foundation.

**Implementation progress as of 2026-06-30:** Phase 0 is implemented as a
vertical slice: branch events, branch prediction, analytical pipeline estimates,
JSON output, frontend execution panel, docs, and integration coverage. Phase 1 is
partially implemented: `--hardware` aliases `--config`, profile metadata is
emitted in JSON, and the frontend has a Hardware Profile panel backed by
`profile.details` for cache, TLB, prefetch, execution-core, memory-latency, and
topology parameters. The examples now include both branch-heavy and
pointer-chasing execution-engine workloads.

**Performance notes:** Bottleneck source attribution is collected during the
existing trace-processing pass. Summary selection scans aggregated source
locations rather than the raw trace, and the frontend folds hardware source
badges into the existing Monaco decoration update instead of adding a second
editor pass.

## Summary

Hardware Explorer is the staged evolution of Cache Explorer from a cache-focused
tool into a broader hardware interaction workbench. The goal is not to become a
cycle-accurate CPU emulator. The goal is to help users understand how source
code interacts with modeled hardware: caches, TLBs, prefetchers, branch
predictors, an approximate out-of-order pipeline, memory latency/bandwidth, and
multi-core coherence.

Cache Explorer should remain the public name until execution-engine results are
visible, tested, and documented in the CLI and web UI. "Hardware Explorer" is the
umbrella concept and eventual product name once cache is one subsystem among
several.

## Current Baseline

The repository already has the right foundation:

- LLVM/runtime trace path:
  `LLVM pass -> runtime tags -> text trace -> TraceEvent -> TraceProcessor`.
- Memory events:
  loads, stores, instruction fetches, prefetch hints, vectors, atomics, memcpy,
  memset, and memmove.
- Memory hierarchy model:
  L1D, L1I, L2, L3, replacement policies, inclusion policy, write policy, TLB
  stats, timing estimates, prefetch stats, 3C classification, hot lines, and
  source attribution.
- Multi-core model:
  per-core L1, shared lower levels, MESI/coherence stats, false sharing reports.
- Hardware presets:
  Intel, AMD, Apple, ARM, RISC-V, embedded, educational, and server variants.
- Frontend:
  React/Monaco workbench with cache hierarchy visualization, metric cards, hot
  lines, suggestions, TLB details, timing types, advanced instrumentation stats,
  and final cache-grid state.
- Validation:
  perf-based cache validation docs and scripts, with a saved Xeon 8488C baseline.
- Hardware Explorer foundation already in progress:
  branch trace events, `BranchPredictor`, `PipelineModel`, and single-core text
  output for estimated execution-engine stats.

The main gap is productization. Branch prediction and pipeline estimates are not
yet first-class JSON/server/frontend concepts, and the current result schema
still treats everything as cache-centric.

## Product Promise

Hardware Explorer answers:

- What hardware subsystem limited this code?
- Which source lines caused those effects?
- How would the behavior change on another hardware profile?
- Which optimization would likely move the bottleneck?
- How confident is the model, and what real counter would validate it?

The wording should be deliberately approximate:

> Explore how code interacts with modeled hardware.

Avoid:

> Accurately simulates any CPU.

## Non-Goals

- Cycle-accurate Tomasulo/ROB simulation.
- Exact proprietary Intel/AMD/Apple branch predictor behavior.
- Exact turbo, DVFS, thermal throttling, OS scheduling, interrupts, or SMT
  behavior.
- GPU, accelerator, or device simulation.
- Binary-only full-system execution.
- Claiming wall-clock runtime predictions as benchmark replacements.

## Design Principles

1. Keep source attribution as the core advantage.
2. Model subsystems independently, then compose their results.
3. Every metric should expose evidence and confidence.
4. Prefer educational and directional accuracy over fake precision.
5. Keep cache workflows excellent; do not bury the original use case.
6. Add hardware breadth in vertical slices, not speculative abstractions.

## Proposed Architecture

### Hardware Profile

Replace the current cache-only profile concept with a broader profile while
keeping compatibility with existing `--config` names.

```cpp
struct HardwareProfile {
  std::string id;
  std::string display_name;
  std::string vendor;
  std::string architecture;
  CacheHierarchyConfig cache;
  TLBConfig tlb;
  PrefetchConfig prefetch;
  ExecutionCoreConfig execution;
  MemorySystemConfig memory;
  TopologyConfig topology;
  ValidationMetadata validation;
};
```

The existing `CacheHierarchyConfig` remains valid and becomes the `cache` member
inside the broader profile.

### Execution Core Config

```cpp
struct ExecutionCoreConfig {
  int issue_width = 4;
  int rob_size = 192;
  int branch_mispredict_penalty = 14;
  int load_store_queue_size = 72;
  int max_memory_level_parallelism = 8;
  BranchPredictorConfig branch_predictor;
};
```

Initial fields should match what the current `PipelineConfig` can actually use.
Future fields can exist behind feature flags only when a model consumes them.

### Result Schema

Keep legacy top-level fields for compatibility, but introduce a subsystem-based
schema for Hardware Explorer.

```json
{
  "config": "intel14",
  "profile": {
    "id": "intel14",
    "displayName": "Intel 14th Gen P-Core",
    "modelConfidence": "directional"
  },
  "events": 12345,
  "summary": {
    "primaryBottleneck": "memory",
    "estimatedCycles": 93021,
    "topSource": "matrix.c:42"
  },
  "subsystems": {
    "cache": {},
    "tlb": {},
    "prefetch": {},
    "coherence": {},
    "branchPrediction": {},
    "pipeline": {},
    "memorySystem": {}
  },
  "explanations": []
}
```

The current `levels`, `tlb`, `timing`, `prefetch`, `coherence`, `hotLines`,
`falseSharing`, and `suggestions` fields can remain during migration.

### Explanation Objects

Every nontrivial panel should be able to say why a result happened.

```json
{
  "id": "exp-001",
  "subsystem": "cache",
  "severity": "high",
  "location": {"file": "matrix.c", "line": 42},
  "claim": "This line repeatedly misses L1D because column-major traversal jumps between cache lines.",
  "evidence": [
    {"metric": "l1dMissRate", "value": 0.81},
    {"metric": "strideBytes", "value": 4096},
    {"metric": "dominantMissType", "value": "capacity"}
  ],
  "confidence": "high",
  "tryNext": "Interchange the loop order or use blocking."
}
```

This becomes the shared language between CLI output, UI panels, docs, and tests.

## Roadmap

### Phase 0: Stabilize Current Foundation

Goal: make the existing branch/pipeline work coherent before broadening scope.

Deliverables:

- Finish the branch event vertical slice end to end.
- Decide whether `TraceEvent` gets a separate `branch_id` field or continues to
  store branch id in `address`; prefer a separate field before the schema hardens.
- Add branch and pipeline stats to JSON output.
- Add TypeScript result types for branch prediction and pipeline stats.
- Add frontend panels for execution-engine summary, branch accuracy, IPC/CPI,
  stall cycles, and hot mispredicted branches.
- Document that the pipeline model is analytical, not cycle-accurate.
- Ensure segment caching either accounts for branch/pipeline deltas or disables
  execution-engine stats when segment caching skips detailed simulation.

Acceptance criteria:

- A sample branch-heavy program shows branch stats in CLI JSON and web UI.
- Existing cache results are unchanged for memory-only traces.
- Unit tests for `BranchPredictor` and `PipelineModel` pass.
- At least one integration test verifies `B` trace lines flow through JSON.

### Phase 1: First-Class Hardware Profiles

Goal: make "hardware" mean more than cache sizes.

Deliverables:

- Introduce `HardwareProfile` while preserving existing preset names.
- Move profile metadata into a registry with display names, vendor, architecture,
  profile source, and confidence level.
- Extend CLI help from `--config` toward `--hardware`, keeping `--config` as an
  alias.
- Add profile JSON output so the UI can display what was modeled.
- Add a Hardware Profile panel in the UI showing cache, TLB, prefetch,
  execution-core, memory, and topology parameters.

Acceptance criteria:

- Existing `--config intel`, `--config zen4`, etc. still work.
- JSON includes enough profile metadata to render a profile page without hardcoded
  frontend constants.
- The UI can compare two profiles without changing source code.

### Phase 2: Execution Engine MVP

Goal: make Hardware Explorer visibly more than Cache Explorer.

Deliverables:

- Execution Engine panel:
  IPC, CPI, estimated cycles, base cycles, frontend stalls, memory stalls, branch
  stalls, branch accuracy, and hot mispredicted branches.
- Branch predictor model options:
  static not-taken, static backward-taken/forward-not-taken, bimodal 2-bit, and
  optional gshare.
- Source annotations:
  hot branch lines and memory-stall-heavy lines.
- CLI sections and JSON schema use the same model names as UI.
- Docs page: "How to read execution-engine estimates."

Acceptance criteria:

- Branch-heavy examples distinguish predictable loops from alternating branches.
- Pointer-chasing examples show memory stalls dominating estimated cycles.
- I-cache-heavy examples show frontend stalls.
- The UI never presents estimated cycles as measured runtime.

### Phase 3: Memory System Expansion

Goal: explain more memory behavior without leaving the current trace model.

Deliverables:

- TLB model configuration:
  page size, DTLB/ITLB entries, associativity, page-walk penalty, optional huge
  page mode.
- Memory bandwidth estimate:
  requests, bytes, approximate bandwidth pressure, and a saturation warning.
- Memory-level parallelism estimate:
  simple cap on overlap for independent misses, driven by profile config.
- Prefetch explanation:
  issued, useful, late, useless, and pollution categories where possible.
- "Why did this line miss?" view:
  address, set, tag, line size, hit level, miss class, stride, reuse distance
  approximation, prefetch involvement, and competing hot lines.

Acceptance criteria:

- Existing cache/TLB stats continue to match validation baselines within their
  documented target ranges.
- Memory-heavy examples can separate latency-bound from bandwidth-pressure cases.
- The line explanation view gives a useful answer for row-major vs column-major,
  linked-list, false-sharing, and working-set examples.

### Phase 4: Topology and Multi-Core

Goal: make multi-core hardware structure visible and understandable.

Deliverables:

- Topology model:
  cores, clusters, private/shared cache levels, optional heterogeneous core
  classes, socket count placeholder.
- Multi-core execution stats:
  first pass can report coherence/cache/TLB only; execution-engine stats can be
  explicitly unavailable until modeled.
- Coherence timeline:
  invalidations, ownership transfers, false sharing, and contended cache lines.
- NUMA later:
  remote latency/bandwidth model behind an explicit experimental flag.

Acceptance criteria:

- False-sharing examples show the responsible cache line, threads, offsets, and
  coherence events.
- Multi-core JSON says which subsystems are modeled and which are unavailable,
  instead of silently omitting them.
- Heterogeneous profiles do not pretend to schedule threads accurately.

### Phase 5: Hardware Lab

Goal: make exploration the core experience.

Deliverables:

- Compare profiles side by side.
- Sensitivity controls:
  line size, L1 size, associativity, prefetch policy, branch predictor, ROB size,
  memory latency, and page size.
- Scenario snapshots:
  "Intel vs Apple", "prefetch off vs on", "small cache vs large cache",
  "before vs after optimization."
- Exportable report containing code, profile, result summary, explanations, and
  validation confidence.

Acceptance criteria:

- Users can change a hardware parameter and immediately see which source lines
  move.
- Reports are reproducible from a saved profile/result JSON.
- The lab distinguishes measured, simulated, estimated, and unsupported values.

### Phase 6: Validation and Confidence

Goal: keep the expanded scope credible.

Deliverables:

- Extend validation beyond cache counters:
  instructions, cycles, branches, branch misses, L1D, L1I, LLC where available,
  DTLB/ITLB misses where available.
- Add profile-specific validation metadata:
  tested hardware, date, OS, compiler, counters, benchmark set, average delta,
  max delta, and known counter limitations.
- Add confidence labels per subsystem:
  measured baseline, calibrated, directional, educational, experimental,
  unsupported.
- Add CI checks for JSON schema stability and known example snapshots.

Acceptance criteria:

- Docs show which claims are validated and which are modeled.
- UI confidence badges are driven by result metadata, not marketing copy.
- A new model cannot be shown as "calibrated" without validation data.

## UI Shape

The first screen remains the workbench: editor left, results right. No landing
page is needed.

Recommended result navigation:

- Summary
- Source Hotspots
- Memory Hierarchy
- Execution Engine
- Coherence
- Hardware Profile
- Lab

Primary interactions:

- Click a metric to see the responsible subsystem and source lines.
- Click a source line to see cache, TLB, branch, and pipeline evidence.
- Toggle hardware profiles and compare deltas.
- Save a scenario as a reproducible report.

Visual rule:

Cache Explorer is already a dense engineering tool. Hardware Explorer should
remain quiet, inspectable, and workbench-like, not a marketing dashboard.

## CLI Shape

Short term:

```bash
cache-explore examples/matrix_col.c --config intel14 --json
cache-explore examples/branchy.c --config zen4 --show execution
```

Long term:

```bash
hardware-explore examples/matrix_col.c --hardware intel14 --json
hardware-explore examples/foo.c --hardware apple-m3 --compare zen4
hardware-explore examples/foo.c --hardware intel14 --lab l1d.size=64KB
```

Keep `cache-explore` as a compatibility entrypoint.

## Testing Strategy

- Unit tests for each model:
  cache, TLB, prefetch, branch predictor, pipeline, topology helpers.
- Trace parser tests for every event type.
- Golden JSON tests for stable result shape.
- Integration examples:
  sequential, strided, matrix row/column, linked list, false sharing,
  predictable branch, alternating branch, instruction-cache stress.
- Frontend parser/render tests for optional subsystem presence.
- Validation scripts against perf counters for calibrated profiles.

## Risks

### Accuracy Overclaiming

Risk: users assume estimated cycles equal real runtime.

Mitigation: confidence labels, docs, and UI wording. Use "estimated" and
"modeled" consistently.

### Trace Data Limits

Risk: some hardware effects need instruction dependencies, opcodes, or binary
layout that the current trace does not capture.

Mitigation: state unavailable data explicitly. Add new instrumentation only for
vertical slices with clear value.

### Schema Sprawl

Risk: every model adds ad hoc top-level JSON fields.

Mitigation: move new work under `profile`, `summary`, `subsystems`, and
`explanations`, while maintaining old fields during migration.

### UI Complexity

Risk: the tool becomes a pile of charts.

Mitigation: keep "what limited this code?" as the organizing question. Hide
detail behind subsystem tabs and line explanations.

### Multi-Core Execution Modeling

Risk: pipeline/branch stats become misleading when multiple threads interact.

Mitigation: mark execution-engine multi-core as unavailable until a clear model
exists. Keep coherence/false-sharing as the multi-core strength.

## Naming Recommendation

Use this naming ladder:

1. Cache Explorer: current product.
2. Cache Explorer with execution engine: after Phase 2.
3. Hardware Explorer: after the UI has at least memory hierarchy, TLB,
   prefetch, branch prediction, pipeline estimates, and hardware profile lab as
   first-class modules.

This keeps the ambition alive without asking the project to wear the bigger name
before the experience earns it.

## First Implementation Target

The initial slice was:

1. Add branch/pipeline stats to JSON.
2. Add frontend result types and an Execution Engine panel.
3. Add one branch-heavy example and one pointer-chasing example to show the
   difference between branch stalls and memory stalls.
4. Add docs explaining the analytical pipeline model.
5. Add a confidence badge: `Execution engine: estimated`.

That gives Hardware Explorer its first visible subsystem beyond cache while
keeping the change tightly connected to work already present in the repo.

## Next Implementation Target

The next best slice is:

1. Add source-level annotations for hot branches and memory-stall-heavy lines.
2. Start the `summary` object with `primaryBottleneck`, `estimatedCycles`, and
   `topSource`.
3. Move branch prediction and pipeline output under a new additive
   `subsystems.execution` object while keeping legacy `execution` for
   compatibility.
4. Add a profile comparison result path that can compare two hardware profiles
   without frontend hardcoding.
