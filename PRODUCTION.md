# Production — `@fabric/core`
`@fabric/core` is the **reference Fabric client**: P2P `Peer`, `Message`, `Key` / identity, collections, Bitcoin and Lightning services, and the types that **hub.fabric.pub** and **`@fabric/http`** build on.

## Pre-flight
| Step | Command |
|------|---------|
| Node | **24.14.1** (see `package.json` `engines` and `.nvmrc`). |
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
| [PRIVACY.md](../PRIVACY.md) | Operator-facing privacy model |
| [AGENTS.md](../AGENTS.md) | Agent service contract |
