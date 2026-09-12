# Amount and receive privacy
Privacy for **value** on Fabric’s Bitcoin path. Message-layer seals (GroupChat,
onion `P2P_FORWARD`, priced document ciphertext) are out of scope here — see
[PRIVACY.md](../PRIVACY.md) and [MESSAGE_BODY.md](MESSAGE_BODY.md).

Index: [FEDERATED_SETTLEMENT.md](FEDERATED_SETTLEMENT.md). Tracks **P1** and **P2**.

## Order of work
1. **P1 — reusable receive.** BIP352 silent payments (or equivalent static
   payment codes) so a federation or user can publish one receive identity
   without address reuse.
2. **P2 — optional amount blinding.** Hide amounts (and later instrument ids)
   from third-party observers while **keeping explicit conservation** for
   signers.

Do not ship P2 before P1 has a scanning story. Do not ship P2 as a
performance cache over incomplete commitments.

## P1 — Receive privacy
**Goal:** a published receive code that does not reuse on-chain addresses.

**Inputs we will wait on:** Bitcoin Core / libsecp256k1 silent-payment
surfaces. Fabric does not need a private scan-key protocol of its own.

**Acceptance:**
- Encode / decode a silent-payment address from Fabric identity material
  (or an explicit scan/spend pair derived from the Environment).
- Build a spend to that address from a known outpoint set (send path).
- Scan a block / tx list with the scan key (receive path). Light-client
  scan can follow full-node scan.
- Labels (BIP352) are optional follow-up.
- No Hub RPC that returns other users’ scan keys.

**Non-goals for P1:** mixing, CoinJoin policy, or changing the reserve
ledger to blinded amounts.

## P2 — Amount blinding
**Goal:** observers of L1 (or of gossiped state) cannot read amounts; **every
signer** can still prove conservation.

### Required properties
A blinded output commitment MUST bind at least:

| Field | Why |
|-------|-----|
| Value | Conservation |
| Instrument id | Stop proof reuse across instruments (default instrument = BTC sats) |
| `scriptPubKey` / spend condition | Stop proof reuse onto a different vault or user script |

Verifier implementations MUST NOT cache “this proof was valid” under a key
that omits any of those fields. If a cache exists, the key is the full bind
tuple (or the cache is disabled). A tagged `@fabric/core` release is required
before any federation member runs P2 code against a shared vault.

### Conservation
Signers recompute or verify a **range / balance proof** against the same
`/federationReserve` (or instrument ledger) they use in F0. Digests of blinded
state still do not authorize withdrawal — F1 destination lock and tip-bound
`amountSats` (or an equivalent signer-visible amount) remain.

Until those proofs exist, Hub and core stay on **explicit sats**.

### Acceptance (design + tests before merge)
- Proof verification fails if value, instrument id, or script is substituted
  from another valid proof.
- Cache-miss and cache-hit paths produce identical accept/reject (or there is
  no cache).
- Federation sign gate refuses blinded state it cannot re-prove.
- Release checklist includes “P2 tag + pin” as a distinct X1 event.

## What we will not do
- Invent a new confidential-transaction consensus coin.
- Enable P2 on mainnet vaults from a branch tip.
- Treat `sensitive: true` on AMP frames as amount privacy.

## Related
- [SIGNATURE_PROOF_MODEL.md](SIGNATURE_PROOF_MODEL.md)
- `functions/federationReserveLedger.js` (explicit F0 ledger)
- `functions/federationValidatorVerify.js`
- Bitcoin BIP352 (external)
