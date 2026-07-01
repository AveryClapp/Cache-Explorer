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
- Golden kernel tests, workload snapshot verification, profile drift checks, and
  server tests in CI.
- Share links that preserve single-file run settings.

Known gaps:

- Workload catalog is still too small to act as a broad regression corpus.
- Workload variants need per-variant sources for common comparisons such as
  row-major versus column-major kernels.
- Multi-file projects are not fully preserved in share links.
- The result UI does not yet expose one-click repro commands or workload badges.
- There is no hosted regression dashboard for benchmark history.
- Deployment/package polish is still developer-oriented.

## Done Criteria

### 1. Reproducibility

- Every result includes source identity, compiler identity, optimizer settings,
  simulator/runtime/pass hashes, hardware profile confidence, and fidelity
  settings.
- Share links restore the full runnable project, not just visible text.
- Exported JSON is sufficient for bug reports and reproducible benchmark reports.

### 2. Executable Workload Catalog

- Workload metadata supports same-source and per-variant-source comparisons.
- The catalog covers locality, layout, prefetch, tiling, pointer chasing,
  false sharing, branch behavior, vector/memcpy/atomic instrumentation, and
  hardware-profile-sensitive examples.
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
- CI covers CLI, frontend type checks, server tests, simulator unit tests,
  profile drift, workload verification, and e2e flows.
- Benchmark verification reports duration so regressions can become visible over
  time.

### 6. Deployment Polish

- One documented local command starts the full product.
- Hosted/server deployment has health checks, cache pruning, rate limits, and
  clear sandbox status.
- Docs include quick starts for web, CLI, workload verification, hardware profiles,
  and reproducible bug reports.

## Implementation Path

1. Broaden workload metadata and catalog coverage.
2. Preserve full multi-file projects in share links.
3. Add copyable repro commands to result provenance.
4. Add more workload snapshots for memory layout, pointer chasing, prefetch,
   false sharing, and branch behavior.
5. Add benchmark-history artifacts or dashboards from CI.
6. Harden deployment docs and local dev bootstrap.

## Near-Term Leaps

- Extend workload variants with optional `example`, `optLevel`, `config`, and
  `limit` overrides.
- Add row-versus-column and sequential-versus-pointer workloads to the catalog.
- Round-trip multi-file share state with active and main file identity.
- Keep committing each completed slice with validation output.
