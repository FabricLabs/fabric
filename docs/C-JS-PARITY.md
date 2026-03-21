# C / JavaScript Implementation Parity

Parity notes for the native addon (`binding.cc`, `src/*.c`) and the JavaScript reference (`types/*.js`).

## Native / JS surface summary

### 1. `binding.gyp`
- **Sources**: `validation.c`, `secure_memory.c`, `secure_random.c`, `bip340.c`, `taproot.c` (plus existing peer/message stack)
- **Library**: `libwallycore` (double-SHA256 and related primitives used from C)
- **Purpose**: BIP340/Taproot helpers from JS; secure message body handling in C

### 2. `src/binding.cc`
- **libwally**: `wally_init(0)` once at addon load
- **BIP340**: `bip340Init`, `bip340Cleanup`, `bip340Keygen`, `bip340PubkeyFromPrivate`, `bip340Sign`, `bip340Verify`
- **Taproot**: `taprootScriptPubKey`, `taprootTweakXOnly`, `taprootKeypathSign`, `bip341SighashDefault`

### 3. `src/cli.c` / `src/cli.h`
- CLI state includes `Peer *peer`, listening port, `broadcast` / `listen` / `connect` / `stop`
- Outbound path: `message_set_body` → `message_compute_body_hash` → `message_sign` → `peer_send_message`

### 4. `src/message.c`
- Secure alloc/free/zero for bodies; validation helpers on `message_set_body`
- **Body hash**: `message_compute_body_hash` = SHA256(SHA256(body)) (Bitcoin-style)
- **Signing**: tagged hash `"Fabric/Message"` over header + body into a separate buffer; **does not** overwrite `message->hash` (wire body hash)
- **`message_compute_hash`**: deprecated no-op (legacy call sites)

---

## Body hash (wire integrity) — aligned

| Layer | Behavior |
|--------|-----------|
| **C** | `message_compute_body_hash` / `message_verify_body_hash` use double-SHA256 over raw body bytes |
| **JS** | `Hash256.doubleDigest` in `types/hash256.js`; `Message` `data` setter sets `raw.hash`; `Peer._handleFabricMessage` compares with `Hash256.doubleDigest` on `raw.data` |

Cross-checks: `tests/fabric.message.js` (expected header hashes, `fromBuffer` preserves wire hash), `tests/peering.cross-implementation.js` (round-trip and bad-hash rejection).

**Parse path:** `Message.fromRaw` / `fromBuffer` must **not** run the `data` setter after filling `raw` from bytes — the setter recomputes `hash` from the body and would mask a corrupt wire hash. The `data` setter is for composing messages; parsing keeps header `hash` as on the wire.

---

## Signing flow — aligned

- **Algorithm**: BIP-340 Schnorr with `secp256k1_tagged_sha256` / JS equivalent, tag **`Fabric/Message`**
- **Digest input**: header (signature zeroed) + body bytes
- **`hash` field on wire**: body integrity only (double-SHA256), not the signed digest
- **Author**: x-only pubkey (32 bytes)

---

## Wire format

- **Header**: 208 bytes = magic(4) + version(4) + parent(32) + author(32) + type(4) + size(4) + hash(32) + preimage(32) + signature(64). **preimage** is all-zero for public messages (optional secret on wire otherwise).
- **Body**: variable, bounded by `MAX_MESSAGE_SIZE` in JS (`constants.js`), i.e. 3888 bytes for a 4096-byte frame with the v2 header.

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
