# Contributing to Cache Explorer

Thanks for helping make Cache Explorer better. This project sits at the
intersection of compilers, hardware modeling, and product UI, so good
contributions are clear about both behavior and trust boundaries.

## Start Here

```bash
git clone https://github.com/AveryClapp/cache-explorer.git
cd cache-explorer

./scripts/doctor.sh
./scripts/dev.sh
```

Open the frontend URL printed by `./scripts/dev.sh`.

The doctor script checks the local toolchain and product entrypoints. The dev
script builds missing native artifacts, installs Node dependencies if needed,
and starts the backend and frontend on available local ports.

## Prerequisites

- LLVM/Clang 17-21, with LLVM 18 recommended for broadest CI parity.
- CMake 3.20+.
- Ninja.
- Node.js 18+.
- npm.

## Development Workflow

1. Fork the repository.
2. Create a branch from `main`.
3. Keep changes focused on one behavior or cleanup area.
4. Add or update tests for behavior changes.
5. Run the smallest useful verification set locally.
6. Open a pull request with the template filled out.

Use Conventional Commits for commit messages:

```text
feat: add ARM cache profile
fix: preserve timeout diagnostics
docs: clarify calibration evidence packets
test: add browser smoke for share round trip
chore: update release metadata
```

## Verification Tiers

Run the tier that matches your change. More is welcome, but avoid heavy local
stress unless the PR explicitly needs it.

### Docs and Metadata

```bash
git diff --check
ruby -e 'require "yaml"; Dir[".github/**/*.yml"].each { |f| YAML.load_file(f) }; puts "yaml ok"'
```

### Frontend

```bash
cd frontend
npm run build
npm run bundle:check
npm run tokens:check
npm run diagnostics:check
npm run smoke:ui
npm run visual:check
```

### Backend Server

```bash
cd backend/server
npm test
```

### Calibration Packets

```bash
./backend/scripts/cache-explore calibration
./backend/scripts/cache-explore calibration --json
```

### Native Simulator and Integration Tests

```bash
./scripts/build.sh
cd backend/cache-simulator/build
./CacheLevelTest
./CacheSystemTest
./MESICoherenceTest
./MultiCorePrefetchTest
./MultiCoreTLBTest
./MultiCoreTraceProcessorTest
./AdvancedInstrumentationTest
```

CI runs broader native, integration, workload, frontend, Docker, release, and
dashboard checks.

## Safety and Performance

Cache Explorer can execute user-provided code locally. Contributions that touch
execution paths, sandboxing, compilation, subprocess management, or temporary
files must preserve the safety model:

- Keep public/untrusted execution behind sandbox-aware code paths.
- Preserve bounded timeouts and resource cleanup.
- Do not add stress workloads to default verification.
- Keep stress and long empirical sweeps opt-in and documented.
- Prefer mocked browser and metadata checks when validating UI workflows.

If a change can affect laptop load, thermal behavior, or long-running compile
loops, call that out in the PR.

## Hardware Claims

Hardware profiles should be honest about what is known.

- Use `calibrated` only when there is Level 2 or better evidence for that
  subsystem.
- Use `modeled` for fields consumed directly by the simulator.
- Use `estimated` for directional analytical model inputs.
- Use `metadata-only` for profile facts that do not affect results.
- Use `unsupported` when the engine does not model the behavior.

See:

- [Hardware Model Contract](docs/HARDWARE_MODEL_CONTRACT.md)
- [Calibration Roadmap](docs/CALIBRATION_ROADMAP.md)
- [How to Read Results](docs/HOW_TO_READ_RESULTS.md)

## Code Style

### C++ and C

- Follow the existing style in the touched module.
- Prefer clear ownership and deterministic tests.
- Keep simulator behavior covered by unit or golden-kernel tests.
- Use CMake/Ninja paths already present in the repo.

### TypeScript and React

- Prefer existing components and CSS tokens.
- Keep dense engineering workflows scan-friendly.
- Use accessible names for icon-only or ambiguous controls.
- Avoid adding new design systems or large dependencies without a strong reason.

### General

- Do not commit generated build outputs, local databases, or `.env` files.
- Keep docs and comments precise about caveats.
- Do not add `Co-Authored-By` lines to commits.

## Reporting Bugs

Use the bug report issue form. Include:

- Exact command or UI path.
- OS, LLVM/Clang version, Node version, browser, and hardware profile.
- Whether the run used sandbox, direct local execution, Docker, or CI.
- The smallest code sample that reproduces the issue.
- Result fidelity/provenance details if the issue is accuracy-related.

## Security Reports

Do not open a public issue for vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the MIT
License.
