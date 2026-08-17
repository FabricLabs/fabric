# Fabric Messages

Opcode uniqueness and the V1 freeze live in [`FABRIC_MESSAGE_TYPE_CONSOLIDATION.md`](FABRIC_MESSAGE_TYPE_CONSOLIDATION.md) (generated from `WIRE_TYPE_DECODE_ORDER`). This file keeps purpose notes.

## Original Table

Historical sketch only — not the live opcode map. Live decode names: [`FABRIC_MESSAGE_TYPE_CONSOLIDATION.md`](FABRIC_MESSAGE_TYPE_CONSOLIDATION.md).

```
TYPE|NAME
====|====
0000|
0001|GENERIC_MESSAGE
0002|PEER_ANNOUNCE
0003|PEER_PING
0004|PEER_PONG
0005|
0006|
0007|
0008|
0009|
000a|
000b|
000c|
000d|
000e|
000f|
0010|
001f| # 31
0020| # 32
0021|BITCOIN_BLOCK_HASH
0022|BITCOIN_TRANSACTION_HASH
002f| # 47
0030| # 48
0031|FABRIC_STATE
0032|FABRIC_DOCUMENT
0033|FABRIC_DELTA
```

## Expanded Catalog

This file enumerates known message types used in `@fabric/core` as of this repo state.

**V1 body rule:** AMP bodies are **typed field layouts** (C-like memory), not JSON.
See [`docs/MESSAGE_BODY.md`](docs/MESSAGE_BODY.md). JSON bridging is `@fabric/http`.

Scope:
- **Wire types** are the canonical opcode-backed AMP message types decoded by `types/message.js`.
- **Generic payload types** are transitional `GenericMessage` / legacy UTF-8 JSON body `type` values routed by peers/services until field schemas are registered.

Primary sources:
- `constants.js`
- `types/message.js` (`WIRE_TYPE_DECODE_ORDER`)
- `types/peer.js` (`_handleGenericMessage` routing)
- `DEVELOPERS.md` (receipt semantics)

## 1) Canonical Wire Types (Opcode-Backed)

