# Message body migration
Plan for moving Fabric AMP message bodies off JSON onto the typed field
layouts described in [MESSAGE_BODY.md](./MESSAGE_BODY.md). Written for the
agents and maintainers who carry out the later phases: each phase lists its
work by repository and file, what "done" means, and the questions still open.

The wire version stays `0x01` throughout. Schemas only ever grow by appending
optional fields, which old decoders ignore.

```text
Phase 1  core, 8 types with a schema        done (2026-10-24)
Phase 2  downstream senders and readers     next
Phase 3  schemas for the 17 types without   after Phase 2
Phase 4  unregistered names, legacy opcodes any time
Phase 5  decoder requires fields            last, after a deprecation window
```

## Status
All 76 registered opcodes (`WIRE_TYPE_DECODE_ORDER` in `types/message.js`),
as of Phase 1.

| Status | Meaning | Opcodes |
|--------|---------|---------|
| **Typed fields** (7) | Schema registered; every originator uses `Message.fromFields`. | `P2P_FORWARD` `0x45`, `P2P_MUSIG_START` `0x4220`, `P2P_MUSIG_ACCEPT` `0x4221`, `P2P_MUSIG_RECEIVE_COUNTER` `0x4222`, `P2P_MUSIG_SEND_PROPOSAL` `0x4223`, `P2P_MUSIG_REPLY_TO_PROPOSAL` `0x4224`, `P2P_MUSIG_ACCEPT_PROPOSAL` `0x4225` |
| **Raw bytes, by design** (3) | No schema on purpose: UTF-8 text or a raw inner frame. | `P2P_CHAT_MESSAGE` `0x68`, `P2P_PEER_ALIAS` `0x5b`, `P2P_RELAY` `0x43` |
| **Core sends fields; downstream still JSON** (8, Phase 1) | Core senders use `buildMessage`; every receiver accepts both. Hub, GoonCitizen and goon.vc still send JSON. | `P2P_PING` `0x12`, `P2P_PONG` `0x13`, `P2P_PEER_ANNOUNCE` `0x5c`, `P2P_PEER_GOSSIP` `0x61`, `P2P_PEERING_OFFER` `0x62`, `CONTRACT_PUBLISH` `0x5f`, `CONTRACT_MESSAGE` `0x60`, `SIDECHAIN_STATE_PATCH` `0x3e5` |
| **Needs a schema** (17, Phase 3) | Mesh traffic with a JSON body and no schema. | `P2P_SESSION_OFFER` `0x5d`, `P2P_SESSION_OPEN` `0x5e`, `P2P_SESSION_ACK` `0x4200`, `P2P_INVENTORY_REQUEST` `0x57`, `P2P_INVENTORY_RESPONSE` `0x58`, `P2P_FILE_SEND` `0x59`, `P2P_DOCUMENT_PUBLISH` `0x5a`, `DOCUMENT_PUBLISH` `0x3e6`, `DOCUMENT_REQUEST` `0x3e7`, `CONTRACT_PROPOSAL` `0x8a`, `P2P_INSTRUCTION` `0x20`, `P2P_STATE_COMMITTMENT` `0x32`, `P2P_FLUSH_CHAIN` `0x56`, `BITCOIN_BLOCK` `0x5208`, `BITCOIN_BLOCK_HASH` `0x526c`, `BITCOIN_TRANSACTION` `0x55f0`, `BITCOIN_TRANSACTION_HASH` `0x5654` |
| **JSON at the edge, by design** (5) | Hub / `@fabric/http` carriers where JSON is the intended body. | `JSON_CALL` `0x3e80`, `JSON_PATCH` `0x400`, `GENERIC_MESSAGE` `0x3aff`, `CHAT_MESSAGE` `0x67`, `P2P_MESSAGE_RECEIPT` `0x44` |
| **Legacy, unplanned** (16, Phase 4) | JSON or empty body, nothing plans to modernize them; deprecation candidates. | `P2P_BASE_MESSAGE` `0x31`, `P2P_GENERIC` `0x80`, `P2P_STATE_REQUEST` `0x29`, `P2P_TRANSACTION` `0x39`, `P2P_CHAIN_SYNC_REQUEST` `0x55`, `LOG_MESSAGE` `0xc0d49070`, `GENERIC_LIST` `0xc0d4c76e`, `BLOCK_CANDIDATE` `0x3`, `P2P_IDENT_REQUEST` `0x1`, `P2P_IDENT_RESPONSE` `0x11`, `P2P_STATE_ROOT` `0x30`, `P2P_STATE_CHANGE` `0x33`, `P2P_CALL` `0x42`, `PEER_CANDIDATE` `0x9`, `SESSION_START` `0x2`, `P2P_START_CHAIN` `0x21` |
| **Lightning, reserved** (20) | `0x2000`–`0x2013`; registered, no body codec, no core originator. | `LIGHTNING_INIT` … `LIGHTNING_PONG` |

