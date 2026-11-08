# `@fabric/core` types: production readiness

Snapshot of every file under `types/` (110 files, 64,812 lines) on branch
`feature/schemas` at `431f1001c`, 2026-11-05, with the working tree's
uncommitted changes included. Each type is graded for production use, grouped
by area, and checked for whether the message bodies it sends or reads use
field schemas (see [docs/MESSAGE_BODY.md](../docs/MESSAGE_BODY.md) and
[docs/MESSAGE_BODY_MIGRATION.md](../docs/MESSAGE_BODY_MIGRATION.md)).

## How this was measured

- **Mechanical, per file:** line count, class and base class, test files that
  `require` it (directly or by basename, which also counts `functions/*`
  shims), TODO/FIXME count, empty methods and empty `catch` blocks,
  `console.log`, synchronous fs, dynamic `require`, and every
  `Message.fromVector` / `fromLegacyBody` / `fromFields` call.
- **Wire status:** read from the live registry in `types/message.js`
  (`Message.getBodySchema`, `LEGACY_BODY_TYPES`, `DEPRECATED_WIRE_TYPES`),
  not from docs.
- **Judgement:** each file was read for what it implements and how. The
  smallest ones were also constructed, which found three that throw.

Test counts are files, not assertions or coverage. "No tests" means no test
file loads the module, not that its code is never exercised indirectly.

### Grades

| Grade | Meaning |
|---|---|
| **A** | Ready: complete for its stated scope, tested, no known defects. |
| **B** | Usable with caveats: in production use by Hub, but with gaps (size, swallowed errors, sync I/O, thin tests for its size, open TODOs). |
| **C** | Prototype or experimental: works for demos or regtest, or is marked experimental / deprecated. Do not build new production paths on it. |
| **D** | Dormant or broken: a stub, unused for years, or failing at construction. Remove or fix. |

### Body schema column

| Value | Meaning |
|---|---|
| `defines` | The type is the schema registry (`Message`). |
| `fields` | Every frame it sends uses a field schema. |
| `fields (inbound)` | It reads schema'd frames; it sends none. |
| `canonical JSON` | It sends signed artifacts inside `CONTRACT_MESSAGE`. The envelope has a field schema, but the `payload` field is a canonical-JSON string, because the signature covers that string. |
| `mixed` | Some of its frames use fields, some JSON. |
| `JSON` | Its frames are JSON (no schema exists for them yet). |
| `JSON (deprecated)` | It sends JSON on an opcode that is now deprecated: receivers count it and ignore it. |
| `JSON (local)` / `n/a (local)` | Builds a frame or record that never leaves the process. |
| `none` | Placeholder with no codec. |
| `n/a` | Sends no messages. |

## Summary

| Grade | Wire and networking | Cryptography and identity | Bitcoin | Contracts and execution | Markets and payments | Documents and storage | Base classes | Total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A — ready | 1 | 18 | 5 | 1 | 2 | 2 | 1 | **30** |
| B — usable, with caveats | 1 | 7 | 7 | 6 | 7 | 5 | 7 | **40** |
| C — prototype / experimental | 3 | 4 | 2 | 2 | 2 | 2 | 6 | **21** |
| D — dormant or broken | 3 | 0 | 1 | 2 | 0 | 4 | 9 | **19** |
| Total | 8 | 29 | 15 | 11 | 11 | 13 | 23 | **110** |

**Schema adoption.** Of the 93 registered opcodes, 44 have field schemas: 21
require fields on the wire (a Peer drops their JSON bodies) and 23 were
field-only from the start. 8 keep raw or JSON bodies by design, 7 are still
JSON with no schema, 14 are deprecated, and 20 Lightning opcodes are reserved
without a codec. Among the 110 types, the 27 that send or read frames break
down as: 4 fully on fields, 2 reading only schema'd frames, 14 using
`CONTRACT_MESSAGE` with a canonical-JSON payload, 3 mixed, and 4 still sending
JSON (1 with no schema yet, 2 on deprecated opcodes, 1 local only).

