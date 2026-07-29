# C / JavaScript Implementation Parity

**Canonical protocol (0.1.0):** the **JavaScript** reference (`types/message.js`,
`types/peer.js`, document-exchange helpers under `functions/`). npm install does
**not** build the C addon by default (`scripts/install-native.js`). C sources
remain in-tree for optional local builds (`npm run build:c` or
`FABRIC_BUILD_NATIVE=1`).

Treat this document as notes for the **optional** native stack — not as the
source of truth for wire behavior. When C and JS disagree, **fix C or leave it
experimental**; do not change JS to match broken C.

Parity notes for the native addon (`binding.cc`, `src/*.c`) and the JavaScript reference (`types/*.js`).

## Native / JS surface summary

### 1. `binding.gyp`
- **Sources**: `src/binding.cc` plus three C translation units that `#include` the implementation files (unity build for fewer compile units, same behavior):
  - **`src/crypto.c`** — `sha2.c`, `security.c`, `native/sipa/segwit_addr.c`, `taproot.c`
  - **`src/protocol.c`** — `errors.c`, `validation.c`, `message.c`
  - **`src/p2p.c`** — `threads.c`, `scoring.c`, `peer.c` (named `p2p.c` so the TU can include `peer.c` without self-inclusion)
- **Libraries**: `secp256k1`, Noise (`libnoiseprotocol`, `libnoisekeys`) — see `binding.gyp` `conditions` for platform paths
- **Purpose**: N-API surface in `binding.cc`; crypto/protocol/peer layers compiled as above for Message, Peer, and wire experiments vs JS

### 2. `src/binding.cc`
- **libwally**: `wally_init(0)` once at addon load
- **BIP340**: `bip340Init`, `bip340Cleanup`, `bip340Keygen`, `bip340PubkeyFromPrivate`, `bip340Sign`, `bip340Verify`
- **Taproot**: `taprootScriptPubKey`, `taprootTweakXOnly`, `taprootKeypathSign`, `bip341SighashDefault`

### 3. `src/cli.c` / `src/cli.h`
- CLI state includes `Peer *peer`, listening port, `broadcast` / `listen` / `connect` / `stop`
- Outbound path: `message_set_body` → `message_compute_body_hash` → `message_sign` → `peer_send_message`

### 4. `src/message.c` (compiled via `src/protocol.c`)
- Secure alloc/free/zero for bodies; validation helpers on `message_set_body`
- **Body hash**: `message_compute_body_hash` = SHA256(SHA256(body)) (Bitcoin-style)
- **Signing**: tagged hash `"Fabric/Message"` over header + body into a separate buffer; **does not** overwrite `message->hash` (wire body hash)
- **`message_compute_hash`**: deprecated no-op (legacy call sites)
- **Known gap:** C sign/verify author/signature ordering still lags JS — do not use C as a second protocol oracle until fixed

---

## Body hash (wire integrity) — JS canonical

| Layer | Behavior |
|--------|-----------|
| **JS** | `Hash256.doubleDigest` in `types/hash256.js`; `Message` `data` setter sets `raw.hash`; `Peer._handleFabricMessage` compares with `Hash256.doubleDigest` on `raw.data` |
| **C** | `message_compute_body_hash` / `message_verify_body_hash` use double-SHA256 over raw body bytes (optional) |

Cross-checks: `tests/fabric.message.js` (expected header hashes, `fromBuffer` preserves wire hash), `tests/peering.cross-implementation.js` (when native is built).

**Parse path:** `Message.fromRaw` / `fromBuffer` must **not** run the `data` setter after filling `raw` from bytes — the setter recomputes `hash` from the body and would mask a corrupt wire hash. The `data` setter is for composing messages; parsing keeps header `hash` as on the wire.

---

## Signing flow — JS canonical

- **Algorithm**: BIP-340 Schnorr with tagged hash tag **`Fabric/Message`**
- **Digest input**: header (**signature zeroed**, **author set**) + body bytes
- **`hash` field on wire**: body integrity only (double-SHA256), not the signed digest
- **Author**: x-only pubkey (32 bytes)

---

## Wire format

- **Header**: 208 bytes = magic(4) + version(4) + parent(32) + author(32) + type(4) + size(4) + hash(32) + preimage(32) + signature(64).
- **preimage**: all-zero for public messages; optional **payment secret** for HTLC / Fabric Circuit hops (Lightning-style — not SHA256(body)). See [`MESSAGE_BODY.md`](./MESSAGE_BODY.md).
- **Body**: variable, bounded by `MAX_MESSAGE_SIZE` in JS (`constants.js`), i.e. 3888 bytes for a 4096-byte frame with the v2 header. **V1:** body is a C-like typed field layout per opcode — not JSON ([`MESSAGE_BODY.md`](./MESSAGE_BODY.md)).

---

## BIP340 / Taproot

- **C addon**: exports in `binding.cc` for tests and wallet tooling
- **JS**: `@noble/curves` / `@noble/hashes`; Taproot-oriented helpers in `types/key.js`, `types/federation.js`
- **Optional**: call native `bip340*` / `taproot*` from JS when the addon is loaded for single-stack crypto

---

## C CLI vs JS CLI

- **C**: ncurses TUI, in-process peer
- **JS**: `types/cli.js` + `types/peer.js`
- Same protocol goals; different UX and process model

---

## Build dependencies

- **macOS (Homebrew)**: `secp256k1`, `libwally-core`, noise static libs — paths in `binding.gyp` may need adjusting if keg names differ (`libwally-core` vs `/usr/local/lib`).
- **Linux**: typical `-lsecp256k1` `-lwallycore` plus noise, as in `binding.gyp` conditions.

After `npm run build:c`, run `npm test` (includes `tests/peering.cross-implementation.js`).

---

## Optional native acceleration (CLI / library)

- **`doubleSha256`** on `fabric.node` matches wire body hash; JS loads it via `functions/fabricNativeAccel.js` (`FABRIC_ADDON_PATH`).
- **`Hash256.doubleDigest`** uses that helper (native or @noble fallback).
- Other bindings exist for low-level experiments; the **supported** accelerated surface for the `fabric` harness is intentionally tiny — see [`CLI-BINARY.md`](./CLI-BINARY.md).

## Remaining / optional work

1. **JS ↔ native**: extend the allowlist only when a clear hot path needs it (e.g. optional `bip340Verify` passthrough); default remains noble/JS.
2. **C peer ↔ JS peer**: integration test with a live TCP round-trip once a minimal C sender/receiver binary or harness is available (today’s peering tests cover JS wire compatibility).
3. **Docs**: keep `BUILD.md` in sync with libwally installation for both platforms.

JS-only backlog (CLI, Peer, contracts): [`JS-PLAN.md`](./JS-PLAN.md).
