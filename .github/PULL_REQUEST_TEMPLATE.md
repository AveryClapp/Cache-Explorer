## Summary

What does this PR change, and why?

## Type

- [ ] Bug fix
- [ ] Feature
- [ ] Documentation
- [ ] Test coverage
- [ ] Refactor or cleanup
- [ ] Release/deployment
- [ ] Hardware model or calibration

## User Impact

- [ ] Changes UI/UX
- [ ] Changes CLI/API output
- [ ] Changes JSON schema, share state, or exported data
- [ ] Changes build, install, Docker, or release behavior
- [ ] No user-facing behavior change

## Trust, Safety, and Performance

- [ ] No security-sensitive paths touched
- [ ] Touches compile/run/sandbox/subprocess/temp-file behavior
- [ ] Touches release artifacts, checksums, attestations, or downloads
- [ ] Could affect runtime, memory, CPU load, or browser responsiveness
- [ ] Adds or changes hardware/model/calibration claims

Notes:

## Testing

Paste the commands you ran and summarize the result.

```text

```

Recommended checks by area:

- Docs/metadata: `git diff --check`
- Frontend: `npm run build`, `npm run bundle:check`, `npm run smoke:ui`
- Visual UI changes: `npm run visual:check`
- Server: `npm test` in `backend/server`
- Calibration: `./backend/scripts/cache-explore calibration`
- Native simulator: relevant `*Test` binaries under `backend/cache-simulator/build`

## Screenshots or Recordings

Add screenshots for UI changes, especially first-run, results, Hardware
Explorer, workload catalog, and modal states.

## Documentation

- [ ] README/docs updated
- [ ] Existing docs still accurate
- [ ] New caveats or limitations documented
- [ ] Not applicable

## Checklist

- [ ] I searched for related issues/PRs.
- [ ] I kept the PR focused.
- [ ] I added or updated tests where appropriate.
- [ ] I did not add default stress or long-running workloads.
- [ ] I preserved honest hardware/model contract language.
- [ ] I did not commit build outputs, local databases, secrets, or `.env` files.

## Related Issues

Closes #
