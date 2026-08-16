# Types & services layering (suite)
Canonical map of `types/` and `services/` across **`@fabric/core`**, **`@fabric/http`**, **`@fabric/hub`**, **`@fabric/passport`**, and **GoonCitizen**. Use this before adding a new class, subclassing Hub, or copying an identity/session helper.

**This file is not a ship list.** Owner go-ahead is still required. Core class-count reduction lives in **[PRODUCTION_MARCH.md](PRODUCTION_MARCH.md)**; this file is the *cross-package* home for overlapping APIs.

| Field | Value |
|-------|--------|
| Last reviewed | 2026-08-15 |
| Trees scanned | `types/` + `services/` (Passport: `src/types/`, `src/background/`, `src/crypto/`, `src/utils/`) |
| Local checkouts | `~/fabric-clean`, `~/fabric-http`, `~/hub.fabric.pub`, `~/fabric-browser-extension`, `~/star-citizen-live` (`~/goon.vc` insight only) |
| Crypto lift | IdentityCrossSign + identity Schnorr + verify live in `@fabric/core/functions/*` (follow-up after [#183](https://github.com/FabricLabs/fabric/pull/183) merge). HTTP / Hub re-export those leaves; GoonCitizen keeps a browser-safe local copy for the dashboard bundle. |
| Core `npm test` | 2026-08-14: gossip-network `verifiedPubkey` expect fixed; remaining work is identity lift + OUTSTANDING queue (not this suite fail). |

---

## How future agents should use this
1. **Name collision ≠ same type.** Same export name in two packages is usually a stub, a UI twin, or a legacy fork. Check the [collision table](#name-collisions) first.
2. **Prefer `functions/` re-exports over new classes.** Shared wire/session helpers already lift into `@fabric/http` (and Hub re-exports them). See [success pattern](#success-pattern).
3. **Compose, do not subclass Hub** for a new application. GoonCitizen `LiveRelay` is the live app; `StarCitizen extends Hub` is legacy.
4. After you add, delete, or re-home a type/service, update this file in the **same PR** ([refresh procedure](#refresh-procedure)).

---

## Layering (who owns what)
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

## Success pattern
Shared *behavior* that is not a protocol class belongs in **`@fabric/http/functions/*`** (browser-safe when possible) or **`@fabric/core/functions/*`** (crypto / AMP / contract). Downstream packages **re-export** the same function object.

Hub already guards this with `tests/liftedApis.exports.test.js` (allowlist, `httpSharedMode`, device-link Origin helpers, oracle attestation, pubkey, chat normalize). GoonCitizen does the same for several http helpers (`functions/httpSharedMode.js`, `fabricSiteLoginVerify.js`, `fabricDeviceLinkProtocol.js`, …).

**Do this:**
```js
module.exports = require('@fabric/http/functions/httpSharedMode');
```

**Do not do this:** copy the file into a second repo, or add a new `types/Foo.js` that collides with core `Foo`.

---

## Name collisions
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

## Per-package inventory
### `@fabric/core` — `types/` (protocol spine)
**Keep as the public spine** (aligns with PRODUCTION_MARCH + `types/fabric.js` statics): `Actor`, `Service` (+ `FabricShell`), `Store`, `Peer` (+ `Peer.Swarm`), `Message`, `Key`, `Identity`, `Chain`, `Block`, `Contract`, `Federation`, `Collection`, `Resource`, `State`, `Machine`, `Program`, `Circuit`, `Wallet`, `Worker`, `Remote`, `Hash256`, `Entity` (+ `Transition`), `Tree`, `Beacon`, `Filesystem`.

**Services (keep):** `services/bitcoin.js`, `services/lightning.js`. Others (`zmq`, `redis`, `mqtt`, `text`/`txt`, `exchange`, `local`, `turntable`) are integrations — do not reimplement in Hub or GoonCitizen.

**Message collections:** `functions/fabricMessageCollection.js` is the share/replay helper for ordered AMP hex (journals, Discord packs, catch-up). GoonCitizen re-exports it; do not fork a second JSON-as-canonical log. Hub `messages/*.json` stays an activity log.

**Core stubs / low-value leaves** (do not copy downstream): `types/component.js`, `types/network.js`, `types/observer.js`, `types/transaction.js`. Class-count work: PRODUCTION_MARCH (`Scribe` is already a deprecation alias).

### `@fabric/http` — `types/` (HTTP/SPA only)

**Stay in http:** `server` (`HTTPServer`), `spa`, `site`, `app`, `compiler` (webpack), `bridge`, `sandbox`, `browser`, `client`, `element`, `avatar`, `JSONCall`, `distributedExecutionHttp`, `resource` (HTTP verbs), `remote` (HTTP client).

**Delete or stop exporting when touching:** `identity.js`, `peer.js`, `swarm.js` stubs. **Rename if touching:** `channel.js` (UI), `hub.js` (legacy Oracle hub).

Package main (`types/web.js`) exports `Server`, `Client`, `SPA`, `Avatar` — not the stubs.

### `@fabric/hub` — operator

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

### `@fabric/passport` — extension

No top-level `types/` or `services/`. Treat as a **client** of core Key/Message and http site-login / device-link.

| Path | Verdict |
|------|---------|
| `src/types/key.ts` | **Do not grow.** Incomplete elliptic Key; `toBech32()` is a stub. Target: `@fabric/core/types/key`. |
| `src/types/identity.ts` | UI `IIdentity` / chain allowlist — not core Identity. Keep local. |
| `src/background/encryptedDatastore.ts` | chrome.storage AES-GCM — parallel to `Store.openEncrypted`, not a merge candidate. |
| `src/utils/identityCrossSign.ts` | **Re-export** of `@fabric/core/functions/identityCrossSign`. |
| `src/utils/fabricSiteLoginSign.ts`, `fabricDeviceLinkSign.ts` | Clients of http — keep as clients. |
| `src/fabric/bitcoinService.ts` | Hub HTTP Bitcoin client — keep. |

### GoonCitizen — application

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

## Common API slices (ranked)
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

## Do not consolidate

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

## Healthy subclass edges (copy this pattern)

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

## Refresh procedure

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

## Remaining work
Not a ship list. Owner go-ahead still required. Detail for Core also lives in [OUTSTANDING.md](OUTSTANDING.md).

### Core [#183](https://github.com/FabricLabs/fabric/pull/183) (edit existing PR files only)
- **Do not add** identity leaves, this file, or `package.json` smoke `require()`s for those leaves (CodeRabbit ~150-file cap; smoke would fail without the files).
- Existing OUTSTANDING items: type-tree keep/remove, `messageHex` laziness, `contractId` → `contractIdentifier`, genesis journal cap, blinded-execution scaffold, third-party review of peer/HTLC.

### Follow-up Core PR (new files)
Land `functions/identityCrossSign.js`, `fabricIdentitySchnorr.js`, `identityCrossSignVerify.js` (+ `.d.ts`) and `tests/functions.identityCrossSign.js`, then PUBLIC_API / smoke / AGENTS pointers in the **same** commit. After that, pin or `npm link` core in http / Hub / Passport / GoonCitizen.

### Pending tests (not failures)
- 3× Lightning `_makeRPCRequest` (JSON-RPC line-delimited / error / timeout) — skipped unit stubs.
- 1× `dials configured peers and emits CONTRACT_PUBLISH` (`tests/playnet.contract.publish.integration.js`) — skipped unless a live mnemonic is configured.

### Downstream (already edited in those repos)
Keep the re-exports. Remaining ranked slices: site-login possession-proof (http/Hub), Passport Key class, Hub Queue/Worker delete, CollectionStore only if a second consumer appears.

---

## Related docs

| Doc | Role |
|-----|------|
| [OUTSTANDING.md](OUTSTANDING.md) | Core security queue + suite status |
| [PRODUCTION_MARCH.md](PRODUCTION_MARCH.md) | Core *class count* keep/fold/remove |
| [DEVELOPERS.md](../DEVELOPERS.md) | Core `types/` vs `services/` layout, Store, Fabric facade |
| [AGENTS.md](../AGENTS.md) | Agent lifecycle (`Service` start/stop) |
| Hub `docs/PRODUCTION_MARCH.md` | Copy of core march + Hub RC scope |
| Hub `tests/liftedApis.exports.test.js` | Re-export contract for shared functions |
| GoonCitizen `AGENTS.md` §3–§4 | What LiveRelay actually runs |
| GoonCitizen `DECISIONS.md` D-009/D-010/D-011/D-013 | Why Fabric conventions, Peer, site-login, device-link exist |
