# Federated settlement
How Fabric moves **explicit Bitcoin value** under a federation without treating
a digest as a claim, and without standing up a second consensus coin.

This is the index. Detail lives in sibling docs:

| Doc | Track |
|-----|--------|
| [PEG_OPERATIONS.md](PEG_OPERATIONS.md) | Two-way peg: mature credit, burn-then-release, destination lock, emergency spend |
| [AMOUNT_PRIVACY.md](AMOUNT_PRIVACY.md) | Reusable receive (BIP352) then optional amount blinding |
| [ISSUED_INSTRUMENTS.md](ISSUED_INSTRUMENTS.md) | Named instruments on contract state — not a new L1 asset type |
| [SIGNATURE_PROOF_MODEL.md](SIGNATURE_PROOF_MODEL.md) | Witnesses vs digests vs L1 observability |
| Hub [FEDERATED_SETTLEMENT.md](https://github.com/FabricLabs/hub.fabric.pub/blob/master/docs/FEDERATED_SETTLEMENT.md) | RPCs, env, operator gates |

**Proof rule (unchanged):** signatures authorize; digests commit; Bitcoin
timestamps. A `stateDigest` is never withdrawal authority.

## What “done” means
A federation can:

1. Credit **matured** L1 deposits into `/federationReserve`.
2. Burn outstanding sats, then release the same amount from the vault to a
   **destination that proves it belongs to an authorized set**.
3. Refuse to sign when local snapshots, reserve conservation, or (when bound)
   a Program run do not match.
4. Recover vault coins after a published timelock if the live threshold is
   lost.
5. Pin the code that signers actually run (tagged `@fabric/core`, Hub lockfile
   SHA) **before** the vault holds coins others rely on.

Lightning, Payjoin, and inventory HTLC stay **adapters and markets** on the
same identity — they are not a substitute for (1)–(5).

## Tracks

| Id | Name | Status | Gate |
|----|------|--------|------|
| **F0** | Explicit reserve + tip-bound withdrawal | **Shipped** | `amountSats` in `ContractWithdrawalRequest`; `federationReserveLedger` (verified `vaultConfirmedSats` on credit; pending burns until L1 settle); `evaluateValidatorSignGate` |
| **F1** | Destination authorization | Next | Withdrawal address must prove membership in a published allowlist (xpub / descriptor), not “any script the signers accept” |
| **F2** | Peg loop | Next | Watch vault deposits to `maturityDepth`; credit once; burn outstanding **then** broadcast the vault spend |
| **F3** | Emergency recovery | Next | Script-path CLTV (or CSV) + recovery quorum; documented test that the live key set cannot block forever |
| **F4** | Compact aggregate spend | Open | Implement MuSig2 for vault / epoch **or** stop naming it; today’s seal is k-of-n BIP340 accumulate |
| **F5** | Functionary signing | Open | PSBT (or descriptor) export that a hardware / air-gapped signer can complete without the Hub host holding the spend key |
| **P1** | Receive privacy | Deferred | BIP352 silent payments once Bitcoin Core / libsecp surfaces are stable |
| **P2** | Amount blinding | Deferred | Optional; requires conservation proofs that bind value, instrument id, and `scriptPubKey`. No verifier cache on a subset of those fields. Tagged release before any signer runs it |
| **I1** | Issued instruments | Later | Contract-layer balances with issuer / reissuer roles — see [ISSUED_INSTRUMENTS.md](ISSUED_INSTRUMENTS.md) |
| **X1** | Release pin | Always | Tag core; pin Hub; do not fund a shared vault from an untagged `feature/*` tip |

Application mesh (chat, Groups, mission gossip) does **not** wait on F1–F5.

## Non-goals
- A Bitcoin-Core fork or a second mined / federated block chain for settlement.
- Treating Hub Beacon epochs as a substitute for L1 finality on vault coins.
- Shipping amount blinding as a cache-optimized consensus trick.
- Native multi-asset scriptPubKeys on Bitcoin.
- Claiming a sandboxed contract VM until [AUDIT.md](../AUDIT.md) isolate work lands.
- Making Lightning, L402, or HTTP payment schemes the inner invoice type.

## Current code (F0)
| Piece | Where |
|-------|--------|
| Reserve conservation | `functions/federationReserveLedger.js` |
| Withdrawal request / witnesses | `functions/contractSpend.js` |
| Partial vault PSBT | `functions/contractTaproot.js` `prepareLeafPsbt` |
| Pre-sign gate | `functions/federationValidatorVerify.js` |
| Program → hashlock leaf | `functions/programTaprootBind.js` |
| Hub credit / propose / prepare | `CreateFederationPegInCredit`, `ProposeFederationPegOut`, `PrepareFederationVaultWithdrawalPsbt` |

## How to take a track
1. Write or extend the sibling doc’s **acceptance** list (tests first).
2. Keep amounts explicit until P2 is designed and tagged.
3. Fail closed when validators are configured (no admin-token shortcut for
   vault release).
4. Do not expand RC marketing copy until X1 is done for that surface.

Owner go-ahead is still required before implementation slices land on a
release branch. This file is a map, not a ship list.
