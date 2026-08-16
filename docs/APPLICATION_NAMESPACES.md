# Fabric application namespaces

Canonical model for multi-app mesh traffic across **Hub**, light peers,
and other `@fabric/core` consumers.

Formal ARC genesis / tip / spend: [`ARC.md`](ARC.md).  
Code catalog: [`functions/applicationNamespaces.js`](../functions/applicationNamespaces.js).  
Wire opcodes: [`MESSAGES.md`](../MESSAGES.md) §1 and §3.

## Model

| Layer | Outer type | Role |
|-------|------------|------|
| **Global shoutbox** | `P2P_CHAT_MESSAGE` (`0x68`) | Network-wide chat; body = UTF-8 text only. Peer relays bit-identical. Display nicknames via `P2P_PEER_ALIAS` (`0x5b`), not chat payload. |
| **Namespace declare** | `CONTRACT_PUBLISH` / `P2P_CONTRACT_PUBLISH` (`0x5f`) | Publish genesis → `Actor(definition).id` is the **application namespace**. |
| **Namespace events** | `CONTRACT_MESSAGE` / `P2P_CONTRACT_MESSAGE` (`0x60`) | Body MUST include `contract: <id>`. Peer relays; **apps ignore unknown ids**. |
| **Proposals** | `CONTRACT_PROPOSAL` / `P2P_CONTRACT_PROPOSAL` (`0x8a`) | Batched messages + Merkle + patch (+ optional PSBT), optional `contractId`. |
| **Federation timeline** | (contract shape) | Validators + threshold on a Federation / Federation-shaped genesis define convergent authority for that namespace. |

```
P2P_CHAT_MESSAGE ──────────► global shoutbox
CONTRACT_PUBLISH ──────────► namespace id = Actor(definition).id
CONTRACT_MESSAGE{contract} ► ingest if known; else ignore; Peer still gossips
Federation validators ─────► convergent timeline for that namespace
```

**Legacy:** `ChatMessage` / `CHAT_MESSAGE` (`0x67`) remains for Hub WebSocket UI
fanout in some paths. Prefer `P2P_CHAT_MESSAGE` for all **mesh** chat.

## Shared CONTRACT_MESSAGE body types

These `type` strings ride inside `CONTRACT_MESSAGE` (not outer opcodes).
Product-specific types (missions, gameplay batches, share envelopes, activity
trees) belong in **app catalogs**, not this core list.

| Body `type` | Purpose |
|-------------|---------|
| `FederationContractInvite` | Co-signer / join invite (`v: 2` + `proposedPolicy`) |
| `FederationContractInviteResponse` | Accept / reject |
| `GroupChat` | Chat under a group / pair Application Resource Contract (optional seal: tip-bound v1 or participant-key v2 in `functions/groupChatSeal.js`) |
| `GroupChange` | Membership / meta on a group Federation contract |
| `GroupChangeProposal` | Proposed membership/meta change; accumulates validator votes before adopt |
| `GroupChangeVote` | BIP340 validator vote on a `GroupChangeProposal` |
| `GroupJournalRequest` | Request missing Statechain journal entries (`fromClock` → tip) |
| `GroupJournalBatch` | Catch-up batch of journal rows + tip Schnorr (`ContractStateTip`) |
| `GroupStateJournal` | Optional tip attestation: folded `stateDigest` signed to threshold |
| `ContractCapabilityGrant` | Token-backed reader/signer grant (`OP_CONTRACT_READ` / `OP_CONTRACT_SIGN`) |
| `ContractWithdrawalRequest` | Spend or decay-migrate from contract Taproot UTXO |
| `ContractWithdrawalWitness` | Co-signer witness for withdrawal / migration |
| `MessageReceived` | Phase-1 delivery ACK for **any** sync-tracked wire frame — stored/relayed as `CONTRACT_MESSAGE`; 2PC sidecar only (does not advance tip clock) |
| `MessageReceipt` | Phase-2 BIP340 receipt over message / content hash — same path; tip digest unchanged |


