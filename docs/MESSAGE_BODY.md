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
- **Opaque UTF-8 exceptions:** `P2P_CHAT_MESSAGE` and `P2P_PEER_ALIAS` use the
  body bytes as the UTF-8 text / nickname itself (no field schema, no JSON).
  Build with `Message.fromVector(['P2P_CHAT_MESSAGE', text])` (string body).

## Legacy JSON objects ↔ fields

[`functions/fabricMessageBodies.js`](../functions/fabricMessageBodies.js) maps
the JSON objects apps already build onto the field schemas of eight opcodes,
and back:

- `buildMessage(type, body)` — field-encoded `Message` from the legacy object.
  Replaces `Message.fromVector([type, JSON.stringify(body)])` one for one.
- `encodeLegacyBody(type, body)` / `decodeToLegacyBody(type, fields)` — the
  two halves of that mapping.
- `tryParseLegacyBody(message)` — the legacy object from either encoding.

Peer runs `decodeToLegacyBody` on every field body of these types before its
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
| `CONTRACT_MESSAGE` | `contract`, `payload` | `{ contract, ...payload }`; `payload` is `JSON.stringify` of the body without `contract` |
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
still sends JSON, and JSON bodies of all eight types are still accepted. The
remaining phases are in [MESSAGE_BODY_MIGRATION.md](./MESSAGE_BODY_MIGRATION.md).

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

## Related

- [`MESSAGES.md`](../MESSAGES.md) — opcode catalog
- [`C-JS-PARITY.md`](./C-JS-PARITY.md) — header / hash / sign parity
- Hub `MESSAGE_TRANSPORT.md` — browser bridge (JSON at HTTP edge)
