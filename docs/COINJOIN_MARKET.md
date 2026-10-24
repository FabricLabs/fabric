# L1:L1 Coinjoin Market (experimental)
A peer-to-peer market for mixing on-chain coins. Makers post signed offers to
lend their UTXOs to a coinjoin for a fee; a taker picks several makers and
builds **one** transaction in which every party receives an output of the same
amount, so observers cannot tell which input paid which equal output. Fidelity
bonds (coins time-locked on chain) let takers favour makers who have locked up
capital, which makes Sybil makers expensive.

**Status:** core prototype, **regtest only**. Not in the frozen
[PUBLIC_API.md](../PUBLIC_API.md) table; paths and body shapes may change.
Native Fabric protocol: not wire-compatible with JoinMarket
(`joinmarket-clientserver`), though the model is the same.

| Module | Role |
|--------|------|
| [`functions/coinjoin.js`](../functions/coinjoin.js) | Pure helpers: body normalize / sign / verify / seal, fees, plan, PSBT build, maker + taker checks, key-path signing, ownership proofs |
| [`functions/podle.js`](../functions/podle.js) | Proof of discrete-log equivalence: one commitment per taker UTXO and index, `PodleBlacklist` |
| [`functions/fidelityBond.js`](../functions/fidelityBond.js) | Bond script, redeem PSBT, certificate, chain verification, `bondValue`, `BondVerifier` |
| [`types/coinjoinBook.js`](../types/coinjoinBook.js) | `CoinjoinBook` — local offer book, bond refresh, weighted-random maker choice, index |
| [`types/coinjoinRound.js`](../types/coinjoinRound.js) | `CoinjoinTakerRound` / `CoinjoinMakerRound` — one round's state machines over injected adapters |

## Market model
One instrument: a coinjoin of `amountSats`, P2TR key-path only. An offer covers
`[minSats, maxSats]` and prices the maker's service:

```text
cjfee = feeSats + ⌊amountSats × feePpm / 1e6⌋          (feePpm ≤ 50000)
```

The maker also pays `txFeeContributionSats` toward the miner fee; the taker pays
the rest. The taker pays every maker's `cjfee`, so a maker's change is

```text
makerChange = inputs − amountSats + cjfee − txFeeContributionSats
```

dropped (to miners) below 330 sats. `CoinjoinBook#index(amountSats)` reports
makers, offers, cheapest and median fee, bonded makers, and `topBondShare`.

There is **no central coordinator**. Every node keeps its own `CoinjoinBook`
from offers it hears. `choose(amountSats, count, { maxFeeSats, exclude,
requireBond })` keeps the cheapest fitting offer per maker, then draws makers at
random without replacement, weighted by bond value: unbonded makers weigh
`noBondShare` (default 0.1) × the mean bond value, or all weigh 1 when nobody
is bonded. Price only filters (`maxFeeSats`); it never ranks, so cheap Sybil
offers do not crowd out bonded makers.

## Bodies
All bodies are JSON carried in `CONTRACT_MESSAGE` under contract
`fabric/coinjoin/v1`, `version: 1`, each BIP340 signed by its author over
`stableStringify(jsonSafe(body without signature))`. `bodyId(body)` is the
SHA-256 of that signing string (`offerId`, `fillId`). `fromBody` returns `null`
for anything that does not normalize; `verifyBody` returns
`{ ok, reason, body, id }`.

`toContractMessage(x)` wraps a signed offer, cancel, or sealed envelope for
`buildMessage('CONTRACT_MESSAGE', …)`; `fromContractMessage(value)` reads one
back as `{ kind: 'offer'|'cancel', body, id }` (verified) or
`{ kind: 'sealed', envelope, to }`. Round bodies are refused unsealed.

