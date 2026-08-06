# Fabric application namespaces

Canonical model for multi-app mesh traffic across **Hub**, **GoonCitizen**,
**Sensemaker**, and other `@fabric/core` peers.

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

These `type` strings ride inside `CONTRACT_MESSAGE` (not outer opcodes):

| Body `type` | Used by | Purpose |
|-------------|---------|---------|
| `FederationContractInvite` | Hub, GoonCitizen | Hub-shaped co-signer / join invite (`v: 2` + `proposedPolicy`) |
| `FederationContractInviteResponse` | Hub, GoonCitizen | Accept / reject |
| `MissionCreated` | GoonCitizen | Network mission register upsert |
| `MissionBroadcast` | GoonCitizen | Network mission offer |
| `SCEventBatch` | GoonCitizen | Log / event batch |
| `GroupChat` | GoonCitizen Group Federation | Group channel chat |
| `GroupChange` | GoonCitizen Group Federation | Membership / meta |
| `GroupShare` | GoonCitizen Group Federation | Group-scoped shares (mission offers; `kind: GroupOffer` for opaque `fabric:<hex>` join offers) |
| `GameStateSnapshot` | GoonCitizen → Hub sidechain | Cumulative analytics snapshot for Beacon seal (also listed under `ACTIVITY_TYPES`) |

### Shared activity / GenericMessage types

Not outer opcodes; not always `CONTRACT_MESSAGE` bodies. Catalogued as
`ACTIVITY_TYPES` in `applicationNamespaces.js`:

| `type` | Purpose |
|--------|---------|
| `FederationSignRequest` | Ask Federation validators to Schnorr-sign a Beacon epoch commitment |
| `FederationSignResponse` | Return a validator signature for a pending round |
| `GameStateSnapshot` | App → Hub sidechain / activity fanout of sealed game-state digests |

Apps MAY add more body types under **their** contract namespace without changing
core opcodes. Do not casually mutate a frozen genesis `messageTypes` array if
it is hashed into the contract `Actor` id (GoonCitizen network genesis).

## Downstream status

| Product | Shoutbox (`P2P_CHAT_MESSAGE`) | Contract namespaces | Notes |
|---------|-------------------------------|---------------------|-------|
| **@fabric/core** Peer | Relays + `chat` event | Relays + `contract:publish` / `contract:message` | Source of truth for opcodes |
| **Hub** | SubmitChatMessage → P2P mesh; WS often `ChatMessage` | Tracks publish once per id; counts messages in memory | Invites also appear in chat JSON historically |
| **GoonCitizen** | `global` channel | GoonCitizen genesis + per-Group Federation contracts | Full Groups-as-Federations path |
| **Sensemaker** | Global UI sends/receives `P2P_CHAT_MESSAGE`; Peer `chat` + contract events attached | Emits `fabric:contract:*`; ignore-unknown by default | AI stream stays off mesh; Federation `CONTRACT_PUBLISH` optional next |

## Convergence rules

1. **New mesh features** use the outer types above — not new one-off opcodes per app.
2. **App-specific semantics** go in `CONTRACT_MESSAGE` body `type` + `object` under a published contract id.
3. **Ignore unknown namespaces** — never crash the Peer on unfamiliar `contract` ids.
4. **Hub invite JSON** (`FederationContractInvite` v2) is the shared join/policy shape.
5. Prefer importing names from `@fabric/core/functions/applicationNamespaces` rather than duplicating string literals.