| Name | Code (dec) | Code (hex) | Purpose |
|---|---:|---:|---|
| `BITCOIN_BLOCK` | 21000 | `0x5208` | Carries a Bitcoin block payload into Fabric message flow. |
| `BITCOIN_BLOCK_HASH` | 21100 | `0x526c` | Announces/propagates a Bitcoin block hash. |
| `BITCOIN_TRANSACTION` | 22000 | `0x55f0` | Carries a Bitcoin transaction payload. |
| `BITCOIN_TRANSACTION_HASH` | 22100 | `0x5654` | Announces/propagates a Bitcoin transaction hash. |
| `LOG_MESSAGE` | 3235156080 | `0xc0d49070` | Debug/log transport message for diagnostics. |
| `GENERIC_LIST` | 3235170158 | `0xc0d4c76e` | Generic list/queue-style payload container. |
| `SIDECHAIN_STATE_PATCH` | 997 | `0x03e5` | Typed-field sidechain/registry update (`basisClock` / `basisDigest` / `catalogCanonical` / optional `patchesCanonical`). HTTP may map RFC6902 ↔ fields. |
| `DOCUMENT_PUBLISH` | 998 | `0x03e6` | Publishes a document descriptor/content reference. |
| `DOCUMENT_REQUEST` | 999 | `0x03e7` | Requests a document from peers/services. |
| `BLOCK_CANDIDATE` | 3 | `0x0003` | Candidate block announcement in peer coordination. |
| `P2P_PING` | 18 | `0x0012` | Keepalive/liveness probe. |
| `P2P_PONG` | 19 | `0x0013` | Response to ping. |
| `P2P_GENERIC` | 128 | `0x0080` | Generic Fabric envelope for application payloads. |
| `P2P_CHAIN_SYNC_REQUEST` | 85 | `0x0055` | Requests chain synchronization from peers. |
| `P2P_FLUSH_CHAIN` | 86 | `0x0056` | Requests/announces chain rewind/flush in trusted flows. |
| `P2P_INVENTORY_REQUEST` | 87 | `0x0057` | Requests inventory/resources from a peer or relay path. |
| `P2P_INVENTORY_RESPONSE` | 88 | `0x0058` | Returns inventory/resource results. |
| `P2P_FILE_SEND` | 89 | `0x0059` | Transfers file/document payload chunks/metadata peer-to-peer. |
| `P2P_DOCUMENT_PUBLISH` | 90 | `0x005a` | Publishes document pricing/availability via P2P path. |
| `P2P_PEER_ALIAS` | 91 | `0x005b` | Announces/updates personal nickname. Body = raw UTF-8 nickname only (no JSON). Relayed bit-identical; registry keyed by signer pubkey. |
| `P2P_PEER_ANNOUNCE` | 92 | `0x005c` | Announces peer identity/presence to network participants. |
| `P2P_PEER_GOSSIP` | 97 | `0x0061` | First-class peer gossip frame (host/port candidates). Relayed bit-identical; logical payload dedup + hop/rate limits. |
| `P2P_PEERING_OFFER` | 98 | `0x0062` | First-class peering-capacity offer. Relayed bit-identical; candidate queue + hop/rate limits. |
| `P2P_SESSION_OFFER` | 93 | `0x005d` | Initiates peer session handshake. |
| `P2P_SESSION_OPEN` | 94 | `0x005e` | Accepts/completes peer session handshake. |
| `P2P_SESSION_ACK` | 16896 | `0x4200` | Session handshake ack (not mesh-flooded). |
| `P2P_MUSIG_START` | 16928 | `0x4220` | Directed BIP-327 session open: `sessionId` + `msg` + packed pubkeys + initiator `pubnonce`. |
| `P2P_MUSIG_ACCEPT` | 16929 | `0x4221` | First co-signer `pubnonce` (n=2 complete after this). |
| `P2P_MUSIG_RECEIVE_COUNTER` | 16930 | `0x4222` | Remaining signers’ `pubnonce` (n>2). |
| `P2P_MUSIG_SEND_PROPOSAL` | 16931 | `0x4223` | Coordinator publishes recomputed `aggnonce` (must match local `nonceAgg`). |
| `P2P_MUSIG_REPLY_TO_PROPOSAL` | 16932 | `0x4224` | 32-byte partial signature. |
| `P2P_MUSIG_ACCEPT_PROPOSAL` | 16933 | `0x4225` | 64-byte aggregated BIP-340 signature. |
| `CONTRACT_PUBLISH` | 95 | `0x005f` | Publishes a contract definition; registers it under a deterministic `Actor` id (the contract **namespace**). Emits `contract:publish` and relays. |
| `CONTRACT_MESSAGE` | 96 | `0x0060` | Namespaced contract event. Body MUST carry `contract: <id>`; dispatch routes by that namespace (emits `contract:message`). State-patch `ops` apply only to locally registered contracts; unknown ids are app-consumed, not fatal. |
| `P2P_IDENT_REQUEST` | 1 | `0x0001` | Requests identity material from counterparty. |
| `P2P_IDENT_RESPONSE` | 17 | `0x0011` | Returns identity material to requester. |
| `P2P_BASE_MESSAGE` | 49 | `0x0031` | Baseline/default Fabric wire message type. |
| `P2P_STATE_ROOT` | 48 | `0x0030` | Announces state root/snapshot anchor. |
| `P2P_STATE_COMMITTMENT` | 50 | `0x0032` | State commitment (legacy spelling of the wire name). |
| `P2P_STATE_CHANGE` | 51 | `0x0033` | Announces incremental state change/delta. |
| `P2P_STATE_REQUEST` | 41 | `0x0029` | Requests state data from a peer. |
| `P2P_TRANSACTION` | 57 | `0x0039` | Generic transaction-style message in P2P flow. |
| `P2P_CALL` | 66 | `0x0042` | RPC/call-like request message over P2P channel. |
| `P2P_RELAY` | 67 | `0x0043` | Mesh flood envelope; body = raw inner Message bytes (not directed onion). |
| `P2P_MESSAGE_RECEIPT` | 68 | `0x0044` | Ack/receipt for processed inbound WebSocket/P2P message. |
| `P2P_FORWARD` | 69 | `0x0045` | Directed onion hop: `nextPeer` + `ttl` + nested `inner` Message. |
| `PEER_CANDIDATE` | 9 | `0x0009` | Candidate peer advertisement for connection management. |
| `SESSION_START` | 2 | `0x0002` | Starts a session context. |
| `CHAT_MESSAGE` | 103 | `0x0067` | Legacy chat opcode / Hub transitional carrier. Prefer first-class `P2P_CHAT_MESSAGE`. |
| `P2P_CHAT_MESSAGE` | 104 | `0x0068` | First-class peer chat frame. Body = raw UTF-8 message text only (no JSON; no nickname/handle). Author is AMP header + signature. Relayed **verbatim** (wire-hash dedup). Nicknames use `P2P_PEER_ALIAS`. |
| `JSON_CALL` | 16000 | `0x3e80` | JSON-RPC-like call request payload. |
| `JSON_PATCH` | 1024 | `0x0400` | RFC6902-style JSON patch operation payload. |
| `CONTRACT_PROPOSAL` | 138 | `0x008a` | Contract proposal (batched messages + Merkle + patch context). |
| `P2P_START_CHAIN` | 33 | `0x0021` | Starts/announces chain bootstrap flow. |
| `P2P_INSTRUCTION` | 32 | `0x0020` | Peer instruction frame. |
| `LIGHTNING_INIT` | 8192 | `0x2000` | Lightning initialization (AMP; not BOLT-on-Lightning). |
| `LIGHTNING_ERROR` | 8193 | `0x2001` | Lightning protocol error. |
| `LIGHTNING_OPEN_CHANNEL` | 8194 | `0x2002` | Proposes opening a Lightning channel. |
| `LIGHTNING_ACCEPT_CHANNEL` | 8195 | `0x2003` | Accepts channel open parameters. |
| `LIGHTNING_FUNDING_CREATED` | 8196 | `0x2004` | Announces channel funding transaction creation. |
| `LIGHTNING_FUNDING_SIGNED` | 8197 | `0x2005` | Returns/acknowledges funding signatures. |
| `LIGHTNING_CHANNEL_READY` | 8198 | `0x2006` | Declares channel ready for routing/HTLC operations. |
| `LIGHTNING_SHUTDOWN` | 8199 | `0x2007` | Initiates cooperative channel shutdown. |
| `LIGHTNING_CLOSING_SIGNED` | 8200 | `0x2008` | Exchanges closing signatures. |
| `LIGHTNING_UPDATE_ADD_HTLC` | 8201 | `0x2009` | Adds an HTLC to commitment state. |
| `LIGHTNING_UPDATE_FULFILL_HTLC` | 8202 | `0x200a` | Fulfills HTLC with preimage/proof. |
| `LIGHTNING_UPDATE_FAIL_HTLC` | 8203 | `0x200b` | Fails/cancels HTLC. |
| `LIGHTNING_COMMITMENT_SIGNED` | 8204 | `0x200c` | Commitment signature exchange in channel updates. |
| `LIGHTNING_REVOKE_AND_ACK` | 8205 | `0x200d` | Revocation + acknowledgment in Lightning state machine. |
| `LIGHTNING_CHANNEL_ANNOUNCEMENT` | 8206 | `0x200e` | Gossip announcement for channel existence. |
| `LIGHTNING_NODE_ANNOUNCEMENT` | 8207 | `0x200f` | Gossip announcement for node metadata. |
| `LIGHTNING_CHANNEL_UPDATE` | 8208 | `0x2010` | Gossip update for channel routing policy/state. |
| `LIGHTNING_WARNING` | 8209 | `0x2011` | Lightning warning. |
| `LIGHTNING_PING` | 8210 | `0x2012` | Lightning keepalive (distinct from `P2P_PING`). |
| `LIGHTNING_PONG` | 8211 | `0x2013` | Lightning ping response (distinct from `P2P_PONG`). |

