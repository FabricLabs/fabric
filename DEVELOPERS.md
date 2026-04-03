# Fabric Developer Resources
There is a lot to cover when building decentralized applications on Fabric, so grab a coffee ☕ and settle in.

## Contents
- [Vision](#vision)
- [Quick start](#quick-start)
- [Repository layout](#repository-layout)
- [Development workflow](#development-workflow)
- [Bitcoin service](#bitcoin-service-servicesbitcoin)
- [Message types](#message-types-typesmessage)
- [Architecture](#architecture)
- [Storage](#storage-typesstore)
- [Reference links](#reference-links)
- [Production & release](#production--release)
- [Core types (reference)](#core-types-reference)
- [Roadmap & doc backlog](#roadmap--doc-backlog)

## Vision
Read **[VISION.md](VISION.md)** first for what Fabric is building, how **`@fabric/core`** fits (JS reference client, Bitcoin/Lightning services, **FabricShell**/CLI), and which docs are canonical vs experimental.

## Quick Start
See also [`QUICKSTART.md`][quickstart-guide] for up-to-date instructions.

0. `nvm use 24.14.1` (install [`nvm`][nvm-official] if needed; matches `.nvmrc` / `package.json` engines)
1. From a clone of this repo: `npm install` (or `npm install -g @fabric/core` to put `fabric` on your `PATH`)
2. (optional) `fabric setup` to generate a master key and local config
3. (optional) `fabric keygen` to generate a new master key without saving to disk (ephemeral)
4. Run `fabric` — the CLI entry is wired through `types/cli.js` and extends **`Service.FabricShell`**

Working from a **git checkout** (not the global package) is best when you are changing `@fabric/core` itself; use `npm link` or `npm install ../fabric` from downstream packages (Hub, HTTP server) as described in the repo README.

## Repository layout
| Path | Role |
|------|------|
| `types/` | ES6 **classes** — `Actor`, `Peer`, `Service`, `Store`, `Message`, etc. CommonJS (`require`) throughout. |
| `services/` | Long-running **integrations** (Bitcoin RPC, Lightning stubs, ZMQ, …) built on `Service`. |
| `contracts/` | Language snippets, traces, and tooling (e.g. type dependency graph). |
| `scripts/` | CLI entrypoints, doc helpers (`list-jsdoc-type-files.js`, `remove-legacy-types.sh`). |
| `tests/` | Mocha suites; run with `npm test`. |
| `settings/` | Default and environment-specific config; `settings/deprecations.js` holds legacy aliases. |
| `assets/` | **Generated** browser bundles; rebuild with `npm run build` after type changes. |

## Development workflow
- **Node:** engines field in `package.json` is authoritative (currently Node 22.x).
- **Unit tests:** `npm test` — runs Mocha recursively under `tests/`.
- **Lint:** `npm run lint` / `npm run lint:fix` (Semistandard).
- **API reference:** `npm run make:api` writes `API.md` from JSDoc (see `scripts/list-jsdoc-type-files.js` for which `types/*.js` files are included).
- **HTML docs:** `npm run make:docs` (runs `make:api` first, then **`scripts/clean-jsdoc-html.js`** — removes all **`docs/**/*.html`** and JSDoc template dirs **`docs/fonts`**, **`docs/scripts`**, **`docs/styles`**, **`docs/public`** so stale pages and duplicate assets do not accumulate, then JSDoc writes under `docs/`).
- **Historical / one-off Markdown:** see **`docs/NON_CANONICAL.md`** — root-level “completion” and analysis files are not the same tier as **VISION.md** or **`docs/README.md`**.
- **Native addon (`fabric.node`):** it is **not** `require()`’d unless **`FABRIC_NATIVE_DOUBLE_SHA256=1`**; message body double-SHA256 uses **@noble/hashes** by default. Enable that env var when exercising the C **`doubleSha256`** export.
- **Local packages:** when `fabric`, `fabric-http`, and Hub are sibling repos, `npm install ../fabric ../fabric-http --no-save` keeps Message opcodes and servers aligned.

Agent-oriented services (lifecycle, workers, payments) are summarized in [`AGENTS.md`](AGENTS.md).

## Production & Release
Use this repo as a **library** or run the **`fabric`** CLI in environments you control. For shipping:

| Step | Where |
|------|--------|
| Node **22.14.x**, `npm ci`, **`npm run ci`** | [`docs/PRODUCTION.md`](docs/PRODUCTION.md) |
| Completion / privacy / security matrix | [`docs/PRODUCTION-CHECKLIST.md`](docs/PRODUCTION-CHECKLIST.md), [`PRIVACY.md`](PRIVACY.md), [`SECURITY.md`](SECURITY.md) |
| Version tag, changelog, Hub & fabric-http bumps | [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) |
| Operator privacy model | [`PRIVACY.md`](PRIVACY.md) |
| Vulnerability process | [`SECURITY.md`](SECURITY.md) |

**Build scripts:** `npm run build` runs `make:all`, which still has **placeholder** `make:service` / `make:app` / `make:lib` steps. The **release gate for quality is `npm run ci`** (full Mocha suite), not a successful `npm run build`. Track operator and bundle readiness in [`docs/PRODUCTION-CHECKLIST.md`](docs/PRODUCTION-CHECKLIST.md) and [`docs/PRODUCTION.md`](docs/PRODUCTION.md).

## Core Types (reference)
These live under `types/*.js` (CommonJS). The **`Fabric`** facade (`types/fabric.js`) re-exports many of them for quick experiments; production code usually imports a **leaf** type.

| Type | Role |
|------|------|
| **`Actor`** | Base identity + vector clock + `commit()`; most user-facing types extend it. |
| **`Message`** | Wire envelope for P2P and services; opcode-driven dispatch. |
| **`Peer`** | TCP/NOISE P2P node, relay, registry; **`Peer.Swarm`** multi-peer orchestration. |
| **`Service`** | Long-lived app surface, resources; **`Service.FabricShell`** is the browser/CLI application shell (`CLI` extends it). |
| **`Store`** | LevelDB persistence; **`Store.openEncrypted`** for at-rest crypto. |
| **`Entity`** | Generic structured document; **`Entity.Transition`** for JSON Patch diffs. |
| **`Key` / `Identity`** | Schnorr/secp256k1 keys and BIP32/BIP39 identity. |
| **`Chain` / `Block`** | Local chain views and block helpers (network-specific services extend these). |

Regenerate **`API.md`** with `npm run make:api` after JSDoc changes. Experimental or legacy-only files may be omitted via **`scripts/list-jsdoc-type-files.js`**.

## Bitcoin service (`services/bitcoin`)
RPC is the **source of truth** when a node is connected.  Optional HTTP fallback for block, transaction, and address-index reads is configured only via `bitcoin.explorerBaseUrl` or `FABRIC_EXPLORER_URL` (an **origin**, not a path). If unset, those helpers stay RPC-only or fail closed with a clear error — `@fabric/core` does not default to any public explorer.

## Message types (`types/message`)
`P2P_MESSAGE_RECEIPT` (`constants.P2P_MESSAGE_RECEIPT`, `0x44`) is the on-wire type for server acknowledgements of an inbound WebSocket/P2P message (payload JSON uses `@type: Receipt`). It is distinct from `GenericMessage` so clients can discriminate without parsing the body first.

## Architecture
Fabric is two things: a **protocol** for machines to exchange information (“the Fabric Protocol”), and a **software library** (`@fabric/core`) with tools for building networks that speak that protocol.

You will typically run against a **Bitcoin** node (bitcoind and/or bcoin with `bcoin --only=127.0.0.1`) for L1 workflows; Lightning and other L2 paths are integrated where the `services/` layer provides them.

### Overview
The `fabric` CLI is the default operator surface. The `@fabric/core` library is organized into the areas below (numbered for reference — not every folder name matches one-to-one).

The `@fabric/core` library consists of these major areas:
0. **Assets** — static and generated files for the default runtime (see below).
1. **Contracts** — reviewed contract descriptions and scripts (Purity, Bitcoin Script, Minsc, Solidity, etc.).
2. **Components** — interface vocabulary for describing types to users (CLI-first; web follows).
3. **Resources** — declarative definitions consumed by `types/resource` and apps.
4. **Services** — `Service` subclasses and integrations under `services/`.
5. **Types** — ES6 classes under `types/` (`Actor`, `Channel`, `Oracle`, `Service`, `Key`, …).

#### 0. Assets
Files here feed the default **inventory** for packaged releases. When using `@fabric/http`’s server, many assets are served from `/` (configurable). Use this tree for **generated** binaries, WASM, and bundled UI — avoid committing large binaries unless they are part of the release process.

##### 0.1 Inventory
For the `0.1` line, focus is Lightning-oriented document exchange. Operators running `fabric chat` can:

1. Load a file into local inventory: `/import <filename>`
2. Publish to peers: `/publish <documentID> <rate>`
3. Request from the network: `/request <documentID> <rate>`

When this surface is stable and well tested, the project can tag `0.1.0-RC1` and move toward a security audit.

##### 0.2 Roadmap
See [the official Fabric roadmap][fabric-roadmap] for planned work.

#### 1. Contracts

Peer-to-peer applications (“agreements”) are self-enforcing: two peers in a `Channel` update shared contract state after responding to counterparty requests (for example via L2 spendable UTXOs). If the contract expires, exit clauses let parties spend on L1 again; both hold the latest signed state.

Before an agreement, Fabric peers normally open a **payment channel** (Lightning-class or similar).

**Note:** shipping security targets **Bitcoin** first; other chains are out of scope until contributors extend the stack.

##### 1.1 Application resource contracts
Agreements are expressed as structured [**Resources**](#3-resources) — standardized services a peer may offer. Each node chooses which resources it provides and at what price; demand and supply form the “information market” described in the Fabric whitepaper.

To create an application resource contract, you combine a **Resource** definition (JSON or programmatic) with a **Service** implementation that honors the declared routes, roles, and constraints. The `Machine` and execution layers then interpret or validate transitions according to the contract `type` you select.

##### 1.2a Convergence
User-facing design should be **terminal-first** where possible: one logical app, multiple shells (CLI, web, native). That implies clear **Software Development Interface** boundaries so the same resource definitions work across environments.

**How should peer-to-peer contracts be written?** Start with a **small, formal** contract type, prove it in tests, then add variants via the `Machine` / `type` settings rather than ad-hoc scripts everywhere.

##### 1.2b JavaScript
Execution today starts with a **restricted subset of JavaScript** so newcomers can experiment without a new language. Sandboxing matters: prefer **pure**, stack-friendly functions; a formal grammar for a Fabric-specific dialect is a longer-term goal.

Turing completeness is possible; the design still avoids obvious cryptographic footguns. **Code review** remains essential for anything that moves funds or identity.

#### 2. Components

Fabric targets more than raw library users: a **visual composer** for secured apps on native (`x86`, `ARM`) and the [legacy web][legacy-web] is a goal. Browsers add complexity; the project biases toward **Native Web Components** and similar primitives that do not lock you to a single SPA framework.

The Fabric CLI (`npm i -g @fabric/core`) is the reference shell. Discussion happens in [Grove][grove] and [GitHub Discussions][fabric-core-github-discussions].

#### 3. Resources
Fabric’s decentralized “web” is built around the **Resource** type: a committed agreement to deliver data (often with payment), frequently using HTLC-style flows on the chosen L2.

These are sometimes called **Application Resource Contracts (ARCs)** — the allowed storylines for a contract.

##### Example resource
`resources/document.json`:
```json
{
  "name": "Document",
  "description": "A generic document resource.  All data treated as raw bytes, no additional protocols or parameters.",
  "creator": "022380f37b7479c224089be7156d25251db5136d24d030f1261b6e3a1f59a8b49b",
  "owner": "022380f37b7479c224089be7156d25251db5136d24d030f1261b6e3a1f59a8b49b",
  "labels": ["example", "bitcoin", "lightning", "fabric"],
  "paths": {
    "list": "/documents",
    "view": "/documents/:id"
  },
  "components": {
    "list": "DocumentList",
    "view": "DocumentView"
  },
  "constraints": {
    "state": {
      "clock": {
        "$lte": 1000
      }
    }
  },
  "roles": {
    "list": ["*"],
    "view": ["*"],
    "create": ["~owner"],
    "update": ["~owner"],
    "delete": ["~owner"]
  }
}
```

This is a declarative description of a generic document API: paths, UI component names, state constraints, and RBAC-style roles.

##### Interesting properties

- **`components`** — maps named events to UI elements (today oriented to the CLI; same names can map to web components later).
- **`constraints`** — caps and invariants; the example bounds a **vector clock** so the resource “consumes” capacity as state advances.

**Note on clocks:** types inheriting `Actor` advance a vector clock on `commit()`. Some messages may advance the clock more than once; design relays and limits accordingly. Channel balances update with state unless the transition is a `NOOP` burn.

`Resource` pairs with `Service` to describe **what** a node exposes to the network.

#### 4. Services
Nodes exchange **`Message`** instances — transactions, computation requests, and control plane data. A **Service** publishes one or more resources and emits events for local consumers or bridges (e.g. HTTP).

Extend `Service` to integrate external systems.

##### Example service
```js
'use strict';

const Service = require('@fabric/core/types/service');

class MyClockService extends Service {
  constructor (input = {}) {
    super(input);

    this.settings = Object.assign({
      clock: 0,
      frequency: 1
    }, input);

    this._state = {
      content: null
    };

    return this;
  }

  // Called once per tick when the service is running
  tick () {
    const origin = this.get('clock') || 0;
    console.log('clock:', origin);
    this.set('clock', origin + 1);
  }

  async start () {
    await super.start();
    return this;
  }
}

module.exports = MyClockService;
```

Services are the integration boundary where ecosystems meet Fabric’s messaging model.

See [`guides/SERVICES.md`](guides/SERVICES.md) for a longer overview of bundled services (Bitcoin, Lightning, Exchange, Redis, ZMQ).

#### 5. Types

`@fabric/core` ships **CommonJS** ES6 classes for broad compatibility. Typical import:

```js
const Actor = require('@fabric/core/types/actor');
```

##### Types by example

Create and sign a message with the Schnorr **`Key`** type:

```js
'use strict';

const Hash256 = require('@fabric/core/types/hash256');
const Key = require('@fabric/core/types/key');

const message = 'Hello, world!';
const key = new Key();
const signature = key.sign(message);

console.log('Message:', message);
console.log('Message hash:', Hash256.digest(message));
console.log('Public key:', key.public);
console.log('Signature (hex):', signature.toString('hex'));
```

## Storage (`types/store`)

**`Store`** is the long-term Level-backed storage primitive. Pass an optional **`Codec`** (`types/codec`) in settings to encrypt values at rest; Level uses a `buffer` wire format with Fabric encrypt/decrypt.

Use **`Store.encryptedSettings(settings)`** / **`Store.openEncrypted(settings)`** for defaults that match the former `types/keystore.js` (path `./stores/keystore`, `Codec` from `{ key, mode, version }` / `FABRIC_SEED`). Use additional plain **`Store`** instances for caches or indexes (no codec).

**`FabricShell`** (browser/CLI shell) is **`types/service.js`** **`Service.FabricShell`**: it wires `Store.openEncrypted`, peer, machine, tips/stash stores, and resources. **`CLI`** extends **`FabricShell`**.

Other **`Store`** subclasses add domain behavior — for example **`Datastore`**, **`Oracle`**, and **`Resource`**.

### Consolidated prototypes (fewer top-level `types/*.js` files)

- **`Transition`** — defined on **`types/entity.js`**; export **`Entity.Transition`** (JSON Patch between entity states).
- **`Swarm`** — **`Peer.Swarm`** on **`types/peer.js`** (`Actor` wrapping an embedded `Peer`).
- Removed standalone modules (unused or superseded): **`aggregator`**, **`consensus`**, **`mempool`**, **`swap`**, **`value`**, **`walker`**. See **`scripts/remove-legacy-types.sh`**.
- Removed **`types/stash.js`** (legacy `Vector` + localforage); use **`Store`** or app-specific caches instead.

## Reference links
| Link | Description |
|------|-------------|
| [QUICKSTART.md][quickstart-guide] | Install and first commands |
| [AGENTS.md](AGENTS.md) | Agent services, lifecycle, workers |
| [SECURITY.md](SECURITY.md) | Disclosure process, release hygiene |

## Roadmap & doc backlog
Short list of documentation improvements (edit here as items land):

- [ ] Markdown/CMS for published docs site
- [ ] Sweep remaining `TODO` markers in repo-specific guides
- [ ] Cross-link `docs/*.html` JSDoc output from this guide where helpful

---

[services]: guides/SERVICES.md
[actor-type]: Actor.html
[fabric-core-github]: https://github.com/FabricLabs/fabric
[fabric-core-github-discussions]: https://github.com/FabricLabs/fabric/discussions
[fabric-roadmap]: https://github.com/FabricLabs/fabric/projects/1
[grove]: https://dev.fabric.pub
[legacy-web]: https://web.fabric.pub
[minsc-home]: https://min.sc
[nvm-official]: https://nvm.sh

# Parking Lot
## TODO
- [ ] Write Markdown CMS
- [ ] Remove TODOs
- [ ] Commit and Publish

[quickstart-guide]: QUICKSTART.md
