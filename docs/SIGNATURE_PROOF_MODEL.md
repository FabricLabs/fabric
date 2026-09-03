# Signature proof model
Fabric separates **who authorized a transition** from **what was committed** and from **what appeared on Bitcoin L1**.

## Rule
**Signatures authorize state transitions.** Schnorr witnesses (BIP340) on canonical signing strings prove federation approval for sidechain patches, Beacon epochs, and contract tips.

**L1 observes and timestamps.** OP_RETURN payloads and block/tx documents anchor or index commitments; they do not replace mesh federation witnesses.

## Authorization layer (primary proof)

| Mechanism | Signing string / wire | Proves |
|-----------|----------------------|--------|
| AMP `Message` | Tagged `Fabric/Message` hash | Wire signer authorized the frame |
| `federationWitness` | `signingStringForSidechainStatePatch` | k-of-n approved an RFC6902 patch proposal |
| `federationWitness` (epoch) | `signingStringForBeaconEpoch` | k-of-n approved a Beacon epoch payload |
| `ContractStateTip` | Contract-namespace tip string | k-of-n approved a namespace head digest |
| `CONTRACT_PUBLISH` | AMP + authority list in genesis body | Publisher is listed in `validators` / `members.signers` / `spendPolicy.validators` |
| Device-link / identity cluster | UTF-8 challenge strings | Mutual Schnorr attestation between devices |

Helpers: `functions/sidechainState.js`, `functions/beaconFederationSigning.js`, `functions/contractStateSigning.js`, `functions/contractPublishAuthority.js`.

Operator identity for those signatures is the Fabric Environment (`fabric setup` / `FABRIC_XPRV` / sealed `~/.fabric/wallet.json`). See `functions/fabricOperatorIdentity.js` — exclusive xprv-first so Hub and publishers do not split on Key’s mnemonic-first constructor.

## Commitment layer (integrity, not authorization)

| Artifact | Role |
|----------|------|
| `stateDigest` | SHA-256 over canonical sidechain `{ version, clock, content }` |
| `patchCommitmentDigestHex` | Hash of `{ basisClock, basisDigest, patches }` |
| `runCommitmentHex` / `programHash` | Deterministic execution run digest |
| Execution run attestation | `signingStringForExecutionRun` + federation witness (before L1 anchor when validators set) |
| Merkle roots (Beacon chain, document index) | Aggregate ordering / inventory |

Digests answer **what** changed. They do not prove **who** approved the change unless paired with a witness above.

## L1 observability (secondary — not federation proof)

| Magic / format | Module | Purpose | Validator-signed? |
|----------------|--------|---------|-------------------|
| `fab100` | Hub `sidechainBlockScan` | Scan OP_RETURN for sidechain signals | No — read-only |
| `c0d3f33d` (40 bytes) | `functions/fabricHallmark.js` | Hallmark commitment over tip + contract + sidechain/contracts digests | No — Hub wallet tx (admin-gated) |
| 32-byte run hash | Hub `AnchorExecutionRunCommitment` | Execution run anchor (regtest today) | No — admin + wallet |
| Bitcoin block/tx documents | `bitcoinBlockDocument.js` | Immutable L1 snapshot catalog | Content hash; AMP on publish/transfer |

Hallmarks are **on-chain only** — not Fabric P2P frames. See `docs/STATECHAIN.md`.

## Hub write paths (strict production)

When `FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS` (or persisted equivalent) is non-empty:

1. `SubmitSidechainStatePatch` requires **`federationWitness`** — admin token is rejected.
2. Beacon epochs require valid federation witnesses (`federationWitnessFailClosed`).
3. `_applySidechainPatchesTrusted` is disabled unless `FABRIC_SIDECHAIN_TRUSTED_PATCH=1` (regtest/playnet only).
4. `AcceptTrackedApplicationContract` verifies pending publish **`signer`** against contract authority lists.

When validators are unset, operator **admin token** remains the HTTP shortcut for local desktop Hub.

## Federation validators: deterministic next-state

Each validator:

1. Observes **local L1 tips** (`bitcoind` `block` events; Beacon `followBlocks` when validators are set, including regtest).
2. Folds gossiped contract / sidechain digests into a **canonical epoch** (`canonicalEpochForFederation` — no wallet balance or wall-clock).
3. Seals **`payload.contracts.merkleRoot`** (accepted tracked contracts Tree / digest) into the Beacon broadcast alongside `stateDigest`.
4. Accumulates **k-of-n BIP340 Schnorr** signatures over `signingStringForBeaconEpoch` (`FederationSignRequest` / `FederationSignResponse` gossip). MuSig2 single-sig aggregation is stubbed (`musig2EpochAggregate`); production path is multi-sig accumulate until threshold.

## Related docs

- Core: [DISTRIBUTED_EXECUTION.md](DISTRIBUTED_EXECUTION.md), [STATECHAIN.md](STATECHAIN.md)
- Hub: [DISTRIBUTED_CONTRACT_EXECUTION.md](https://github.com/FabricLabs/hub.fabric.pub/blob/master/docs/DISTRIBUTED_CONTRACT_EXECUTION.md), [FEDERATION_DEPLOYMENT.md](https://github.com/FabricLabs/hub.fabric.pub/blob/master/docs/FEDERATION_DEPLOYMENT.md)
