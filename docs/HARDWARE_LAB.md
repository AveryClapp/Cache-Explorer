# Hardware Lab (Preview)

Hardware Lab is the local, single-core sensitivity workspace at `?view=lab`.
It compares the current C/C++ source under a named CPU profile and a copy of
that profile with explicit what-if overrides. Presets are never mutated.

## Use it

1. Put your C/C++ source and capture settings in **Analyze**.
2. Open **Hardware Lab**. Review the copied source and baseline profile.
3. Choose a starter change or add individual parameters.
4. Run **baseline & scenario**. Inspect aggregate deltas, source-line changes,
   sampled miss explanations, effective configuration and provenance.
5. **Export scenario** saves source, settings, overrides and the report in a
   versioned JSON file. **Import scenario** reads it locally, without executing
   code or fetching anything. Review imported source before replaying it.

The Lab does not load Monaco. Navigation retains the scenario for the current
app session; export before closing or refreshing the page. Imports and report
viewing work offline once the app is loaded. Compilation requires the local
backend and a supported local LLVM compiler. This is not a hosted execution
service or a guarantee that a first visit works without downloading the app.

Runs are sequential, cancellable and limited to 200,000 captured events each.
The source/capture settings are identical between the two requests. Separate
executions can still have different addresses, input, schedules or sampled
prefixes. Replay reproduces the input recipe, **not a bit-identical trace or
measured benchmark**. Exported effective configurations, tool versions and
artifact hashes let you inspect differences between environments. A report
loaded from a file is an unverified snapshot, not new calibration evidence.

## Parameters

Use repeatable `--lab field=value` arguments with either CLI name:

```sh
hardware-explore main.c --hardware educational --json --limit 100000 \
  --lab l1d.sizeKB=64 --lab branch.predictor=gshare

cache-explore main.c --config intel --json --limit 100000 \
  --lab tlb.pageSize=2097152 --lab dtlb.entries=128
```

| Group | Fields |
| --- | --- |
| Cache | `l1d.sizeKB`, `l1d.associativity`, `cache.lineSize`, `prefetch.policy` |
| Translation | `tlb.pageSize`, `dtlb.entries`, `dtlb.associativity`, `itlb.entries`, `itlb.associativity`, `tlb.missPenaltyCycles` |
| Memory | `memory.dramCycles`, `memory.assumedMlp`, `memory.bandwidthBytesPerCycle` |
| Execution | `execution.robSize`, `execution.issueWidth`, `branch.predictor` |

The UI and server share [field definitions](../frontend/src/lab/fields.json).
The native validator additionally checks complete cache/TLB geometry before
the CLI compiles or runs source. Unknown fields, duplicates, invalid geometry,
segment caching, streaming and multi-core sensitivity fail explicitly.
Unchanged fields inherit the selected profile; up to 16 overrides are allowed.
Page size and cache-line size must be powers of two. Changing page size models
different translation behavior; it does not allocate OS huge pages.

HTTP callers use `POST /compile` with the normal source/settings fields plus
`hardwareLab: {"l1d.sizeKB":"64"}` and an explicit `limit` of 1–200000.
Only C/C++ detailed local execution accepts overrides. Hosted mode returns 501,
and other HTTP/streaming routes reject them instead of ignoring them. Existing
`cache-explore`, `--config` and `CACHE_EXPLORER_*` names remain supported.
`HARDWARE_EXPLORER_DATA_DIR` (or `CACHE_EXPLORER_DATA_DIR`) can isolate the local
server's SQLite cache from the repository during tests.

### Branch prediction

The source workflow supports `bimodal-2bit` (default), `static-not-taken` and
`gshare`. These are transparent teaching models, not vendor predictors.

The native simulator also supports `branch.predictor=btfnt`, but only when every
branch record supplies its **static machine-target direction**: `D1` for a
target below the branch PC, `D0` otherwise. The direction is separate from the
observed taken/not-taken outcome:

```text
B 0x1234 1 loop.c:10 T1 D1
B 0x5678 0 loop.c:12 T1 D0
```