**Content bodies are only half migrated.** Every application protocol in core
(channels, coinjoin, swaps, federations, bonds, resolutions, storage
challenges, document offers) rides `CONTRACT_MESSAGE`, whose envelope
(`contract`, `payload`, `recipient`, `ref`, `slot`) is a field layout but whose
`payload` is JSON. That is deliberate: `Witness.signArtifact` signs the
canonical-JSON string, so moving those bodies to fields would change every
signature and needs per-body-type layouts plus a signing-string decision. It
is the largest remaining piece of the schema work: 26 named body types in
`channel.js`, `coinjoin.js`, `swap.js` and `federation.js` alone.

## Findings, most serious first

1. **Three shipped types fail when used.** `types/path.js` throws on every
   construction (undefined `settings`). `types/validator.js` starts an
   unhandled promise rejection in its constructor (`this.stream` undefined)
   and `validate()` always returns `true`. Both are in `files[]` and the
   `./types/*` export. `authority.js` and `component.js` also throw but are
   already excluded from the package.
2. **`Disk#get` runs `require()` on a caller-joined path** (`types/disk.js`),
   which executes any file it is pointed at. Shipped, no tests, no users found
   in core.
3. **`Store#_POST` logs the key and value unconditionally on failure**
   (`types/store.js`, around line 405). Stores hold encrypted settings and
   wallet material, so a failed write can put secrets in logs. Other
   `console.log`s in `Store`, `Wallet` and `Remote` print whole values or
   transactions when verbosity is raised, and `Remote#executeMethod` logs every
   call regardless of verbosity.
4. **Resolved: flush-chain removed.** `P2P_FLUSH_CHAIN` and
   `Peer#sendFlushChainToTrustedPeers` were removed from the V1 protocol;
   opcode `0x56` is reserved and decodes as unknown.
5. **Senders on deprecated opcodes are dead.** `Remote#executeMethod`
   (`P2P_CALL`), `Interface#_handleStateChange` (`P2P_TRANSACTION`),
   `Peer#_requestStateFromAllPeers` (`P2P_STATE_REQUEST`) and the `Service`
   heartbeat (`P2P_GENERIC`) build frames on opcodes that receivers now count
   and ignore. Remove them or move them onto live types.
6. **`P2P_FILE_SEND` is the main JSON frame left on the hot path.** Document
   blobs travel as JSON + base64 (`Document`, `DocumentBlobTransferBook`,
   `Peer`). The schema waits on the repricing question (migration open
   question 4). `P2P_CHAIN_SYNC_REQUEST`, `P2P_BASE_MESSAGE` carriers and
   `PASSPORT_SIGN_REQUEST` are the other live JSON bodies.
7. **`Message` still has silent fallbacks.** The constructor
   `JSON.stringify`s plain objects even when a schema exists, and
   `fromVector` turns an unknown name into `P2P_BASE_MESSAGE`. A typo or a
   `fromVector` call where `fromLegacyBody` was meant produces a frame other
   Peers drop, with no error at the sender. A sender-side assertion (throw
   when the type has a field layout and the body is an object) would catch
   both.
8. **`Peer` is an 8.7k-line monolith** covering transport, Noise, gossip,
   documents, inventory, HTLC delivery, MuSig, onion routing and flush,
   with 14 empty `catch` blocks. It is the most-tested type (38 files), but
   any change there is high-risk. Splitting out the document and inventory
   paths would make review tractable.
9. **Swallowed errors and synchronous I/O in operational types.**
   `Environment` (21 sync fs calls, 8 empty `catch`es), `Filesystem` (18 sync
   fs calls on publish), `Channel` / `ChannelBook` (11 empty `catch`es),
   `Setup` (6), `Beacon` and `Wallet` (3 each). Each empty `catch` should log
   or be justified in a comment.
10. **Large financial types have thin tests for their size.** `Federation`
    (1.8k lines, 3 test files), `CoinjoinRound` (1.2k, 2), `Chain` (1k, 3) and
    `Beacon` (1.5k, 3) move or account for coins. `Federation` signs mainnet
    vault withdrawals and should get an external review before production funds.
11. **`Wallet` has no coin selection** and 21 TODOs, including "parse as
    Message"; spends depend on the bitcoind wallet.
12. **20 Lightning opcodes are registered with no codec and no originator**,
    and `lightning/message.js` is an empty subclass. They are reserved
    surface, not a feature.
13. **`docs/PRODUCTION_MARCH.md` is stale.** Its "remove-candidate" list
    includes `witness`, `bond`, `document`, `challenge`, `bech32`, `hkdf` and
    `ecc`, which are now core, tested, production types. It lists `Worker` as
    "keep", but `Worker` only logs.

