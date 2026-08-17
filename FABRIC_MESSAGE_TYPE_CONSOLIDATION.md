# Fabric Message Type Consolidation

Generated from `types/message.js` `WIRE_TYPE_DECODE_ORDER`. **Do not hand-edit the catalog table.**

```
npm run docs:message-types
```

Mocha asserts this file matches the live decode order (`tests/scripts.gen-message-type-consolidation.js`).

See also [`MESSAGES.md`](MESSAGES.md) (purpose notes), [`POLICY.md`](POLICY.md) (relay / Lightning AMP range), [`docs/MESSAGE_BODY.md`](docs/MESSAGE_BODY.md) (typed bodies).

## Purpose

V1 is a **freeze**, not a new opcode set. Wire version stays `0x01` (208-byte header). Consolidation means:

1. **One decode name per opcode.** Encode aliases are allowed; they must round-trip to that decode label.
2. **Typed field bodies** on mesh-originated types. JSON belongs at `@fabric/http`. Exceptions: chat/alias UTF-8, `P2P_RELAY` raw inner AMP, `JSON_CALL` at the Hub edge.
3. **Application events stay inside `CONTRACT_MESSAGE`.** Do not give MissionBroadcast, GroupChat, IdentityCrossSign, etc. their own outer opcodes.
4. **Do not pack Fabric types into a gapless `0x01, 0x02, …` sequence** — that would break playnet.

## Closed (opcode uniqueness)

Lightning Fabric-Message types live in `0x2000–0x2013` (`POLICY.md`). Fabric keeps the low numbers (`P2P_PING` `0x12`, `P2P_INSTRUCTION` `0x20`, `P2P_GENERIC` `0x80`, …). Duplicate opcodes fail at `Message` module load. `P2P_INSTRUCTION`, `P2P_STATE_COMMITTMENT`, and `P2P_SESSION_ACK` are first-class decode names.

BOLT-on-lightningd is unchanged. Old Lightning AMP frames that used BOLT numbers will not decode as Lightning types. Mesh chat / gossip / peering opcodes did not move.

This catalog: **76** decode names, **76** unique opcodes, **13** with a registered field schema, **20** Lightning AMP rows.

## Dual carriers (do not merge numbers)

| Keep | Transitional / other | Rule |
|---|---|---|
| `P2P_CHAT_MESSAGE` `0x68` | `CHAT_MESSAGE` `0x67` | Originate mesh shoutbox on `0x68` only. `0x67` is Hub cache. |
| `P2P_DOCUMENT_PUBLISH` `0x5a` | `DOCUMENT_PUBLISH` `998` | Two jobs (mesh pricing vs document descriptor). Keep both opcodes. |
| `P2P_INVENTORY_REQUEST` / `RESPONSE` | JSON `INVENTORY_*` on `P2P_BASE_MESSAGE` / `GENERIC_MESSAGE` | Originate new inventory on the first-class opcodes. |
| `CONTRACT_PUBLISH` / `CONTRACT_MESSAGE` / `CONTRACT_PROPOSAL` | `P2P_CONTRACT_*` encode aliases | Decode names stay `CONTRACT_*`. Correct. |

Hub `functions/fabricMessageRegistry.js` still lists gossip, peering offer, and file send as inner-pending, and invents `JSONBlob` `15104`. Those rows are **not** in this catalog until core registers them.

## Not registered (by design)

| Name | Notes |
|---|---|
| `HEARTBEAT` | POLICY / examples only. Constructor logs if named. Do not register. |
| `JSONBlob` `15104` | Hub registry + some tests use `GENERIC_MESSAGE + 1`. Core `Message.types` has no `JSON_BLOB`. Do not add until core owns it. |
| `P2P_STATE_ANNOUNCE` | Generic JSON body `type`, not an opcode. Handled in `Peer._handleGenericMessage`. |

## Catalog (decode order)

