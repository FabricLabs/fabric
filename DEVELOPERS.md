# Fabric Developer Resources
There is a lot to cover when building decentralized applications on Fabric, so grab a coffee ☕ and settle in.

## Contents
- [Vision](#vision)
- [Quick start](#quick-start)
- [Repository layout](#repository-layout)
- [Development workflow](#development-workflow)
- [Bitcoin service](#bitcoin-service-servicesbitcoin)
- [Lightning BOLTs, RPC map & Hub desktop (`npm link`)](#lightning-bolts-rpc-map--hub-desktop-npm-link)
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

0. `nvm use 24.15.0` (install [`nvm`][nvm-official] if needed; matches `.nvmrc` / `package.json` engines)
0b. Ensure **npm 12+** (`npm -v`). Node 24.15.0 may ship npm 11.x — upgrade with `npm install -g npm@12` (or newer) before installing. **`@fabric/core` keeps npm’s default `allow-git=none`** (no git deps). Only downstream packages that install Fabric from GitHub (Hub / `@fabric/http` / app peers) should set **`.npmrc` `allow-git=all`** for nested commit-SHA fetches — do not add that opt-in here.
1. From a clone of this repo: `npm install` (or `npm install -g @fabric/core` to put `fabric` on your `PATH`).
2. (optional) `fabric setup` to view / generate / backup / restore the local master key (`~/.fabric/wallet.json` is password-sealed JSON by default; TTY opens a lightweight TUI with unlock / lock / idle timeout)
3. (optional) `fabric keygen` to generate a new master key without saving to disk (ephemeral)
4. Run `fabric` — the CLI entry is wired through `types/cli.js` and extends **`Service.FabricShell`**. **Contracts** (HTLCs, document sessions, programs, shell packs, …) are documented in **[docs/CONTRACTS.md](docs/CONTRACTS.md)**; terminal UX in **[docs/CLI.md](docs/CLI.md)**.

Working from a **git checkout** (not the global package) is best when you are changing `@fabric/core` itself; use `npm link` or `npm install ../fabric` from downstream packages (Hub, HTTP server) as described in the repo README.

## Repository layout
| Path | Role |
|------|------|
| `types/` | ES6 **classes** — `Actor`, `Peer`, `Service`, `Store`, `Message`, etc. CommonJS (`require`) throughout. Cross-package homes: **[Types & services layering](#types--services-layering-suite)**. |
| `services/` | Long-running **integrations** (Bitcoin RPC, Lightning stubs, ZMQ, …) built on `Service`. |
| `contracts/` | Language snippets, traces, and tooling (e.g. type dependency graph). |
| `scripts/` | CLI entrypoints, doc helpers (`list-jsdoc-type-files.js`, `remove-legacy-types.sh`). **`functions/fabricMessageCollection.js`** collects / replays AMP `FabricMessageCollection` documents (`functions/fabricMessageCollection.js`). |
| `tests/` | Mocha suites; run with `npm test`. |
| `settings/` | Default and environment-specific config; `settings/deprecations.js` holds legacy aliases. |
| `assets/` | **Generated** browser bundles; rebuild with `npm run build` after type changes. |

## Development workflow
- **Node:** engines field in `package.json` is authoritative (currently Node 24.15.x).
- **Unit tests:** `npm test` — runs Mocha recursively under `tests/`.
- **Lint:** `npm run lint` / `npm run lint:fix` (Semistandard).
- **API reference:** `npm run make:api` writes `API.md` from JSDoc (see `scripts/list-jsdoc-type-files.js` for which `types/*.js` files are included).
  - **JSDoc for Closure / jsdoc2md:** do **not** use TypeScript-only optional object syntax in tags (`{ genesis?: object }` fails with `Invalid type expression`). Prefer `@param {Object} [opts]` plus `@param {Object} [opts.genesis] …`. Put prose **above** `@type {…}` (or in a separate line) — `@type` does not allow a trailing description. Keep tags Closure-compatible so `make:api` / `make:docs` stay green.
  - **Avoid Global pollution:** use `@fileoverview` / `@module` for file prose (bare blocks attach to the next `const`/`require` and become Global docs). Prefer `//` over `/** @type */` inside settings object literals. Mark private helpers/constants `@private` so they stay off `docs/global.html`.
- **HTML docs:** `npm run make:docs` (runs `make:api` first, then **`scripts/clean-jsdoc-html.js`** — removes all **`docs/**/*.html`** and JSDoc template dirs **`docs/fonts`**, **`docs/scripts`**, **`docs/styles`**, **`docs/public`** so stale pages and duplicate assets do not accumulate, then JSDoc writes under `docs/`).
- **Historical / one-off Markdown:** see **`docs/NON_CANONICAL.md`** — root-level “completion” and analysis files are not the same tier as **VISION.md** or **`docs/README.md`**.
- **Native addon (`fabric.node`):** it is **not** `require()`’d unless **`FABRIC_NATIVE_DOUBLE_SHA256=1`**; message body double-SHA256 uses **@noble/hashes** by default. Enable that env var when exercising the C **`doubleSha256`** export.
- **Local packages:** when `fabric`, `fabric-http`, and Hub are sibling repos, `npm install ../fabric ../fabric-http --no-save` keeps Message opcodes and servers aligned.

Agent-oriented services (lifecycle, workers, payments) are summarized in [`AGENTS.md`](AGENTS.md).

## Production & Release
Use this repo as a **library** or run the **`fabric`** CLI in environments you control. For shipping:

| Step | Where |
|------|--------|
| Node **24.15.0** (see `.nvmrc`), `npm ci`, **`npm run ci`** | [`docs/PRODUCTION.md`](docs/PRODUCTION.md) |
| Public leaf API + scoped RC claim | [`PUBLIC_API.md`](PUBLIC_API.md) |
| Completion / privacy / security matrix | [`docs/PRODUCTION.md`](docs/PRODUCTION.md), [`PRIVACY.md`](PRIVACY.md), [`SECURITY.md`](SECURITY.md), [`AUDIT.md`](AUDIT.md) |
| Version tag, changelog, Hub & fabric-http bumps | [`docs/PRODUCTION.md`](docs/PRODUCTION.md) (§ Release checklist) |
| Operator privacy model | [`PRIVACY.md`](PRIVACY.md) |
| Vulnerability process | [`SECURITY.md`](SECURITY.md) |

**Build scripts:** `npm run build` runs `make:all`, which still has **placeholder** `make:service` / `make:app` / `make:lib` steps. The **release gate for quality is `npm run ci`** (full Mocha suite), not a successful `npm run build`. Track operator and bundle readiness in [`docs/PRODUCTION.md`](docs/PRODUCTION.md).

## Core Types (reference)
These live under `types/*.js` (CommonJS). The **`Fabric`** facade (`types/fabric.js`) re-exports many of them for quick experiments; production code **must** import a **leaf** type from the frozen map in **[PUBLIC_API.md](PUBLIC_API.md)**.

**Beacon** (`types/beacon`): L1-tied epoch chain sealing `sidechain` / `contracts` digests (Hub re-exports as `contracts/beacon.js`).

**Sidechain document** (`functions/sidechainState` + `documentRegistrySidechain`): logical `sidechain/STATE` + journal/snapshots/tip restore. Wire updates use typed `SIDECHAIN_STATE_PATCH` fields; RFC6902 JSON is an `@fabric/http` edge transform. See [docs/DISTRIBUTED_EXECUTION.md](docs/DISTRIBUTED_EXECUTION.md). Network-wide field map + Program: [docs/NETWORK_STATE_PROGRAM.md](docs/NETWORK_STATE_PROGRAM.md); wire diagram [`contracts/protocol.dot`](contracts/protocol.dot).

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

## Lightning: BOLTs, RPC map & Hub desktop (`npm link`)

| Doc | Purpose |
|-----|---------|
| [docs/BOLT_COMPATIBILITY.md](docs/BOLT_COMPATIBILITY.md) | Checklist: **BOLT #1–#12** vs delegated to `lightningd` vs exposed on `Lightning` |
| [docs/FABRIC_LIGHTNING_OFFERS.md](docs/FABRIC_LIGHTNING_OFFERS.md) | Fabric **markets** (commerce / P2P) vs **BOLT12**; **`Lightning.Bolt12`** |
| [docs/FABRIC_PAYMENT_BECH32.md](docs/FABRIC_PAYMENT_BECH32.md) | **`fa1…`** bech32m Fabric-routed payments; **`Lightning.FabricPayment`** |
| [docs/LIGHTNING_COMPAT.md](docs/LIGHTNING_COMPAT.md) | Core Lightning **JSON-RPC** ↔ Fabric method names |

**Programmatic:** `require('@fabric/core/services/lightning').DOCS` lists Markdown paths (`fabricLightningMarkets` and `fabricLightningOffers` are the same file); **`Lightning.Bolt12`** re-exports `functions/lightningBolt12.js` (`FabricLightningMarketRole` / `FabricLightningOfferRole`); **`Lightning.Bolt12Semantics`** re-exports `functions/bolt12Semantics.js` (BIP-340 scope for **`decode`**, recurrence TLV helpers); **`Lightning.FabricPayment`** re-exports `functions/fabricPaymentBech32.js` (`fa1…` encode/decode and **`classifyPaymentEncodingString`**).

### Manual test: `@fabric/hub` desktop + local `@fabric/core` / `@fabric/http`

After changing **`@fabric/core`**, you can exercise the stack from the **`@fabric/hub`** package (Electron / desktop; e.g. sibling clone `hub.fabric.pub`) by linking local packages. Typical order:

1. **This repo (`@fabric/core`):** `npm link` — registers the global link for `@fabric/core`.
2. **`@fabric/http`** (sibling clone): `npm link @fabric/core` then `npm link` — HTTP server depends on core; second `npm link` publishes `@fabric/http` globally.
3. **Hub (`@fabric/hub`):** `npm link @fabric/core` and `npm link @fabric/http` — resolves both to your working trees.

Then start the Hub desktop app (see Hub’s `package.json`, e.g. `build:desktop` / Electron scripts). Verify Lightning UI or HTTP mutations against your linked core. To unlink later: `npm unlink @fabric/core` / `@fabric/http` in Hub and HTTP, then reinstall published versions as needed.

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
For the `0.1` line, focus is **consenting peer file exchange** plus **ranked L1 document markets**. Operators running `fabric` / `fabric chat` can:

1. `/import` → `/publish <id> <rateSats>`
2. `/inventory [peer] [btc]` → `/offers [id]` (rank by price/latency/score)
3. Unpaid: `/request` → seller `/approve`; paid: `/buy` → pay → `/confirm <settlementId> <txid>`
4. Private relay fees: `/relayfees`; budgeted requests rewrite hops with fee skim
5. Large files: multi-blob offers and reassembly (see L1 doc)

Details: [`docs/L1_DOCUMENT_EXCHANGE.md`](docs/L1_DOCUMENT_EXCHANGE.md); BIP: [`docs/bip-fabric-file-exchange.md`](docs/bip-fabric-file-exchange.md).

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

These are sometimes called **Application Resource Contracts (ARCs)** — the allowed storylines for a contract. Wire + tip + spend: [`docs/CONTRACTS.md`](docs/CONTRACTS.md#application-resource-contracts-arc).

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
| [docs/CONTRACTS.md](docs/CONTRACTS.md) | Contracts as interfaces; Hub registry (Hub publishes first) |
| [docs/CLI.md](docs/CLI.md) | Terminal `/contracts`, refunds, verbosity |
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

## Types & services layering (suite)
Canonical map of `types/` and `services/` across **`@fabric/core`**, **`@fabric/http`**, **`@fabric/hub`**, **`@fabric/passport`**, and **GoonCitizen**. Use this before adding a new class, subclassing Hub, or copying an identity/session helper.

**This file is not a ship list.** Owner go-ahead is still required. Core class-count reduction lives in **[PRODUCTION_MARCH.md](docs/PRODUCTION_MARCH.md)**; this file is the *cross-package* home for overlapping APIs.

| Field | Value |
|-------|--------|
| Last reviewed | 2026-08-15 |
| Trees scanned | `types/` + `services/` (Passport: `src/types/`, `src/background/`, `src/crypto/`, `src/utils/`) |
| Local checkouts | `~/fabric-clean`, `~/fabric-http`, `~/hub.fabric.pub`, `~/fabric-browser-extension`, `~/star-citizen-live` (`~/goon.vc` insight only) |
| Crypto lift | IdentityCrossSign + identity Schnorr + verify live in `@fabric/core/functions/*` (follow-up after [#183](https://github.com/FabricLabs/fabric/pull/183) merge). HTTP / Hub re-export those leaves; GoonCitizen keeps a browser-safe local copy for the dashboard bundle. |
| Core `npm test` | 2026-08-14: gossip-network `verifiedPubkey` expect fixed; remaining work is identity lift + OUTSTANDING queue (not this suite fail). |

---

### How future agents should use this
1. **Name collision ≠ same type.** Same export name in two packages is usually a stub, a UI twin, or a legacy fork. Check the [collision table](#name-collisions) first.
2. **Prefer `functions/` re-exports over new classes.** Shared wire/session helpers already lift into `@fabric/http` (and Hub re-exports them). See [success pattern](#success-pattern).
3. **Compose, do not subclass Hub** for a new application. GoonCitizen `LiveRelay` is the live app; `StarCitizen extends Hub` is legacy.
4. After you add, delete, or re-home a type/service, update this file in the **same PR** ([refresh procedure](#refresh-procedure)).

---

### Layering (who owns what)
```text
@fabric/core          protocol primitives + chain integrations
  types/              Actor, Service, Store, Peer, Message, Key, Identity,
                      Chain, Contract, Federation, Collection, Resource, Wallet, …
  services/           Bitcoin, Lightning (primary); ZMQ, Redis, MQTT, Text, …

@fabric/http          HTTP / WebSocket / SPA / browser surface
  types/              HTTPServer, SPA, Site, App, Compiler (webpack), Bridge,
                      Sandbox, Remote (HTTP subclass), Resource (HTTP verbs)
  functions/          site-login, device-link, peering HTTP, chat normalize,
                      httpSharedMode, federation invite, oracle attestation
  (no services/)

@fabric/hub           rendezvous operator (reference app)
  services/hub.js     orchestrator: Peer + HTTPServer + Bitcoin + Beacon + RPC
  services/           Payjoin, Peering, Setup, Fabric (HTTP Remote), Email, Challenge
  types/              thin SPA/Site/Compiler skins; LightningChannel; BridgeMessageCollection

@fabric/passport      browser extension wallet / identity chrome
  src/types/          UI interfaces + incomplete Key fork (do not grow)
  (no services/)      Hub is a HTTP/WS client, not a class dependency

GoonCitizen           application (star-citizen-live)
  services/LiveRelay  what npm start runs (EventEmitter, own HTTP)
  services/           FabricNetwork (Peer adapter), Chat/Group/Mission/Payout/Snapshot
  types/              Store façade over core Store; Group/Mission domain types
```

**Require graph (do not invert):**
```text
core  ◄──  http  ◄──  hub
                ◄──  passport (Key/Message/site-login clients)
                ◄──  GoonCitizen (Peer, Store, http functions)
hub   ◄──  GoonCitizen (Bitcoin proxy, identityCluster re-export, Hub HTTP)
hub   ◄──  goon.vc GoonVC extends Hub   (hosted edge; insight only)
```

Core never `require`s `@fabric/http` or `@fabric/hub`.

---

### Success pattern
Shared *behavior* that is not a protocol class belongs in **`@fabric/http/functions/*`** (browser-safe when possible) or **`@fabric/core/functions/*`** (crypto / AMP / contract). Downstream packages **re-export** the same function object.

Hub already guards this with `tests/liftedApis.exports.test.js` (allowlist, `httpSharedMode`, device-link Origin helpers, oracle attestation, pubkey, chat normalize). GoonCitizen does the same for several http helpers (`functions/httpSharedMode.js`, `fabricSiteLoginVerify.js`, `fabricDeviceLinkProtocol.js`, …).

**Do this:**
```js
module.exports = require('@fabric/http/functions/httpSharedMode');
```

**Do not do this:** copy the file into a second repo, or add a new `types/Foo.js` that collides with core `Foo`.

---

### Name collisions
| Name | Canonical | Other copy | Relation | Action |
|------|-----------|------------|----------|--------|
| **Identity** | core `types/identity.js` (Actor, BIP32) | http `types/identity.js` (12-line Key stub) | stub | delete/rename http stub; callers use core |
| **Key** | core `types/key.js` (Schnorr) | Passport `src/types/key.ts` (elliptic, stub `toBech32`) | incomplete fork | Passport should use core Key |
| **Wallet** | core `types/wallet.js` | http `types/wallet.js` (legacy bcoin) | duplicate | keep core; migrate/rename http |
| **Peer** | core `types/peer.js` (~5k LOC AMP/TCP) | http `types/peer.js` (PeerJS stub) | stub | delete http stub |
| **Swarm** | core `Peer.Swarm` | http `types/swarm.js` (documented no-op) | stub | delete http stub |
| **Channel** | core `types/channel.js` (payment) | http `types/channel.js` (`<fabric-channel>` UI) | name only | rename http element |
| **Compiler** | core `types/compiler.js` (JS/minsc AST) | http `types/compiler.js` (webpack SPA); Hub/goon subclass http | different jobs | keep both; document as HTTPCompiler vs contract compiler |
| **Router** | core `types/router.js` (chat `!commands`) | http `types/router.js` (path-to-regexp) | name only | rename if touching |
| **Remote** | core `types/remote.js` (base WS) | http `types/remote.js` **extends** core | healthy subclass | keep |
| **Resource** | core `types/resource.js` (Store) | http `types/resource.js` **extends** Fabric.Resource | healthy subclass | keep |
| **Component** | core `types/component.js` (jade stub, broken `super`) | http `types/component.js` (real custom element) | core dead | delete/ignore core stub; UI lives in http |
| **Hub** | **hub** `services/hub.js` (~14k LOC Service) | http `types/hub.js` (Oracle + Express toy) | **naming trap** | deprecate/rename http (`LegacyHttpHub`); never merge |
| **Queue** | core `types/queue.js` | Hub `types/queue.js` (richer, unused at runtime) | stale fork | Hub runtime uses core Worker; delete or re-export core |
| **Worker** | core `types/worker.js` | Hub `types/worker.js` | stale fork | hub.js requires **core** Worker |
| **Challenge** | core `types/challenge.js` (State) | Hub `services/challenge.js` (storage-contract cadence) | name only | leave; different jobs |
| **Store** | core `types/store.js` (Actor, async paths) | GoonCitizen `types/Store.js` (**composes** core) | healthy façade | do not merge into core |
| **SPA / Site / Compiler** | http types | Hub + goon.vc thin `_renderWith` skins | healthy extend | skins stay in apps |
| **Fabric** | core `types/fabric.js` (facade Service) | Hub `services/fabric.js` (HTTP Remote sync) | name only | leave |

---

### Per-package inventory
#### `@fabric/core` — `types/` (protocol spine)
**Keep as the public spine** (aligns with PRODUCTION_MARCH + `types/fabric.js` statics): `Actor`, `Service` (+ `FabricShell`), `Store`, `Peer` (+ `Peer.Swarm`), `Message`, `Key`, `Identity`, `Chain`, `Block`, `Contract`, `Federation`, `Collection`, `Resource`, `State`, `Machine`, `Program`, `Circuit`, `Wallet`, `Worker`, `Remote`, `Hash256`, `Entity` (+ `Transition`), `Tree`, `Beacon`, `Filesystem`.

**Services (keep):** `services/bitcoin.js`, `services/lightning.js`. Others (`zmq`, `redis`, `mqtt`, `text`/`txt`, `exchange`, `local`, `turntable`) are integrations — do not reimplement in Hub or GoonCitizen.

**Message collections:** `functions/fabricMessageCollection.js` is the share/replay helper for ordered AMP hex (journals, Discord packs, catch-up). GoonCitizen re-exports it; do not fork a second JSON-as-canonical log. Hub `messages/*.json` stays an activity log.

**Core stubs / low-value leaves** (do not copy downstream): `types/component.js`, `types/network.js`, `types/observer.js`, `types/transaction.js`. Class-count work: PRODUCTION_MARCH (`Scribe` is already a deprecation alias).

#### `@fabric/http` — `types/` (HTTP/SPA only)

**Stay in http:** `server` (`HTTPServer`), `spa`, `site`, `app`, `compiler` (webpack), `bridge`, `sandbox`, `browser`, `client`, `element`, `avatar`, `JSONCall`, `distributedExecutionHttp`, `resource` (HTTP verbs), `remote` (HTTP client).

**Delete or stop exporting when touching:** `identity.js`, `peer.js`, `swarm.js` stubs. **Rename if touching:** `channel.js` (UI), `hub.js` (legacy Oracle hub).

Package main (`types/web.js`) exports `Server`, `Client`, `SPA`, `Avatar` — not the stubs.

#### `@fabric/hub` — operator

| File | Verdict |
|------|---------|
| `services/hub.js` | Keep as orchestrator; carve more *Hub-only* services (Payjoin/Peering/Setup pattern). Do not fold into core or http. |
| `services/payjoin.js` | Hub-only BIP77/78 |
| `services/peering.js` | Hub HTTP + OracleAttestation (uses http functions) |
| `services/setup.js` | Admin token bootstrap |
| `services/fabric.js` | HTTP Remote sync — keep name locally, do not confuse with core `Fabric` |
| `services/email.js`, `challenge.js` | Hub-only |
| `types/spa.js`, `site.js`, `compiler.js` | Thin skins over http — keep |
| `types/lightningChannel.js` | Extends core Channel — keep until a second LN UI needs it in core |
| `types/bridgeMessageCollection.js` | Hub WS message map — keep |
| `types/queue.js`, `worker.js` | Stale forks — delete or re-export core |

#### `@fabric/passport` — extension

No top-level `types/` or `services/`. Treat as a **client** of core Key/Message and http site-login / device-link.

| Path | Verdict |
|------|---------|
| `src/types/key.ts` | **Do not grow.** Incomplete elliptic Key; `toBech32()` is a stub. Target: `@fabric/core/types/key`. |
| `src/types/identity.ts` | UI `IIdentity` / chain allowlist — not core Identity. Keep local. |
| `src/background/encryptedDatastore.ts` | chrome.storage AES-GCM — parallel to `Store.openEncrypted`, not a merge candidate. |
| `src/utils/identityCrossSign.ts` | **Re-export** of `@fabric/core/functions/identityCrossSign`. |
| `src/utils/fabricSiteLoginSign.ts`, `fabricDeviceLinkSign.ts` | Clients of http — keep as clients. |
| `src/fabric/bitcoinService.ts` | Hub HTTP Bitcoin client — keep. |

#### GoonCitizen — application

| File | Verdict |
|------|---------|
| `services/LiveRelay.js` | **What runs.** EventEmitter + REST/dashboard. Do not extend Hub. |
| `services/FabricNetwork.js` | Constructs core `Peer`; app `CONTRACT_MESSAGE` conveniences. Adapter, not a second Peer. |
| `services/ChatManager.js` / `GroupManager.js` / `MissionManager.js` / `PayoutManager.js` / `SnapshotManager.js` | Application. Share wire helpers only (chat normalize, federation invite JSON). |
| `types/Store.js` | Composes core Store; sync `get/put/all/del` on `/collections/<name>`. Correct. Extract a generic façade only if a second consumer appears. |
| `types/Group.js`, `Mission.js`, `MissionApplication.js` | Domain; Group wraps core `Federation`. |
| `services/StarCitizen.js` | **Legacy** `extends Hub`. mocha/history only. Do not use as a template. |
| `types/StarCitizenAPI.js` | Legacy stub. Not LiveRelay. |

**goon.vc (insight):** `GoonSPA` / `GoonSite` / `HTMLCompiler` mirror Hub skins over http. `GoonVC extends Hub` is the hosted-edge pattern — not a model for new desktop apps.

---

### Common API slices (ranked)
Payoff vs risk for *sharing* an API. Implement only with owner go-ahead; small PRs; re-export, don’t copy.

| Rank | Slice | Home | Payoff | Risk | Notes |
|------|-------|------|--------|------|-------|
| 1 | **IdentityCrossSign** (+ revoke) canonical strings + Schnorr verify | **core** `functions/identityCrossSign` + `identityCrossSignVerify` + `fabricIdentitySchnorr` | High | Low | **Implemented locally 2026-08-14; not in [#183](https://github.com/FabricLabs/fabric/pull/183).** Downstream re-exports already exist. Pin/link core before those CI jobs. Site-login HTTP stays in http. |
| 2 | **Site-login + device-link** | **http** (already) | High | Low–med | GC/Passport/Hub must wrap http; do not fork verify. Possession-proof redeem is the security outstanding, not a new type. |
| 3 | **Passport Key → core Key** | **core** Key | High (crypto) | Med | Drop elliptic class; keep `IKey` UI state in Passport. |
| 4 | **Retire Hub Queue/Worker forks** | **core** | Med | Low | Runtime already uses core Worker. |
| 5 | **httpSharedMode** | **http** (already) | Med | Low | Hub + GC re-export; keep the test that they are the same function. |
| 6 | **Rename http `types/hub.js`** | **http** | Med (docs trap) | Low | Product Hub is `@fabric/hub`. |
| 7 | **CollectionStore façade** | optional core helper | Med if 2nd consumer | Med | Today only GoonCitizen `types/Store.js`. |
| 8 | **AppPeerSession** (identity → Peer, message log, peering offer) | core or http helper | Med | Med–high | Extract from FabricNetwork *without* GC publish methods. |
| 9 | **Document inventory item / publish envelope** | core (`publishedDocumentEnvelope`) + http shapes | Med | Med | Hub document market vs GC `localDocuments` / offers stay separate catalogs. |
| 10 | **SPA Compiler factory** | http | Low | Low | Hub/goon skins stay in apps. |
| 11 | **Carve `services/hub.js`** | hub services | High long-term | **High** | Continue Payjoin/Peering/Setup; no big-bang. |
| 12 | **LightningChannel → core** | hub until 2nd consumer | Low | Low | |

---

### Do not consolidate

These look like duplicates and are not:

| Temptation | Why not |
|------------|---------|
| Merge **LiveRelay** into Hub / subclass Hub for GoonCitizen | Different products. LiveRelay is the live entry. `StarCitizen extends Hub` is legacy. |
| Collapse **FabricNetwork** into **Peer** | Adapter + app message types. Peer stays protocol. |
| Put **ChatManager** in core/Hub | Discord keys, local tags, bridged rails are app-specific. Share `fabricChatNormalize` only. |
| Merge GoonCitizen **Store** into core **Store** | Sync collection façade vs async path Store. Composition is the point. |
| Merge http **Compiler** into core **Compiler** | Webpack/HTML vs minsc/JS AST. |
| Merge http **Channel** into core **Channel** | UI element vs payment channel. |
| Fold Hub **Payjoin / Bitcoin UI / Beacon** into core | Operator rendezvous. Core already has `services/bitcoin` + `types/beacon`. |
| New `@fabric/app-peer` package | Extra pin surface. Prefer a function module in core/http first. |
| Invert requires (core → http) | Breaks the library/CLI story. |

---

### Healthy subclass edges (copy this pattern)

```text
http.Resource     →  core Resource (Fabric.Resource)
http.Remote       →  core Remote
http.JSONCall     →  core Message
Hub.LightningChannel → core Channel
Hub.SPA/Site/Compiler → http SPA/Site/Compiler
GoonCitizen.Store    composes core Store  (does not extend)
GoonCitizen.FabricNetwork  constructs core Peer
GoonCitizen.Group    uses core Federation
GoonCitizen.Mission  extends core Entity
```

If a new type does not fit one of: **extend the layer below**, **compose it**, or **stay application-only** — stop and update this file instead of inventing a parallel class.

---

### Refresh procedure

When types/services change in any of the five trees, run this in the same change:

1. `rg '^(class |module\\.exports)' types services` (Passport: `src/types` + `src/background`) in each checkout.
2. Confirm `require('@fabric/…')` still matches the [require graph](#layering-who-owns-what). New core `require('@fabric/http')` is a bug.
3. Update the [collision table](#name-collisions) if you add or delete a same-named export.
4. If you lift a helper, add a Hub/GoonCitizen re-export **and** a same-function assertion (see `tests/liftedApis.exports.test.js`).
5. Bump **Last reviewed** at the top. Do not fork this document into Hub or GoonCitizen — point at it.

**Sibling paths on this machine:**

| Package | Checkout |
|---------|----------|
| `@fabric/core` | `/Users/eric/fabric-clean` |
| `@fabric/http` | `/Users/eric/fabric-http` |
| `@fabric/hub` | `/Users/eric/hub.fabric.pub` |
| `@fabric/passport` | `/Users/eric/fabric-browser-extension` |
| GoonCitizen | `/Users/eric/star-citizen-live` |
| goon.vc (insight) | `/Users/eric/goon.vc` |

---

### Remaining work
Not a ship list. Owner go-ahead still required. Detail for Core also lives in [OUTSTANDING.md](docs/OUTSTANDING.md).

#### Core [#183](https://github.com/FabricLabs/fabric/pull/183) (edit existing PR files only)
- **Do not add** identity leaves, this file, or `package.json` smoke `require()`s for those leaves (CodeRabbit ~150-file cap; smoke would fail without the files).
- Existing OUTSTANDING items: type-tree keep/remove, `messageHex` laziness, `contractId` → `contractIdentifier`, genesis journal cap, blinded-execution scaffold, third-party review of peer/HTLC.

#### Follow-up Core PR (new files)
Identity leaves (`functions/identityCrossSign.js`, `fabricIdentitySchnorr.js`, `identityCrossSignVerify.js`) and tests in `tests/fabric.identity.js` are already on #185. Pin or `npm link` core in http / Hub / Passport / GoonCitizen. Sidecar `.d.ts` files were dropped for the GitHub 150-file review cap.

#### Pending tests (not failures)
- 3× Lightning `_makeRPCRequest` (JSON-RPC line-delimited / error / timeout) — skipped unit stubs.
- 1× `dials configured peers and emits CONTRACT_PUBLISH` (`tests/fabric.hub.mesh.integration.js` — `playnet contract publish live`) — skipped unless a live mnemonic is configured.

#### Downstream (already edited in those repos)
Keep the re-exports. Remaining ranked slices: site-login possession-proof (http/Hub), Passport Key class, Hub Queue/Worker delete, CollectionStore only if a second consumer appears.

---

### Related docs

| Doc | Role |
|-----|------|
| [OUTSTANDING.md](docs/OUTSTANDING.md) | Core security queue + suite status |
| [PRODUCTION_MARCH.md](docs/PRODUCTION_MARCH.md) | Core *class count* keep/fold/remove |
| [DEVELOPERS.md](../DEVELOPERS.md) | Core `types/` vs `services/` layout, Store, Fabric facade |
| [AGENTS.md](../AGENTS.md) | Agent lifecycle (`Service` start/stop) |
| Hub `docs/PRODUCTION_MARCH.md` | Copy of core march + Hub RC scope |
| Hub `tests/liftedApis.exports.test.js` | Re-export contract for shared functions |
| GoonCitizen `AGENTS.md` §3–§4 | What LiveRelay actually runs |
| GoonCitizen `DECISIONS.md` D-009/D-010/D-011/D-013 | Why Fabric conventions, Peer, site-login, device-link exist |
