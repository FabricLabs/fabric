# Distributed execution (core)

There is **no** `DistributedExecution` Fabric type and **no** `Statechain` Fabric
type. Distributed runs use:

| Layer | Role |
|-------|------|
| **`Program` + `Machine`** | Executable artifact + runner (`docs/PROGRAM.md`) |
| **`Contract` / `Federation`** | Shared coordination + k-of-n Schnorr policy |
| **`Chain` + `Block`** | Consensus ledgers (`pow` \| `federation` \| `gossip`) — `docs/CHAIN.md` |
| **`functions/` helpers** | Canonical JSON, Beacon epoch signing, program manifest, **sidechain document** |

Hub’s longer narrative (Beacon, delegation, signing rounds): hub.fabric.pub
`docs/DISTRIBUTED_CONTRACT_EXECUTION.md`. HTTP binder:
`@fabric/http` `types/distributedExecutionHttp` (manifest / epoch / sidechain routes).

## Protocol helpers (`functions/`)

| Module | Role |
|--------|------|
| `fabricCanonicalJson` | Deterministic digests (Actor / sidechain / Program) |
| `beaconFederationSigning` | Epoch commitment strings + federation witness verify |
| `fabricProgramManifest` | Manifest v1 (`programId` / `programHash` / allowed types / optional `sidechainPolicy`) |
| **`sidechainState`** | Sealed JSON document: digests, RFC6902 patches, path policy, journal, snapshots, Beacon tip restore, contract namespace seals |

Deprecated thin re-export (one release): `types/distributedExecution.js` → the first three helpers only (not the document APIs).

## Shared mutual state (sidechain document)

A **sidechain document** is a logical JSON value `{ version, clock, content }`
advanced by RFC6902 patches under optional path policy, authorized by federation
(or operator policy), and sealed into L1-tied Beacon epoch digests
(`payload.sidechain: { clock, stateDigest }`) with full snapshots for reorg rewind.

```js
const sidechainState = require('@fabric/core/functions/sidechainState');
```

| Concern | API |
|---------|-----|
| Document | `createInitialState`, `stateDigest`, `applyPatchesToState` |
| Contract rules | `parseStatechainPathPolicy`, `validatePatchesAgainstPolicy` |
| Federation string | `signingStringForSidechainStatePatch`, `patchCommitmentDigestHex` |
| Persistence | `loadState` / `persistState`, snapshot helpers, `sidechain/JOURNAL` |
| Tip restore | `resolveStateForBeaconTip` |
| Wire body | `SIDECHAIN_STATE_PATCH_TYPE`, `encodeSidechainStatePatchMessage` / `parse…` |

Store paths: `sidechain/STATE`, `sidechain/SNAPSHOTS`, `sidechain/JOURNAL`.

**Opcode catalog + common-state Program:** [NETWORK_STATE_PROGRAM.md](./NETWORK_STATE_PROGRAM.md),
diagram [`contracts/protocol.dot`](../contracts/protocol.dot).

**Chain digests may feed** the document / `GameStateSnapshot`; raw gossip is never
Beacon authority.

### Contract namespaces

Accepted `CONTRACT_PUBLISH` ids reuse the **same** document helpers under
`sidechains/<contractId>/STATE` (Hub ADR-001). Parents seal child heads at
`/namespaces/<contractId>`.

| Module | Host | Role |
|--------|------|------|
| `functions/contractStatechains` | Fabric Filesystem | Provision + parent seal + contract patches |
| `functions/contractSidechainLocal` | Node `fs` | Desktop / relay `<storeRoot>/sidechains/<id>/STATE.json` |

### Manifest `sidechainPolicy`

```json
{
  "version": 1,
  "programId": "…",
  "programHash": "…",
  "allowedMessageTypes": ["BEACON_EPOCH", "SIDECHAIN_STATE_PATCH"],
  "sidechainPolicy": {
    "maxOps": 32,
    "maxPathDepth": 8,
    "allowedPathPrefixes": ["/app"],
    "deniedPathPrefixes": ["/app/admin"]
  }
}
```

### Wire note

`SIDECHAIN_STATE_PATCH` uses the **same opcode / type name** across Peer, Beacon,
and HTTP. Core prefers **typed fields** (`basisClock`, `basisDigest`,
`catalogCanonical`) via `messageBodyCodec` /
`functions/documentRegistrySidechain`. **RFC6902 JSON patch arrays are an
`@fabric/http` edge transform** (`messageBodyJsonBridge`) of those fields — not
the core/simulator primary API. Digests of `sidechain/STATE` still use
`fabricCanonicalJson` (digest ≠ wire body).

A dedicated numeric outer opcode may be allocated later.

Related: [PROGRAM.md](./PROGRAM.md), [CHAIN.md](./CHAIN.md),
[APPLICATION_NAMESPACES.md](./APPLICATION_NAMESPACES.md),
[snippets/sidechains.md](../snippets/sidechains.md).