## Wire opcodes by body status

| Status | Count | Opcodes |
|---|---:|---|
| Fields required on the wire (JSON dropped) | 20 | `P2P_PING`, `P2P_PONG`, `P2P_INVENTORY_REQUEST`, `P2P_INVENTORY_RESPONSE`, `P2P_DOCUMENT_PUBLISH`, `P2P_PEER_ANNOUNCE`, `P2P_SESSION_OFFER`, `P2P_SESSION_OPEN`, `CONTRACT_PUBLISH`, `CONTRACT_MESSAGE`, `P2P_PEER_GOSSIP`, `P2P_PEERING_OFFER`, `CONTRACT_PROPOSAL`, `SIDECHAIN_STATE_PATCH`, `DOCUMENT_PUBLISH`, `DOCUMENT_REQUEST`, `BITCOIN_BLOCK`, `BITCOIN_BLOCK_HASH`, `BITCOIN_TRANSACTION`, `BITCOIN_TRANSACTION_HASH` |
| Fields only (no JSON mapping) | 23 | `P2P_FORWARD`, `P2P_DOCUMENT_BID`, `P2P_DOCUMENT_ASK`, `P2P_MUSIG_START`, `P2P_MUSIG_ACCEPT`, `P2P_MUSIG_RECEIVE_COUNTER`, `P2P_MUSIG_SEND_PROPOSAL`, `P2P_MUSIG_REPLY_TO_PROPOSAL`, `P2P_MUSIG_ACCEPT_PROPOSAL`, `PASSPORT_CHALLENGE`, `PASSPORT_ASSERTION`, `DELEGATION_LINK_OFFER`, `DELEGATION_LINK_ANSWER`, `DELEGATION_LINK_REVEAL`, `DELEGATION_GRANT`, `DELEGATION_REVOKE`, `DELEGATION_REQUEST`, `DELEGATION_RESULT`, `DELEGATION_MAILBOX_FETCH`, `PASSPORT_CONNECT`, `PASSPORT_SESSION`, `PASSPORT_RESUME`, `PASSPORT_REFUSED` |
| Raw bytes by design | 3 | `P2P_RELAY`, `P2P_PEER_ALIAS`, `P2P_CHAT_MESSAGE` |
| JSON at the edge by design | 5 | `P2P_MESSAGE_RECEIPT`, `CHAT_MESSAGE`, `JSON_PATCH`, `GENERIC_MESSAGE`, `JSON_CALL` |
| JSON, no schema yet | 7 | `P2P_INSTRUCTION`, `P2P_BASE_MESSAGE`, `P2P_STATE_COMMITTMENT`, `P2P_CHAIN_SYNC_REQUEST`, `P2P_FILE_SEND`, `P2P_SESSION_ACK`, `PASSPORT_SIGN_REQUEST` |
| Deprecated (decode only, counted) | 14 | `P2P_IDENT_REQUEST`, `SESSION_START`, `BLOCK_CANDIDATE`, `PEER_CANDIDATE`, `P2P_IDENT_RESPONSE`, `P2P_START_CHAIN`, `P2P_STATE_REQUEST`, `P2P_STATE_ROOT`, `P2P_STATE_CHANGE`, `P2P_TRANSACTION`, `P2P_CALL`, `P2P_GENERIC`, `LOG_MESSAGE`, `GENERIC_LIST` |
| Lightning, reserved (no codec) | 20 | `LIGHTNING_INIT` … `LIGHTNING_PONG` (`0x2000`–`0x2013`) |

## Types by group

Within each group, rows are sorted by grade, then size.

### Wire and networking

8 files, 12,886 lines.