| Decode name | Dec | Hex | Encode aliases | Field schema | Family |
|---|---:|---|---|---|---|
| `BITCOIN_BLOCK` | 21000 | `0x5208` | `BitcoinBlock` | no | bitcoin |
| `BITCOIN_BLOCK_HASH` | 21100 | `0x526c` | `BitcoinBlockHash` | no | bitcoin |
| `BITCOIN_TRANSACTION` | 22000 | `0x55f0` | `BitcoinTransaction` | no | bitcoin |
| `BITCOIN_TRANSACTION_HASH` | 22100 | `0x5654` | `BitcoinTransactionHash` | no | bitcoin |
| `LOG_MESSAGE` | 3235156080 | `0xc0d49070` | `FabricLogMessage`, `FabricServiceLogMessage`, `GenericLogMessage`, `LogMessage` | no | legacy |
| `GENERIC_LIST` | 3235170158 | `0xc0d4c76e` | `GenericList`, `GenericQueue`, `GenericTransferQueue` | no | legacy |
| `GENERIC_MESSAGE` | 15103 | `0x3aff` | `GenericMessage` | no | hub |
| `SIDECHAIN_STATE_PATCH` | 997 | `0x03e5` | `SidechainStatePatch` | yes | contracts |
| `DOCUMENT_PUBLISH` | 998 | `0x03e6` | `DocumentPublish` | no | documents |
| `DOCUMENT_REQUEST` | 999 | `0x03e7` | `DocumentRequest` | no | documents |
| `BLOCK_CANDIDATE` | 3 | `0x0003` | `BlockCandidate` | no | legacy |
| `P2P_PING` | 18 | `0x0012` | `Ping` | yes | mesh |
| `P2P_PONG` | 19 | `0x0013` | `Pong` | yes | mesh |
| `P2P_GENERIC` | 128 | `0x0080` | `Generic` | no | legacy |
| `P2P_CHAIN_SYNC_REQUEST` | 85 | `0x0055` | `ChainSyncRequest` | no | mesh |
| `P2P_FLUSH_CHAIN` | 86 | `0x0056` | `FlushChain` | no | mesh |
| `P2P_INVENTORY_REQUEST` | 87 | `0x0057` | `InventoryRequest` | no | documents |
| `P2P_INVENTORY_RESPONSE` | 88 | `0x0058` | `InventoryResponse` | no | documents |
| `P2P_FILE_SEND` | 89 | `0x0059` | `FileSend` | no | documents |
| `P2P_DOCUMENT_PUBLISH` | 90 | `0x005a` | `DocumentPricingPublish` | no | documents |
| `P2P_PEER_ALIAS` | 91 | `0x005b` | `PeerAlias` | no | mesh |
| `P2P_PEER_ANNOUNCE` | 92 | `0x005c` | `PeerAnnounce` | yes | mesh |
| `P2P_PEER_GOSSIP` | 97 | `0x0061` | `PeerGossip` | yes | mesh |
| `P2P_PEERING_OFFER` | 98 | `0x0062` | `PeeringOffer` | yes | mesh |
| `P2P_SESSION_OFFER` | 93 | `0x005d` | `SessionOffer` | no | session |
| `P2P_SESSION_OPEN` | 94 | `0x005e` | `SessionOpen` | no | session |
| `P2P_SESSION_ACK` | 16896 | `0x4200` | — | no | session |
| `P2P_MUSIG_START` | 16928 | `0x4220` | `MusigStart` | yes | session |
| `P2P_MUSIG_ACCEPT` | 16929 | `0x4221` | `MusigAccept` | yes | session |
| `P2P_MUSIG_RECEIVE_COUNTER` | 16930 | `0x4222` | `MusigReceiveCounter` | yes | session |
| `P2P_MUSIG_SEND_PROPOSAL` | 16931 | `0x4223` | `MusigSendProposal` | yes | session |
| `P2P_MUSIG_REPLY_TO_PROPOSAL` | 16932 | `0x4224` | `MusigReplyToProposal` | yes | session |
| `P2P_MUSIG_ACCEPT_PROPOSAL` | 16933 | `0x4225` | `MusigAcceptProposal` | yes | session |
| `CONTRACT_PUBLISH` | 95 | `0x005f` | `P2P_CONTRACT_PUBLISH` | no | contracts |
| `CONTRACT_MESSAGE` | 96 | `0x0060` | `P2P_CONTRACT_MESSAGE` | no | contracts |
| `P2P_IDENT_REQUEST` | 1 | `0x0001` | `IdentityRequest` | no | session |
| `P2P_IDENT_RESPONSE` | 17 | `0x0011` | `IdentityResponse` | no | session |
| `P2P_BASE_MESSAGE` | 49 | `0x0031` | `PeerMessage` | no | legacy |
| `P2P_STATE_ROOT` | 48 | `0x0030` | `StateRoot` | no | legacy |
| `P2P_STATE_COMMITTMENT` | 50 | `0x0032` | `StateCommitment` | no | legacy |
| `P2P_STATE_CHANGE` | 51 | `0x0033` | `StateChange` | no | legacy |
| `P2P_STATE_REQUEST` | 41 | `0x0029` | `StateRequest` | no | legacy |
| `P2P_TRANSACTION` | 57 | `0x0039` | `Transaction` | no | legacy |
| `P2P_CALL` | 66 | `0x0042` | `Call` | no | legacy |
| `P2P_RELAY` | 67 | `0x0043` | — | no | mesh |
| `P2P_MESSAGE_RECEIPT` | 68 | `0x0044` | — | no | hub |
| `P2P_FORWARD` | 69 | `0x0045` | — | yes | mesh |
| `PEER_CANDIDATE` | 9 | `0x0009` | `PeerCandidate` | no | legacy |
| `SESSION_START` | 2 | `0x0002` | `StartSession` | no | legacy |
| `CHAT_MESSAGE` | 103 | `0x0067` | `ChatMessage` | no | hub |
| `P2P_CHAT_MESSAGE` | 104 | `0x0068` | — | no | mesh |
| `JSON_CALL` | 16000 | `0x3e80` | `JSONCall` | no | hub |
| `JSON_PATCH` | 1024 | `0x0400` | `JSONPatch` | no | hub |
| `CONTRACT_PROPOSAL` | 138 | `0x008a` | `ContractProposal`, `P2P_CONTRACT_PROPOSAL` | no | contracts |
| `P2P_START_CHAIN` | 33 | `0x0021` | `StartChain` | no | legacy |
| `P2P_INSTRUCTION` | 32 | `0x0020` | `PeerInstruction` | no | session |
| `LIGHTNING_INIT` | 8192 | `0x2000` | `LightningInit` | no | lightning |
| `LIGHTNING_ERROR` | 8193 | `0x2001` | `LightningError` | no | lightning |
| `LIGHTNING_OPEN_CHANNEL` | 8194 | `0x2002` | `OpenChannel` | no | lightning |
| `LIGHTNING_ACCEPT_CHANNEL` | 8195 | `0x2003` | `AcceptChannel` | no | lightning |
| `LIGHTNING_FUNDING_CREATED` | 8196 | `0x2004` | `FundingCreated` | no | lightning |
| `LIGHTNING_FUNDING_SIGNED` | 8197 | `0x2005` | `FundingSigned` | no | lightning |
| `LIGHTNING_CHANNEL_READY` | 8198 | `0x2006` | `ChannelReady` | no | lightning |
| `LIGHTNING_SHUTDOWN` | 8199 | `0x2007` | `Shutdown` | no | lightning |
| `LIGHTNING_CLOSING_SIGNED` | 8200 | `0x2008` | `ClosingSigned` | no | lightning |
| `LIGHTNING_UPDATE_ADD_HTLC` | 8201 | `0x2009` | `UpdateAddHTLC` | no | lightning |
| `LIGHTNING_UPDATE_FULFILL_HTLC` | 8202 | `0x200a` | `UpdateFulfillHTLC` | no | lightning |
| `LIGHTNING_UPDATE_FAIL_HTLC` | 8203 | `0x200b` | `UpdateFailHTLC` | no | lightning |
| `LIGHTNING_COMMITMENT_SIGNED` | 8204 | `0x200c` | `CommitmentSigned` | no | lightning |
| `LIGHTNING_REVOKE_AND_ACK` | 8205 | `0x200d` | `RevokeAndAck` | no | lightning |
| `LIGHTNING_CHANNEL_ANNOUNCEMENT` | 8206 | `0x200e` | `ChannelAnnouncement` | no | lightning |
| `LIGHTNING_NODE_ANNOUNCEMENT` | 8207 | `0x200f` | `NodeAnnouncement` | no | lightning |
| `LIGHTNING_CHANNEL_UPDATE` | 8208 | `0x2010` | `ChannelUpdate` | no | lightning |
| `LIGHTNING_WARNING` | 8209 | `0x2011` | `LightningWarning` | no | lightning |
| `LIGHTNING_PING` | 8210 | `0x2012` | `LightningPing` | no | lightning |
| `LIGHTNING_PONG` | 8211 | `0x2013` | `LightningPong` | no | lightning |

