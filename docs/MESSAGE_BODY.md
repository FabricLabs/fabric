# Fabric Message bodies (V1)

For Fabric **V1**, `@fabric/core` treats AMP **bodies as C-like typed field
layouts**, not JSON documents. JSON appears only at the **`@fabric/http`**
(and Hub UI) boundary as a human/SPA bridge.

## Wire frame (unchanged)

**Header (208 bytes)** ‖ **body** (`size` bytes), as in
[`C-JS-PARITY.md`](./C-JS-PARITY.md) / `src/message.h`.

**Wire `version` field:** `0x00000001` (`VERSION_NUMBER` / `FABRIC_MESSAGE_VERSION`) for the
`@fabric/core` **0.1.x** pre-release. The 208-byte layout (including Lightning-style
`preimage`) is the V1 frame under this version — not a bump to `0x02`.

| Offset | Size | Field |
|--------|------|--------|
| 0 | 4 | magic |
| 4 | 4 | version (`0x01`) |
| 8 | 32 | parent |
| 40 | 32 | author |
| 72 | 4 | type (opcode) |
| 76 | 4 | size |
| 80 | 32 | hash = double-SHA256(body) — **body integrity** |
| 112 | 32 | preimage — **payment secret** (Lightning-style; zeros if none) |
| 144 | 64 | BIP-340 signature |
| 208 | … | **body** |

Integrity and signing always cover **raw body bytes**. Nested envelopes:

- **`P2P_RELAY` (0x43)** — mesh **flood** carrier; body = raw inner AMP bytes.
  Not for IP-hiding routes (every edge sees the frame).
- **`P2P_FORWARD` (0x45)** — directed **onion hop**; field body
  `{ nextPeer: bytes32, ttl: u8, inner: message }`. Nest layers with
  `@fabric/core/functions/fabricOnion` / `Peer#sendOnion`. Destination sees
  only the last hop’s TCP peer.

### Wire `preimage` (payment secret, not body hash)
Aligned with Lightning HTLC semantics for Fabric Circuits / multi-hop payment
chains:

- **`hash`** = double-SHA256(body) — only body integrity check (Peer drops on mismatch).
- **`preimage`** = all zeros for ordinary public messages; set an explicit 32-byte
  secret when the frame carries an HTLC / circuit payment commitment
  (`payment_hash = SHA256(preimage)`).
- Do **not** default `preimage` to SHA256(body) — that conflates integrity with
  payment secrets and breaks independent hop secrets in circuit chains.

JavaScript (`types/message.js`) is the **canonical** protocol definition for
`@fabric/core` 0.1.0. The optional C addon is not required for npm install.

## Body = fields, not JSON

Per opcode, the body is an ordered list of named fields (big-endian):

| Field type | Encoding |
|------------|----------|
| `u8` / `u16` / `u32` / `u64` | Fixed-width unsigned integer |
| `bytes32` | 32 raw bytes |
| `bytes` / `string` | `u32` length + payload (UTF-8 for `string`) |
| `message` | Nested AMP blob (`u32` length + frame) |

What application code historically put in JSON **keys** becomes these **field
names** in a schema registered for that wire type.

API: `types/message.js` body codec helpers (`Message.encodeBody` /
`Message.decodeBody` / `Message.getBodySchema`), and `Message.fromFields` /
`message.toFields()`. Compatibility re-export:
`require('@fabric/core/functions/messageBodyCodec')` (same helpers).

## JSON belongs in `@fabric/http`

- Core Peer/Message paths must not *design around* `JSON.stringify` /
  `JSON.parse` as the body format.
- Prefer **`Message.fromFields(type, fields)`** for V1 bodies. The Message
  constructor still `JSON.stringify`s plain objects (legacy Hub/chat
  compatibility); it does **not** auto field-encode even when a schema exists.
- HTTP / Bridge may map field structs ↔ JSON for REST and browsers
  (`functions/messageBodyJsonBridge.js` in `@fabric/http`), including
  RFC6902 patch arrays ↔ `SIDECHAIN_STATE_PATCH` fields
  (`basisClock` / `basisDigest` / `catalogCanonical` / optional
  `patchesCanonical` for multi-op fidelity).
- **Legacy:** object bodies without a registered schema still
  `JSON.stringify` (deprecated transitional path for GenericMessage and
  unmigrated types). New opcodes **must** ship a field schema.
- **Required on the wire:** Peer drops JSON bodies of every type in
  `Message.LEGACY_BODY_TYPES` (counted in `Peer#jsonBodyCounts()`; there is
  no opt-out). Send them with `Message.fromLegacyBody`.
  Stored JSON frames still parse with `Message.tryParseLegacyBody`.
- **Opaque UTF-8 exceptions:** `P2P_CHAT_MESSAGE` and `P2P_PEER_ALIAS` use the
  body bytes as the UTF-8 text / nickname itself (no field schema, no JSON).
  Build with `Message.fromVector(['P2P_CHAT_MESSAGE', text])` (string body).

## Legacy JSON objects ↔ fields

`Message` statics in [`types/message.js`](../types/message.js) map
the JSON objects apps already build onto the field schemas of eight opcodes,
and back:

- `Message.fromLegacyBody(type, body)` — field-encoded `Message` from the legacy object.
  Replaces `Message.fromVector([type, JSON.stringify(body)])` one for one.
- `Message.encodeLegacyBody(type, body)` / `Message.decodeLegacyBody(type, fields)` — the
  two halves of that mapping.
