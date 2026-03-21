# Production — `@fabric/core`
`@fabric/core` is the **reference Fabric client**: P2P `Peer`, `Message`, `Key` / identity, collections, Bitcoin and Lightning services, and the types that **hub.fabric.pub** and **`@fabric/http`** build on.

## Pre-flight
| Step | Command |
|------|---------|
| Node | **22.14.x** (see `package.json` `engines`). |
| Install | `npm ci` |
| Release gate | **`npm run ci`** — full recursive **`mocha`** test suite (`NODE_ENV=test`). |

## Native addons
Production installs may compile **native** dependencies (e.g. **secp256k1**, **level**, **zeromq**). CI runners and deploy images need **build toolchain** (Python, make, C++ compiler) unless using prebuilds. See [README.md](../README.md) and **BUILD.md** (if present) for platform notes.

## Downstream alignment
- **hub.fabric.pub** and **@fabric/http** often pin **Git branches** of this repo during RC. For a coordinated release, tag **`@fabric/core`** first (or in lockstep), then bump pins in Hub and fabric-http.
- **Do not** commit seeds, `stores/` production data, or RPC passwords.

## Security
- **Mnemonic / xprv** — Only on operator-controlled machines; backup offline.
- **P2P exposure** — Bind `FABRIC_PORT` / listen interfaces deliberately; use firewall rules in datacenter deploys.

## References
| Doc | Purpose |
|-----|---------|
| [README.md](../README.md) | CLI, quick start, API overview |
| [DEVELOPERS.md](../DEVELOPERS.md) | Contributors: layout, tests, core types |
| [PRODUCTION_READINESS.md](../PRODUCTION_READINESS.md) | Completion, privacy, security checklist |
| [PRIVACY.md](../PRIVACY.md) | Operator-facing privacy model |
| [PAYMENTS_DOCUMENT_BINDING.md](PAYMENTS_DOCUMENT_BINDING.md) | `DocumentPublish` envelope + L1 / HTLC hash chain (`functions/publishedDocumentEnvelope.js`) |
| [CONTRACT_PROPOSAL.md](CONTRACT_PROPOSAL.md) | `ContractProposal` message: batched wires + Merkle chain + JSON Patch (`functions/contractProposal.js`) |
| [MARKETING_OVERVIEW.md](MARKETING_OVERVIEW.md) | Positioning |
| [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) | Tag & downstream bumps |
| [AGENTS.md](../AGENTS.md) | Agent service contract |