### Names sent from core that are not in the catalog
`Message.fromVector` resolves an unknown name to `P2P_BASE_MESSAGE` (`0x31`),
so these go out as generic JSON frames:

| Name | Body | Where |
|------|------|-------|
| `BEACON_EPOCH` | JSON epoch | `types/beacon.js:338`, `:354` |
| `CONTRACT_GENESIS` | JSON genesis (hashed locally, not sent) | `types/contract.js:211` |
| `COMMIT` | serialized commit | `types/filesystem.js:459` |
| `PostedExchangeOrder` | object → JSON | `services/exchange.js:99` |
| `FabricProgramRun` | schema registered by name (`types/message.js:1487`), but decode looks up `0x31`, so the schema is never reached | — |

## Phase 1 — core, eight types with a schema (done)
What changed is in `CHANGELOG.md` (2026-10-24) and the mapping is documented
in [MESSAGE_BODY.md](./MESSAGE_BODY.md#legacy-json-objects--fields). In short:

- `functions/fabricMessageBodies.js` maps the legacy JSON object of each of
  the eight types to fields and back (`buildMessage`, `encodeLegacyBody`,
  `decodeToLegacyBody`, `tryParseLegacyBody`).
- `Peer` rebuilds the legacy object from field bodies before its checks and
  events, so app handlers did not change. Dedup and registration keys hash a
  canonical object.
- Core's own senders use fields: keepalive ping/pong (fresh nonce per ping),
  `Contract#deploy` / `Contract#commit`, `buildSignedSidechainPatchMessage`.
- Tests: `tests/fabricMessageBodies.js`, the field-encoded fixture variant in
  `tests/fabric.hub.mesh.integration.js`, and the updated sidechain tests.

Verified on 2026-10-24: `npm run ci` in core (2960 passing). GoonCitizen
`test:unit` (532 of 539) and `test:relay` (520 of 528), linked to this core,
pass every peer, chat, group and contract test. The 13 failures are in code
these changes don't touch: fabric-http device-link session ids, document
pricing, `MarketManager`, the path inventory and the seed list.

## Phase 2 — downstream senders and readers
Goal: every app sends these eight types as fields and reads raw bodies with
`tryParseLegacyBody`. Readers go first, then senders, repository by
repository, and only after the [rollout](#rollout-order) prerequisites hold.

The sender change is usually one line:

```js
// before
Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify(body)])
// after
const { buildMessage } = require('@fabric/core/functions/fabricMessageBodies');
buildMessage('CONTRACT_MESSAGE', body)
```

### Readers (do these first)
Code that `JSON.parse`s a raw body of one of the eight types breaks on a field
frame. Replace the parse with `tryParseLegacyBody(message)` (or
`decodeToLegacyBody` when it already has decoded fields).

| Repository | Where | Today |
|------------|-------|-------|
| GoonCitizen | `functions/fabricMessageLog.js:263` | `JSON.parse` of the body text for the log view |
| GoonCitizen | `functions/groupShareMessage.js:329` | `JSON.parse` of a `fabric:` clip body |
| Hub | `functions/fabricMessageRegistry.js:40-59` | lists `CONTRACT_MESSAGE` and the peering types as `utf8Json`; should say fields with JSON accepted |
| fabric-http | `functions/messageBodyJsonBridge.js` | maps only `SIDECHAIN_STATE_PATCH`; add the contract and peering types (JSON ↔ fields for REST and the browser). It re-registers the sidechain schema only when it has fewer than 4 fields, so the 5-field core schema is left alone |
| Passport | `src/fabric/fabricWireNotify.ts:55`, `src/fabric/messageTypes.ts` | `JSON.parse` of contract bodies for notifications |

### Senders
| Repository | Where | Type |
|------------|-------|------|
| Hub | `services/hub.js:14702` | `P2P_PEERING_OFFER` |
| Hub | `functions/identityClusterHttp.js:55` | `CONTRACT_MESSAGE` (`IdentityCrossSign`) |
| Hub | `services/challenge.js:685`, `services/market.js:143` | `CONTRACT_MESSAGE` (market namespace) |
| Hub | `scripts/lib/playnetOps.js`, `scripts/playnet-regtest-mesh-launch.js` | `CONTRACT_PUBLISH` |
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

### Pins
Every app must run a core that has Phase 1 before it sends fields. Today:

| Repository | `@fabric/core` pin | Locked commit | Has Phase 1 |
|------------|--------------------|---------------|-------------|
| Hub | `FabricLabs/fabric#feature/channels` | `1ba3b3c` | no (Phase 1 is uncommitted on top of it) |
| fabric-http | `FabricLabs/fabric#feature/channels` | `1ba3b3c` | no |
| GoonCitizen | `github:FabricLabs/fabric#feature/rsi` | `83eeda7`; dev links `~/fabric-clean` | no |
| Passport | `github:FabricLabs/fabric#feature/rsi` | `8092ba8` | no |
| Sensemaker | `file:../fabric-clean` | working tree | yes, once committed |

Bump core in Hub and fabric-http together (they depend on each other), then
GoonCitizen and Passport, as the coordinated pin move the release posture
describes. The deployed Hub's core (`bb007a7`) also predates Phase 1.

## Phase 3 — schemas for the 17 types without one
Write a schema for each type and its `encodeLegacyBody` / `decodeToLegacyBody`
mapping (add it to `LEGACY_BODY_TYPES`), then switch the senders.

| Group | Types | Notes |
|-------|-------|-------|
| Session | `P2P_SESSION_OFFER`, `P2P_SESSION_OPEN`, `P2P_SESSION_ACK` | Carry `maxFrameBytes` (frame cap negotiation). A legacy peer that can't decode fields must still get a frame it understands, so the offer may need to stay JSON until Phase 5. `P2P_SESSION_ACK` has no core originator. |
| Inventory | `P2P_INVENTORY_REQUEST`, `P2P_INVENTORY_RESPONSE` | Responses are paged by byte budget (`functions/inventoryPages`); a field layout changes the page arithmetic. Offer rows hold proofs and leaves: nested arrays, so a `string` field with canonical JSON (as with sidechain patches) is the likely shape. |
| Files and documents | `P2P_FILE_SEND`, `P2P_DOCUMENT_PUBLISH`, `DOCUMENT_PUBLISH`, `DOCUMENT_REQUEST` | `P2P_FILE_SEND` sends the blob as a JSON string today; a `bytes` field removes the base64 overhead (about a quarter of each blob frame). `DOCUMENT_PUBLISH` bodies are the canonical published-document envelope that seller signatures cover; keep that string intact. |
| Contracts | `CONTRACT_PROPOSAL` | Batched messages + Merkle root + JSON Patch + optional PSBT. The batched messages can be `message` fields. |
| Control | `P2P_INSTRUCTION`, `P2P_STATE_COMMITTMENT`, `P2P_FLUSH_CHAIN` | The first two have no core originator: a schema, or move them to Phase 4. |
| Bitcoin | `BITCOIN_BLOCK`, `BITCOIN_BLOCK_HASH`, `BITCOIN_TRANSACTION`, `BITCOIN_TRANSACTION_HASH` | `services/zmq.js:96-108` sends `{ content: hex }`. Raw bytes (`bytes` / `bytes32`) are the natural schema. |

## Phase 4 — unregistered names and legacy opcodes
- Give `BEACON_EPOCH` a real opcode, or send it under `CONTRACT_MESSAGE`.
  Beacon chains persisted under `beacon/CHAIN` hold these frames, so either way
  old chains must still load.
- `CONTRACT_GENESIS` and `COMMIT` are only hashed or stored locally. Use a
  plain buffer instead of a `Message`, or register them.
- `PostedExchangeOrder`: register it or move it under a contract namespace.
- `FabricProgramRun`: attach `SCHEMA_PROGRAM_RUN` to a real opcode so decode
  reaches it.
- Deprecate the legacy opcodes nothing sends (the "Legacy, unplanned" row):
  keep them decodable, warn on receive, and remove them in a later protocol
  version.

## Phase 5 — require fields
Once Phase 2 is done everywhere and the deprecation window has passed,
`tryParseMessageBody` stops trying JSON first for opcodes that have a schema,
and Peer drops JSON bodies of those types (counted, not penalized at first).
The JSON fixture chain (`tests/fixtures/application-contract-chain.json`) then
becomes a negative test. Any stored journal, collection or Beacon chain that
holds JSON frames still has to replay; keep a JSON decode path for replay of
stored frames even after the wire rejects them.

## Rollout order
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
   `decodeToLegacyBody` can't map. A rising count after a sender switch means
   a peer is sending a shape the mapping doesn't know.

## Risks

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
- **Keys outside a schema are dropped.** A field offer loses keys the schema
  doesn't have, such as GoonCitizen's `rendezvous`. Readers that relied on
  them get `undefined`.
- **Contract objects are held by reference.** `Actor` keeps a live reference,
  so mutating a definition after taking its id changes the id.
  `Contract#deploy` now copies `messages` for this reason; apps that build a
  publish body and then mutate it can hit the same bug.

## Checklists

### Phase 2, per repository

- [ ] The core pin has Phase 1 (`functions/fabricMessageBodies.js` exists).
- [ ] Every raw-body `JSON.parse` of the eight types goes through
      `tryParseLegacyBody`.
- [ ] Every sender of the eight types uses `buildMessage`.
- [ ] The app's own tests pass with field frames, and a JSON frame from an old
      peer is still accepted.
- [ ] Stored journals / collections replay unchanged (old JSON frames stay JSON).
- [ ] Pack size budgets re-measured with field frames.

### Phase 3, per type

- [ ] Schema appended in `types/message.js` and registered under the opcode,
      the wire name and any friendly alias.
- [ ] Mapping in `fabricMessageBodies.js`, with a round-trip test.
- [ ] Peer accepts both encodings; dedup keys are encoding-independent.
- [ ] Senders switched in core, then downstream (as in Phase 2).
- [ ] `MESSAGES.md`, `MESSAGE_BODY.md` and this table updated.

### Phase 5

- [ ] No downstream sender of a schema type still sends JSON (check the
      drop/warn counters on the seeds).
- [ ] Stored-frame replay keeps a JSON decode path.
- [ ] Announced deprecation window has passed.

## Open questions

1. **GoonCitizen's `rendezvous` in offers.** `FabricNetwork.js:1271` puts
   `rendezvous: { hubs }` on its peering offer. Should it be a schema field
   (a canonical-JSON `string`), move to the GoonCitizen `PeerProfile`, or be
   dropped? Until decided, a field offer drops it.
2. **Inner type of `Contract#commit`.** It now sends
   `type: 'ContractMessage'` (`LOG_TYPES.ContractMessage`), since
   `APPLICATION_NAMESPACES.md` had no type for a generic `ops` commit. Is that
   the right name, or should generic ops commits get their own body type?
3. **Session offers.** Can `P2P_SESSION_OFFER` / `OPEN` move to fields before
   Phase 5, or must they stay JSON so a legacy peer can always read the
   handshake?
4. **Base64 in file sends.** Is the blob-size win from a `bytes` field in
   `P2P_FILE_SEND` worth re-pricing documents, given that blob prices are
   per-blob (`HTLC_MINIMUM_SATS` floor) and more data fits in a frame?
5. **Deprecation window.** How long after Phase 2 lands everywhere should
   JSON stay accepted on the wire: a fixed date, a core version, or a seed
   counter reaching zero?