## 2) Known Generic Payload Types (Body `type` Values)

These are routed from decoded JSON bodies (often received as `P2P_BASE_MESSAGE` / `P2P_GENERIC`).

> `P2P_CHAT_MESSAGE` (`0x0068`), `P2P_PEER_ALIAS` (`0x005b`), `P2P_PEER_GOSSIP` (`0x0061`), and `P2P_PEERING_OFFER` (`0x0062`) are **first-class outer opcodes** (table above). Chat and alias bodies are opaque UTF-8 text (not JSON); gossip/offer bodies remain JSON objects.

| Generic `type` | Purpose |
|---|---|
| `P2P_STATE_ANNOUNCE` | Announces state updates/snapshots in generic form. |
| `INVENTORY_REQUEST` | Logical inventory request payload. |
| `INVENTORY_RESPONSE` | Logical inventory response payload. |
| `ServiceMessage` | Service-level internal control/event envelope (wallet/service handlers). |
| `BitcoinBlock` | Friendly/body-level alias used in some handlers for block notifications. |
| `BitcoinTransaction` | Friendly/body-level alias for transaction notifications. |

## 3) Application namespaces (contract flow)

**Full specification:** [docs/APPLICATION_NAMESPACES.md](docs/APPLICATION_NAMESPACES.md)  
**Code catalog:** [`functions/applicationNamespaces.js`](functions/applicationNamespaces.js)

Fabric uses a small, consistent pattern for multi-app mesh traffic (Hub,
light peers, downstream apps, …):

1. **Global shoutbox** — `P2P_CHAT_MESSAGE` (not contract-namespaced).
2. **Contract discovery** — `CONTRACT_PUBLISH` / `P2P_CONTRACT_PUBLISH` →
   namespace id = `Actor(definition).id`.
3. **Namespaced updates** — `CONTRACT_MESSAGE` / `P2P_CONTRACT_MESSAGE` with
   `contract: <id>`; apps **ignore** unknown namespaces (not fatal).
4. **Federation timelines** — validators + threshold on Federation-shaped
   contracts define convergent authority for that namespace.

Wire aliases: `P2P_CONTRACT_*` encode to the same opcodes as `CONTRACT_*`
(see `types/message.js`).

## 4) Aliases and Notes

- `types/message.js` accepts both canonical wire names and legacy-friendly aliases (for example `JSONCall` -> `JSON_CALL`, `DocumentPublish` -> `DOCUMENT_PUBLISH`).
- Lightning AMP types use `0x2000–0x2FFF` (`POLICY.md`). Fabric keeps the low numbers (`P2P_PING` `0x12`, `P2P_INSTRUCTION` `0x20`, …). Every opcode in `WIRE_TYPE_DECODE_ORDER` is unique; encode name round-trips to that decode label.
- `HEARTBEAT` appears in policy/examples as a known logical type, but it is not currently registered in `constants.js` canonical wire decode map.
