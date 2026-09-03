# Release And Install Runbook

This is the maintainer-facing path for shipping and installing Cache Explorer.
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
docker-compose up --build
curl -fsS http://localhost:8080/health
curl -fsS http://localhost:8080/sandbox-status
```

Docker is the easiest product-like install because the frontend, backend, health
checks, and API proxy are wired together.

### Production Environment

Use `.env.production.example` as the deployment template. The important posture
bits are:

- `ENABLE_SANDBOX=1` for public untrusted-code execution.
- `TRUST_PROXY=1` behind a reverse proxy.
- Conservative request/process limits until metrics show capacity.
- Stress workloads remain opt-in and outside default verification.

## Pre-Release Gate

Run these checks before tagging:

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

For a full CI-equivalent release candidate, rely on GitHub Actions for simulator
unit tests, integration tests, workload snapshot verification, frontend smoke,
server tests, Docker provenance/SBOM generation, and release validation.

## Release Flow

Cache Explorer uses the root Release Please manifest as the canonical product
version. The versions in `frontend/package.json`, `backend/server/package.json`,
`vscode-extension/package.json`, and `CMakeLists.txt` belong to those individual
build artifacts and do not define the GitHub release version.

Preview tags such as `v0.8.0-hardware-preview` must be published as GitHub
prereleases. Stable semantic-version releases are the only releases that should
be marked Latest.

1. Merge through `main` with CI green.
2. Let Release Please create the release PR and changelog.
3. Review release notes for user-visible model-contract, workload, sandbox,
   rate-limit, or install changes.
4. Merge the release PR.
5. Confirm the tag triggered pass builds and Docker image builds.
6. Confirm the GitHub Release contains pass assets and `SHA256SUMS`.
7. Confirm release validation verifies checksums, attestations, GHCR image
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