| Type | Class | Lines | Tests | Grade | Body schema | Implementation and weaknesses |
|---|---|---:|---:|:-:|---|---|
| `message.js` | `Message` ← Actor | 3221 | 80 | A | defines | Wire oracle: 93 opcodes, 44 with field schemas, keyed layouts, legacy JSON mapping. Constructor still `JSON.stringify`s plain objects and `fromVector` maps unknown names to `P2P_BASE_MESSAGE` without an error, so a mistyped name produces a JSON frame silently. |
| `peer.js` | `Peer` ← Service | 8749 | 43 | B | mixed | 8.7k-line monolith (TCP, Noise, gossip, documents, inventory, HTLC, MuSig, onion). Drops JSON bodies of the 20 field-layout types. Still sends JSON for `P2P_FILE_SEND`, `GenericMessage` carriers and the inner `P2P_BASE_MESSAGE` envelope. 14 empty `catch` blocks. 20 `LIGHTNING_*` opcodes referenced, none decoded. |
| `session.js` | `Session` ← Entity | 215 | 2 | C | n/a | Session lifecycle object; `TypedMessage`, encrypt/decrypt helpers. Superseded by Peer's Noise session + `P2P_SESSION_*` handshake; one test. |
| `reader.js` | `Reader` ← EventEmitter | 142 | 1 | C | n/a | Marked `@deprecated`: byte-stream frame scanner kept for compatibility. Prefer Peer / Message ingest. |
| `codec.js` | `Codec` | 75 | 1 | C | n/a | Small encode/decode wrapper; one test; not used by the wire path. |
| `remote.js` | `Remote` ← Actor | 463 | 1 | D | JSON (deprecated) | WebSocket client. `executeMethod` sends JSON `P2P_CALL`, a deprecated opcode that receivers ignore, and `console.log`s every call unconditionally. HTTP verbs belong in `@fabric/http`. |
| `lightning/message.js` | `LightningMessage` ← FabricMessage | 12 | 80 | D | none | Empty subclass of `Message`. The 20 Lightning opcodes have no body codec and no originator. |
| `network.js` | `Network` | 9 | 5 | D | n/a | Settings holder with no behavior. |

### Cryptography and identity

29 files, 7,696 lines.

| Type | Class | Lines | Tests | Grade | Body schema | Implementation and weaknesses |
|---|---|---:|---:|:-:|---|---|
| `witness.js` | `Witness` | 1468 | 8 | A | canonical JSON | Signed artifacts (`signArtifact` over canonical JSON), fraud proofs, MuSig2/BLS/adaptor/DLEQ facades. Artifact bodies are canonical JSON by design: the signature covers that string. |
| `key.js` | `Key` ← EventEmitter | 907 | 94 | A | n/a | BIP32/39, BIP340 Schnorr, ECDH, tagged signing. 94 test files. Facade for `key/*`. |
| `witness/musig2.js` | `InvalidContributionError` ← Error | 866 | 4 | A | n/a | BIP-327; vector-tested. |
| `witness/musig2Session.js` | — | 555 | 2 | A | fields | Session state for the `P2P_MUSIG_*` field frames. |
| `key/bip32.js` | `HDNode` | 301 | 7 | A | n/a | In-tree HD derivation (`HDNode`); `tests/functions.bip32.js`. |
| `ecc.js` | — | 268 | 19 | A | n/a | secp256k1 backend selection; 19 tests. |
| `key/bip85.js` | — | 248 | 2 | A | n/a | Deterministic entropy; tested. |
| `key/bip39.js` | — | 230 | 6 | A | n/a | Mnemonic encode/validate; `tests/functions.bip39.js`. |
| `identity.js` | `Identity` ← Actor | 215 | 4 | A | n/a | BIP32 identity on `m/7777'`; tested. |
| `bech32/bech32.js` | — | 201 | 8 | A | n/a | Codec; `tests/functions.sipa.bech32.js` vectors. |
| `hash256.js` | `Hash256` | 170 | 15 | A | n/a | Double-SHA256, tagged hash, HMAC, keystream. Widely used and tested. |
| `key/base58.js` | — | 131 | 3 | A | n/a | Base58check; tested via `functions/*` shims. |
| `key/pubkey.js` | — | 95 | 14 | A | n/a | Pubkey normalisation; one empty `catch`. |
| `hkdf.js` | `HKDF` | 94 | 2 | A | n/a | RFC 5869; tested. |
| `bech32.js` | `Bech32` | 57 | 8 | A | n/a | Facade: `Bech32.Codec` (BIP-173/350) and `Bech32.Payment`. |
| `key/bip49.js` | — | 49 | 2 | A | n/a | P2SH-P2WPKH paths; tested. |
| `key/signingTags.js` | — | 32 | 16 | A | n/a | Domain-separation tag constants. |
| `key/keyHasPrivateSigningMaterial.js` | — | 20 | 2 | A | n/a | Single predicate. |
| `witness/bls.js` | — | 422 | 4 | B | n/a | BLS12-381 bundles bound to secp256k1 validators; `tests/functions.bls.js`. |
| `token.js` | `Token` | 246 | 2 | B | n/a | Capability token (admin token). Signed-string verify is tested; 3 TODOs; token claims are JSON, not a field layout. |
| `promise.js` | `EncryptedPromise` | 182 | 1 | B | n/a | `EncryptedPromise`: PBKDF2-sealed value with an iteration cap. 2 `console.log`s, 2 TODOs; one test. |
| `key/fabricKeyMaterial.js` | — | 141 | 3 | B | n/a | Key-material normalisation; covered only through `Key` tests. |
| `bech32/fabricPaymentBech32.js` | — | 137 | 2 | B | n/a | `fa1…` payment strings; unit-tested; format still RC-young. |
| `secret.js` | `Secret` ← EncryptedPromise | 46 | 1 | B | n/a | 32-byte random secret in an `EncryptedPromise`. |
| `ecc.selftest.js` | — | 34 | 0 | B | n/a | Startup self-test; no direct test. |
| `witness/adaptor.js` | — | 237 | 0 | C | n/a | Experimental BIP-340 adaptor sigs; tested via `types.witness.adaptor.js`. |
| `witness/musig2Adaptor.js` | — | 143 | 1 | C | n/a | Listed experimental in PUBLIC_API; checked against secp256k1-zkp. |
| `witness/dleq.js` | — | 125 | 0 | C | n/a | Experimental DLEQ proofs; tested via the adaptor suite. |
| `capability.js` | `Capability` ← Entity | 76 | 1 | C | n/a | Thin `Entity` around token generation; one test. |