**Multi-origin accumulate:** publisher and participants ingest the same signed
AMP bytes from mesh, opaque hub queues, or copy-paste (`fabric:<hex>`) via
[`functions/contractMessageAccumulate.js`](../functions/contractMessageAccumulate.js).
Fold is idempotent by message hash and arrival-order independent.

**Portable collections:** persist and replay those AMP hex frames as
[`FabricMessageCollection`](MESSAGE_COLLECTION.md)
(`functions/fabricMessageCollection.js`) — JSONL or a JSON document whose
`messages[].hex` is `Message.toBuffer()`. Journal rows that already carry
`fabricMessage.hex` ingest directly.

**Delivery
synchronization filter:** sync-tracked body types (default: all except delivery
ACKs and `GroupJournalRequest`) open a per-reader 2PC row in
[`functions/contractMessageCommit.js`](../functions/contractMessageCommit.js)
when accumulated; `MessageReceived` / `MessageReceipt` close those phases and
never open a new pending row. Override via genesis
`primitives.deliverySync` (`mode`: `all` | `none` | `include` | `exclude`).
The sidecar does not alter content `stateDigest`.

**Opaque hub queue:** relays MAY persist AMP hex by `contractId` without opening
sealed bodies via [`functions/contractMessageQueue.js`](../functions/contractMessageQueue.js).
Hub stores under `contract-message-queue/` and later-relays on peer connect
(`ListContractMessageQueue` / `DrainContractMessageQueue`).

**Tip attestation:** journal tips use
[`functions/contractStateSigning`](../functions/contractStateSigning.js)
(`kind: ContractStateTip`, same k-of-n witness shape as Beacon epochs). Hub must
track this module when sealing contract-namespace sidechains.

**Taproot spend ladder:** [`functions/contractTaproot`](../functions/contractTaproot.js)
builds deterministic P2TR trees from author-defined failover tiers (`after` / `until`
decay + optional migrate). See DISTRIBUTED_EXECUTION.md.

### Shared activity / GenericMessage types

Not outer opcodes; not always `CONTRACT_MESSAGE` bodies. Catalogued as
`ACTIVITY_TYPES` in `applicationNamespaces.js`:

| `type` | Purpose |
|--------|---------|
| `FederationSignRequest` | Ask Federation validators to Schnorr-sign a Beacon epoch commitment |
| `FederationSignResponse` | Return a validator signature for a pending round |

Apps MAY add more body types under **their** contract namespace without changing
core opcodes. Do not casually mutate a frozen genesis `messageTypes` array if
it is hashed into the contract `Actor` id.

## Downstream status

| Product | Shoutbox (`P2P_CHAT_MESSAGE`) | Contract namespaces | Notes |
|---------|-------------------------------|---------------------|-------|
| **@fabric/core** Peer | Relays + `chat` event | Relays + `contract:publish` / `contract:message` | Source of truth for opcodes |
| **Hub** | SubmitChatMessage → P2P mesh; WS often `ChatMessage` | Tracks publish; **opaque CONTRACT_MESSAGE queue** + later-relay on connect | Invites also appear in chat JSON historically |
| **Light peer / desktop** | `global` channel | App genesis + per-group Federation contracts | Groups-as-Federations; product types in app catalog |
| **Downstream app** | Global UI sends/receives `P2P_CHAT_MESSAGE`; Peer `chat` + contract events attached | Emits `fabric:contract:*`; ignore-unknown by default | App-local streams stay off mesh; Federation `CONTRACT_PUBLISH` optional next |

## Convergence rules

1. **New mesh features** use the outer types above — not new one-off opcodes per app.
2. **App-specific semantics** go in `CONTRACT_MESSAGE` body `type` + `object` under a published contract id.
3. **Ignore unknown namespaces** — never crash the Peer on unfamiliar `contract` ids.
4. **Same accepted Message set ⇒ same tip** — accumulate from any origin; fold by sorted message hash.
