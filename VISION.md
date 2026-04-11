# Fabric — product vision
This document is the **north star** for documentation and implementation work in **`@fabric/core`**. Older whitepapers, completion reports, and snippets may add color; when they conflict with **this file**, **DEVELOPERS.md**, **PROTOCOL.md**, and **QUICKSTART.md**, prefer those four plus **README.md**.

## What we are building
**Fabric** is a **protocol and a reference client** for **peer-to-peer agreements**—applications that coordinate without requiring users to trust the same server. **Bitcoin** is the primary settlement and bonding layer: participants lock value where the protocol requires it, and dispute/exit paths stay on-chain where appropriate.

**`@fabric/core`** is the **JavaScript (Node) reference implementation**: typed classes for **identity**, **messages**, **peers**, **chain views**, **services** (Bitcoin RPC, Lightning stubs, ZMQ, …), **storage**, and **contracts/proposals** that downstream apps (including **hub.fabric.pub**) compose into products.

The **vision** is not “replace the web in one release.” It is: **clear protocols**, **auditable code**, **honest docs**, and **incremental** delivery—CLI and hub first, broader ecosystem as adapters land.

## Principles (from engineering culture)
See **[GOALS.md](GOALS.md)** for the explicit list. In short:

- **Simplicity over cleverness** — complexity is the enemy.
- **Make it work → make it right → make it fast** (in that order).
- **Human liberty** — improve access to sovereignty and reduce unnecessary trusted third parties.

## Architecture (current)
| Layer | Role |
|-------|------|
| **Wire** | **Fabric Message** framing (`types/message.js`), opcodes in **`constants`**, TCP/NOISE **`Peer`**. |
| **State** | **Actor** / **State** / **Collection**; JSON Patch for deltas; hub and clients use similar patterns. |
| **Money** | **Bitcoin** and **Lightning** **services** over RPC; optional explorers via configured origins only. |
| **Apps** | **`CLI`** extends **`FabricShell`** (`types/service.js`) — encrypted store, peer, machine, resources. |
| **Downstream** | **Hub** (rendezvous, WebSocket bridge, documents, optional Payjoin) is a **consumer** of this library, not part of this repo. |

## What “done” looks like for 0.1.x
- **Operators** can run **`fabric`** / a hub with **[docs/PRODUCTION.md](docs/PRODUCTION.md)** expectations.
- **Developers** can follow **[QUICKSTART.md](QUICKSTART.md)** and **[DEVELOPERS.md](DEVELOPERS.md)** without dead links.
- **Protocol** behavior for messages and services is described in **[PROTOCOL.md](PROTOCOL.md)** and **[MESSAGES.md](MESSAGES.md)** and stays aligned with **`@fabric/core`** opcodes.
- **Tests**: **`npm run ci`** is the release gate (see **README.md**).

## Experimental / secondary tracks
These are **not** the default path for new contributors:

- **C bindings** and **native** examples — see **examples/README-C-EXAMPLES.md**, **README_C_BINDINGS.md**.
- **WebGPU / garbled circuits** — see **examples/README-WEBGPU.md**; research-grade.
- **Historical** whitepapers and **snippets/** — ideas and drafts, not schedule commitments.

## Documentation map
| Tier | Files |
|------|--------|
| **Must read** | **README.md**, **QUICKSTART.md**, **DEVELOPERS.md**, **VISION.md** (this file) |
| **Protocol & security** | **PROTOCOL.md**, **MESSAGES.md**, **POLICY.md**, **SECURITY.md**, **PRIVACY.md** |
| **Operators** | **docs/PRODUCTION.md**, **docs/RELEASE_CHECKLIST.md**, **docs/PRODUCTION-CHECKLIST.md** |
| **Guides** | **guides/SERVICES.md**, **guides/ACTORS.md**, **guides/BUILD.md**, **guides/BEST_PRACTICES.md** |
| **API** | **API.md** (regenerate with `npm run make:api`), HTML under **docs/** after `npm run make:docs` |
| **Changelog** | **CHANGELOG.md** |

## Implementation priorities (forward motion)
1. **Keep the JS path honest** — examples and README commands match **package.json** scripts and **Node 24.x**.
2. **Tighten protocol ↔ code** — **FABRIC_MESSAGE_TYPE_CONSOLIDATION.md** and **constants** stay in sync; fewer one-off message types over time.
3. **Shrink doc surface** — label one-off reports via **[docs/NON_CANONICAL.md](docs/NON_CANONICAL.md)**; point readers here + **docs/README.md** instead of adding new root-level “completion” files.
4. **Hub + HTTP** — coordinate releases with **hub.fabric.pub** / **@fabric/http** (see **DEVELOPERS.md**).

---

*Last consolidated: 2026-03 — maintainers: update **CHANGELOG.md** when vision-level direction changes.*
