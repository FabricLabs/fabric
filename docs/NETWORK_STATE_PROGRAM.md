# Fabric network state Program

This document enumerates **first-class AMP wire opcodes** (canonical decode
names from `Message.WIRE_TYPE_DECODE_ORDER`) and defines the **Program +
manifest** shape that lets Fabric-speaking peers derive a **common state** —
a list of fields and their values — across the network.

Companion diagram: [`contracts/protocol.dot`](../contracts/protocol.dot).  
Opcode catalog: [`MESSAGES.md`](../MESSAGES.md).  
Execution model: [`DISTRIBUTED_EXECUTION.md`](./DISTRIBUTED_EXECUTION.md), [`PROGRAM.md`](./PROGRAM.md).

There is **no** `DistributedExecution` or `Statechain` Fabric type. Shared
mutual state is the **sidechain document** helpers in
`functions/sidechainState.js`.

---

## 1. First-class wire opcodes

Canonical decode names after **first-match** collapse when numeric codes collide
(e.g. `P2P_PING` wins over `LIGHTNING_PING` for `0x12`).

### Identity & session

| Hex | Dec | Wire name |
|-----|-----|-----------|
| `0x0001` | 1 | `P2P_IDENT_REQUEST` |
| `0x0011` | 17 | `P2P_IDENT_RESPONSE` |
| `0x0002` | 2 | `SESSION_START` |
| `0x005d` | 93 | `P2P_SESSION_OFFER` |
| `0x005e` | 94 | `P2P_SESSION_OPEN` |

### Liveness & transport

| Hex | Dec | Wire name |
|-----|-----|-----------|
| `0x0012` | 18 | `P2P_PING` |
| `0x0013` | 19 | `P2P_PONG` |
| `0x0043` | 67 | `P2P_RELAY` |
| `0x0044` | 68 | `P2P_MESSAGE_RECEIPT` |
| `0x0045` | 69 | `P2P_FORWARD` |
| `0x0031` | 49 | `P2P_BASE_MESSAGE` |
| `0x0080` | 128 | `P2P_GENERIC` |
| `0x3aff` | 15103 | `GENERIC_MESSAGE` |

### Peering & discovery

| Hex | Dec | Wire name |
|-----|-----|-----------|
| `0x0009` | 9 | `PEER_CANDIDATE` |
| `0x005b` | 91 | `P2P_PEER_ALIAS` |
| `0x005c` | 92 | `P2P_PEER_ANNOUNCE` |
| `0x0061` | 97 | `P2P_PEER_GOSSIP` |
| `0x0062` | 98 | `P2P_PEERING_OFFER` |

### Application namespaces & chat

| Hex | Dec | Wire name |
|-----|-----|-----------|
| `0x005f` | 95 | `CONTRACT_PUBLISH` |
| `0x0060` | 96 | `CONTRACT_MESSAGE` |
| `0x008a` | 138 | `CONTRACT_PROPOSAL` |
| `0x0067` | 103 | `CHAT_MESSAGE` (legacy) |
| `0x0068` | 104 | `P2P_CHAT_MESSAGE` |

### Documents & inventory

| Hex | Dec | Wire name |
|-----|-----|-----------|
| `0x03e6` | 998 | `DOCUMENT_PUBLISH` |
| `0x03e7` | 999 | `DOCUMENT_REQUEST` |
| `0x005a` | 90 | `P2P_DOCUMENT_PUBLISH` |
| `0x0057` | 87 | `P2P_INVENTORY_REQUEST` |
| `0x0058` | 88 | `P2P_INVENTORY_RESPONSE` |
| `0x0059` | 89 | `P2P_FILE_SEND` |

### Local / sidechain-oriented state frames

| Hex | Dec | Wire name |
|-----|-----|-----------|
| `0x0029` | 41 | `P2P_STATE_REQUEST` |
| `0x0030` | 48 | `P2P_STATE_ROOT` |
| `0x0033` | 51 | `P2P_STATE_CHANGE` |
| `0x0400` | 1024 | `JSON_PATCH` |

Body/activity type (not yet a dedicated outer opcode): `SIDECHAIN_STATE_PATCH`.

### Chain, Bitcoin tip, calls

| Hex | Dec | Wire name |
|-----|-----|-----------|
| `0x0003` | 3 | `BLOCK_CANDIDATE` |
| `0x0021` | 33 | `P2P_START_CHAIN` |
| `0x0055` | 85 | `P2P_CHAIN_SYNC_REQUEST` |
| `0x0056` | 86 | `P2P_FLUSH_CHAIN` |
| `0x0039` | 57 | `P2P_TRANSACTION` |
| `0x0042` | 66 | `P2P_CALL` |
| `0x3e80` | 16000 | `JSON_CALL` |
| `0x5208` | 21000 | `BITCOIN_BLOCK` |
| `0x526c` | 21100 | `BITCOIN_BLOCK_HASH` |
| `0x55f0` | 22000 | `BITCOIN_TRANSACTION` |
| `0x5654` | 22100 | `BITCOIN_TRANSACTION_HASH` |

### Lightning (BOLT subset; shared opcodes noted)

| Hex | Dec | Wire name (canonical first-match) |
|-----|-----|-------------------------------------|
| `0x0010` | 16 | `LIGHTNING_INIT` |
| `0x0020` | 32 | `LIGHTNING_OPEN_CHANNEL` |
| `0x0022`–`0x0024` | 34–36 | funding / channel ready |
| `0x0026`–`0x0027` | 38–39 | shutdown / closing signed |
| `0x0082`–`0x0085` | 130–133 | HTLC fulfill/fail, commitment, revoke |
| `0x0100`–`0x0102` | 256–258 | channel/node announcement, channel update |

