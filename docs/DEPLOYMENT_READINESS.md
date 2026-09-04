# Hardware Explorer Preview Deployment Readiness

Hardware Explorer is local-first. A hosted instance is ready to accept untrusted
traffic only when operators can answer three
questions without reading source code:

- Is the service healthy enough to accept runs?
- Is user code running in the expected sandbox posture?
- Can this release be reproduced and trusted after it ships?

This document is the production posture checklist. It complements
`docs/COMPILER_EXPLORER_LEVEL_PLAN.md` and
`docs/RELEASE_INSTALL_RUNBOOK.md`; it is not a new architecture.

## Production Defaults

Recommended hosted defaults:

- Start from `.env.production.example` and move real values into the deployment
  secret/config system.
- Set `HARDWARE_EXPLORER_DEPLOYMENT_MODE=hosted` and
  `HARDWARE_EXPLORER_ENABLE_SANDBOX=1`. Startup fails closed unless the Docker
  sandbox image and daemon are available.
- Put the service behind a reverse proxy and set
  `HARDWARE_EXPLORER_TRUST_PROXY=1` so rate limits
  use the client-facing address rather than the proxy address.
- Set `HARDWARE_EXPLORER_ALLOWED_ORIGINS` to the exact HTTPS origins allowed to
  call HTTP and WebSocket endpoints. Do not use a reflected or wildcard origin.
- Keep health and metrics probe-friendly; do not rate-limit `/health` or
  `/metrics`.
- Keep expensive product routes rate-limited: `/compile`, `/compare`,
  `/experiment`, `/shorten`, `/api/share`, and workload verification.
- Start conservative: `RATE_LIMIT_RPM=30`, `MAX_CONCURRENT_PROCESSES=5`,
  `TIMEOUT_DEFAULT=60000`, `TIMEOUT_COMPILATION=30000`, and
  `HARDWARE_EXPLORER_WORKLOAD_VARIANT_TIMEOUT_MS=120000`.
- Bound database-backed shares with `HARDWARE_EXPLORER_MAX_SHARE_BYTES`,
  `HARDWARE_EXPLORER_MAX_SHARE_ENTRIES`, and
  `HARDWARE_EXPLORER_SHARE_MAX_AGE_DAYS`; share URLs keep source out of the URL
  itself but the server still stores that source until retention removes it.
- Keep stress workloads opt-in. Default verification should not include
  `--include-stress` until those workloads are tuned on a dedicated machine.

The direct runner is only for trusted local development, local Docker, and CI
smoke checks. Do not expose it to untrusted users. In Preview, `/compare` and
`/experiment` are intentionally unavailable in hosted sandbox mode; keep the
full multi-profile workflow local until those routes have a sandbox-capable
runner.

Build the execution image before starting a hosted server:

```bash
./docker/build-image.sh
HARDWARE_EXPLORER_DEPLOYMENT_MODE=hosted \
HARDWARE_EXPLORER_ENABLE_SANDBOX=1 \
node backend/server/server.js
```

The server refuses to listen if either the image or Docker daemon is missing.

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

For hosted traffic, `healthy` is insufficient by itself: `/health` must also
report `mode: "hosted"` and `sandbox: "enabled"`.

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

```bash
./backend/scripts/cache-explore calibration
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
