# Application Resource Contracts (ARC)

**Status:** Draft — formalizes the Contract / ARC wire + state model for `@fabric/core` 0.1.x (`VERSION_NUMBER = 0x01`).
**Driven by:** security review themes on [FabricLabs/fabric#183](https://github.com/FabricLabs/fabric/pull/183) (authz, spend-policy fail-closed, path policy, Token grants).

Related: [`CONTRACTS.md`](CONTRACTS.md), [`APPLICATION_NAMESPACES.md`](APPLICATION_NAMESPACES.md), [`DISTRIBUTED_EXECUTION.md`](DISTRIBUTED_EXECUTION.md), [`functions/applicationNamespaces.js`](../functions/applicationNamespaces.js).

---

## 1. What an ARC is

An **Application Resource Contract (ARC)** is a published Fabric **Contract** whose
genesis declares:

1. **Primitives** — which `CONTRACT_MESSAGE` body types (and optional Machine opcodes) are in-bounds
2. **Members** — who may read and who may sign (via Tip roster and/or `Token` grants)
3. **Spend policy** — how tip state maps to a Bitcoin P2TR (and related L2) spending surface
4. **Anchor** — a **Bitcoin block hash** (and preferably height) binding the publish / tip to L1 time

Namespace id = `Actor(genesis).id` after `CONTRACT_PUBLISH` (same as today).

An ARC is **not** a separate opcode family. Outer wire remains:

| Outer | Role |
|-------|------|
| `CONTRACT_PUBLISH` (`0x5f`) | Genesis |
| `CONTRACT_MESSAGE` (`0x60`) | Namespaced events |
| `CONTRACT_PROPOSAL` (`0x8a`) | Batched proposal / patch / optional PSBT |

---

## 2. Genesis object (`CONTRACT_PUBLISH` body)

Minimum fields for a 0.1 ARC genesis (extensible; unknown fields ignored by core):

```json
{
  "@type": "FabricContract",
  "name": "example-arc",
  "interfaces": ["arc.core"],
  "primitives": {
    "messageTypes": [
      "GroupChat",
      "GroupChange",
      "ContractCapabilityGrant",
      "ContractWithdrawalRequest",
      "ContractWithdrawalWitness",
      "MessageReceived",
      "MessageReceipt"
    ],
    "opcodes": []
  },
  "members": {
    "signers": ["<compressed-or-xonly-hex>", "..."],
    "readers": ["*"],
    "threshold": 1
  },
  "spendPolicy": {
    "network": "regtest",
    "publisher": "<pubkey>",
    "validators": ["..."],
    "threshold": 1,
    "csvBlocks": 144
  },
  "sidechainPolicy": {
    "allowedPathPrefixes": ["/registry", "/members"],
    "maxOps": 32
  },
  "bitcoinAnchor": {
    "blockHash": "<64-hex>",
    "height": 0
  }
}
```

### Rules

- **`primitives.messageTypes`**: ingest MUST reject `CONTRACT_MESSAGE` body `type` values not listed (apps may subclass catalogs only by publishing a new genesis or an authorized primitive-extend message — TBD; default fail-closed).
- **`primitives.deliverySync`**: optional synchronization filter for which body types open per-reader `MessageReceived` / `MessageReceipt` 2PC rows (`mode`: `all` | `none` | `include` | `exclude`). Delivery ACK types never open a new pending row.
- **`primitives.opcodes`**: Machine / Program opcode allow-list when the ARC exposes a program interface. Enforced by `Machine.setAllowedOpcodes` / `applyGenesisOpcodes` / `loadProgram({ genesis })` (fail closed when non-empty).
- **`members`**: initial tip roster. Later changes only via authorized `GroupChange` / grant messages (see §4).
- **`spendPolicy`**: input to `contractTaproot` / `Contract#toTaprootContract`. Fail closed on invalid threshold, CSV range, CLTV BIP65 boundary (see PR #183).
- **`bitcoinAnchor.blockHash`**: **required** for public-network ARCs; MUST be a known Bitcoin best-block hash at publish time (or last accepted tip when re-anchoring).

---

## 3. Tip state

Each ARC maintains a tip:

```text
tip = {
  contractId,
  clock,
  stateDigest,          // SHA256(canonical { version, clock, content })
  content,              // members, messages, app bags, …
  bitcoinBlockHash,     // most recent L1 tip this state claims
  bitcoinHeight?
}
```

**Standard:** every accepted state transition that advances `clock` SHOULD refresh
`bitcoinBlockHash` to the peer’s current Bitcoin tip (or Hub Beacon tip). Withdrawal
and L2 spend proofs MUST include the tip’s `stateDigest` **and** `bitcoinBlockHash`.

---

## 4. Members, Tokens, and authz

| Role | Capability | How granted |
|------|------------|-------------|
| Reader | `OP_CONTRACT_READ` | Genesis `members.readers` or `ContractCapabilityGrant` Token |
| Signer | `OP_CONTRACT_SIGN` | Genesis `members.signers` / threshold set or grant Token |

`functions/contractCapability.js` issues/verifies Tokens with `ctx.contractId`.

### MUST (security — PR #183)

1. **Ingest authz:** `contractMessageAccumulate.ingestMessageBuffer` (and equivalents) MUST NOT fold `GroupChange` (or other member/spend mutations) on AMP signature alone. Author MUST be in the current signer set **or** present a verified `OP_CONTRACT_SIGN` Token for this `contractId`.
2. **Verify vs parse:** Token verify without `issuerKey` MUST NOT look like authorization (`allowUnverified` only, result labeled `verified: false`).
3. **Path policy:** RFC6902 / `patchesCanonical` paths MUST stay inside genesis `sidechainPolicy` (no fail-open `policy = null` for registry helpers).

---

## 5. Primitives catalog (core)

Shared body `type` strings (`CONTRACT_BODY_TYPES` in `applicationNamespaces.js`):

| Type | Mutates tip? | Authz |
|------|--------------|--------|
| `GroupChat` | append messages | reader or signer (policy) |
| `GroupChange` | members | **signer only** |
| `ContractCapabilityGrant` | grants | signer / issuer |
| `ContractWithdrawalRequest` | pending spend | signer |
| `ContractWithdrawalWitness` | witness set | signer |
| `GroupJournalRequest` / `Batch` / `GroupStateJournal` | sync | signer / federation |
| `MessageReceived` / `MessageReceipt` | sync filter (sidecar only) | participant (reader set) |


| `FederationContractInvite` (+ Response) | join flow | genesis / validators |

Product apps MAY add types **only** if listed in that contract’s `primitives.messageTypes`.

---

## 6. Tip → UTXO / spending contract

```text
resolveSpend({ genesis, tip }) =
  buildContractTaproot(
    spendPolicy from normalizeArcGenesis(genesis),
    keys := tip.content.signers (else tip.content.members, else genesis signers/validators),
    threshold := tip or genesis threshold
  )
→ { address, policy, leaves, network, stateDigest, bitcoinBlockHash }
```

Implementation: [`functions/contractSpend.js`](../functions/contractSpend.js) (`resolveSpend`, `buildWithdrawalRequest`, `validateWithdrawalRequest`, `prepareWithdrawalFromRequest`). `Contract#resolveSpend` delegates here.

- **L1 withdrawal:** `ContractWithdrawalRequest` **MUST** bind `{ stateDigest, bitcoinBlockHash, destinationAddress, feeSats, … }` to the current tip; co-signers add `ContractWithdrawalWitness` with the same tip fields + `requestId`. Accumulate rejects stale bindings at ingest.
- **Program run binding:** When the tip seals `content.program` (`programHash` + `runCommitmentHex` from `Machine.runProgram` / `FabricProgramRun`), withdrawals MUST carry matching digests (`functions/contractProgramBind`). Genesis may require this via `interfaces: ['fabric.program']`, non-empty `primitives.opcodes`, or `spendPolicy.requireProgramRun`. Binding does **not** by itself change the P2TR address — Machine is the deterministic compute layer; Taproot remains the authority redeem surface.
- **Optional hashlock leaf:** `spendPolicy.hashlock` / `composeTaprootTree({ hashlock, extraLeaves })` adds a tapscript leaf (`OP_SHA256 <commitment> EQUAL` or `… EQUALVERIFY <pk> CHECKSIG`). This **does** change the address. Commitment MAY be `runCommitmentHex` or `SHA256(preimage)`. See `docs/PROGRAM.md` and `prepareHashlockWithdrawalPsbt` / `finalizeHashlockPsbt`.
- **Composable trees:** `buildSpendLeaf` / `buildHashlockLeaf` / `buildScriptLeaf` + `composeTaprootTree` are the wallet-facing leaf API; Hub vault summaries expose `leaves[]` for UI selection.
- **L2 spending:** HTLC / channel offers SHOULD embed the same `contractId`, `stateDigest`, and `bitcoinBlockHash` so counterparties refuse stale tips.
- **Decay / CSV / CLTV:** encode and mature per BIP68/BIP65; never silently clamp k-of-n below declared threshold.

`Contract#_handleBitcoinTransaction` remains a TODO: watch L1 for payments **to** `toAddress()` and fold balance into tip content under signer policy.

---

## 7. Implementation map

| Concern | Module |
|---------|--------|
| Contract class | `types/contract.js` |
| Body type names | `functions/applicationNamespaces.js` |
| Tip → P2TR / withdrawals | `functions/contractSpend.js` |
| Machine/Program run bind | `functions/contractProgramBind.js` (`bindProgramRunToTip`, withdrawal digest checks) |
| Accumulate / fold | `functions/contractMessageAccumulate.js` (signer authz + primitives + withdrawal fold) |
| Token grants | `functions/contractCapability.js`, `types/token.js` |
| Tip Schnorr | `functions/contractStateSigning.js` |
| P2TR ladder | `functions/contractTaproot.js` |
| Sidechain doc | `functions/sidechainState.js`, `contractStatechains.js` |
| Hub tracked accept | Hub `functions/trackedApplicationContracts.js` (`normalizeArcGenesis` + `resolveSpend`) |

---

## 8. Work remaining

1. ~~**Fix** `GroupChange` / member mutation authz in accumulate (PR #183 High)~~
2. ~~**Enforce** `primitives.messageTypes` at ingest~~
3. ~~**Thread** `bitcoinBlockHash` through withdrawal messages~~
4. ~~**Wire** Token grants into member checks~~
5. ~~**Document** Machine `opcodes[]` / Program bind when Program interface is attached~~ — see `docs/PROGRAM.md` + `contractProgramBind`
6. ~~**Complete** L1 payment observation on `Contract`~~ — `functions/contractPaymentObserve` + `Contract#_handleBitcoinTransaction`
7. ~~Align Hub tracked-contract accept path with this genesis shape~~
8. Call sites must pass `meta.genesis.signers` (or persist genesis) for any `GroupChange` path
9. ~~**Enforce** GroupChat reader∪signer authz + BIP340 withdrawal witness / MessageReceipt~~ — `authorizeIngest` + `verifyWithdrawalWitnessSignature` / `markReceipt` (PR #183 review follow-up)
10. **RC deploy:** tag `@fabric/core`, bump Hub + GoonCitizen/`relay.goon.vc` to the tag, verify AcceptTrackedApplicationContract attaches `spendAddress` + tip `bitcoinAnchor`
11. **Network promotion:** `beacon/NETWORK` binding + `FABRIC_BEACON_RESET_NETWORK=1` when flipping regtest → signet/mainnet (see `functions/beaconNetworkGuard.js`)
12. **Beacon as native ARC:** Hub auto-publishes `fabric-beacon` via `functions/beaconContractDefinition` on `startBeacon` (see Hub `docs/DISTRIBUTED_CONTRACT_EXECUTION.md`)
13. **Optional hashlock / composable trees:** `composeTaprootTree`, leaf builders, `prepareHashlockWithdrawalPsbt` — Hub vault PSBT uses full `policy` leaves; wallet UIs list `leaves[]`
14. ~~**ExecutionRun → FabricProgramRun / full Machine runner:**~~ Hub uses `fabric-execution` on `Machine`/`Program` (`executionProgramRunner`); digests via `executionRunBridge`
15. ~~**Enforce** genesis `primitives.opcodes` on `Machine.loadProgram` / `define`~~ — `functions/opcodeAllowList.js` + `Machine.setAllowedOpcodes` / `applyGenesisOpcodes` (fail closed when set; unrestricted legacy soft-coerce otherwise)
### Dual P2TR surfaces → single authority ladder

| Surface | Role |
|---------|------|
| **Authority P2TR** (`taproot-authority-ladder-v1`) | One address: **t0-authority** = k-of-n validators/signers (immediate main-chain withdrawals); **t1-soft** unlocks after ~**144** blocks CSV (default softer rule = 1-of-publisher; optional `softMode: 'reduced'`) |
| Hub Federation vault | Same ladder via `buildFederationVaultFromPolicy` (default; legacy single-leaf opt-in only) |
| ARC `resolveSpend` / `spendAddress` | Same ladder when validators + threshold + network + csvBlocks + publisher match |
| **Beacon ARC** (`fabric-beacon`) | Same authority set as Federation validators; Actor id stable across networks; spend overlay at Accept / re-enrich |

Do **not** maintain a second unrelated vault script for the same authority set. Genesis **MUST NOT** embed tip `bitcoinBlockHash` if Actor id stability across networks is required — Hub overlays network/tip at Accept time.

**Canonical authority bag** (Beacon ARC genesis `spendPolicy`, Hub vault, `resolveSpend` return):

```json
{
  "publisher": "<compressed-hex>",
  "validators": ["..."],
  "threshold": 1,
  "csvBlocks": 144,
  "softMode": "publisher"
}
```

`depositMaturityBlocks` is a deposit-UX alias of `csvBlocks` only. Tip overlays nest as `bitcoinAnchor: { blockHash, height }` (flat `bitcoinBlockHash` remains a summary alias). Spend tip keys prefer `content.signers` over a general `members` roster. Group folds keep **participants** in `members` and **authority** in `signers` / `proposedPolicy.validators` (application accept does not widen spend keys).

Hub asserts vault `spendAddress` ≡ accepted `fabric-beacon` ARC after `startBeacon` (`authorityUnity` on vault / manifest).

---

## 9. Non-goals (0.1)

- Full isolate/vm for arbitrary JS Programs (see `AUDIT.md`)
- Sphinx-level onion privacy inside ARC payloads
- Collapsing Beacon **epoch sealing** (`BEACON_EPOCH` / `beacon/CHAIN`) into application CONTRACT_MESSAGE traffic — the Beacon **service** stays the L1 clock; the Beacon **ARC** is the authority/spend/namespace surface under the same tracked-contract path
- Rewriting frozen GoonCitizen / Group Actor ids — Hub **normalizes** legacy `messageTypes` / `proposedPolicy` into ARC fields without republishing genesis
