# Cache Explorer Benchmarks

Executable workload metadata lives in `workloads/`.

Each workload snapshot describes:
- the example source file
- compiler optimization level
- modeled hardware profile
- variant definitions
- expected metric relationships

Variants may override `example`, `optLevel`, `config`, and `limit` when the
relationship compares different source files or hardware settings.

The integration suite runs these snapshots through `tests/integration/test-workload-snapshots.sh`.

Useful commands:

```bash
backend/scripts/cache-explore workloads
backend/scripts/cache-explore workloads --ids
backend/scripts/cache-explore workloads conv2d-intel14 --json
backend/scripts/cache-explore workloads conv2d-intel14 --commands
backend/scripts/cache-explore workloads --verify
backend/scripts/cache-explore workloads --verify --json
tests/integration/test-workload-snapshots.sh
```
