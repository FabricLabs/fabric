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
| `fabric-execution` | Hub structured steps (`Push`/`Pop`/`Dup`/`ADD`/`FabricOpcode`/…). Untrusted runs execute in a child process |
| `javascript` | Step names. Source functions register only with `trusted: true` (local operator) |
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

Unknown steps throw, including when no allow-list is set (`runProgram` returns `ok: false`). An allow-list also rejects `define()` of off-list names. One `compute` stops at 256 steps and a stack of 64, the same caps as `executionProgramRunner` (`maxSteps` / `maxStack` on the Machine). A `javascript` program's functions run only when the caller passes `{ trusted: true }`, in this process. `fabric-execution` runs in a child process (`Program.runIsolated`, entry `types/program.js`): the child gets `PATH` and `FABRIC_PROGRAM_ISOLATE=1`, not the parent environment and not host `define()` functions. `{ isolate: true }` does the same for a `fabric-opcodes` script. This is not a hardened virtual machine.

## Paid jobs

A bonded job is a `ComputeOffer` `CONTRACT_MESSAGE`
(`functions/computeJob.js`). The known program is `Program.programHash`. The
worker stakes a `Bond.buildDeposit` whose answer leaf commits to the claimed
run (`answerHashForRun`). Any peer reruns the program. A matching rerun pays
the worker from a bounty after the challenge window: the preimage is the
`runCommitmentHex`. A mismatch is a `wrong-run` fraud proof, and
`preparePenaltySpend` moves the deposit.

Only deterministic `fabric-opcodes` and `fabric-execution` runs of at most
256 steps can be bonded. `javascript` and `trusted: true` are refused before
a bond is built. The proof carries the program and the input, not an
execution trace; `verify()` reruns. This is not a hardened virtual machine.
JoinMarket fidelity bonds (`Bond.buildFidelity`) stay a coinjoin reputation
lock. Hub `RunExecutionContract` stays a local operator run and does not
create a `ComputeOffer`.

## L1 redeemability

Goal: a Program compute result can authorize spending an L1 Bitcoin output.

**Architecture split (do not collapse):**

| Layer | Role |
|-------|------|
| **`Machine` + `Program`** | Deterministic off-chain runner; content-addressed `programHash` + `runCommitmentHex` (`FabricProgramRun`) |
| **ARC Taproot** (`resolveSpend` / authority ladder) | Redeemable P2TR k-of-n (+ CSV soft tier); tip-bound by `stateDigest` + `bitcoinBlockHash` |
| **Binding** (`Program.bindRun` / `Program.validateBinding`) | Seal run digests onto `tip.content.program`; withdrawals MUST carry matching digests when the tip (or genesis `fabric.program` / `primitives.opcodes` / `spendPolicy.requireProgramRun`) requires it |

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
} = require('@fabric/core/types/policy');

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

**Program → hashlock leaf:** `Policy.hashlockFromProgramRun`,
`Policy.withRunHashlock` (or `policy.withRunHashlock(run)` on an instance) attaches a hashlock
whose `commitmentHex` is the Machine `runCommitmentHex`. That **changes** the
P2TR address and L1-enforces the commitment without co-signers on the hashlock
path. The leaf requires a Schnorr signature from `run.pubkeyHex` as well as the
preimage; a preimage-only leaf needs an explicit `allowPreimageOnly: true` —
intentional threat model only.

**Validator recompute:** federation members SHOULD refuse to sign until
`Federation.evaluateValidatorSignGate` (`types/federation`) passes (epoch
digests + reserve conservation + optional `Program.verifyMachineRun`). Hub
Beacon auto-sign and vault PSBT prep call this gate when validators are set.

1. **1-round (today)** — run Program on Machine → `Program.bindRun` → `Contract.buildWithdrawalRequest` copies digests → threshold witnesses + PSBT.
2. **2–3 round** — federation / challenge–response before the witness is final (Beacon / Federation helpers).
3. **Scaffold** — `bitcoin-script` `toRedeemScript()` / `OP_CHECKREDEEM` compile stub (not yet a Machine opcode).
4. **Optional hashlock** — attach leaf at publish/compose time; `prepareHashlockWithdrawalPsbt` + `finalizeHashlockPsbt({ preimage32 })` (pure) or preimage+sig.
5. **Blinded execution scaffold** — [`functions/blindedExecutionCircuit.js`](../functions/blindedExecutionCircuit.js) composes garbler `CONTRACT_PUBLISH` → ContractProposal accept/reject → content-addressed `circuitCommitment` → optional hashlock Taproot / PSBT bind. This is **composition + digests**, not Yao gate garbling/OT (still a future backend behind the same commitments). Signed `at` on accept/reject binds the decision timestamp; that does **not** make the scaffold a real GC/OT protocol. Do not market it as Yao/GC.

```js
const Contract = require('@fabric/core/types/contract');
const Program = require('@fabric/core/types/program');

const { ok, tip: stackTip, stack, runCommitmentHex } = await machine.runProgram(prog);
const tip = Program.bindRun(arcTip, {
  programHash: prog.programHash,
  runCommitmentHex
});
const withdrawal = Contract.buildWithdrawalRequest({
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

Related: [CHAIN.md](./CHAIN.md), [DISTRIBUTED_EXECUTION.md](./DISTRIBUTED_EXECUTION.md), [FEDERATED_SETTLEMENT.md](./FEDERATED_SETTLEMENT.md).
