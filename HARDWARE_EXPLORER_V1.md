# Hardware Explorer Preview

Hardware Explorer is now an end-to-end workflow around the cache simulator:

- Browse a catalog of modeled hardware profiles.
- Apply a profile to the active analysis.
- Persist and compare a run set across profiles.
- Launch multi-profile experiments with named variants.
- Export single-run, comparison, experiment, and profile-diff reports.
- Explore hardware-parameter sensitivity in the lazy Hardware Lab workspace.
- Save/replay C/C++ scenarios with source, effective configuration, evidence,
  result deltas and confidence; import without executing code.
- Inspect bounded memory-miss explanations and ordered multicore snoop history.

## Modeled Surface

Each profile carries cache geometry, topology, TLB defaults, prefetch behavior, execution-core metadata, memory latency, bandwidth hints, model coverage, and validation confidence.

Execution width feeds an analytical estimate. SIMD capability and physical
bandwidth/maximum MLP hints remain metadata-only; instruction dependencies are
unsupported. The Lab's separate assumed MLP and bytes/cycle capacity are explicit
what-if assumptions, not measurements. Cache hierarchy, configurable TLBs,
prefetch behavior and multicore coherence are modeled surfaces.

The exact trust boundary is documented in [Hardware Model Contract](docs/HARDWARE_MODEL_CONTRACT.md). Every profile exposes `modelContract.fields` so the UI, exports, and API can distinguish modeled, estimated, metadata-only, conditional, calibrated, and unsupported hardware surfaces.

## Experiment Templates

The UI includes starter templates for:

- Conv2D direct versus tiled traversal.
- Matrix multiply direct versus blocked traversal.
- Predictable versus alternating branch paths.

Templates can load their example kernel, apply variants, switch optimization level, and set performance-oriented run options.

## Report Paths

The UI exports:

- Single analysis JSON and CSV.
- Hardware comparison JSON and CSV.
- Hardware experiment JSON and CSV.
- Hardware profile run-set JSON and CSV, including baseline deltas.
- Versioned Hardware Lab scenario JSON, including runnable source, capture
  settings, parameter overrides, report snapshots and their provenance.

See [Hardware Lab](docs/HARDWARE_LAB.md) for controls, replay semantics, evidence
limits, CLI examples and verification commands.

## Performance Notes

- The comparison path uses the direct compare endpoint for supported single-file C/C++ inputs, avoiding a frontend loop of independent per-profile compile requests.
- Experiment templates enable fast mode and segment caching for heavy cache-locality kernels where detailed 3C classification is less important than quick comparative feedback.
- Templates also set bounded event limits so real-kernel experiments stay interactive by default.
- Server responses strip the large cache-state payload before returning successful compile results, which keeps UI rendering and export payloads smaller.
- Run-set selection is normalized against canonical profile IDs when profiles load, preventing alias churn from causing repeated or missing runs.

## Release boundary

Preview is intentional. Real calibration for default Intel/AMD/Apple profiles is
not supplied by simulated counter snapshots. Lab scenarios never inherit a
preset's calibration claim. Hosted Lab execution returns 501 until its sandbox
runner supports the same controls; the supported replay product is local-first.
NUMA, heterogeneous scheduling, cycle accuracy and measured prefetch
lateness/pollution remain outside the current model.

The broader implementation remains on a feature branch. MacOS local checks do
not substitute for Linux/Docker qualification, and implementation completion
does not authorize a stable rename, merge or release.