Legacy traces remain valid for the other predictors. Missing direction fails
BTFNT analysis. LLVM IR block order and synthetic branch IDs cannot establish
final machine-code direction, so source capture/UI do not offer BTFNT. No Pin
capture or decompiler integration is claimed to emit these extensions yet.

## Reading the evidence

- **Cache/TLB counts:** outcomes of the modeled hierarchy for captured events.
- **Execution cycles:** the existing analytical pipeline, with an explicit
  independent-miss assumption when `memory.assumedMlp` differs from one. It does
  not discover dependencies or actual overlap. Page-walk penalties affect summed
  cache/TLB service cycles, not the separate execution-cycle estimate.
- **Memory pressure:** demand DRAM fill bytes divided by hypothetical
  bytes/cycle capacity, compared with analytical execution cycles. This excludes
  prefetch traffic, dirty writebacks and protocol overhead. It is not measured
  GB/s/utilization, and does not feed back into the latency-only cycle estimate.
  No instruction-count events means pressure is unavailable, not zero.
- **Miss explanations:** the top 24 of the first 512 source locations, with one
  observed miss sample each (or the first hit if no miss occurred). Addresses are
  cache-line bases. Capacity/conflict labels use the existing 3C heuristic.
  Reuse gap counts intervening demand accesses, not unique-line stack distance.
  A previous same-set address is an observation, not proof it evicted this line.
- **Prefetch:** issued/useful counts and sample involvement are available. Late
  and pollution measurements are explicitly unavailable because the model
  installs prefetches immediately. Unused-at-end does not prove uselessness.
- **Source deltas:** bounded result subsets can omit rows; missing values remain
  unknown rather than being treated as zero. Legacy combined instruction/data
  hot-line counts are not relabeled as L1 data misses.
- **Coherence:** multi-core results expose the latest 256 cross-core snoop
  events with sequence, cache-line address and participating cores. Earlier
  omitted events are counted. Sequence is trace order, not time. False-sharing
  reports separately provide source, threads and byte offsets; an invalidation
  alone does not prove false sharing. Uniform round-robin core assignment is
  modeled, not OS scheduling, NUMA or heterogeneous cluster placement.

`subsystems.memorySystem`, `subsystems.cacheEvidence` and `subsystems.topology`
are additive. Legacy result fields remain. Multi-core/segment runs explicitly
mark unsupported detailed execution/memory evidence unavailable. The standard
streaming Analyze path uses the multi-core engine; use the Lab or batch CLI for
the detailed single-core evidence described here.

Every modified scenario is **experimental / uncalibrated**, including cached
results derived from a narrowly calibrated preset. No Intel/AMD/Apple calibration
is invented. See [Hardware Model Contract](HARDWARE_MODEL_CONTRACT.md).

## Verification

The `Hardware Lab Preview` workflow builds from a fresh checkout on macOS and
Linux, runs native and server tests, validates scenario files, runs the real
compiler/runtime CLI, checks frontend build/lint/budgets, and exercises the live
desktop/mobile default journey. A separate Linux job builds/runs the local
Docker product. It does not publish images or release the branch.

Local equivalents (set the three artifact paths to your fresh builds):

```sh
export HARDWARE_EXPLORER_SIM=/path/to/cache-sim
export HARDWARE_EXPLORER_PASS=/path/to/CacheProfiler.so
export HARDWARE_EXPLORER_RUNTIME=/path/to/libcache-explorer-rt.a
ctest --test-dir /path/to/simulator-build --output-on-failure
node --test tests/hardware-lab/simulator.test.mjs tests/hardware-lab/cli.test.mjs
node --experimental-strip-types --test tests/hardware-lab/scenario.test.mjs
npm test --prefix backend/server
npm run build --prefix frontend
npm run lint --prefix frontend
npm run bundle:check --prefix frontend
HARDWARE_EXPLORER_LAB_URL=http://127.0.0.1:5194 \
  node --experimental-strip-types frontend/scripts/hardware-lab-smoke.mjs
```

The scenario/browser test scripts require Node 24 (the server still supports
the repository's Node 20 environment). Browser tests retain Chromium sandboxing.