- `Message.tryParseLegacyBody(message)` — the legacy object from either encoding.

Peer runs `decodeLegacyBody` on every field body of these types before its
checks and before `contract:publish`, `contract:message`, `peeringGossip`,
`peeringOffer`, `peerAnnounce` and `sidechain:patch` are emitted, so handlers
see the same object whichever encoding the sender used.

| Opcode | Fields | Legacy object |
|--------|--------|---------------|
| `P2P_PING` / `P2P_PONG` | `nonce` | `{ nonce }` (a pong echoes its ping's nonce) |
| `P2P_PEER_ANNOUNCE` | `host`, `port`, `pubkey`?, `nonce`? | same keys |
| `P2P_PEER_GOSSIP` | `host`, `port`, `gossipHop`, `nonce`, `pubkey`? | same keys; a missing hop encodes as `GOSSIP_MAX_HOPS` |
| `P2P_PEERING_OFFER` | `transport`, `host`, `port`, `peeringHop`, `pubkey`?, `slots`?, `peering`?, `nonce`? | same keys; a missing hop encodes as `PEERING_OFFER_MAX_HOPS` |
| `CONTRACT_PUBLISH` | `definition` | the definition: `JSON.stringify` of the object, key order kept, so `Actor(definition).id` is unchanged |
| `CONTRACT_MESSAGE` | `contract`, `payload`, then optional `recipient`, `ref`, `slot` | `{ contract, ...payload }`; `payload` is `JSON.stringify` of the body without `contract`. The three index fields are copied from the object (top-level, else `object`) so a reader can match them without parsing `payload`. Empty ones are omitted. Old decoders ignore the trailing bytes. |
| `SIDECHAIN_STATE_PATCH` | `basisClock`, `basisDigest`, `catalogCanonical`, `patchesCanonical`?, `federationWitnessCanonical`? | `{ type, version, kind, basisClock, basisDigest, patches, federationWitness }` |

`?` marks optional trailing fields. Old decoders ignore trailing bytes, so
these appends are forward compatible under `0x01`.

Notes:

- An encoded hop of 0 makes receivers drop gossip and offers, which is why a
  missing hop encodes as the maximum.
- `basisDigest` must be 64 lowercase hex or empty (empty encodes as 32 zero
  bytes and decodes back to `''`). The sidechain signing string compares the
  digest case-sensitively, so upper-case hex is refused instead of silently
  lower-cased.
- Keys outside a schema are dropped. An offer's nested `object` envelope is
  flattened, and non-string values such as GoonCitizen's `rendezvous` are not
  carried.
- Gossip and offer dedup keys and the announce registration key hash a
  canonical object (`canonicalPeeringObject`), so JSON and field copies of one
  message collapse to one key even though their frame hashes differ.

Core's own senders use fields: keepalive ping/pong, `Contract#deploy` /
`Contract#commit`, and `buildSignedSidechainPatchMessage`. Everything else
still sends JSON. Since Phase 5 a Peer drops JSON bodies of all of them on the wire. The
remaining phases are in [Migration](#migration) below.

### Keyed layouts (session, inventory, documents)

Thirteen more opcodes map through the same statics, with a layout built from one
key table per type (`KEYED_LAYOUTS` in `types/message.js`), so the schema and
the mapping cannot drift:

- `present` (`u32`) comes first: bit *i* is set when key *i* was in the body,
  so `0`, `''` and `false` round-trip as written (`blobIndex: 0` is the first
  blob, not "absent"). Bit 31 marks a Hub-style envelope
  (`{ type, actor, object, target }`); the keys are then read under `object`.
- One field per key the type's readers use.
- `extra` (`string`) comes last: JSON of every key the table does not name,
  and of any value that is not the declared kind (`null`, a string where a
  number goes, upper-case hex, non-canonical base64, a negative number). A
  body any JSON sender writes therefore maps to fields and back unchanged;
  nothing is dropped, and encoding never fails for an object body.

| Opcode | Keys with their own field |
|--------|---------------------------|
| `P2P_SESSION_OFFER` | `type`, `actor.{id, pubkey, parentPubkey, parentXpub, parentSignature}`, `object.challenge`, `object.maxFrameBytes` (`u32`) |
| `P2P_SESSION_OPEN` | the same `type` and `actor` keys, `object.{initiator, counterparty, solution}`, `object.maxFrameBytes` |
| `P2P_INVENTORY_REQUEST` | `kind`, `created`, `offerBtc`, `maxSats`, `buyerRefundPublicKey`, `blobHashHex`, `merkleRootHex`, `inventoryRelayTtl`, `htlcLocktimeBlocks`, `htlcAmountSats` |
| `P2P_INVENTORY_RESPONSE` | `kind`, `created`, `inventoryId`, `page`, `pages`, `items` (JSON, key order kept) |
| `P2P_DOCUMENT_PUBLISH` | `hash`, `rate`, `contentHash`, `contentHashHex`, `binding` |
| `DOCUMENT_PUBLISH` | `contentBase64` (sent as raw `bytes`), `id`, `mime`, `name`, `revision`, `sha256`, `size` |
| `DOCUMENT_REQUEST` | `document`, `id`, `maxSats`, `relayHop`, `routeId`, `blobIndex`, `batchEnd`, `blobTotal`, `quote`, `credit`, `creditRef`, `contentHashHex` |
| `BITCOIN_BLOCK` | `tip`, `height`, `network`, `at`, `hash`, `blockHash`, `content` (raw block, `hex` → bytes) |
| `BITCOIN_BLOCK_HASH` / `BITCOIN_TRANSACTION_HASH` | `content` (32 bytes) |
| `BITCOIN_TRANSACTION` | `content` (raw transaction, `hex` → bytes) |
| `CONTRACT_PROPOSAL` | `version`, `contractId`, `chain.{parentRoot, merkleRoot, leafHashes}`, `statePatch`, `messages` (JSON, so the Merkle check reads the same values), `psbt.proposalBase64` (bytes) |

Hashes (`…Hex`, `contentHash`) are 32 raw bytes behind a length prefix, so an
absent one costs 4 bytes. Integers are `u8` (hops, TTL), `u32` (indexes,
pages, frame caps) or `u64` (sats, millisecond times; safe integers only).
Envelope keys outside `object` (`type`, `actor`, `target`) and keys like
Hub's `reason` or `hashes` ride in `extra`. Decoded objects list the extra keys
first, then the table's keys, so top-level key order can differ from the
sender's; values inside `extra` and `items` keep theirs. Nothing hashes these
objects in key order (unlike `CONTRACT_PUBLISH`).

Core's `Peer` sends all seven as fields, the session handshake included, and
still reads JSON bodies of them (the generic Peer path, `DOCUMENT_PUBLISH`,
and `DOCUMENT_REQUEST` all go through the legacy-body codec). A core without
these layouts can't read the handshake, so it can't open a session.

`DOCUMENT_PUBLISH` is the one with a payment binding: an unsealed document's
purchase hash comes from the unsigned field frame
`documentPublishEnvelopeBuffer` *rebuilds* from the decoded values
(`purchaseContentHashHex`; byte layout in
[bip-fabric-file-exchange.md](./bip-fabric-file-exchange.md#unsealed-commitments)),
never from the bytes received, so every copy of a document has the same
purchase hash and registration key. Peer gossips that same frame signed: only
the author and signature differ. The content travels as raw bytes, about a
quarter smaller than base64.

`hex` is a key kind for lowercase even-length hex of any size, stored as raw
bytes (half the size of the hex text).

Peer reads `BITCOIN_BLOCK` and `CONTRACT_PROPOSAL` in
either encoding; the `bitcoinBlock` event now carries the parsed `object`.
Core sends `CONTRACT_PROPOSAL` (`createContractProposalMessage`) as
fields. The ZMQ service builds Bitcoin messages locally
and does not put them on the wire, so it is unchanged.

`P2P_SESSION_ACK` has no layout: no code sends one and nothing reads it.
`P2P_FILE_SEND` waits on the repricing question in the migration plan.

## Peer sends no JSON bodies

Since 2026-11-05 every frame `Peer` originates uses a field layout:

| Opcode | Dec | Keys with their own field |
|--------|-----|---------------------------|
| `P2P_FILE_SEND` | 89 | `name`, `body` (raw blob bytes, base64 in the legacy object), `blobIndex`, `blobTotal`, `blobHashHex`, `merkleRootHex`, `chunkBytes`, `contentSha256`, `sealed`, `perBlob`, `paymentHashHex`, `iv`, `scheme`, `routeId`, `relayedBy`, `deliveryFabricId`, `fileRelayTtl`, `proof` (JSON) |
| `P2P_CHAIN_SYNC_REQUEST` | 85 | `v`, `reason`, `requester`, `at`, `tip` |
| `DOCUMENT_KEY_REVEAL` | 1000 | `documentId`, `keyHex`, `paymentHashHex`, `iv`, `scheme`, `plaintextSha256`, `settlementId`, `blobIndex`, `routeId` |
| `DOCUMENT_BLOB_QUOTE` | 1001 | `documentId`, `merkleRootHex`, `blobIndex`, `blobHashHex`, `keyHashHex`, `paymentHashHex`, `wrappedKeyHex`, `amountSats`, `expiresAt`, `routeId` |
| `DOCUMENT_BLOB_BATCH` | 1002 | `documentId`, `merkleRootHex`, `start`, `end`, `paymentHashHex`, `amountSats`, `expiresAt`, `blobs` (JSON key wraps), `routeId` |

The three `DOCUMENT_*` opcodes are new: key reveals, blob quotes and blob
batches used to ride `GenericMessage` JSON. Their friendly names are the old
inner types (`DocumentContentKeyReveal`, `DocumentBlobQuote`,
`DocumentBlobBatch`), and their legacy shape is the same `{ type, object }`
body, so the handlers did not change. A `GenericMessage` / `P2P_BASE_MESSAGE`
carrying one of those inner types is now dropped with a warning. A file-send
frame is about a third smaller than its JSON form, so blob prices
(`HTLC_MINIMUM_SATS` per blob) buy more bytes; per-blob pricing is unchanged.

`@fabric/http` keepalives are field frames too: the server and bridge send
`P2P_PING` / `P2P_PONG` with `{ nonce }` (the sender's clock), and a client's
text `{"type":"HEARTBEAT"}` is carried as a `P2P_PING` field frame. ZMQ
notifications (`services/zmq`) are `BITCOIN_*` field frames, read back by
`Bitcoin#_handleZMQMessage`.

`GenericMessage` stays JSON: it is the Hub ↔ browser carrier, and Peer only
dispatches or relays it (inventory it relays without the original frame is
rebuilt as `P2P_INVENTORY_*` fields; anything else is not relayed).

## `Message` refuses silent fallbacks

- An unregistered type **name** throws `Unknown message type` (it used to
  become `P2P_BASE_MESSAGE`). Numeric opcodes are still written as given.
  Code that relied on the fallback now names `P2P_BASE_MESSAGE` explicitly.
- A plain-object body for a type with a field layout throws: build it with
  `Message.fromLegacyBody` or `Message.fromFields`. A JSON **string** body is
  still accepted, as the explicit way to build replay and negative-test
  frames; Peer drops those on receive.
- `Message.fromFields` throws for a name-only schema (`FabricProgramRun`).

## `sensitive` is not encryption

`Message` constructor option / property `sensitive: true`:

- Forces the wire header `preimage` to zeros (and will not invent
  `SHA256(body)` as a payment secret).
- Does **not** encrypt, seal, or redact the body bytes.

Peers and relays that handle the frame still observe the body. For
confidentiality use sealed document delivery, tip-bound chat seals, or
application-layer crypto — see [PRIVACY.md](../PRIVACY.md).

## Deprecated / legacy paths (still handled)

These remain accepted where needed for Hub / older peers, but are **deprecated**
for new code toward the `0x01` / 0.1.x pre-release:

| Legacy | Prefer |
|--------|--------|
| 176-byte header sketches (no `preimage` field) | 208-byte V1 header under version `0x01` |
| Defaulting wire `preimage` to SHA256(body) | Zero preimage for public frames; explicit 32-byte secret only for HTLC/circuit |
| First-class mesh/session types inside `P2P_BASE_MESSAGE` / `GENERIC_MESSAGE` JSON | First-class AMP opcodes (`P2P_SESSION_*`, `P2P_CHAT_MESSAGE`, …) |
| Message constructor `@type` / `@data` | `type` / `data` |
| JSON-stringified object bodies for types with registered field schemas | `Message.fromFields` / typed field layouts |
| Legacy inventory JSON `type: 'INVENTORY_REQUEST'` via base carrier | `P2P_INVENTORY_REQUEST` when originating new traffic (base carrier still accepted) |

## Not the same as content-address digests

Canonical JSON used for **Actor / sidechain document / Program digests**
(`fabricCanonicalJson`) is a separate concern from Message **wire bodies**.
Do not conflate the two.

## Migration
Plan for moving Fabric AMP message bodies off JSON onto the typed field
layouts described above. Written for the
agents and maintainers who carry out the later phases: each phase lists its
work by repository and file, what "done" means, and the questions still open.

The wire version stays `0x01` throughout. Schemas only ever grow by appending
optional fields, which old decoders ignore.

```text
Phase 1  core, 8 types with a schema        done (2026-10-24)
Phase 2  downstream senders and readers     next
Phase 3  schemas for the 17 types without   13 in (2026-10-30, 2026-11-03); 4 left
Phase 4  unregistered names, legacy opcodes done (2026-11-03)
Phase 5  decoder requires fields            done (2026-11-03), no deprecation window
```

### Status
All 76 registered opcodes (`WIRE_TYPE_DECODE_ORDER` in `types/message.js`),
as of Phase 1.

| Status | Meaning | Opcodes |
|--------|---------|---------|
| **Typed fields** (7) | Schema registered; every originator uses `Message.fromFields`. | `P2P_FORWARD` `0x45`, `P2P_MUSIG_START` `0x4220`, `P2P_MUSIG_ACCEPT` `0x4221`, `P2P_MUSIG_RECEIVE_COUNTER` `0x4222`, `P2P_MUSIG_SEND_PROPOSAL` `0x4223`, `P2P_MUSIG_REPLY_TO_PROPOSAL` `0x4224`, `P2P_MUSIG_ACCEPT_PROPOSAL` `0x4225` |
| **Raw bytes, by design** (3) | No schema on purpose: UTF-8 text or a raw inner frame. | `P2P_CHAT_MESSAGE` `0x68`, `P2P_PEER_ALIAS` `0x5b`, `P2P_RELAY` `0x43` |
| **Core sends fields; downstream still JSON** (8, Phase 1) | Core senders use `Message.fromLegacyBody`; every receiver accepts both. Hub, GoonCitizen and goon.vc still send JSON. | `P2P_PING` `0x12`, `P2P_PONG` `0x13`, `P2P_PEER_ANNOUNCE` `0x5c`, `P2P_PEER_GOSSIP` `0x61`, `P2P_PEERING_OFFER` `0x62`, `CONTRACT_PUBLISH` `0x5f`, `CONTRACT_MESSAGE` `0x60`, `SIDECHAIN_STATE_PATCH` `0x3e5` |
| **Core sends fields** (7, Phase 3) | Keyed layout registered and mapped; core's Peer sends fields, the session handshake included, and reads both. Cores without the layouts are not supported. | `P2P_SESSION_OFFER` `0x5d`, `P2P_SESSION_OPEN` `0x5e`, `P2P_INVENTORY_REQUEST` `0x57`, `P2P_INVENTORY_RESPONSE` `0x58`, `P2P_DOCUMENT_PUBLISH` `0x5a`, `DOCUMENT_PUBLISH` `0x3e6`, `DOCUMENT_REQUEST` `0x3e7` |
| **Needs a schema** (4) | Mesh traffic with a JSON body and no schema. `P2P_FILE_SEND` waits on open question 4; the other three have no originator (Phase 4 candidates). | `P2P_SESSION_ACK` `0x4200`, `P2P_FILE_SEND` `0x59`, `P2P_INSTRUCTION` `0x20`, `P2P_STATE_COMMITTMENT` `0x32` |
| **Schema; readers in core** (5, Phase 3, 2026-11-03) | Keyed layout registered; Peer reads both encodings. Core sends `CONTRACT_PROPOSAL` as fields; Hub still sends `BitcoinBlock` and `ContractProposal` as JSON. | `BITCOIN_BLOCK` `0x5208`, `BITCOIN_BLOCK_HASH` `0x526c`, `BITCOIN_TRANSACTION` `0x55f0`, `BITCOIN_TRANSACTION_HASH` `0x5654`, `CONTRACT_PROPOSAL` `0x8a` |
| **JSON at the edge, by design** (5) | Hub / `@fabric/http` carriers where JSON is the intended body. | `JSON_CALL` `0x3e80`, `JSON_PATCH` `0x400`, `GENERIC_MESSAGE` `0x3aff`, `CHAT_MESSAGE` `0x67`, `P2P_MESSAGE_RECEIPT` `0x44` |
| **Deprecated** (14, Phase 4) | Decode only; Peer counts and warns (`Message.DEPRECATED_WIRE_TYPES`). Removed in a later protocol version. | `P2P_GENERIC` `0x80`, `P2P_STATE_REQUEST` `0x29`, `P2P_TRANSACTION` `0x39`, `LOG_MESSAGE` `0xc0d49070`, `GENERIC_LIST` `0xc0d4c76e`, `BLOCK_CANDIDATE` `0x3`, `P2P_IDENT_REQUEST` `0x1`, `P2P_IDENT_RESPONSE` `0x11`, `P2P_STATE_ROOT` `0x30`, `P2P_STATE_CHANGE` `0x33`, `P2P_CALL` `0x42`, `PEER_CANDIDATE` `0x9`, `SESSION_START` `0x2`, `P2P_START_CHAIN` `0x21` |
| **Legacy, in use** (2) | JSON bodies; still sent by Hub. | `P2P_BASE_MESSAGE` `0x31`, `P2P_CHAIN_SYNC_REQUEST` `0x55` |
| **Lightning, reserved** (20) | `0x2000`–`0x2013`; registered, no body codec, no core originator. | `LIGHTNING_INIT` … `LIGHTNING_PONG` |

#### Names that are not in the catalog
`Message.fromVector` resolves an unknown name to `P2P_BASE_MESSAGE` (`0x31`).
None of these were ever sent to peers; Phase 4 settled each one:

| Name | Now |
|------|-----|
| `BEACON_EPOCH` | no frame; entry id is `epochEntryId(payload)` (`types/beacon.js`) |
| `CONTRACT_GENESIS` | unchanged: signed frame stored in the definition (`types/contract.js`) |
| `COMMIT` | plain `{ type, id, state, signatures }` record (`types/filesystem.js`) |
| `PostedExchangeOrder` | plain `{ type, object }` event (`services/exchange.js`) |
| `FabricProgramRun` | name-only schema for `encodeBody`; `fromFields` refuses it |

### Phase 1 — core, eight types with a schema (done)
What changed is in `CHANGELOG.md` (2026-10-24) and the mapping is documented
in [MESSAGE_BODY.md](#legacy-json-objects--fields). In short:

- `Message` statics map the legacy JSON object of each of the eight types
  to fields and back (`Message.fromLegacyBody`, `encodeLegacyBody`,
  `decodeLegacyBody`, `tryParseLegacyBody`). Older pins have them in
  `functions/fabricMessageBodies.js` as `buildMessage`, `encodeLegacyBody`,
  `decodeToLegacyBody`, `tryParseLegacyBody`; that module is gone.
- `Peer` rebuilds the legacy object from field bodies before its checks and
  events, so app handlers did not change. Dedup and registration keys hash a
  canonical object.
- Core's own senders use fields: keepalive ping/pong (fresh nonce per ping),
  `Contract#deploy` / `Contract#commit`, `buildSignedSidechainPatchMessage`.
- Tests: `tests/types.message.legacyBody.js`, the field-encoded fixture variant in
  `tests/fabric.hub.mesh.integration.js`, and the updated sidechain tests.

Verified on 2026-10-24: `npm run ci` in core (2960 passing). GoonCitizen
`test:unit` (532 of 539) and `test:relay` (520 of 528), linked to this core,
pass every peer, chat, group and contract test. The 13 failures are in code
these changes don't touch: fabric-http device-link session ids, document
pricing, `MarketManager`, the path inventory and the seed list.

### Phase 2 — downstream senders and readers
Goal: every app sends these eight types as fields and reads raw bodies with
`Message.tryParseLegacyBody`. Readers go first, then senders, repository by
repository, and only after the [rollout](#rollout-order) prerequisites hold.

The sender change is usually one line:

```js
// before
Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify(body)])
// after
Message.fromLegacyBody('CONTRACT_MESSAGE', body)
```

#### Readers (do these first)
Code that `JSON.parse`s a raw body of one of the eight types breaks on a field
frame. Replace the parse with `tryParseLegacyBody(message)` (or
`decodeLegacyBody` when it already has decoded fields).

| Repository | Where | Today |
|------------|-------|-------|
| GoonCitizen | `functions/fabricMessageLog.js:263` | `JSON.parse` of the body text for the log view |
| GoonCitizen | `functions/groupShareMessage.js:329` | `JSON.parse` of a `fabric:` clip body |
| Hub | `functions/fabricMessageRegistry.js` | **Done (2026-11-02):** mapped types are `fields-legacy-json`; the `fabric:` viewer previews field bodies as JSON. Peer-event readers needed no change. |
| fabric-http | `functions/messageBodyJsonBridge.js` | **Done (2026-11-02):** `messageBodyToJson` adds `legacy` for all 15 mapped types (either encoding); `messageFromLegacyJson` builds field frames. |
| Passport | `src/fabric/fabricWireNotify.ts:55`, `src/fabric/messageTypes.ts` | `JSON.parse` of contract bodies for notifications |

#### Senders
| Repository | Where | Type |
|------------|-------|------|
| Hub | `services/hub.js` peering offer broadcast | `P2P_PEERING_OFFER` — **done (2026-11-02)** |
| Hub | `functions/identityClusterHttp.js` | `CONTRACT_MESSAGE` (`IdentityCrossSign`) — removed from Hub |
| Hub | `services/challenge.js`, `services/market.js`, `services/hub.js` `_publishContractMessage`, inventory envelopes | `CONTRACT_MESSAGE`, `P2P_INVENTORY_*` — **done (2026-11-02)** |
| Hub | `scripts/lib/playnetOps.js` | `CONTRACT_PUBLISH` — Hub no longer publishes; application repos do |
| GoonCitizen | `services/FabricNetwork.js:608` (`_signMessage`; contract sends at `:683`) | every contract message the app sends |
| GoonCitizen | `services/FabricNetwork.js:1262-1275` | `P2P_PEERING_OFFER` (carries `rendezvous`, see the open questions) |
| GoonCitizen | `functions/clusterSync.js:291` | `CONTRACT_MESSAGE` (`DeviceDataShare`) |
| GoonCitizen | `scripts/playnet-deploy-gooncitizen.js:250`, `functions/playnetOpsSweep.js:174` | `CONTRACT_PUBLISH` |
| goon.vc | `services/fabricRelay.js:376` | `CONTRACT_MESSAGE` (`GroupDataShare`) |
| Sensemaker | `services/sensemaker.js` | `CONTRACT_PUBLISH` handling; check for senders |

Size budgets: a field `CONTRACT_MESSAGE` is the JSON body without `contract`
plus two `u32` length prefixes and the contract id, so it is never more than a
few bytes larger. Packers that budget against `MAX_MESSAGE_SIZE`
(goon.vc `MAX_PACK_BYTES` = 24 KiB, GoonCitizen `deviceDataSync`
`AMP_ENVELOPE_RESERVE`) still have room, but re-measure the largest pack.

#### Pins
Every app must run a core that has Phase 1 before it sends fields. Today:

| Repository | `@fabric/core` pin | Locked commit | Has Phase 1 |
|------------|--------------------|---------------|-------------|
| Hub | `FabricLabs/fabric#feature/passport` | — | yes |
| fabric-http | `FabricLabs/fabric#feature/passport` | — | yes |
| GoonCitizen | `github:FabricLabs/fabric#feature/rsi` | `83eeda7`; dev links `~/fabric-clean` | no |
| Passport | `github:FabricLabs/fabric#feature/rsi` | `8092ba8` | no |
| Sensemaker | `file:../fabric-clean` | working tree | yes, once committed |

Bump core in Hub and fabric-http together (they depend on each other), then
GoonCitizen and Passport, as the coordinated pin move the release posture
describes. The deployed Hub's core (`bb007a7`) also predates Phase 1.

### Phase 3 — schemas for the 17 types without one
Write a schema for each type and its `encodeLegacyBody` / `decodeLegacyBody`
mapping (add it to `LEGACY_BODY_TYPES`), then switch the senders.

**Done (2026-10-30): session, inventory and documents.** Seven types have a
keyed layout ([MESSAGE_BODY.md](#keyed-layouts-session-inventory-documents)):
a `present` bitmask, one field per key the readers use, and `extra` for every
other key, so Hub envelopes and app keys (`mainchain` kinds, relay TTL, HTLC
terms) survive the round trip. Unlike the Phase 1 types, nothing is dropped.
Receivers in core accept both encodings: the generic Peer path through
`LEGACY_BODY_TYPES`, and the `DOCUMENT_PUBLISH` / `DOCUMENT_REQUEST` handlers
through `tryParseLegacyBody`. Payment hashes and registration keys match
across encodings (`tests/types.message.legacyBody.js`).

**Senders switched in core.** Peer sends all seven with
`Message.fromLegacyBody`: the session offer and open, inventory requests and
responses (including relayed ones), both `DOCUMENT_REQUEST` senders, and the
`DOCUMENT_PUBLISH` / `P2P_DOCUMENT_PUBLISH` pair. Core is the reference
implementation, so older cores are not a constraint: one without these
layouts drops the field bodies ("parse failed") and can't complete the
handshake. The unsigned envelope behind an unsealed purchase hash
(`documentPublishEnvelopeBuffer`) is the same field frame unsigned, so
unsealed purchase hashes changed with it; the file-exchange BIP's layout and
test vectors follow. Sealed and per-blob payment hashes don't involve it.

**Done (2026-11-03): Bitcoin, contract proposals, chain flush.** Six more
keyed layouts. A new `hex` key kind stores raw blocks and transactions as
bytes. `CONTRACT_PROPOSAL` keeps `messages` as one JSON field rather than
nested `message` fields: the Merkle check hashes each entry's decoded wire
bytes, so either works, and JSON keeps `leafHash` beside each frame. Hub
readers of `bitcoinBlock` use the event's parsed `object`; Hub senders of
`BitcoinBlock` and `ContractProposal` switch once the seeds run this core.

| Group | Types | Notes |
|-------|-------|-------|
| Session | `P2P_SESSION_OFFER`, `P2P_SESSION_OPEN` (done), `P2P_SESSION_ACK` | `P2P_SESSION_ACK` has no originator and no reader, so it has no layout: give it one when something sends it, or move it to Phase 4. |
| Inventory | `P2P_INVENTORY_REQUEST`, `P2P_INVENTORY_RESPONSE` (done) | `items` is one JSON string field (offer rows nest proofs and leaves), so the page arithmetic (`DocumentBook.paginateInventoryItems`, which measures JSON) still holds: a page's other fields take about 60 bytes, well under the 256-byte reserve. |
| Files and documents | `P2P_DOCUMENT_PUBLISH`, `DOCUMENT_PUBLISH`, `DOCUMENT_REQUEST` (done); `P2P_FILE_SEND` | `DOCUMENT_PUBLISH` carries the content as raw bytes; its purchase hash is rebuilt from the decoded values, so every copy agrees. `P2P_FILE_SEND` waits on open question 4. |
| Contracts | `CONTRACT_PROPOSAL` (done) | Keyed layout; `messages` stays one JSON field. |
| Control | `P2P_INSTRUCTION`, `P2P_STATE_COMMITTMENT` (`P2P_FLUSH_CHAIN` was removed in V1) | The last two have no core originator: a schema, or move them to Phase 4. |
| Bitcoin | `BITCOIN_BLOCK`, `BITCOIN_BLOCK_HASH`, `BITCOIN_TRANSACTION`, `BITCOIN_TRANSACTION_HASH` (done) | Keyed layouts; `content` is raw bytes (`hex` kind). Hub's tip gossip keys (`tip`, `height`, `network`, `at`) have fields; `supply` rides in `extra`. |

### Phase 4 — unregistered names and legacy opcodes (done 2026-11-03)
No opcodes were added: none of the unregistered names ever reached the wire.

- **`BEACON_EPOCH`**: the Beacon built a signed frame only to take its hash as
  the `beacon/CHAIN` entry id. Entries now use `epochEntryId` (double-SHA256
  of the epoch's canonical JSON), so ids are deterministic. Stored entries
  keep their ids; chain links only compare ids, so old chains still load.
- **`COMMIT`**: `Filesystem#commit` emits a plain record
  `{ type: 'COMMIT', id, state, signatures }`; `id` is the state digest and
  the signature (when the key can sign) covers it. Every `commit` listener
  only logs.
- **`CONTRACT_GENESIS`**: unchanged. The author-signed frame is stored hex in
  the contract definition (`messages[genesis]`), and its hash is the genesis
  id; it is a stored record, not traffic.
- **`PostedExchangeOrder`**: `services/exchange.js` emits a local
  `{ type, object }` event instead of a frame.
- **`FabricProgramRun`**: still registered by name for `encodeBody` /
  `decodeBody`. `Message.fromFields` now throws for any name that has a
  schema but no opcode, instead of building a `P2P_BASE_MESSAGE` frame no one
  can decode.
- **Deprecated opcodes**: `Message.DEPRECATED_WIRE_TYPES` lists the 14
  registered opcodes nothing sends or handles. They still decode; Peer counts
  them (`Peer#deprecatedWireTypeCounts()`) and warns on the first of each type
  and every 100th. `P2P_BASE_MESSAGE` and `P2P_CHAIN_SYNC_REQUEST` are still
  in use and stay off the list. `P2P_SESSION_ACK`, `P2P_INSTRUCTION` and
  `P2P_STATE_COMMITTMENT` stay registered without a schema until something
  sends them. Removal waits for a protocol version bump.

### Phase 5 — require fields (done 2026-11-03)
Enforced now, ahead of the original preconditions, by owner decision: the
deprecation window was skipped.

- Peer drops a frame whose type has a field layout (`Message.LEGACY_BODY_TYPES`,
  21 types) when its body is JSON, before any handler, without penalty. It
  counts drops per type (`Peer#jsonBodyCounts()`) and warns on the first of
  each type and every 100th, naming `Message.fromLegacyBody` as the fix.
- There is no opt-out: the `acceptJsonBodies` setting is gone, so old JSON
  frames can't be replayed over the wire.
- Stored frames still replay: `Message.tryParseLegacyBody`,
  `fabricMessageCollection`, `contractMessageAccumulate` and the queue read
  JSON frames unchanged. The committed JSON fixture chain
  (`tests/fixtures/application-contract-chain.json`) is now the negative test:
  a Peer registers nothing from it, while the stored chain still folds to the
  same tip.
- Types without a layout (`P2P_CHAIN_SYNC_REQUEST`, `P2P_BASE_MESSAGE`,
  `P2P_FILE_SEND`, the edge JSON types) keep JSON bodies.
- Hub sends `BitcoinBlock`, `ContractProposal` and WebRTC-relayed frames of
  these types as fields. Browsers still get JSON over WebSocket.

**Breaks:** GoonCitizen, goon.vc, Passport and Hubs or seeds on an older core
still send JSON for some of these types. A peer on this core drops those
frames until each switches senders (Phase 2 table). Watch `jsonBodyCounts()`
on the seeds.

### Rollout order
1. **Ship Phase 1 core to the seeds first.** `hub.fabric.pub` and
   `relay.goon.vc` must run a core that unpacks field bodies before any app
   sends field contract frames. The pinned cores (`8092ba8`, `83eeda7`,
   `bb007a7`, `1ba3b3c`) already have the ping, gossip, offer, announce,
   publish and message schemas, so they decode field frames, but they do not
   rebuild the legacy object. For them a field `CONTRACT_PUBLISH` is a
   definition of `{ definition: "<json>" }`, which gives a different namespace
   id, and a field `CONTRACT_MESSAGE` has no `type` or `ops`. Field ping,
   pong, gossip, offer and announce frames are safe on old cores, because
   their field names match the JSON keys.
2. **Then upgrade every reader** (Phase 2 readers table).
3. **Then switch senders,** one app at a time, starting with the low-traffic
   ones (deploy scripts, `identityClusterHttp`) and leaving GoonCitizen
   `_signMessage` until last.
4. **Watch for drops.** Peer logs a warning and skips a field body that
   `decodeLegacyBody` can't map. A rising count after a sender switch means
   a peer is sending a shape the mapping doesn't know.

### Risks

- **Frame hashes change.** A field frame and a JSON frame of the same body
  are different bytes, so they have different hashes and ids. Anything keyed
  by frame hash sees two messages: journals, `FabricMessageCollection`s,
  GoonCitizen's `fabricMessage.hex` journal rows, `MessageReceived` /
  `MessageReceipt` targets, and the Hub's opaque contract message queue. Peer
  dedup and registration keys are encoding-independent; these are not.
- **Accumulate order can flip.** `contractMessageAccumulate` sorts entries by
  message hash. Re-encoding a chain changes every hash, so two non-commuting
  ops (for example two `members.set` frames in one round) can fold in the
  other order. The field fixture test in `tests/fabric.hub.mesh.integration.js`
  shows this for the generic application chain. Don't re-encode a stored
  chain; a sender should pick one encoding per frame and keep it.
- **`Actor` ids depend on key order.** `CONTRACT_PUBLISH` carries
  `JSON.stringify(definition)`, not canonical JSON, so the namespace id is the
  same for both encodings. A sender that rebuilds the definition with
  different key order gets a different id, whatever the encoding.
- **Stricter sidechain input.** `buildSignedSidechainPatchMessage` throws
  `TypeError` for a `basisDigest` that is not 64 lowercase hex (or empty). It
  used to sign anything.
- **Keys outside a schema are dropped** (Phase 1 types only). A field offer
  loses keys the schema doesn't have, such as GoonCitizen's `rendezvous`.
  Readers that relied on them get `undefined`. The keyed layouts carry such
  keys in `extra` instead.
- **Contract objects are held by reference.** `Actor` keeps a live reference,
  so mutating a definition after taking its id changes the id.
  `Contract#deploy` now copies `messages` for this reason; apps that build a
  publish body and then mutate it can hit the same bug.

### Checklists

#### Phase 2, per repository

- [ ] The core pin has Phase 1 (`Message.fromLegacyBody`, or `functions/fabricMessageBodies.js` on older pins).
- [ ] Every raw-body `JSON.parse` of the eight types goes through
      `tryParseLegacyBody`.
- [ ] Every sender of the eight types uses `Message.fromLegacyBody` (`buildMessage` on older pins).
- [ ] The app's own tests pass with field frames, and a JSON frame from an old
      peer is still accepted.
- [ ] Stored journals / collections replay unchanged (old JSON frames stay JSON).
- [ ] Pack size budgets re-measured with field frames.

#### Phase 3, per type

- [ ] Schema appended in `types/message.js` and registered under the opcode,
      the wire name and any friendly alias.
- [ ] Mapping in the legacy-body codec in `types/message.js`, with a round-trip test.
- [ ] Peer accepts both encodings; dedup keys are encoding-independent.
- [ ] Senders switched in core, then downstream (as in Phase 2).
- [ ] `MESSAGES.md`, `MESSAGE_BODY.md` and this table updated.

#### Phase 5

- [ ] No downstream sender of a schema type still sends JSON (check the
      drop/warn counters on the seeds).
- [ ] Stored-frame replay keeps a JSON decode path.
- [ ] Announced deprecation window has passed.

### Open questions

1. **GoonCitizen's `rendezvous` in offers.** `FabricNetwork.js:1271` puts
   `rendezvous: { hubs }` on its peering offer. Should it be a schema field
   (a canonical-JSON `string`), move to the GoonCitizen `PeerProfile`, or be
   dropped? Until decided, a field offer drops it.
2. **Inner type of `Contract#commit`.** It now sends
   `type: 'ContractMessage'` (`LOG_TYPES.ContractMessage`), since
   `APPLICATION_NAMESPACES.md` had no type for a generic `ops` commit. Is that
   the right name, or should generic ops commits get their own body type?
3. **Session offers.** Settled (2026-10-30): `P2P_SESSION_OFFER` / `OPEN` are
   fields; a legacy peer that can't read the handshake is not supported.
4. **Base64 in file sends.** Is the blob-size win from a `bytes` field in
   `P2P_FILE_SEND` worth re-pricing documents, given that blob prices are
   per-blob (`HTLC_MINIMUM_SATS` floor) and more data fits in a frame?
5. **Deprecation window.** How long after Phase 2 lands everywhere should
   JSON stay accepted on the wire: a fixed date, a core version, or a seed
   counter reaching zero?

## Related

- [`MESSAGES.md`](../MESSAGES.md) — opcode catalog
- [`C-JS-PARITY.md`](./C-JS-PARITY.md) — header / hash / sign parity
- Hub `MESSAGE_TRANSPORT.md` — browser bridge (JSON at HTTP edge)
