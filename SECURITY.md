# Security
Fabric aims to maximize the security of a sensible default configuration while keeping dependencies understandable and reviewable.

## Objectives
- Secure defaults for the reference client (`@fabric/core`)
- Minimal attack surface where practical
- Clear separation between **experimental** APIs and **release** commitments (see [CHANGELOG.md](CHANGELOG.md))

## Operator-facing docs
| Doc | Use |
|-----|-----|
| [DEVELOPERS.md](DEVELOPERS.md) | Contributor workflow, core types, tests |
| [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) | Completion, privacy, security checklist |
| [PRIVACY.md](PRIVACY.md) | What is / is not hidden from peers and observers |
| [AUDIT.md](AUDIT.md) | Known issues and recommendations |
| [SECURITY_IMPLEMENTATION_PLAN.md](SECURITY_IMPLEMENTATION_PLAN.md) | Native/C hardening roadmap |
| [docs/PRODUCTION.md](docs/PRODUCTION.md) | Node version, native addons, downstream alignment |

## Process
1. Before large changes, run **`npm run ci`** (full test suite).
2. For dependency and coverage reports: **`npm run reports`** (install log, coverage, TODO grep — may be slow).
3. Review **`npm audit`** results before release tags; record exceptions in the release notes if needed.
4. **Never** commit seeds, `stores/` production data, or RPC passwords (see [docs/PRODUCTION.md](docs/PRODUCTION.md)).

## Disclosure
Report security issues through the contact in [TODO.md](TODO.md) / project README as applicable.