### Bitcoin, wallet and settlement

15 files, 11,673 lines.

| Type | Class | Lines | Tests | Grade | Body schema | Implementation and weaknesses |
|---|---|---:|---:|:-:|---|---|
| `policy.js` | `Policy` | 2038 | 18 | A | n/a | Failover spend ladder → P2TR, leaves, PSBTs; 18 tests. |
| `htlc.js` | `Htlc` | 667 | 19 | A | n/a | P2TR claim/refund HTLC; 19 tests; one empty `catch`. |
| `wallet/accountKeys.js` | — | 628 | 6 | A | n/a | Account derivation and vault keys; `tests/functions.accountKeys.js`. |
| `wallet/bip21.js` | — | 159 | 1 | A | n/a | BIP21 URI parse/build; tested. |
| `wallet/bip86.js` | — | 75 | 1 | A | n/a | Taproot key-path addresses; tested. |
| `federation.js` | `Federation` ← Contract | 1805 | 4 | B | canonical JSON | Descriptors, Taproot vault, withdrawal PSBTs, 6 member message types under `CONTRACT_MESSAGE` (JSON payload). Mainnet custody path: needs an external review before production funds. |
| `beacon.js` | `Beacon` ← Actor | 1526 | 3 | B | n/a (local) | Epoch chain sealing contract/sidechain digests. Entry ids are now a deterministic digest (Phase 4); 3 empty `catch` blocks; regtest mining path. |
| `wallet.js` | `Wallet` ← Service | 1452 | 7 | B | fields (inbound) | Accounts, descriptors, BIP86 receive, watch. 21 TODOs (no coin selection, "parse as Message"), 33 verbosity-gated `console.log`s that print whole transactions and blocks, 3 empty `catch` blocks. |
| `bond.js` | `Bond` ← Contract | 1337 | 8 | B | canonical JSON | Bounty, deposit and fidelity bonds; 8 tests. Certificates and pre-signs travel as signed canonical-JSON artifacts in `CONTRACT_MESSAGE.payload`. Listed as a remove candidate in PRODUCTION_MARCH, which is now stale. |
| `chain.js` | `Chain` ← Actor | 1046 | 3 | B | n/a | pow / federation / gossip consensus over `Block`s; 3 test files for 1k lines. |
| `block.js` | `Block` ← Actor | 493 | 4 | B | n/a | Bitcoin-shaped header + Merkle + federation signatures. |
| `wallet/walletTransactionWatch.js` | — | 289 | 1 | B | fields (inbound) | Matches `BITCOIN_*` events to watched scripts; tested. |
| `bitcoin/transaction.js` | `BitcoinTransaction` ← Actor | 86 | 4 | C | n/a | Minimal Actor wrapper; real tx work uses bitcoinjs. |
| `bitcoin/block.js` | `BitcoinBlock` ← Actor | 43 | 4 | C | n/a | 43-line Actor wrapper, untouched since 2023. |
| `transaction.js` | `Transaction` ← Actor | 29 | 4 | D | n/a | Empty Actor; unchanged since 2022. |

