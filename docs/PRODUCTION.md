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

## Release checklist
Use before tagging an RC or release:

- [ ] Clean tree on the agreed branch.
- [ ] `npm ci` on **Node 24.15.x**.
- [ ] **`npm run ci`** (full test suite).
- [ ] Confirm **native** modules build on a fresh Linux image if you ship to production servers.
- [ ] Update **CHANGELOG.md** with version, date, breaking vs additive notes.
- [ ] Bump **version** in `package.json` (tag must match).
- [ ] **Downstream:** bump **`@fabric/core`** in [fabric-http](https://github.com/FabricLabs/fabric-http) and [hub.fabric.pub](https://github.com/FabricLabs/hub.fabric.pub); run their `npm run ci`.
- [ ] Tag and push; publish **npm** `@fabric/core` when ready (or document Git install ref).

Optional before tag: `npm run report:quality`, `npm run make:dev && npm run check:book-links`, `npm run report:coverage-baseline`.

Historical consolidation checklist notes (exports, lint gates, audit triage) live in
git history under the former `PRODUCTION-CHECKLIST.md` / `RELEASE_CHECKLIST.md`
paths; this file is the operator source of truth.

## References
| Doc | Purpose |
|-----|---------|
| [README.md](../README.md) | CLI, quick start, API overview |
| [DEVELOPERS.md](../DEVELOPERS.md) | Contributors: layout, tests, core types |
| [PRIVACY.md](../PRIVACY.md) | Operator-facing privacy model |
| [AGENTS.md](../AGENTS.md) | Agent service contract |
