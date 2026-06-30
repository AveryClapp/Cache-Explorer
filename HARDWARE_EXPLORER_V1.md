# Hardware Explorer v1

Hardware Explorer is now an end-to-end workflow around the cache simulator:

- Browse a catalog of modeled hardware profiles.
- Apply a profile to the active analysis.
- Persist and compare a run set across profiles.
- Launch multi-profile experiments with named variants.
- Export single-run, comparison, experiment, and profile-diff reports.

## Modeled Surface

Each profile carries cache geometry, topology, TLB defaults, prefetch behavior, execution-core metadata, memory latency, bandwidth hints, model coverage, and validation confidence.

The simulator still treats execution width, SIMD, bandwidth, and dependency effects as estimates unless a profile marks the field as calibrated. Cache hierarchy, TLB, prefetch behavior, and multicore coherence are the strongest modeled surfaces today.

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

## Performance Notes

- The comparison path uses the direct compare endpoint for supported single-file C/C++ inputs, avoiding a frontend loop of independent per-profile compile requests.
- Experiment templates enable fast mode and segment caching for heavy cache-locality kernels where detailed 3C classification is less important than quick comparative feedback.
- Templates also set bounded event limits so real-kernel experiments stay interactive by default.
- Server responses strip the large cache-state payload before returning successful compile results, which keeps UI rendering and export payloads smaller.
- Run-set selection is normalized against canonical profile IDs when profiles load, preventing alias churn from causing repeated or missing runs.

## Remaining Frontier

The next leap is calibration: importing measured host topology, preserving benchmark baselines, and attaching observed timing counters to the modeled profile so Hardware Explorer can distinguish estimated, measured, and validated fields at query time.