### Contracts and execution

11 files, 4,372 lines.

| Type | Class | Lines | Tests | Grade | Body schema | Implementation and weaknesses |
|---|---|---:|---:|:-:|---|---|
| `contract.js` | `Contract` ← Service | 1754 | 20 | A | fields | `Contract#deploy` / `commit` send `CONTRACT_PUBLISH` / `CONTRACT_MESSAGE` as fields; 20 tests. The `CONTRACT_GENESIS` record is still a signed `P2P_BASE_MESSAGE` frame stored in the definition (by design, not sent). |
| `machine.js` | `Machine` ← Actor | 486 | 10 | B | n/a | Deterministic opcode VM; 10 tests. The sandbox is not hardened (host JS binds), per PUBLIC_API. |
| `program.js` | `Program` ← Circuit | 477 | 10 | B | n/a | Multi-language artifact; `solidity` / `asm` return `{ ok: false }` by design. |
| `challenge.js` | `Challenge` | 476 | 2 | B | canonical JSON | Storage proof-of-possession rounds and receipts; 2 tests. |
| `resolutions.js` | `Resolutions` ← Actor | 409 | 0 | B | canonical JSON | Pre-signed timelocked exits; tested via `types.contract.resolutions.js`. |
| `stack.js` | `Stack` ← State | 118 | 1 | B | n/a | Base for `Collection` / `Script`. |
| `roundRobin.js` | `RoundRobin` ← Circuit | 32 | 2 | B | n/a | Tiny selector; tested. |
| `circuit.js` | `Circuit` ← Actor | 311 | 2 | C | n/a | Graph / Bristol circuit research type; 11 empty methods; one TODO. |
| `compiler.js` | `Compiler` | 259 | 1 | C | n/a | JS / Minsc / Solidity frontends are stubs; sync fs. |
| `script.js` | `Script` ← Stack | 36 | 0 | D | n/a | Two-opcode lookup table; unchanged since 2019. |
| `instruction.js` | `Instruction` ← State | 14 | 0 | D | n/a | Empty `State` subclass. |

### Markets and payments

11 files, 11,040 lines.

| Type | Class | Lines | Tests | Grade | Body schema | Implementation and weaknesses |
|---|---|---:|---:|:-:|---|---|
| `delegation.js` | `Delegation` ← EventEmitter | 2054 | 2 | A | fields | Pairing, grants, requests: all 8 `DELEGATION_*` frames have field schemas. Inner `DelegationRequest` payloads are JSON in a field. |
| `book.js` | `Book` ← Actor | 163 | 5 | A | n/a | Capped insertion-ordered `Map`; base of every book. |
| `channel.js` | `Channel` ← State | 2860 | 8 | B | canonical JSON | 7 channel body types on `CONTRACT_MESSAGE` (no opcode, by decision). 2.9k lines, 8 tests, 6 empty `catch` blocks. |
| `coinjoin.js` | `PodleBlacklist` | 1545 | 7 | B | canonical JSON | 8 body types on `CONTRACT_MESSAGE`, PoDLE, P2TR only, refused on mainnet. |
| `coinjoinRound.js` | `CoinjoinTakerRound` ← Coinjoin | 1205 | 2 | B | canonical JSON | Taker / maker state machines; sealed round messages; 2 tests for 1.2k lines. |
| `channelBook.js` | `ChannelBook` ← Book | 813 | 5 | B | canonical JSON | Non-evicting channel registry; 5 empty `catch` blocks. |
| `signedBook.js` | `SignedBook` ← Book | 449 | 2 | B | canonical JSON | Signed ingest and cancels; 3 empty methods (subclass hooks). |
| `coinjoinBook.js` | `CoinjoinBook` ← OrderBook | 278 | 3 | B | canonical JSON | Fee/bond-weighted maker choice. |
| `orderBook.js` | `OrderBook` ← SignedBook | 116 | 1 | B | canonical JSON | Shared market views over `SignedBook`. |
| `swap.js` | `Swap` ← EventEmitter | 1386 | 5 | C | canonical JSON | L1/L2 liquidity swap. PUBLIC_API marks it experimental, regtest-only. |
| `liquidityBook.js` | `LiquidityBook` ← OrderBook | 171 | 2 | C | canonical JSON | Experimental with `swap`. |

