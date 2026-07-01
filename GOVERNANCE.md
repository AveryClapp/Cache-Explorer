# Governance

Cache Explorer currently uses a maintainer-led governance model.

## Maintainers

Maintainers are responsible for:

- Reviewing pull requests.
- Triage and labels.
- Release decisions.
- Security response.
- Protecting the hardware model contract and safety boundaries.

## Decision Making

Small fixes can be merged after maintainer review and passing checks.

Large changes should start as an issue or discussion before implementation,
especially when they affect:

- Sandbox or execution behavior.
- Native build and release artifacts.
- Hardware calibration claims.
- Public APIs, JSON schemas, or share-state format.
- UI workflow structure.
- Long-running benchmark or stress behavior.

Maintainers make final calls when there is disagreement, with a bias toward
safety, reproducibility, and keeping model claims honest.

## Becoming a Maintainer

Maintainer access is earned through sustained, high-quality contributions,
helpful review, and good judgment around safety and project scope.

## Code of Conduct

All project spaces follow the [Code of Conduct](CODE_OF_CONDUCT.md).
