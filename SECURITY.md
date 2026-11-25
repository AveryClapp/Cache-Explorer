# Security Policy

Hardware Explorer Preview (formerly Cache Explorer) compiles and may execute
local source code. Please treat
sandboxing, subprocess execution, temporary files, release artifacts, and
downloaded binaries as security-sensitive areas.

Direct execution is for trusted local use only. A hosted deployment must set
`HARDWARE_EXPLORER_DEPLOYMENT_MODE=hosted` and
`HARDWARE_EXPLORER_ENABLE_SANDBOX=1`; startup is refused if the sandbox image or
Docker daemon is unavailable. Comparison and experiment endpoints are not
offered in hosted sandbox mode yet.

## Supported Versions

Security fixes target:

- The current `main` branch.
- The latest published release when a practical patch release is possible.

Older releases are best-effort only.

## Reporting a Vulnerability

Please do not report security vulnerabilities in public issues, pull requests,
or discussions.

Preferred path:

1. Open a private GitHub security advisory:
   `https://github.com/AveryClapp/Cache-Explorer/security/advisories/new`
2. Include a concise description, affected versions, reproduction steps, and
   impact.
3. If private advisories are unavailable, contact the maintainer through the
   contact information on the GitHub profile and avoid posting exploit details
   publicly.

You should receive an initial response within 7 days. If the report is valid,
maintainers will coordinate a fix, release notes, and any needed credit.

## Scope

In scope:

- Escaping the intended sandbox or execution boundary.
- Arbitrary file read/write through submitted source, archives, paths, or
  filenames.
- Command injection in compile, run, workload, calibration, Docker, or release
  scripts.
- Unsafe handling of downloaded LLVM pass binaries or checksums.
- Denial-of-service behavior that bypasses documented limits.
- Cross-site scripting or unsafe share-state handling in the frontend.

Out of scope:

- Running intentionally untrusted code in direct local development mode.
- Resource-heavy workloads when stress mode or large event limits were
  explicitly requested.
- Vulnerabilities in unsupported local toolchains outside Hardware Explorer's
  control.

## Safe Disclosure

Please give maintainers reasonable time to ship a fix before public disclosure.
Reports that include a patch or minimized reproduction are especially helpful.
