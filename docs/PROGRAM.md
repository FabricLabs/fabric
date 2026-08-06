# Fabric Program
`Program` is Fabric’s multi-language executable artifact. **`Machine`** loads and
runs programs; **`Chain` / `Block`** remain consensus; the **sidechain document**
(`functions/sidechainState`) remains the sealed JSON document under the
distributed-execution helper family.

There is **no** `DistributedExecution` type and **no** `Statechain` type.
Protocol helpers live under `functions/` (`fabricCanonicalJson`,
`beaconFederationSigning`, `fabricProgramManifest`, `sidechainState`).

## Languages

| Language | Status |
|----------|--------|
| `fabric-opcodes` | Runnable on Machine (define / opcode registry) |
| `javascript` | Step names + registerable functions via `Machine.define` |
| `bitcoin-script` | Compile via bitcoinjs; `toRedeemScript()` for L1 P2WSH/P2TR leaf scaffold |
| `solidity` | Compile stub (Compiler frontend later) |
| `asm` | Compile stub |

```js
const Program = require('@fabric/core/types/program');
const Machine = require('@fabric/core/types/machine');

const prog = Program.from({
  language: 'fabric-opcodes',
  steps: ['OP_TRUE']
});
prog.compile();

const machine = new Machine();
machine.define('OP_TRUE', () => true);
const { ok, tip, runCommitmentHex } = await machine.runProgram(prog);
```

## L1 redeemability (scaffold)

Goal: a Program compute result can authorize spending an L1 Bitcoin output.

1. **1-round** — `bitcoin-script` redeem script (`toRedeemScript`) + preimage /
   witness from Machine result (`runCommitmentHex` binds `programHash` + result).
2. **2–3 round** — federation / challenge–response before the witness is final
   (Beacon / Federation helpers; same Schnorr verify path as epoch seals).
3. **Future** — garbled circuits via existing `Circuit` (not implemented here).

Do **not** confuse gossip Blocks or raw SC events with redeem authority.

## Manifest

`Machine.parseManifest(raw)` (also `functions/fabricProgramManifest`) validates
`programId` / `programHash` + allowed message types + optional federation /
`sidechainPolicy`. HTTP routes that expose this remain in `@fabric/http`
(`distributedExecutionHttp` binder — service surface only).

Related: [CHAIN.md](./CHAIN.md), [DISTRIBUTED_EXECUTION.md](./DISTRIBUTED_EXECUTION.md).
