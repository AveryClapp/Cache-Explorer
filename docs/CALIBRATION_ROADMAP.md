# Calibration Roadmap

Cache Explorer is product-nailed-down when it tells the truth about what it
models. It becomes lab-calibrated only when many profiles have repeatable
measurements backing the model contract.

The goal of calibration is not to replace profilers. The goal is to make the
Hardware Explorer trust packet precise enough that users can tell whether a
result is measured, modeled, estimated, descriptive metadata, or unsupported.

## Calibration Levels

- Level 0: metadata imported from public/vendor documentation, with no claim that
  the field drives results.
- Level 1: modeled in the simulator and covered by unit or golden-kernel tests.
- Level 2: measured on at least one real machine for a narrow workload family.
- Level 3: measured across multiple workload families on the named profile.
- Level 4: reproduced across multiple machines or maintainers for the same
  profile class.

A profile should use `calibrated` only for the fields that have Level 2 or
better evidence. Other fields can still be useful, but they should remain
`modeled`, `estimated`, `metadata-only`, `conditional`, or `unsupported`.

## Evidence Packet

Each calibration claim should be backed by a small evidence packet:

- Profile id and CPU identity.
- OS, compiler, LLVM/pass version, simulator/runtime hash, and run command.
- Workload manifest/source hash when a catalog workload is used.
- Counter source, such as `perf`, Instruments, VTune, or platform-specific PMU
  tooling.
- Measured counters, simulator outputs, expected relationship, observed delta,
  and pass/fail status.
- Caveats, including thermal state, power mode, virtualization, SMT, and any
  unavailable counters.

This packet can live in benchmark history artifacts first. It can move into a
formal calibration database later if hosted usage justifies it.

The checked-in packet contract lives at
`benchmarks/calibration/calibration-evidence.schema.json`. Example packets live
under `benchmarks/calibration/evidence/` and can be validated without running
benchmarks:

```bash
./backend/scripts/cache-explore calibration
./backend/scripts/cache-explore calibration --json benchmarks/calibration/evidence/*.json
```

The validator also prints a subsystem coverage summary. Bundled example packets
currently cover these claim shapes:

| Packet | Profile | Promoted Claim | Purpose |
| --- | --- | --- | --- |
| `intel14-conv2d-cache-hierarchy-example` | `intel14` | cache hierarchy Level 2 calibrated | Shows the narrow shape for cache hit-rate promotion. |
| `zen4-pointer-chase-tlb-example` | `zen4` | TLB Level 2 calibrated | Shows page-size/TLB relationship evidence. |
| `m3-stream-prefetch-example` | `m3` | prefetch Level 1 modeled, bandwidth Level 1 estimated | Keeps Apple counter limits explicit. |
| `sapphirerapids-branch-frontend-example` | `sapphirerapids` | branch/frontend Level 1 estimated | Records directional evidence without claiming predictor internals. |

Example packets are schema fixtures until placeholder hashes and host metadata
are replaced with real captured values.

## Subsystem Matrix

| Subsystem | Product Status | Calibration Target |
| --- | --- | --- |
| Cache hierarchy | Strong modeled surface | Validate hit/miss direction on layout, stride, pointer, and stencil workloads. |
| TLB | Modeled | Add page-walk and huge-page workload evidence where counters exist. |
| Prefetch | Modeled/estimated | Compare prefetch-off, stream, stride, and irregular access workloads. |
| Coherence | Modeled for multicore traces | Keep smoke coverage default-safe; run heavy false-sharing stress only on dedicated machines. |
| Branch prediction | Estimated | Calibrate directional branch-pattern deltas, not exact mispredict counts. |
| Pipeline/cycles | Estimated | Validate broad cycle ordering, not absolute wall-clock timing. |
| Memory bandwidth/MLP | Metadata or estimated | Add bandwidth probes only after cache/TLB evidence is stable. |
| SIMD/vector width | Metadata with trace stats | Treat as descriptive until scheduling effects are modeled. |
| Topology/NUMA | Metadata/unsupported | Do not imply scheduling, SMT, or NUMA behavior until the engine supports it. |

## Safe Collection Workflow

Default calibration jobs should use bounded catalog workloads and preserve the
current no-stress default. The heavy stress path remains opt-in:

```bash
./backend/scripts/cache-explore workloads --verify --json \
  --history reports/workloads/history.json
```

Only run stress workloads on a machine reserved for that purpose:

```bash
./backend/scripts/cache-explore workloads --verify --include-stress --json
```

For a real-kernel spot check, prefer one small kernel with an explicit event
limit and a known profile:

```bash
./backend/scripts/cache-explore experiment examples/conv2d_kernel.c -O2 \
  --variant direct \
  --variant tiled:RUN_TILED=1 \
  --configs educational,intel14,zen4,m3 \
  --limit 200000
```

## Promotion Rule

Do not promote a field to `calibrated` because one result looks plausible. A
field graduates only when the evidence packet proves the expected relationship,
the workload hash is stable, the run is reproducible, and the caveats are shown
in the profile trust packet.
