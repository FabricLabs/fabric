# Fabric — product vision
This document is the **north star** for documentation and implementation work in **`@fabric/core`**. Older whitepapers, completion reports, and snippets may add color; when they conflict with **this file**, **DEVELOPERS.md**, **PUBLIC_API.md**, **PROTOCOL.md** (→ `docs/MESSAGE_BODY.md`), and **QUICKSTART.md**, prefer those plus **README.md**.

## What we are building
**Fabric** is a **protocol and a reference client** for **peer-to-peer agreements**—applications that coordinate without requiring users to trust the same server. **Bitcoin** is the primary settlement and bonding layer: participants lock value where the protocol requires it, and dispute/exit paths stay on-chain where appropriate.

**`@fabric/core`** is the **JavaScript (Node) reference implementation**: typed classes for **identity**, **messages**, **peers**, **chain views**, **services** (Bitcoin RPC, Lightning stubs, ZMQ, …), **storage**, and **contracts/proposals** that downstream apps (including **hub.fabric.pub**) compose into products.

Every Fabric-speaking node is a peer. **Hub** is one application and an optional public registry (contract directory, Beacon, browser bridge). It is not a privileged tier. A peer that speaks core can sell file chunks, answer storage challenges, run a bonded program, and join a federation without Hub Accept. Core owns primary Message types. New market payloads ride `CONTRACT_MESSAGE` bodies defined beside the core type. HTTP is an adapter.

A node is paid in Bitcoin for three kinds of work:

- **Chunks.** The network is a paid CDN for 32 KiB file chunks. Delivery is `P2P_FILE_SEND`; settlement is a per-blob HTLC.
- **Storage.** A publisher’s storage Contract pays a provider who answers challenges for as long as the publisher enforces the term. Fraud proofs slash the provider’s deposit.
- **Compute.** A worker runs a known program (`Program.programHash`) and posts a `FabricProgramRun`. A fraud proof of a wrong run slashes the worker’s deposit. `javascript` programs that need `trusted: true` are not bondable. This is not a hardened virtual machine.

The **vision** is not “replace the web in one release.” It is: **clear protocols**, **auditable code**, **honest docs**, and **incremental** delivery—CLI and peers first, Hub and other apps as adapters.

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
| **Contracts** | Agreements beyond the base peer protocol. Contracts advertise **interfaces** (not a single `kind`). Any peer may publish one. A Hub registry is a directory of contracts peers already speak. See **[docs/CONTRACTS.md](docs/CONTRACTS.md)**. **`CLI`** extends **`FabricShell`** (`types/service.js`). |
| **Downstream** | **Hub** (example application: rendezvous, WebSocket bridge, documents UI, BIP78 Payjoin HTTP) is a **consumer** of this library, not part of this repo. |

## What “done” looks like for 0.1.x
- **Operators** can run **`fabric`** / a hub with **[docs/PRODUCTION.md](docs/PRODUCTION.md)** expectations.
- **Developers** can follow **[QUICKSTART.md](QUICKSTART.md)**, **[PUBLIC_API.md](PUBLIC_API.md)**, and **[DEVELOPERS.md](DEVELOPERS.md)** without dead links.
- **Protocol** wire format is **[docs/MESSAGE_BODY.md](docs/MESSAGE_BODY.md)** (entry: **[PROTOCOL.md](PROTOCOL.md)**); semantics in **[MESSAGES.md](MESSAGES.md)** stay aligned with opcodes.
- **Scoped claim:** Peer + document helpers + local Program/Machine — not a hardened remote sandbox.
- **Tests**: **`npm run ci`** is the release gate (see **README.md**).

## Experimental / secondary tracks
These are **not** the default path for new contributors:

- **C bindings** and **native** examples — see **examples/README-C-EXAMPLES.md**, **README_C_BINDINGS.md**.
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
1. **Keep the JS path honest** — examples and README commands match **package.json** scripts and **Node 26.x**.
2. **Tighten protocol ↔ code** — **FABRIC_MESSAGE_TYPE_CONSOLIDATION.md** and **constants** stay in sync; fewer one-off message types over time.
3. **Shrink doc surface** — label one-off reports via **[docs/NON_CANONICAL.md](docs/NON_CANONICAL.md)**; point readers here + **docs/README.md** instead of adding new root-level “completion” files.
4. **Hub + HTTP** — coordinate releases with **hub.fabric.pub** / **@fabric/http** (see **DEVELOPERS.md**).

---

*Last consolidated: 2026-03 — maintainers: update **CHANGELOG.md** when vision-level direction changes.*
