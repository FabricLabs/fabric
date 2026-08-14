# Fabric Chain

`Chain` is a ledger of Bitcoin-shaped **[`Block`](../types/block.js)** values.
Consensus policy on the Chain chooses how a tip is accepted — not a parallel
entry type:

| Consensus | Use | Authority |
|-----------|-----|-----------|
| `pow` (default) | Bitcoin / playnet Block + mempool | Parent link; optional `bits`/`nonce` PoW |
| `federation` | Hub Beacon `BEACON_EPOCH` (`beacon/CHAIN`) | Linear tip; Elements-style k-of-n Schnorr on the block |
| `gossip` | Combined authored observation / event-batch firehose | Content-addressed union by block id; optional author Schnorr |

**Prior art:** Bitcoin (PoW + parent); Blockstream Elements / Strong Federations
(`signblockscript`, threshold block signers); application **data** blocks for
authored observations.

**Sidechain document helpers** (`functions/sidechainState`) hold the sealed JSON
document. Tip digests feed that document / app snapshots — raw gossip never
becomes Beacon consensus.

Related: [DISTRIBUTED_EXECUTION.md](./DISTRIBUTED_EXECUTION.md), [PROGRAM.md](./PROGRAM.md).

## Module

```js
const Chain = require('@fabric/core/types/chain');
const Block = require('@fabric/core/types/block');
// or: Fabric.Chain / Fabric.Block
```

### Block header (Bitcoin-shaped)

| Field | Role |
|-------|------|
| `parent` | Previous tip id (`null` at genesis) |
| `height` | Monotonic clock on this chain |
| `transactions` | Map id → tx |
| `data` | Opaque JSON (Beacon epoch payload or SCEvent body) |
| `type` | e.g. `Block` \| `BEACON_EPOCH` \| `SCEvent` |
| `merkleRoot` | From tx ids and/or data digest |
| `nonce` / `bits` | Optional PoW |
| `author` | Optional pubkey (gossip) |
| `signatures` / `federationWitness` | Optional Elements-style multi-sig |

Methods: `digest()`, `signingString()`, `sign(key)`, `addSignature(pubkey, sig)`,
`validate({ consensus, validators, threshold, bits })`, `toRecord()` / `fromRecord()`.

### Chain API

| Concern | API |
|---------|-----|
| Construct | `Chain.create({ consensus })`, `fromJSON` / `toJSON` |
| Mutate | `append(block)`, `pop`, `merge`, `truncateAt`, `pruneByBeaconHeight` |
| Read | `tip`, `height`, `entries` / `blocks`, `at`, `replay`, `digest` |
| Split | `split({ by: 'clock'\|'time'\|'author'\|'predicate', ... })` |
| Verify | `verify(validators?, threshold?)` |
| Beacon codec | `fromBeaconMessages`, `toBeaconMessages` |
| Gossip ids | `eventId({ source, kind, fields, timestamp })` |
| Playnet mine | `proposeTransaction` → `generateBlock` → `append` |

Deprecated aliases: `seal: 'block'|'federation'|'gossip'` maps to
`consensus: 'pow'|'federation'|'gossip'` for one release (`SEAL_*` exports remain).

## Consensus rules (short)

- **pow:** playnet Block ledger; optional PoW when `settings.bits` is set.
- **federation:** `append` requires `parent === tip.id`; `merge` rejects forks;
  `verify` checks `federationWitness` (Beacon epochs use
  `signingStringForBeaconEpoch`).
- **gossip:** `append` is idempotent by block id; `merge` unions by id then
  stable-orders by `(timestamp, height, author, id)`; `verify` checks author
  signatures when present.
