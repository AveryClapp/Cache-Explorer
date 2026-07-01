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
- Browser smoke covers launch paths, workload catalog controls, and share
  short-link roundtrips.
- Share links that preserve multi-file projects, active/main file identity, run
  settings, and experiment setup.
- Verified workload browser in the app, backed by product-facing workload APIs,
  with search, status filtering, hardware-target filtering, and sorting.
- Workload-driven experiments for same-source define variants and per-variant
  source comparisons.
- Workload snapshots include stable manifest and source-file hashes in catalog,
  verification, and history outputs.
- Workload verification can emit compact benchmark-history JSON artifacts,
  standalone HTML trend reports, and a GitHub Pages workload dashboard in CI.
  The dashboard restores retained history from the Actions cache and renders up
  to 30 recent runs.
- Workload verification covers branch behavior, prefetch policy, vector/SIMD
  stats, memory intrinsic stats, atomic builtin stats, hash-table probing,
  contiguous allocation locality, sequential/binary search locality,
  sort-pattern locality, and image-stencil traversal locality.
- Empty result state routes users into run, verified workload, and experiment
  flows.
- Local bootstrap has a doctor script plus a single dev command that can build,
  install npm dependencies, and start backend/frontend together.
- Docker deployment proxies the product API surface and exposes backend/frontend
  health checks.
- Releases publish LLVM pass checksums and the download helper verifies them
  when available, with strict verification available for CI or locked-down use.
- Release assets are covered by GitHub artifact attestations so downloaded pass
  binaries have provenance in addition to checksums.
- Published Docker images include BuildKit provenance attestations and SBOMs.
- GitHub Release notes include checksum and attestation verification commands.
- Release validation runs when a GitHub Release is published, and can also be
  dispatched manually for a tag. It verifies pass checksums, pass attestations,
  and GHCR image availability.

Known gaps:

- Workload catalog still needs threaded real-world kernels before it can act as
  a broad regression corpus.
- Hosted benchmark history retention is best-effort through the Actions cache;
  durable long-term storage or release-attached history would still be stronger.
- Deployment/package polish still needs release-cadence tuning once real usage
  patterns are visible.
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
- Workload metadata includes stable manifest/source hashes for reproducible
  catalog identity.
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
- Release assets include checksum metadata, provenance attestations, and the
  install/download path verifies checksums when present.
- Docs include quick starts for web, CLI, workload verification, hardware profiles,
  and reproducible bug reports.

## Implementation Path

1. Broaden workload metadata and catalog coverage.
2. Tune optional threaded false-sharing workload snapshots.
3. Add durable benchmark-history storage beyond the best-effort Actions cache.
4. Harden deployment docs and local dev bootstrap.
5. Polish workload/history onboarding and modal empty/error states.
6. Add more browser-level flows for result-bearing experiment journeys.

## Near-Term Leaps

- Tune threaded false-sharing examples so they can run as optional stress
  workloads without dragging down CI.
- Add durable benchmark-history storage beyond the best-effort Actions cache.
- Keep committing each completed slice with validation output.
