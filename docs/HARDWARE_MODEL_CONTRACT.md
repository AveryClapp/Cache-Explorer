# Hardware Model Contract

Cache Explorer profiles now expose an explicit model contract. The contract is
the product boundary between hardware facts, simulator behavior, estimates, and
profile metadata.

## Status Terms

- `calibrated`: backed by project-owned empirical validation for this profile or subsystem.
- `modeled`: consumed directly by the simulator when computing results.
- `estimated`: consumed by an approximate analytical model for directional comparisons.
- `conditional`: consumed only for matching traces or run modes.
- `metadata-only`: shown in profile details and exports, but does not affect results.
- `unsupported`: intentionally not modeled by the current engine.

## Required Profile Fields

Every profile declares these contract fields:

- `cacheHierarchy`
- `cacheReplacement`
- `cacheTiming`
- `tlb`
- `prefetch`
- `coherence`
- `branchPrediction`
- `executionPipeline`
- `memoryBandwidth`
- `memoryLevelParallelism`
- `simd`
- `topology`
- `dependencyModel`
- `numa`

## Product Rule

UI panels, exports, and docs should not imply that a field affects results unless
its contract has `drivesSimulation: true`.

This keeps Cache Explorer honest while it grows toward a Compiler Explorer-level
tool: users can inspect what was modeled, what was estimated, what was only
descriptive metadata, and what is not supported yet.

## Current Boundary

The strongest modeled surfaces are cache hierarchy, TLB, prefetch behavior,
source attribution, and MESI-style coherence for multicore traces.

The execution engine is analytical. Branch prediction and pipeline estimates are
useful for directional comparisons, but they are not measured runtime and they
do not model instruction dependencies, opcode mix, port pressure, SMT, exact
frontend decode behavior, NUMA, or OS scheduling.

## Calibration Depth

The model contract is the product truth boundary. The calibration ladder in
[Calibration Roadmap](CALIBRATION_ROADMAP.md) defines when an individual field
can move from modeled or estimated to calibrated.

Cache Explorer should stay honest if a profile is only partially calibrated: the
profile can expose calibrated cache geometry while keeping branch prediction,
pipeline timing, memory bandwidth, SIMD, topology, or NUMA as estimated,
metadata-only, or unsupported.
