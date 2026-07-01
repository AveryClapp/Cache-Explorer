# Compiler Explorer-Level Plan

Cache Explorer reaches Compiler Explorer-level when a user can paste or share code,
choose a target model, run analysis, and trust that another person can reproduce
the same result with the same settings and caveats.

## Current Position

Already in place:

- Multi-language editor for C, C++, Rust, and Zig examples.
- LLVM instrumentation pipeline plus direct CLI usage.
- Hardware profile catalog with explicit model contracts.
- Hardware comparison and experiment modes.
- Result provenance with source, compiler, simulator/runtime/pass hashes, and
  fidelity settings.
- Copyable local repro commands from result provenance.
- Golden kernel tests, workload snapshot verification, profile drift checks,
  frontend build/browser smoke coverage, and server tests in CI.
- Share links that preserve multi-file projects, active/main file identity, run
  settings, and experiment setup.
- Verified workload browser in the app, backed by product-facing workload APIs.
- Workload-driven experiments for same-source define variants and per-variant
  source comparisons.
- Workload verification can emit compact benchmark-history JSON artifacts and
  standalone HTML trend reports in CI.
- Workload verification covers branch behavior, prefetch policy, vector/SIMD
  stats, memory intrinsic stats, atomic builtin stats, and image-stencil
  traversal locality.
- Empty result state routes users into run, verified workload, and experiment
  flows.

Known gaps:

- Workload catalog still needs more sorting, search, hashing, and threaded
  real-world kernels before it can act as a broad regression corpus.
- There is no hosted persistent regression dashboard beyond downloadable CI
  trend reports.
- Deployment/package polish is still developer-oriented.
- Workload history trend surfacing, deeper onboarding, and error states need
  another design pass.

## Done Criteria

### 1. Reproducibility

- Every result includes source identity, compiler identity, optimizer settings,
  simulator/runtime/pass hashes, hardware profile confidence, and fidelity
  settings.
- Share links restore the full runnable project, not just visible text.
- Exported JSON is sufficient for bug reports and reproducible benchmark reports.

### 2. Executable Workload Catalog

- Workload metadata supports same-source and per-variant-source comparisons.
- The catalog covers locality, layout, image stencils, prefetch, tiling,
  pointer chasing, branch behavior, vector/memcpy/atomic instrumentation, and
  hardware-profile-sensitive examples.
- False-sharing/coherence reporting is fixed in the simulator and covered by
  simulator/validation tests, but threaded CLI workloads still need runtime
  tuning before they belong in always-on CI snapshots.
- CI runs product-facing verification commands instead of private-only scripts.
- Workload verifier emits structured JSON, human summaries, durations, and
  provenance for every variant.

### 3. Product Trust UI

- Result panels clearly separate modeled, estimated, metadata-only, and unsupported
  hardware fields.
- Result fidelity is visible without opening raw JSON.
- Users can copy a local CLI repro command for a result.
- Comparison and experiment modals show confidence/fidelity alongside winners.

### 4. Share And Collaboration

- Share URLs preserve files, main file, active file, hardware settings, compiler,
  prefetch, sampling, limits, fast mode, segment caching, and experiment setup.
- Shared links are stable across default compiler changes when the compiler exists.
- Missing compiler/profile states degrade visibly and explain what changed.

### 5. Performance And Reliability

- UI remains responsive for million-event default runs.
- Segment caching and fast mode remain explicit fidelity choices.
- CI covers CLI, frontend type checks/browser smoke, server tests, simulator unit tests,
  profile drift, workload verification, and e2e flows.
- Benchmark verification reports duration and downloadable trend summaries so
  regressions can become visible over time.

### 6. Deployment Polish

- One documented local command starts the full product.
- Hosted/server deployment has health checks, cache pruning, rate limits, and
  clear sandbox status.
- Docs include quick starts for web, CLI, workload verification, hardware profiles,
  and reproducible bug reports.

## Implementation Path

1. Broaden workload metadata and catalog coverage.
2. Add more workload snapshots for memory layout, pointer chasing, prefetch,
   false sharing, and branch behavior.
3. Host benchmark-history dashboards from CI artifacts.
4. Harden deployment docs and local dev bootstrap.
5. Polish workload/history onboarding and modal empty/error states.
6. Add more browser-level flows for share, workload, and experiment journeys.

## Near-Term Leaps

- Tune threaded false-sharing examples so they can run as optional stress
  workloads without dragging down CI.
- Add more real kernels for sorting, search, hashing, and allocation patterns.
- Publish benchmark-history HTML reports through hosted docs or Pages.
- Keep committing each completed slice with validation output.
