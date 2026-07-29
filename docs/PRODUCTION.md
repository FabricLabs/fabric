# Production — `@fabric/core`
`@fabric/core` is the **reference Fabric client**: P2P `Peer`, `Message`, `Key` / identity, collections, Bitcoin and Lightning services, and the types that **hub.fabric.pub** and **`@fabric/http`** build on.

## Pre-flight
| Step | Command |
|------|---------|
| Node | **24.15.0** (see `package.json` `engines` / `.nvmrc`). |
| Install | `npm ci` |
| Release gate | **`npm run ci`** — full recursive **`mocha`** test suite (`NODE_ENV=test`). |

## Native addons
**`fabric.node` (C) is not built on npm install** — JS is the canonical protocol. Optional:
`npm run build:c` / `FABRIC_BUILD_NATIVE=1` (see [BUILD.md](../BUILD.md)). Other deps (e.g.
**level**, **zeromq**) may still compile their own bindings.

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