| Type | Signed by | Sealed to | Fields |
|------|-----------|-----------|--------|
| `CoinjoinOffer` | `makerPubkey` | — (gossiped) | `network`, `scriptType` (`p2tr`), `minSats` (≥ 10000), `maxSats`, `feeSats`, `feePpm`, `txFeeContributionSats`, `createdAt`, `expiresAt`, `makerPubkey`, `nonce`, optional `fidelityBond` |
| `CoinjoinOfferCancel` | `makerPubkey` | — (gossiped) | `offerId`, `makerPubkey`, `createdAt` |
| `CoinjoinFill` | round key | offer `makerPubkey` | `offerId`, `roundId`, `amountSats`, `commitment` (PoDLE), `takerPubkey`, `createdAt`, `nonce` |
| `CoinjoinFillAck` | `makerPubkey` | round key | `offerId`, `roundId`, `fillId`, `makerPubkey`, `sealPubkey`, `createdAt` |
| `CoinjoinAuth` | round key | `sealPubkey` | `roundId`, `fillId`, `takerPubkey`, `reveal` (PoDLE: `txid`, `vout`, `index`, `P`, `P2`, `e`, `s`), `createdAt` |
| `CoinjoinIoAuth` | `makerPubkey` | round key | `roundId`, `fillId`, `makerPubkey`, `inputs` (`txid`, `vout`, `valueSats`, `scriptPubKeyHex`, optional `ownershipSig`), `coinjoinScriptHex`, `changeScriptHex`, `createdAt` |
| `CoinjoinTx` | round key | `sealPubkey` | `roundId`, `takerPubkey`, `psbt`, `createdAt` |
| `CoinjoinSig` | `makerPubkey` | round key | `roundId`, `fillId`, `makerPubkey`, `psbt` (maker inputs signed), `createdAt` |

**Keys.** The taker signs with a fresh **round key** per round, so rounds do
not link to each other or to a long-lived identity. The maker signs with its
offer key and answers the fill with an ephemeral `sealPubkey`; everything after
the fill is sealed to it. Sealing is the participant ECDH seal of
`functions/groupChatSeal` (namespace `fabric/coinjoin/v1`), in the envelope
`{ type: 'CoinjoinSealed', version, to: <x-only>, seal }`. Relays see only `to`.

A PSBT is capped at 22000 base64 characters (`MAX_PSBT_CHARS`) so a sealed
round message fits one 32 KiB message; `buildCoinjoinPsbt` refuses an unsigned
PSBT over half of that (signatures and wallet metadata roughly double it).

## Settlement
One transaction, valid only once **every** party has signed, so nobody is
committed before anyone else and there is no free option. A maker who stalls
costs the taker time, not money: it is dropped and the round rebuilt.

```text
taker (round key)                          maker
  pick makers (CoinjoinBook#choose)
  PoDLE commitment from one wallet UTXO
  | CoinjoinFill (commitment) ------------> |  validateFill, blacklist lookup
  | <------------ CoinjoinFillAck (sealPubkey)
  | CoinjoinAuth (PoDLE reveal) ----------> |  verifyPodle, UTXO age/value,
  |                                         |  blacklist.add, select coins
  | <------------ CoinjoinIoAuth (inputs, coinjoin + change scripts)
  check maker inputs on chain (unspent, value, script, confs, distinct)
  build PSBT (BIP-69, nLockTime = tip, all P2TR)
  | CoinjoinTx (psbt) --------------------> |  validateCoinjoinForMaker, sign
  | <------------ CoinjoinSig (psbt)
  merge + verify each maker signature, validateCoinjoinForTaker
  sign own inputs, finalize, broadcast
```

**Transaction shape.** Version 2, `nLockTime` = taker's tip (anti fee sniping;
makers accept up to their tip + 2), sequence `0xfffffffe`, inputs and outputs
BIP-69 sorted (inputs by display txid then vout; outputs by value then script),
every input and output P2TR key-path, signed `SIGHASH_DEFAULT`. One equal output
per party (at least `minMakers` + 1, default 3), plus change outputs above dust.
Size estimate: `vsize = ⌈(42 + 230 × inputs + 172 × outputs) / 4⌉`.

**Maker check** (`validateCoinjoinForMaker`): its inputs are all present and
unchanged, its coinjoin output pays exactly `amountSats` to its script, its
change output pays exactly `makerChange` (absent when that is dust), at least
`minEqualOutputs` outputs pay `amountSats`, no other output pays its scripts,
and the transaction is v2 with a sane `nLockTime`. Anything else is refused.

