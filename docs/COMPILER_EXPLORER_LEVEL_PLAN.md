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
- Result Fidelity surfaces the hardware model contract as modeled, estimated,
  metadata-only, and unsupported buckets directly in the result panel.
- Result Fidelity remains visible for legacy or partial results that lack
  provenance, showing unknown fields instead of hiding the trust boundary.
- Copyable local repro commands from result provenance.
- Copyable structured diagnostics from compile/runtime error states.
- Golden kernel tests, workload snapshot verification, profile drift checks,
  frontend build/browser smoke coverage, and server tests in CI.
- Browser smoke covers launch paths, workload catalog controls, workload history
  surfacing, result-bearing trust UI, legacy trust fallbacks, dirty socket
  recovery, result-bearing hardware comparison, verified workload-to-experiment
  handoff, and share short-link roundtrips.
- Share links that preserve multi-file projects, active/main file identity, run
  settings, and experiment setup.
- Shared hardware profiles and run sets normalize known profile aliases and warn
  when unavailable profiles are skipped or replaced.
- Verified workload browser in the app, backed by product-facing workload APIs,
  with search, status filtering, hardware-target filtering, and sorting.
- Workload catalog can surface published benchmark history in-app through a
  product API, including latest status, slowest workloads, duration deltas, and
  unavailable-history states.
- Workload-driven experiments for same-source define variants and per-variant
  source comparisons.
- Workload snapshots include stable manifest and source-file hashes in catalog,
  verification, and history outputs.
- Workload verification can emit compact benchmark-history JSON artifacts,
  standalone HTML trend reports, and a GitHub Pages workload dashboard in CI.
  The dashboard restores retained history from the published Pages site and the
  Actions cache, publishes a history index, and renders up to 30 recent runs.
- Workload verification covers branch behavior, prefetch policy, vector/SIMD
  stats, memory intrinsic stats, atomic builtin stats, hash-table probing,
  contiguous allocation locality, sequential/binary search locality,
  sort-pattern locality, image-stencil traversal locality, and a default-safe
  threaded false-sharing smoke case.
- Workload metadata supports opt-in stress workloads; the heavier threaded
  false-sharing stress manifest remains excluded from default CI verification.
- The workload catalog exposes stress workloads through an explicit opt-in
  toggle and carries the same opt-in through product verification requests.
- Stress workload verification from the UI sends a bounded per-variant timeout
  with the opt-in request so known-heavy threaded checks fail clearly.
- Workload catalog and verification API errors include structured details,
  timeout state, exit codes, and truncated subprocess diagnostics when available.
- Workload verification has a bounded per-variant timeout so stress workloads
  fail clearly instead of hanging CI or product API requests.
- Empty result state routes users into run, verified workload, and experiment
  flows.
- The workbench header surfaces backend health, direct/sandbox execution mode,
  and compiler availability so deployment trust is visible before a run.
- Local bootstrap has a doctor script plus a single dev command that can build,
  install npm dependencies, and start backend/frontend together.
- Optional Vim editor mode is lazy-loaded so the main app bundle avoids that
  non-default editor-mode payload.
- Product modals are lazy-loaded, keeping the first-load workbench chunk under
  the enforced frontend bundle budget.
- Frontend CI checks the built bundle budget after Vite build, tracking main app
  JS/CSS, Monaco JS/CSS, and lazy product modal chunks separately.
- Frontend CI also verifies CSS design-token usage so stale component styles
  cannot silently fall back to browser defaults.
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
  GHCR image availability, and attaches a published workload-history archive to
  the release.

Known gaps:

- Threaded false-sharing has a default smoke workload, but heavier threaded
  stress and real-world kernels still need runtime tuning before joining default
  CI.
- Hosted benchmark history retention is backed by the published Pages dashboard,
  the Actions cache, and release-attached workload-history archives.
- Deployment/package polish still needs release-cadence tuning once real usage
  patterns are visible.
- Deeper onboarding still needs another design pass; API-side workload error
  diagnostics and in-app workload history surfacing are in place.
- On 2026-07-01, `false-sharing-stress-intel` timed out at 30 seconds per
  variant locally even with bounded verification. It remains stress-only until
  the threaded instrumentation path is tuned enough for default coverage.

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
  simulator/validation tests plus a default workload smoke. Threaded stress
  workloads are explicit and opt-in until runtime tuning makes them suitable for
  always-on CI snapshots.
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
2. Tune optional threaded false-sharing stress workloads until they can join
   default CI or remain clearly labeled as stress-only coverage.
3. Add external benchmark-history archival only if Pages plus release-attached
   archives are not enough.
4. Harden deployment docs and local dev bootstrap.
5. Polish onboarding and modal empty/error states around first-run workflows.
6. Add more browser-level flows for result-bearing experiment journeys.

## Near-Term Leaps

- Tune threaded false-sharing stress workloads and real-world threaded kernels
  until they are fast enough for default CI, or keep them explicitly opt-in.
- Add external benchmark-history archival only if Pages plus release-attached
  archives are not enough.
- Keep committing each completed slice with validation output.