## Remaining work

Owner-gated. Protocol version stays `0x01`.

1. **Hub catalog** — Drop INNER pending rows that are already outer opcodes. Do not register `JSONBlob` until core owns `15104`.
2. **Dual-carrier kill** — Originate inventory / file / chat only on first-class opcodes. Mesh chat = `0x68` only.
3. **Field schemas** — Still JSON for session offer/open/ack, inventory, file send, document publish/request, contract publish/proposal, instruction, state commitment. `CONTRACT_MESSAGE` stays a JSON envelope `{ contract, type, … }`.
4. **Protocol-v1 matrix** — Add `P2P_FORWARD`, `P2P_RELAY`, `P2P_PONG`, `P2P_INVENTORY_RESPONSE`, `P2P_SESSION_OPEN`, `P2P_DOCUMENT_PUBLISH`, `SIDECHAIN_STATE_PATCH`, `CONTRACT_PROPOSAL`. MuSig2 stays directed.
5. **Not V1** — Gapless Fabric opcodes; wire version `0x02`; per-app outer types; folding `DOCUMENT_PUBLISH` into `0x5a`.

## V1 originate set

`P2P_PING`, `P2P_PONG`, `P2P_CHAT_MESSAGE`, `P2P_PEER_ALIAS`, `P2P_PEER_GOSSIP`, `P2P_PEERING_OFFER`, `P2P_PEER_ANNOUNCE`, `P2P_RELAY`, `P2P_FORWARD`, `P2P_INSTRUCTION`, `P2P_INVENTORY_REQUEST`, `P2P_INVENTORY_RESPONSE`, `P2P_FILE_SEND`, `P2P_DOCUMENT_PUBLISH`, `DOCUMENT_PUBLISH`, `DOCUMENT_REQUEST`, `CONTRACT_PUBLISH`, `CONTRACT_MESSAGE`, `CONTRACT_PROPOSAL`, `SIDECHAIN_STATE_PATCH`, `P2P_SESSION_OFFER`, `P2P_SESSION_OPEN`, `P2P_SESSION_ACK`, `P2P_MUSIG_*`, `BITCOIN_BLOCK`, `JSON_CALL`.

Lightning AMP `0x2000+` is a separate namespace, not mesh product traffic. `GENERIC_MESSAGE` / `P2P_BASE_MESSAGE` remain accepted inbound under the existing non-escalation rules.
