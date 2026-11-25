# Hardware Explorer Preview Release And Install Runbook

This is the maintainer-facing path for shipping Hardware Explorer Preview while
preserving the existing Cache Explorer packages and compatibility entrypoints.
It avoids hosted-traffic tuning; production values should still be adjusted from
real usage metrics after deployment.

## Install Paths

### Local Product

```bash
./scripts/doctor.sh
./scripts/dev.sh
```

Use this path for contributors and demos. It starts the backend and frontend
together, prints health URLs, and keeps execution in direct local mode.

### Docker Product

```bash
docker compose up --build
curl -fsS http://localhost:8080/health
curl -fsS http://localhost:8080/sandbox-status
```

Docker Compose is a local product install because the frontend, backend, health
checks, and API proxy are wired together. Its backend uses direct execution;
its published ports are loopback-only. Do not expose the Compose network or
ports to untrusted users.

### Production Environment

Use `.env.production.example` as the deployment template. The important posture
bits are:

- `HARDWARE_EXPLORER_DEPLOYMENT_MODE=hosted` for public operation.
- `HARDWARE_EXPLORER_ENABLE_SANDBOX=1`; startup fails if the sandbox is unavailable.
- `HARDWARE_EXPLORER_TRUST_PROXY=1` behind a reverse proxy.
- `HARDWARE_EXPLORER_ALLOWED_ORIGINS` set to exact hosted UI origins.
- Conservative request/process limits until metrics show capacity.
- Bounded share-link size, count, and retention using the
  `HARDWARE_EXPLORER_MAX_SHARE_*` settings.
- Stress workloads remain opt-in and outside default verification.

Build `cache-explorer-sandbox:latest` with `./docker/build-image.sh` before
starting the hosted server. Hosted startup fails closed if that image or the
Docker daemon is unavailable.

A fresh dependency install and first Docker/sandbox image build require network
access; subsequent local analysis does not load external web assets.

## Pre-Release Gate

Run these checks before tagging:

```bash
cd frontend
npm ci
npm run build
npm run lint
npm run bundle:check
npm run tokens:check
npm run diagnostics:check
npm run smoke:ui
npm run visual:check
npm run smoke:live # while the rebuilt Docker product is running
```

```bash
cd backend/server
npm test
```

```bash
./backend/scripts/cache-explore calibration
./tests/integration/test-structured-experiment.sh
```

Run the native build and default experiment on both macOS and Linux. The Linux
gate may run on a native host or the release Docker image. Also run
`docker compose up --build`, confirm both health checks, exercise one default
analysis, then tear the stack down. GitHub Actions remains the independent Linux
check for simulator tests, workload snapshots, Docker provenance/SBOMs, and
release validation.

## Release Flow

The repository uses the root Release Please manifest as the canonical product
version. The versions in `frontend/package.json`, `backend/server/package.json`,
`vscode-extension/package.json`, and `CMakeLists.txt` belong to those individual
build artifacts and do not define the GitHub release version.

Preview tags such as `v1.8.0-preview.1` are automatically published as GitHub
prereleases. Manual releases default to prerelease as well. Stable semantic-version
tags are the only releases that should be marked Latest.

1. Confirm the open stable Release Please PR is based on the intended product
   state; close or supersede stale release PRs before merging the rebrand.
2. Merge through `main` with CI green.
3. Let Release Please create the release PR and changelog.
4. Review release notes for user-visible model-contract, workload, sandbox,
   rate-limit, or install changes.
5. Merge the release PR only when the stable-name decision is explicit.
6. Confirm the tag triggered pass builds and Docker image builds.
7. Confirm the GitHub Release contains pass assets and `SHA256SUMS`.
8. Confirm release validation verifies checksums, attestations, GHCR image
   availability, and workload-history archival.

## Artifact Trust

The release chain should provide:

- `SHA256SUMS` for LLVM pass assets.
- GitHub artifact attestations for release binaries.
- GHCR image provenance attestations and SBOMs.
- Workload-history archives attached to releases when available.
- Calibration evidence packets that validate with
  `cache-explore calibration` before they are used to justify profile promotion.

## Install Verification

After install or deploy:

```bash
curl -fsS http://localhost:8080/health
curl -fsS http://localhost:8080/sandbox-status
curl -fsS http://localhost:8080/metrics | head
```

The UI header should show health and direct/sandbox mode before a run. Share a
short link and reopen it before announcing a public build.