**Taker check** (`validateCoinjoinForTaker`): the signed PSBT still matches the
plan (inputs, outputs, values), and the fee rate is within
`[minFeeRateSatVb, maxFeeRateSatVb]`.

**Signatures.** `mergeMakerSignatures` verifies each maker signature against
`hashForWitnessV1` before copying it in as the final witness, so one bad
signature cannot spoil the broadcast; it drops that maker instead.

### Round states
`CoinjoinTakerRound`:
`new → filled → authed → built ⇄ signed → broadcast`, or `aborted` from any
open state. `timedOut()` lists makers that missed `ackTimeoutMs` (30 s) or
`sigTimeoutMs` (60 s); `rebuild({ drop, feeRateSatVb })` drops them and builds
a new PSBT (at most `maxRebuilds`, 3). A late signature for a superseded
transaction is ignored rather than counted against the maker.

`CoinjoinMakerRound`: `new → acked → ioauthed → signed (⇄ signed on rebuild)`,
or `aborted`. A maker signs at most `maxSigns` (4) transactions in one round.
`abort` releases the maker's coins only if nothing was signed: a signed
transaction can still be broadcast, so those coins stay locked until spent or
unlocked by hand.

Both rounds persist with `toJSON({ includeSecrets })` / `fromJSON` (the round
key or seal key is written only with `includeSecrets`; the maker identity key
never is).

## PoDLE
A taker could open rounds only to learn which UTXOs makers hold. Each fill
carries a commitment `C = H(P2)` with `P2 = k·J_i`, where `k` is the private
key of a taker UTXO and `J_i` is one of 3 NUMS generators (`PODLE_MAX_INDEX`). The reveal proves
`P = k·G` and `P2 = k·J_i` share `k` (DLEQ), and names the UTXO. The maker
checks the UTXO exists, pays to `P` (BIP-86 tweaked key), has
`podleMinAgeConfs` (5) confirmations, and is worth at least `podleMinValuePct`
(20%) of the amount. A used commitment goes into the maker's `PodleBlacklist`;
the taker can use one UTXO 3 times (`index` 0–2) before it must find another
coin, so a taker who aborts rounds to learn maker UTXOs burns its own coins'
tries. One commitment is sent to every maker in a round.

## Fidelity bonds
A bond is a P2TR output with a NUMS internal key (no key path) and one leaf:

```text
<locktime> OP_CHECKLOCKTIMEVERIFY OP_DROP <bondXOnly> OP_CHECKSIG
```

`locktime` is a block height; on mainnet it must be a multiple of 4320 (about a
month), so bonds fall into a few public buckets. The suggested key path is
`m/86'/coin'/0'/2/i` (`bondPath`). `buildBondRedeemPsbt` +
`signAndExtractBondRedeem` spend it after the lock (`nLockTime` = locktime).

**Certificate.** The bond key signs, BIP340, the stable JSON of
`{ type: 'FidelityBondCertificate', version, network, txid, vout,
locktime, bondXOnly, makerPubkey, certExpiresAt }`, so the cold bond key can
lend its weight to a hot offer key until block `certExpiresAt` (at most 2016 ×
26 blocks ahead). `CoinjoinOffer.fidelityBond` carries
`{ txid, vout, locktime, bondXOnly, certExpiresAt, certSig }`.

**Verification** (`verifyFidelityBond`, cached per tip by `BondVerifier`):
certificate valid for this maker and network, not expired, output unspent,
script rebuilt from `bondXOnly` + `locktime` matches, at least 6
confirmations. `CoinjoinBook#refreshBonds(verifier)` re-checks every bond; an
outpoint claimed by more than one maker counts for none of them.

**Value** (JoinMarket's formula, heights in place of times, year = 52560
blocks):

```text
T = (locktime − confirmHeight) / year
L = max(0, tip − locktime) / year
a = max(0, min(1, e^(rT) − 1) − min(1, e^(rL) − 1))        r = 0.015
value = (valueSats × a)^1.3
```

The exponent above 1 rewards one large bond over many small ones, so splitting
capital across Sybil makers lowers total weight. An expired bond decays to zero
as `L` grows.

