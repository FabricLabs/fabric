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
| `fabric-execution` | Hub structured steps (`Push`/`Pop`/`Dup`/`ADD`/`FabricOpcode`/…) on Machine stack |
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
// Optional ARC genesis allow-list (fail closed for define / load / compute):
machine.applyGenesisOpcodes({ primitives: { opcodes: ['OP_TRUE'] } });
machine.define('OP_TRUE', () => true);
const { ok, tip, runCommitmentHex } = await machine.runProgram(prog);
```

When `allowedOpcodes` / `primitives.opcodes` is set, unknown steps and `define()` of off-list names throw (or `runProgram` returns `ok: false`). With no allow-list, unknown steps still soft-coerce to `0` (legacy).

## L1 redeemability

Goal: a Program compute result can authorize spending an L1 Bitcoin output.

**Architecture split (do not collapse):**

| Layer | Role |
|-------|------|
| **`Machine` + `Program`** | Deterministic off-chain runner; content-addressed `programHash` + `runCommitmentHex` (`FabricProgramRun`) |
| **ARC Taproot** (`resolveSpend` / authority ladder) | Redeemable P2TR k-of-n (+ CSV soft tier); tip-bound by `stateDigest` + `bitcoinBlockHash` |
| **Binding** (`functions/contractProgramBind`) | Seal run digests onto `tip.content.program`; withdrawals MUST carry matching digests when the tip (or genesis `fabric.program` / `primitives.opcodes` / `spendPolicy.requireProgramRun`) requires it |

Binding a run **does not** change the P2TR address by itself — co-signers refuse
stale/forged runs via withdrawal validation. An **optional hashlock leaf**
(`spendPolicy.hashlock` / `composeTaprootTree({ hashlock })`) **does** change the
address and L1-enforces `commitmentHex` (often `runCommitmentHex` or
`SHA256(preimage)`) without co-signers when spent via the hashlock path.

## Composable Taproot trees (wallet UI)

```js
const {
  synthesizeDefaultLadder,
  composeTaprootTree,
  buildSpendLeaf,
  buildHashlockLeaf,
  buildScriptLeaf,
  prepareHashlockWithdrawalPsbt,
  finalizeHashlockPsbt
} = require('@fabric/core/functions/contractTaproot');

const tree = composeTaprootTree({
  network: 'regtest',
  policy: synthesizeDefaultLadder({ validators, threshold, publisher, network: 'regtest' }),
  // optional — changes address:
  hashlock: { commitmentHex: runCommitmentHex, id: 'hashlock-run' },
  extraLeaves: [
    buildScriptLeaf({ id: 'custom', asm: 'OP_TRUE' })
  ]
});
// tree.leaves[{ id, kind, tapscriptHex, witnessShape, commitmentHex }]
```

Leaf kinds: `spend` | `migrate` | `hashlock` | `script`. Authority ladders stay
the default; wallets SHOULD render `leaves[]` and let operators pick `leafId`
when preparing a PSBT.

1. **1-round (today)** — run Program on Machine → `bindProgramRunToTip` → `buildWithdrawalRequest` copies digests → threshold witnesses + PSBT.
2. **2–3 round** — federation / challenge–response before the witness is final (Beacon / Federation helpers).
3. **Scaffold** — `bitcoin-script` `toRedeemScript()` / `OP_CHECKREDEEM` compile stub (not yet a Machine opcode).
4. **Optional hashlock** — attach leaf at publish/compose time; `prepareHashlockWithdrawalPsbt` + `finalizeHashlockPsbt({ preimage32 })` (pure) or preimage+sig.
5. **Blinded execution scaffold** — [`functions/blindedExecutionCircuit.js`](../functions/blindedExecutionCircuit.js) composes garbler `CONTRACT_PUBLISH` → ContractProposal accept/reject → content-addressed `circuitCommitment` → optional hashlock Taproot / PSBT bind. This is **composition + digests**, not Yao gate garbling/OT (still a future backend behind the same commitments).

```js
const { bindProgramRunToTip, buildWithdrawalRequest } = require('@fabric/core/functions/contractSpend');

const { ok, tip: stackTip, stack, runCommitmentHex } = await machine.runProgram(prog);
const tip = bindProgramRunToTip(arcTip, {
  programHash: prog.programHash,
  runCommitmentHex
});
const withdrawal = buildWithdrawalRequest({
  tip,
  contractId,
  destinationAddress,
  genesis // optional; enforces bind when interfaces include fabric.program
});
```

Do **not** confuse gossip Blocks or raw SC events with redeem authority. Hub
`CreateExecutionContract` / `RunExecutionContract` run on core
`Machine` + `Program` (`language: 'fabric-execution'` via
`functions/executionProgramRunner`). `programDigest` /
`programHash` are `Program.programHash`; `runCommitmentHex` is
`Program.runCommitmentHex` (legacy `executionRunCommitmentHex` retained).

## Manifest

`Machine.parseManifest(raw)` (also `functions/fabricProgramManifest`) validates
`programId` / `programHash` + allowed message types + optional federation /
`sidechainPolicy`. HTTP routes that expose this remain in `@fabric/http`
(`distributedExecutionHttp` binder — service surface only).

Related: [CHAIN.md](./CHAIN.md), [DISTRIBUTED_EXECUTION.md](./DISTRIBUTED_EXECUTION.md).
