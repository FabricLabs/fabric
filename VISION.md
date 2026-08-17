# Fabric — product vision
This document is the **north star** for documentation and implementation work in **`@fabric/core`**. Older whitepapers, completion reports, and snippets may add color; when they conflict with **this file**, **DEVELOPERS.md**, **PUBLIC_API.md**, **PROTOCOL.md** (→ `docs/MESSAGE_BODY.md`), and **QUICKSTART.md**, prefer those plus **README.md**.

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
| **Contracts** | Agreements beyond the base peer protocol. Contracts advertise **interfaces** (not a single `kind`); Hub registry publishes the **Hub contract first**. See **[docs/CONTRACTS.md](docs/CONTRACTS.md)**. **`CLI`** extends **`FabricShell`** (`types/service.js`). |
| **Downstream** | **Hub** (rendezvous, WebSocket bridge, documents, optional Payjoin) is a **consumer** of this library, not part of this repo. |

## What “done” looks like for 0.1.x
- **Operators** can run **`fabric`** / a hub with **[docs/PRODUCTION.md](docs/PRODUCTION.md)** expectations.
- **Developers** can follow **[QUICKSTART.md](QUICKSTART.md)**, **[PUBLIC_API.md](PUBLIC_API.md)**, and **[DEVELOPERS.md](DEVELOPERS.md)** without dead links.
- **Protocol** wire format is **[docs/MESSAGE_BODY.md](docs/MESSAGE_BODY.md)** (entry: **[PROTOCOL.md](PROTOCOL.md)**); semantics in **[MESSAGES.md](MESSAGES.md)** stay aligned with opcodes.
- **Scoped claim:** Peer + document helpers + local Program/Machine — not a hardened remote sandbox.
- **Tests**: **`npm run ci`** is the release gate (see **README.md**).

## Experimental / secondary tracks
These are **not** the default path for new contributors:

- **C bindings** and **native** examples — optional; see **[examples/README.md](examples/README.md)** (not on the JS release gate).
- **WebGPU / garbled circuits** — see **examples/README-WEBGPU.md**; research-grade.
- **Historical** whitepapers and **snippets/** — ideas and drafts, not schedule commitments.

## Documentation map
| Tier | Files |
|------|--------|
| **Must read** | **README.md**, **QUICKSTART.md**, **PUBLIC_API.md**, **DEVELOPERS.md**, **VISION.md** (this file) |
| **Protocol & security** | **PROTOCOL.md** → **docs/MESSAGE_BODY.md**, **MESSAGES.md**, **POLICY.md**, **SECURITY.md**, **PRIVACY.md**, **AUDIT.md** |
| **Operators** | **docs/PRODUCTION.md** (includes release checklist) |
| **Contracts & CLI** | **docs/CONTRACTS.md**, **docs/CLI.md**, **docs/L1_DOCUMENT_EXCHANGE.md** |
| **Guides** | **guides/SERVICES.md**, **guides/ACTORS.md**, **guides/BUILD.md**, **guides/BEST_PRACTICES.md** |
| **API** | **PUBLIC_API.md** (frozen leaves); **API.md** (full JSDoc via `npm run make:api`) |
| **Changelog** | **CHANGELOG.md** |

## Implementation priorities (forward motion)
1. **Keep the JS path honest** — examples and README commands match **package.json** scripts and **Node 24.x**.
2. **Tighten protocol ↔ code** — **MESSAGES.md** and **constants** stay in sync; fewer one-off message types over time.
3. **Shrink doc surface** — label one-off reports via **[docs/NON_CANONICAL.md](docs/NON_CANONICAL.md)**; point readers here + **docs/README.md** instead of adding new root-level “completion” files.
4. **Hub + HTTP** — coordinate releases with **hub.fabric.pub** / **@fabric/http** (see **DEVELOPERS.md**).

---

*Last consolidated: 2026-03 — maintainers: update **CHANGELOG.md** when vision-level direction changes.*
