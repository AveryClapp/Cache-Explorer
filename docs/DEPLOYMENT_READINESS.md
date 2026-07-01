# Deployment Readiness

Cache Explorer is ready to be run as a product when operators can answer three
questions without reading source code:

- Is the service healthy enough to accept runs?
- Is user code running in the expected sandbox posture?
- Can this release be reproduced and trusted after it ships?

This document is the production posture checklist. It complements
`docs/COMPILER_EXPLORER_LEVEL_PLAN.md`; it is not a new architecture.

## Production Defaults

Recommended hosted defaults:

- Run through Docker or another isolated runner; set `ENABLE_SANDBOX=1` when the
  Docker sandbox image is built and available.
- Put the service behind a reverse proxy and set `TRUST_PROXY=1` so rate limits
  use the client-facing address rather than the proxy address.
- Keep health and metrics probe-friendly; do not rate-limit `/health` or
  `/metrics`.
- Keep expensive product routes rate-limited: `/compile`, `/compare`,
  `/experiment`, `/shorten`, `/api/share`, and workload verification.
- Start conservative: `RATE_LIMIT_RPM=30`, `MAX_CONCURRENT_PROCESSES=5`,
  `TIMEOUT_DEFAULT=60000`, `TIMEOUT_COMPILATION=30000`, and
  `CACHE_EXPLORER_WORKLOAD_VARIANT_TIMEOUT_MS=120000`.
- Keep stress workloads opt-in. Default verification should not include
  `--include-stress` until those workloads are tuned on a dedicated machine.

The direct runner is useful for local development and CI smoke checks, but a
public deployment should report sandbox mode before accepting untrusted code.

## Health Contract

Operators should monitor:

- `/health`: overall status, version, compiler availability, temp-dir writes,
  database status, sandbox mode, timeout settings, and rate-limit settings.
- `/sandbox-status`: sandbox availability and direct/sandbox mode for debugging.
- `/metrics`: Prometheus-compatible uptime, request, error, cache, connection,
  duration, and share/cache-size metrics.

Readiness rule:

- `healthy` can receive normal traffic.
- `degraded` can receive probes and admin traffic, but user-facing runs should be
  treated cautiously until the failing check is understood.
- `unhealthy` should be removed from rotation.

## Release Cadence

Until real hosted usage settles, use a predictable small-release cadence:

- Ship at most one product release per week unless a correctness/security fix is
  needed.
- Run the browser smoke suite, server tests, frontend bundle checks, workload
  snapshot verification, profile drift checks, and release validation before
  tagging.
- Keep release notes explicit about model-contract changes, default workload
  changes, and any sandbox/rate-limit changes.
- Attach workload-history archives to releases so benchmark history survives
  Pages or Actions-cache expiry.

Release artifacts should keep the existing provenance chain:

- LLVM pass assets publish `SHA256SUMS`.
- Download helpers verify checksums when present, and can require them in strict
  environments.
- GitHub artifact attestations cover release assets.
- GHCR images publish BuildKit provenance attestations and SBOMs.

## First-Week Observability

For a new hosted deployment, watch these signals daily:

- Request volume by route and HTTP status.
- Rate-limit rejections and retry-after distribution.
- Compile/run duration and timeout counts.
- Sandbox unavailable transitions.
- Cache size, cache entries, and short-link growth.
- Workload verification duration deltas from the published dashboard.
- Browser smoke failures from CI, especially share/reopen and experiment paths.

Production tuning should be driven by those observations. Raise concurrency,
timeouts, or request windows only when the metrics show the deployment has room.

## Runbook

Before release:

```bash
cd frontend
npm run build
npm run bundle:check
npm run smoke:ui
```

```bash
cd backend/server
npm test
```

After deploy:

```bash
curl -fsS http://localhost:8080/health
curl -fsS http://localhost:8080/metrics | head
```

If the machine becomes resource-constrained:

- Disable stress workload verification.
- Reduce `MAX_CONCURRENT_PROCESSES`.
- Reduce `RATE_LIMIT_RPM`.
- Confirm `/sandbox-status` is not flapping.
- Prefer investigating from metrics and logs before increasing timeouts.