## Risks
- **Sybil makers.** A taker who picks only one attacker's makers is not mixed.
  Bonds price that; without bonds, weighted choice is uniform.
- **The taker learns maker UTXOs** in every round it starts. PoDLE limits how
  often; it does not hide the inputs from the round's taker.
- **Makers learn the taker's amount** and, in each round, the full transaction.
  A taker's own coin is distinguishable only by its change.
- **Change links.** Change outputs are not mixed. Spend coinjoin outputs and
  change separately.
- **Stalling** wastes time and reveals a maker's inputs to the taker. Dropped
  makers come back in `taker.dropped`; pass them to `choose({ exclude })`.
- **Reputation and blacklists are local.** A taker who fills every maker on the
  network with one commitment is refused only by makers that have seen it.
- **Offer spam.** Books are bounded (`maxOffers`, `maxOffersPerMaker`,
  `maxCancelled`, oldest evicted) and offers expire, but nothing prices posting
  an unbonded offer.

### Bond hygiene
- **Fund bonds only from coinjoined coins.** A bond is public by design; funding
  it from a coin linked to your identity links the bond (and the maker) to it.
- **Never spend a bond together with coinjoin coins**, and never send a
  redeemed bond into a coinjoin as one input among your others: that links the
  bond to the coins that were mixed.
- Use a fresh bond key per bond, kept cold; only the certificate (renewed
  before `certExpiresAt`) touches the hot offer key.

## Adapters
The rounds never talk to nodes directly. Pass `adapters: { bitcoin, wallet }`:

| Bitcoin adapter | Returns |
|-----------------|---------|
| `getTipHeight()` | height |
| `getTxOut(txid, vout)` | `{ valueSats, scriptPubKeyHex, confirmations }` or `null` when spent |
| `broadcast(txHex)` | txid |

| Wallet adapter | Returns |
|----------------|---------|
| `selectInputs({ amountSats })` | P2TR rows `{ txid, vout, valueSats, scriptPubKeyHex }`, locked while held |
| `releaseInputs(rows)` | — |
| `getNewScript()` | fresh P2TR `scriptPubKey` hex |
| `signPsbt(psbtBase64)` | PSBT with this wallet's inputs signed, nothing else changed |
| `podleCandidates({ amountSats, minAgeConfs, minValuePct })` (taker) | rows plus `internalPrivateKey` (or `outputPrivateKey`) and `usedIndexes` |
| `signOwnership({ roundId, input })` (maker, optional) | BIP340 signature for `requireOwnership` takers |

`CoinjoinTakerRound.bitcoinAdapter(bitcoinService)` and
`CoinjoinTakerRound.walletAdapter(bitcoinService, { wallet, usedIndexes })` wrap
`services/bitcoin` and a bitcoind descriptor wallet with `tr()` coins
(`walletprocesspsbt` to sign, `lockunspent` to hold coins, `listdescriptors
true` for PoDLE keys — so not watch-only). `memoryWallet` / `memoryChain` are
in-memory versions for tests.

## Tests
- `tests/functions.podle.js`, `tests/functions.coinjoin.js`,
  `tests/functions.fidelityBond.js`, `tests/types.coinjoinBook.js`,
  `tests/types.coinjoinRound.js` — run in `npm test` (in-memory chain + wallets).
- `tests/bitcoin/coinjoin.regtest.js` — managed bitcoind with a taker and two
  maker descriptor wallets: one round end to end over `CONTRACT_MESSAGE`
  (makers earn exactly `cjfee − txFeeContributionSats`), and a bond funded,
  verified, refused before its lock, and redeemed after it.
  Gated: `FABRIC_E2E_REGTEST=1 npx mocha tests/bitcoin/coinjoin.regtest.js`
  (needs `bitcoind` on `PATH`).

## Non-goals
- Mainnet or any network other than regtest.
- Wire compatibility with JoinMarket (IRC / onion message channels, its
  commitment format, its bond scripts).
- Peer routing for sealed envelopes beyond `CONTRACT_MESSAGE` gossip.
- Non-P2TR inputs or outputs, or script-path spends inside a coinjoin.
- Multi-round schemes (tumbler schedules) — compose rounds in the application.
