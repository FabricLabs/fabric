# Issued instruments
Named balances **inside a Fabric contract / sidechain**, not a new Bitcoin
scriptPubKey type and not a second mined asset.

Index: [FEDERATED_SETTLEMENT.md](FEDERATED_SETTLEMENT.md). Track **I1** — later
than F1–F3. Bitcoin sats in `/federationReserve` remain instrument `btc`.

## Why this is a contract interface
[CONTRACTS.md](CONTRACTS.md) already treats payment, crowdfund, and program
surfaces as interfaces on one published object. An **instrument** is another
interface: issuer, holders, and (optional) reissuer share a ledger under a
namespace, with federation witnesses on patches.

Wallets and explorers may display a ticker; the wire id is a 32-byte
commitment to the issuance genesis (issuer pubkey + policy + metadata hash).

## Minimum object
```js
{
  instrumentId: '<64-hex>',
  ticker: 'USD-NOTE',
  precision: 2,
  issuer: '<compressed pubkey hex>',
  reissuer: '<compressed pubkey hex or null>',
  supplySats: 0,
  policy: {
    mint: 'issuer',
    burn: 'holder-or-issuer',
    transfer: 'holder'
  }
}
```

`supplySats` uses integer minor units (same habit as Bitcoin sats). Display
divides by `10 ** precision`.

## Roles
| Role | May |
|------|-----|
| Issuer | Create the instrument; mint per policy |
| Reissuer | Increase supply when a reissue token / role is set |
| Holder | Transfer or burn their balance |
| Federation | Witness patches; never invent supply |

Mint and reissue are **explicit** patches. Hidden inflation is a failed
conservation check, same as F0.

## Conservation (per instrument)
```
sum(holder balances) + pendingBurns == supplySats
```

Cross-instrument transfers (e.g. swap) are two burns + two mints in one
witnessed patch, or an atomic Program bind ([PROGRAM.md](PROGRAM.md)) — not an
implicit consensus multi-asset vin/vout.

## What we will not do in I1
- Extend Bitcoin Script with asset ids.
- Blind instrument type before P2 in [AMOUNT_PRIVACY.md](AMOUNT_PRIVACY.md)
  is designed (proofs must bind instrument id).
- Require every GoonCitizen / mesh app to speak instruments.
- Treat document `purchasePriceSats` as an issued instrument (that stays BTC).

## Acceptance (when the track opens)
- Genesis create + mint + transfer + burn unit tests.
- Reissue without role → reject.
- Conservation break → `evaluateValidatorSignGate` fails.
- Beacon / path policy allowlist for `/instruments` (deny free-form mint
  paths), same pattern as `/federationReserve`.
- Issuer metadata (name, domain) is advisory; id is the genesis commitment.

## Related
- [APPLICATION_NAMESPACES.md](APPLICATION_NAMESPACES.md)
- Hub ADR-001 contract sidechains
- `functions/federationReserveLedger.js` (pattern for `btc` only)
