# Sidechains
In contrast to an **anchor chain**, a **sidechain** is only shared between a set of mutually-interested peers.

## Bitcoin Sidechains
### Example
1. Bitcoin mainchain (the "anchor chain")
2. Fabric sidechain (Alice, Bob, and Carol)

#### Example Flow
1. Alice transfers 1 BTC to the sidechain (the **"peg-in"**), crediting 1 BTC (the mainchain asset) and debiting 1 F-BTC (the sidechain asset)
2. Alice transfers 0.2 F-BTC to Bob, creating a **sidechain transaction** with herself receiving 0.8 F-BTC and Bob receiving 0.2 F-BTC
3. Alice, Bob, and Carol gossip the **sidechain transaction**, validate it, and create a **sidechain block**
4. Bob now controls 0.2 F-BTC, and redeems it on the mainchain (the **"peg-out"**) for 0.2 BTC (the **anchor asset**)
5. Alice may continue transacting with her 0.8 F-BTC or redeem it back for 0.8 BTC

## The Elements Project
To reduce complexity in sidechain implementations, [the Elements Project][elements-project] is forked from the Bitcoin Core source code — thereby retaining the same APIs as Bitcoin itself, but adding any new features or functionality as new RPC methods.

## Fabric sidechain documents
Fabric utilizes sidechains as **shared mutual-state documents** (Hub: “sidechain
state”), enabling proof-by-authorization modification of a shared JSON value
validated against rules pre-determined by the initial contract.

**Implementation:** `@fabric/core/functions/sidechainState` — see
[docs/DISTRIBUTED_EXECUTION.md](../docs/DISTRIBUTED_EXECUTION.md). Hub binds state
digests to Beacon epochs and persists `sidechain/STATE`, `SNAPSHOTS`, and
`JOURNAL`. Not a Fabric type.

### Bond Phase
An initial bond is offered, typically at an `n:1` ratio where `n` is the number of contract counterparties.

### Negotiation Phase
Contract proposals are shared between peers until an `n of n` agreement is reached.

### Execution Phase
Transactions are made which modify contract state along the terms of the unanimously-agreed contract.

### Closure Phase
The contract is complete, and all parties are in possession of the final state, enabling unlock and spending on the anchor chain.

[elements-project]: https://elementsproject.org
