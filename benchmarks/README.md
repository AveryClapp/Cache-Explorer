# Cache Explorer Benchmarks

Executable workload metadata lives in `workloads/`.

Each workload snapshot describes:
- the example source file
- compiler optimization level
- modeled hardware profile
- variant definitions
- expected metric relationships

Variants may override `example`, `optLevel`, `config`, `limit`, and `prefetch`
when the relationship compares different source files, hardware settings, or
prefetch policies.

Relationships compare numeric JSON metrics from each variant result. Use
`missingValue` sparingly when a metric is intentionally sparse, such as comparing
an advanced vector/atomic stats object against a scalar variant that should emit
no such stats.

The integration suite runs these snapshots through `tests/integration/test-workload-snapshots.sh`.

Useful commands:

```bash
backend/scripts/cache-explore workloads
backend/scripts/cache-explore workloads --ids
backend/scripts/cache-explore workloads conv2d-intel14 --json
backend/scripts/cache-explore workloads conv2d-intel14 --commands
backend/scripts/cache-explore workloads --verify
backend/scripts/cache-explore workloads --verify --json
backend/scripts/cache-explore workloads --verify --json --history reports/workloads/history.json
tests/integration/test-workload-snapshots.sh
```
