# Security
Fabric aims to maximize the security of a sensible default configuration while keeping dependencies understandable and reviewable.

## Objectives
- Secure defaults for the reference client (`@fabric/core`)
- Minimal attack surface where practical
- Clear separation between **experimental** APIs and **release** commitments (see [CHANGELOG.md](CHANGELOG.md))

## P2P gossip (`P2P_PEER_GOSSIP`)
Relay of gossip is bounded to reduce amplification DoS: **logical payload** deduplication (stable hash over `type` + `object` sans `gossipHop`), **`gossipHop` TTL** (default 5, decremented on each relay), **per-origin relay budget** per rolling minute (default 60), and **FIFO-capped** wire-hash and payload caches. See `constants.js` (`GOSSIP_*`, `PEER_MAX_WIRE_HASH_CACHE`) and `Peer` `settings.gossip`.

## P2P peering offers (`P2P_PEERING_OFFER`)
Relay uses the same class of controls as gossip, with separate state: logical dedup (hash over `type` + `object` sans `peeringHop`), **`peeringHop` TTL** (default 5), **per-origin relay budget** per rolling minute (default 60), **FIFO-capped** payload cache, and a **bounded, deduped** candidate queue for offered addresses (`PEER_MAX_CANDIDATES_QUEUE`, default 128). See `constants.js` (`PEERING_OFFER_*`, `PEER_MAX_CANDIDATES_QUEUE`) and `Peer` `settings.peering`.

## Canonical JSON (`functions/fabricCanonicalJson.js`)
Sorted-key JSON used for **cryptographic binding** (L1 document preimage / `contentHash`, beacon epoch strings, federation commitments). **Do not fork** a second “stable stringify” in application code — drift breaks parity with Hub and cross-runtime hashes. The implementation caps **nesting depth**, rejects **`BigInt` / `Symbol`**, and encodes **`undefined`** as JSON `null` so string concatenation cannot produce invalid JSON.

## Wire JSON (`functions/wireJson.js`)
Callers use **`tryParseWireJson`** (AMP / **`MAX_MESSAGE_SIZE`**), **`tryParseWireJsonBody`** (empty body → `{}`), **`tryParsePersistedJson`** / **`parsePersistedJson`** (disk / Level / store roots → **`PERSISTED_JSON_MAX_CHARS`**, 2 MiB UTF-16 units in `constants.js`), and **`utf8FromPersistedRaw`** (string or **`Buffer`** → UTF-8 before parse). **`tryParseJsonBounded`** remains the primitive for custom caps. **Prototype pollution** from `JSON.parse` remains a general JavaScript concern; merge parsed objects into application state with care (avoid deep merge from untrusted keys).

## Byte views (`functions/bytes.js`)
**`toUint8Strict`** — only `Buffer` / `Uint8Array` for encoders (base58, BIP-32). **`toUint8Flexible`** — Noble/secp256k1 entrypoints; optional **`maxLength`** caps allocation when input is array-like. Prefer strict helpers for anything derived from wire or user strings.

## Native addon toggles (`FABRIC_NATIVE_*`, `FABRIC_SKIP_NATIVE_ADDON`)
Optional **`fabric.node`** can accelerate double-SHA256 and Bech32/segwit (`functions/fabricNativeAccel.js`). Behavior is **opt-in** via environment variables so CI and browser bundles stay deterministic. Review **`FABRIC_SKIP_NATIVE_ADDON=1`** for CI when a broken addon would otherwise crash the process.

## Patched dependencies (`patch-package`)
`postinstall` applies **`patches/*.patch`** (e.g. `bitcoinjs-lib`, `bs58check`) for v2 entrypoints and nested `wif` / `@noble/hashes` alignment. Treat patches as **security-sensitive**: review diff on upgrade, and keep **`npm audit`** + release notes in sync when changing patched versions.

## Operator-facing docs
| Doc | Use |
|-----|-----|
| [DEVELOPERS.md](DEVELOPERS.md) | Contributor workflow, core types, tests |
| [PRIVACY.md](PRIVACY.md) | What is / is not hidden from peers and observers |
| [AUDIT.md](AUDIT.md) | Known issues and recommendations |
| [docs/PRODUCTION.md](docs/PRODUCTION.md) | Node version, native addons, downstream alignment |

## Process
1. Before large changes, run **`npm run ci`** (full test suite).
2. For dependency and coverage reports: **`npm run reports`** (install log, coverage, TODO grep — may be slow).
3. Review **`npm audit`** results before release tags; record exceptions in the release notes if needed.
4. **Never** commit seeds, `stores/` production data, or RPC passwords (see [docs/PRODUCTION.md](docs/PRODUCTION.md)).

## Disclosure
Report security issues through the contact in [TODO.md](TODO.md) / project README as applicable.