### Documents and storage

13 files, 6,787 lines.

| Type | Class | Lines | Tests | Grade | Body schema | Implementation and weaknesses |
|---|---|---:|---:|:-:|---|---|
| `document.js` | `Document` ← State | 1370 | 14 | A | mixed | Sealed blob tree, inclusion proofs; 14 tests. Blobs ride `P2P_FILE_SEND`, which has no schema yet (Phase 3 open question 4). |
| `tree.js` | `Tree` ← Actor | 594 | 2 | A | n/a | Merkle tree with inclusion and non-inclusion proofs. |
| `documentBook.js` | `DocumentBook` ← Book | 1714 | 14 | B | fields | Ranked offer book and provider telemetry; reads `P2P_DOCUMENT_BID/ASK`, `DOCUMENT_REQUEST`, inventory responses (all schema'd); inventory `items` stay one JSON field. |
| `store.js` | `Store` ← Actor | 889 | 3 | B | n/a | LevelDB + encrypted settings; 16 empty methods. `_POST` failure path `console.log`s the key and value unconditionally (line ~405), which can leak stored secrets. |
| `documentBlobTransferBook.js` | `DocumentBlobTransferBook` | 645 | 5 | B | JSON | Buyer-side `P2P_FILE_SEND` reassembly; that frame is still JSON + base64. |
| `collection.js` | `Collection` ← Stack | 536 | 1 | B | n/a | 11 TODOs (`list()` should return an Array, no validation/signing of results); 8 empty methods. |
| `filesystem.js` | `Filesystem` ← Actor | 488 | 1 | B | n/a (local) | 18 synchronous fs calls on the publish path; `COMMIT` is now a plain record (Phase 4). One test file. |
| `logger.js` | `Logger` ← Actor | 117 | 1 | C | n/a | Append-to-file logger with sync fs. |
| `resource.js` | `Resource` ← Store | 108 | 1 | C | n/a | Declarative ARC resource; one test. |
| `history.js` | `History` ← Actor | 118 | 0 | D | n/a | Unused; imports via `../types/`; unchanged since 2022. |
| `datastore.js` | `Datastore` ← Store | 109 | 1 | D | n/a | Planned to fold into `Store`; `spam` / `ping` demo methods. |
| `ledger.js` | `Ledger` ← State | 70 | 1 | D | n/a | Page stack with fixed 4 KiB memory; one test. |
| `disk.js` | `Disk` | 29 | 0 | D | n/a | `get()` `require()`s an arbitrary joined path: code execution from any caller-controlled path. Shipped. |

### Base classes, services and shells

23 files, 10,468 lines.

| Type | Class | Lines | Tests | Grade | Body schema | Implementation and weaknesses |
|---|---|---:|---:|:-:|---|---|
| `actor.js` | `Actor` ← EventEmitter | 526 | 20 | A | n/a | Content-addressed state + JSON Patch commits; base of most types; 20 tests; 8 TODOs. |
| `cli.js` | `CLI` ← FabricShell | 4157 | 1 | B | mixed | 4.2k-line TUI shell; 14 TODOs. Sends `P2P_CHAT_MESSAGE` (raw by design), `ChainSyncRequest` and `ChatMessage` JSON (no layout / edge JSON). |
| `service.js` | `Service` ← Actor | 1709 | 4 | B | JSON (local) | 1.7k-line base for long-lived services; 20 TODOs ("schema" on actors/channels/messages), 2 dynamic `require`s. Heartbeat builds a JSON `Generic` (`P2P_GENERIC`, deprecated) frame locally. |
| `environment.js` | `Environment` ← Entity | 1117 | 3 | B | n/a | Wallet file, lock/unlock, Bitcoin config discovery; 21 sync fs calls, 8 empty `catch` blocks. |
| `setup.js` | `SetupTui` | 704 | 2 | B | n/a | `fabric setup` TUI; 6 empty `catch` blocks. |
| `state.js` | `State` ← Actor | 597 | 4 | B | n/a | Absorbed Scribe; 4 TODOs. |
| `fabric.js` | `Fabric` ← Service | 457 | 1 | B | n/a | Facade re-exporting types as statics; production code should use leaf imports. |
| `entity.js` | `Entity` ← EventEmitter | 285 | 1 | B | n/a | Second id model (SHA256 of `toJSON`), different from `Actor#id`; documented as migration-only. |
| `node.js` | `Node` ← Service | 147 | 0 | C | n/a | Process wrapper that `console.log`s every commit. |
| `oracle.js` | `Oracle` ← Store | 131 | 1 | C | n/a | `Store` subclass; 2 TODOs. The Hub's `OracleAttestation` lives outside this type. |
| `router.js` | `Router` ← State | 81 | 1 | C | n/a | Chat `!command` router; calls `this.fabric.plugins` which nothing sets. |
| `worker.js` | `Worker` ← Service | 57 | 1 | C | n/a | Listed "keep" but only logs and answers `PING`. |
| `distributedExecution.js` | — | 27 | 0 | C | n/a | Deprecated re-export shim kept one release for Hub. |
| `vector.js` | `Vector` ← EventEmitter | 23 | 1 | C | n/a | Bare `EventEmitter`. |
| `interface.js` | `Interface` ← Service | 204 | 1 | D | JSON (deprecated) | Emits JSON `Transaction` (`P2P_TRANSACTION`, deprecated) frames on state change. |
| `queue.js` | `Queue` ← Actor | 65 | 0 | D | n/a | `_takeJob` / `_completeJob` / `_failJob` are empty; the Redis option does nothing. |
| `typetree.js` | `TypeTree` | 47 | 0 | D | n/a | Dev-only, excluded from the package. |
| `component.js` | `Component` ← Service | 41 | 0 | D | n/a | Broken (uses `this` before `super`); excluded from the package. |
| `path.js` | `Path` ← String | 27 | 34 | D | n/a | Broken: the constructor references an undefined `settings` and throws on every call. Shipped and exported. |
| `validator.js` | `Validator` ← Fabric | 24 | 0 | D | n/a | Broken: the constructor calls an unbound `main()` that rejects (`this.stream` undefined), giving an unhandled rejection; `validate()` returns `true`. Shipped. |
| `label.js` | `Label` ← Actor | 16 | 0 | D | n/a | Hash-of-string id; unchanged since 2021. |
| `authority.js` | `Authority` ← HTTP | 13 | 0 | D | n/a | Broken (`require('./http')` does not exist); excluded from the package. |
| `observer.js` | `Observer` | 13 | 0 | D | n/a | One-line `fast-json-patch` wrapper; unchanged since 2019. |


## Recommendations

**Before RC1**

- Fix or remove `path.js` and `validator.js`; remove `disk.js` or replace
  `require()` with a read. Add a test that constructs every exported type.
- Remove the value from the `Store#_POST` failure log, and make
  `Remote#executeMethod` respect verbosity.
- Delete or rewire the four deprecated-opcode senders (finding 5).
- Make `Message.fromVector` / the constructor throw for an object body on a
  field-layout type (finding 7).

**Schema work after RC1**

- Settle open question 4 and give `P2P_FILE_SEND` a layout: raw blob bytes
  instead of base64 is the largest bandwidth win left.
- Give `P2P_CHAIN_SYNC_REQUEST` and `PASSPORT_SIGN_REQUEST` keyed layouts.
- Plan inner field layouts for the `CONTRACT_MESSAGE` body types (channel,
  coinjoin, swap, federation first). Each needs a signing-string decision:
  keep signing canonical JSON rebuilt from the decoded fields, or sign the
  field bytes and bump each body type's version.

**Cleanup**

- Remove the D-grade dormant types (`transaction`, `instruction`, `script`,
  `observer`, `label`, `history`, `ledger`, `datastore`, `queue`, `network`,
  `interface`) or move them to `examples/`, then refresh `PRODUCTION_MARCH.md`
  from this report.
- Split `Peer` along its document / inventory / settlement seams.
- Replace empty `catch` blocks in `Environment`, `Channel`, `ChannelBook`,
  `Setup`, `Beacon` and `Wallet` with logged or commented handling.
- Add tests for `Federation`, `CoinjoinRound`, `Chain` and `Beacon` in
  proportion to their size.
