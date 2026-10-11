# Peg operations
Operational two-way peg between **Bitcoin L1** and Fabric **`/federationReserve`**.

Index: [FEDERATED_SETTLEMENT.md](FEDERATED_SETTLEMENT.md). Tracks **F1–F3** live
here. **F0** (explicit amounts, tip-bound requests, conservation) is already
required and must not regress.

## Invariants
1. **Conservation.** `outstandingSats + pendingBurnsSats <= vaultConfirmedSats`.
   Operators supply `vaultConfirmedSats` from a local bitcoind view of the vault.
2. **Maturity before credit.** A deposit does not increase `outstandingSats`
   until it has `maturityDepth` Bitcoin confirmations. Default **100** (same
   depth Bitcoin uses for coinbase maturity). Configurable; never below a
   documented floor (propose **6** for signet, **100** for mainnet).
3. **Burn then release.** Outstanding sats move to `pendingBurnsSats` (burn)
   **before** the vault PSBT is broadcast. After L1 confirms, `settlePegOutPayout`
   clears pending and drops `vaultConfirmedSats`. A release without a matching
   burn is a bug. Credits require an independently verified `vaultConfirmedSats`
   (never invent vault totals from deposit proof fields alone).
4. **Tip-bound request.** `ContractWithdrawalRequest` commits `amountSats`,
   destination, and the contract / sidechain tip used to authorize it.
   `stateDigest` alone is not enough.
5. **Destination lock (F1).** The destination must prove it is derived from a
   published authorization set. Threshold signers must not be able to redirect
   a valid burn to an arbitrary address.
6. **Partial amounts.** Vault spends send `amountSats` and return change to the
   vault. Full sweeps are legacy / recovery only.

## Deposit (credit)
```text
user pays vault script
  → watch txid:vout
  → wait maturityDepth
  → CreateFederationPegInCredit (or equivalent signed patch)
  → outstandingSats += amountSats
```

**Acceptance (F2 credit):**
- Duplicate `txid:vout` is rejected.
- Confirmations `< maturityDepth` are rejected.
- Credit that would break conservation is rejected.
- Reorg that unconfirms a credited deposit marks the credit invalid and
  freezes further peg-out until operators reconcile (fail closed).

**Today:** `creditPegIn` / Hub `CreateFederationPegInCredit` exist; there is no
always-on watcher that applies maturity and reorg automatically.

## Withdrawal (burn then release)
```text
user (or officer) proposes withdrawal
  → destination authorization (F1)
  → ProposeFederationPegOut (burn / pending burn)
  → k-of-n ContractWithdrawalWitness when threshold ≥ 2
  → evaluateValidatorSignGate
  → PrepareFederationVaultWithdrawalPsbt
  → functionary signatures (F5)
  → broadcast
```

**Acceptance (F2 release):**
- Prepare is refused if the request is not tip-bound or `amountSats` is missing.
- Prepare is refused if conservation fails after the burn.
- Prepare is refused if destination authorization fails (F1).
- Rate limits (`FABRIC_FEDERATION_PEGOUT_MAX_SATS` /
  `FABRIC_FEDERATION_PEGOUT_DAILY_MAX_SATS`) still apply.
- A second prepare for the same `requestId` is idempotent or rejected — never a
  second L1 spend.

**Today:** propose + prepare + rate limits exist; destination lock and the
automatic burn-then-broadcast loop do not.

## Destination authorization (F1)
Publish a small **authorization set** on the contract / sidechain (descriptors
or account xpubs + BIP32 path policy). A withdrawal proves the destination
script is a derived child of that set — without putting every future address
on the allowlist.

Suggested shape (implementer-owned; keep it boring):

```js
{
  version: 1,
  method: 'bip32-allowlist',
  accounts: [
    { xpub: 'xpub…', path: 'm/84\'/0\'/0\'', script: 'wpkh' }
  ],
  updatedAtClock: 12
}
```

Updates to the set are themselves federation-witnessed patches with a
**delay** (propose N Beacon clocks or N L1 blocks before the new set is live)
so a compromised minority cannot instantly retarget withdrawals.

**Acceptance:**
- Destination outside the live set → reject.
- Delay window not elapsed → old set still governs.
- Empty set when F1 is enabled → reject all peg-out (fail closed).
- Unit tests: happy child, wrong account, tweak / unrelated Taproot, stale set.

Do not implement this as a public list of raw addresses only — that does not
scale and leaks every receive path.

## Emergency recovery (F3)
The vault script MUST include a path that becomes valid after a published
locktime if the live threshold cannot be met (lost keys, unavailable members).

| Path | When | Who |
|------|------|-----|
| Live federation | Now | Current validator set (k-of-n or aggregate) |
| Recovery | After `recoveryLock` (CLTV height/time or CSV) | Recovery quorum (may be a distinct key set) |

**Acceptance:**
- Vectors show live keys cannot spend the recovery path before the lock.
- Vectors show recovery keys can spend after the lock without the live set.
- Recovery destination is also F1-constrained (or a single published recovery
  address committed at vault birth).
- Docs state where recovery keys live (offline). They must not be the same
  files as the online Hub `xprv`.

## Confirmation depth
| Network | Suggested `maturityDepth` | Notes |
|---------|---------------------------|--------|
| Regtest | 1–3 (tests); 100 for “mainnet-shaped” drills | Fast iteration vs realistic freeze |
| Signet | ≥ 6 | Cheap to wait; still exercise the watcher |
| Mainnet | **100** | Coinbase-class reorg protection for credits |

Peg-out L1 confirmations are a separate operator policy (when to mark
`pendingBurns` settled). Do not treat 1 confirmation as final on mainnet.

## Tests to add with each slice
| Slice | Suite |
|-------|--------|
| F1 | `tests/functions.federationDestinationAuth.js` (new) |
| F2 watcher | Hub test with mocked `listunspent` / reorg |
| F2 loop | Credit → propose → prepare → broadcast fixture; double-prepare |
| F3 | `contractTaproot` vector: lock unspent, then recovery spend |

Existing: `tests/functions.federationReserveLedger.js`,
`tests/functions.federationValidatorVerify.js`, contract spend / taproot
suites that already require `amountSats`.

## Related
- `functions/federationReserveLedger.js`
- `functions/contractSpend.js` (`buildWithdrawalRequest`, `validateWithdrawalRequest`)
- `functions/contractTaproot.js`
- Hub `docs/FEDERATION_DEPLOYMENT.md` (network promotion, peg RPC names)