### Misc catalog

| Hex | Dec | Wire name |
|-----|-----|-----------|
| `0xc0d49070` | … | `LOG_MESSAGE` |
| `0xc0d4c76e` | … | `GENERIC_LIST` |

**59** distinct opcodes after first-match collapse.

Relay-as-is mesh types (author + signature preserved; hops never re-sign):
`P2P_CHAT_MESSAGE`, `CONTRACT_PUBLISH`, `CONTRACT_MESSAGE`, `CONTRACT_PROPOSAL`,
`P2P_PEER_GOSSIP`, `P2P_PEERING_OFFER`, `BITCOIN_BLOCK` / `BitcoinBlock`.

---

## 2. Common state document

Shared mutual state is:

```text
{
  version: 1,
  clock: N,
  content: { …fields… }
}
stateDigest = SHA256(canonicalJson({ version, clock, content }))
```

APIs: `functions/sidechainState` (`createInitialState`, `stateDigest`,
`applyPatchesToState`, path policy, journal/snapshots, Beacon tip restore).

### Convergent `content` fields

| Path | Meaning | Driving wire types |
|------|---------|-------------------|
| `/network/peers/<id>` | address, pubkey, alias, score, lastSeen | session, peer alias/announce, gossip/offer |
| `/network/sessions/<id>` | session / challenge material | `P2P_SESSION_OFFER` / `OPEN` |
| `/namespaces/<contractId>` | `{ clock, stateDigest, name? }` | `CONTRACT_PUBLISH`, contract sidechain tips |
| `/namespaces/<contractId>/state` | app document for that namespace | `CONTRACT_MESSAGE`, patches |
| `/documents/<id>` | contentHash, rateSats, published | `DOCUMENT_PUBLISH`, `P2P_DOCUMENT_PUBLISH` |
| `/bitcoin/tip` | height, hash, time | `BITCOIN_BLOCK` |
| `/chat/global/head` | optional shoutbox tip hash | `P2P_CHAT_MESSAGE` |
| `/meta/program` | programId, programHash | genesis / manifest |
| `/meta/clock` | mirrors document clock | every accepted patch |

Document-level: **`version`**, **`clock`**, **`content`**; public commitment
**`stateDigest`**.

---

## 3. Program definition

A **Program** (`types/program`) is the executable artifact. Its **manifest**
(`functions/fabricProgramManifest`) binds which message types may mutate the
document and under what path policy. A **Machine** runs the reduce pipeline;
**Federation / Beacon** seals `{ clock, stateDigest }` so the network agrees
on one tip.

### Manifest (`fabric-network-state-v1`)

```json
{
  "version": 1,
  "programId": "fabric-network-state-v1",
  "programHash": "<Program.hash()>",
  "allowedMessageTypes": [
    "CONTRACT_PUBLISH",
    "CONTRACT_MESSAGE",
    "CONTRACT_PROPOSAL",
    "JSON_PATCH",
    "SIDECHAIN_STATE_PATCH",
    "P2P_STATE_ROOT",
    "P2P_STATE_CHANGE",
    "DOCUMENT_PUBLISH",
    "P2P_DOCUMENT_PUBLISH",
    "BITCOIN_BLOCK",
    "P2P_PEER_GOSSIP",
    "P2P_PEERING_OFFER",
    "P2P_SESSION_OFFER",
    "P2P_SESSION_OPEN",
    "P2P_CHAT_MESSAGE"
  ],
  "federation": { "validators": ["…"], "threshold": 1 },
  "sidechainPolicy": {
    "maxOps": 64,
    "maxPathDepth": 8,
    "allowedPathPrefixes": [
      "/network",
      "/namespaces",
      "/documents",
      "/bitcoin",
      "/chat",
      "/meta"
    ],
    "deniedPathPrefixes": ["/network/admin"]
  }
}
```

### Reduce steps (intended `fabric-opcodes` / Machine pipeline)

```js
Program.from({
  language: 'fabric-opcodes',
  programId: 'fabric-network-state-v1',
  steps: [
    'OP_VERIFY_MESSAGE',           // AMP hash + Schnorr / multisig
    'OP_REQUIRE_ALLOWED_TYPE',     // manifest.allowedMessageTypes
    'OP_REDUCE_TO_PATCHES',        // type → RFC6902 under sidechainPolicy
    'OP_APPLY_SIDECHAIN_PATCH',    // applyPatchesToState
    'OP_REQUIRE_FEDERATION_WITNESS',
    'OP_COMMIT_STATE_DIGEST'       // tip + optional Beacon seal
  ]
});
```

Today Hub/Peer implement much of this reduce in service code +
`sidechainState`; Machine/Program is the executable contract for the same
pipeline.

### Agreement rule

1. Only apply patches allowed by the Program manifest + `sidechainPolicy`.
2. Each accepted patch bumps **`clock`** and recomputes **`stateDigest`**.
3. Federation (k-of-n) signs the patch / Beacon epoch that includes
   `{ clock, stateDigest }`.
4. Any peer with the same Program hash and the same accepted patch history
   derives the **same field map and the same digest**.

Transport-only frames (`P2P_PING`/`PONG`, bare `P2P_RELAY` envelope, most
Lightning ops) stay off the reduce path unless the Program maps them into
`content`.

---

## 4. Simulator coverage

`tests/simulator` exercises protocol flow with composable use-case packs
(session/peering, chat, contracts, documents/inventory, state tips, Bitcoin tip
gossip, chaos). See `tests/simulator/README.md` and scenario `protocol-flow`.
