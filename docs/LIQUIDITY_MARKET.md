# L1/L2 Liquidity Market (experimental)
A peer-to-peer market for swapping on-chain sats (L1) for Lightning sats (L2).
Makers post signed orders quoting L1 at a premium or discount to L2; takers fill
them; each fill settles atomically with one payment hash shared by a P2TR HTLC
and a BOLT11 invoice. The order book's bids and asks are the "bet": they price
which layer is scarcer.

**Status:** core prototype, **regtest only**. Not in the frozen
[PUBLIC_API.md](../PUBLIC_API.md) table; paths and body shapes may change.

| Module | Role |
|--------|------|
| [`functions/liquiditySwap.js`](../functions/liquiditySwap.js) | Pure helpers: body normalize / sign / verify, quotes, roles, escrow + invoice checks |
| [`types/liquidityBook.js`](../types/liquidityBook.js) | `LiquidityBook` — local order book, price-time priority, index, fills |
| [`types/liquiditySwap.js`](../types/liquiditySwap.js) | `LiquiditySwap` — one fill's settlement state machine over injected adapters |
| [`services/lightning.js`](../services/lightning.js) | `createInvoice(…, { preimage, expiry })`; `pay` returns `paymentPreimage` |

## Market model
One instrument, `L1/L2`, priced as **`premiumPpm`**: 1 L1 sat trades for
`1 + premiumPpm / 1e6` L2 sats (bounded to ±500000 ppm).

- **Ask** — the maker sells L1 (gives on-chain sats, receives Lightning).
- **Bid** — the maker buys L1 (gives Lightning, receives on-chain sats).
- Best bid = highest premium; best ask = lowest. `LiquidityBook#index()` reports
  `bestBidPpm`, `bestAskPpm`, `midPpm`, `spreadPpm`, depth per side, and
  `crossed`. A positive mid means L1 is trading at a premium (on-chain liquidity
  is scarcer); a negative mid means Lightning liquidity is.
- The maker's `feeSats` always reaches the maker: it is **added** to the L2
  amount on asks (taker pays more) and **subtracted** on bids (maker pays less).

`quote({ side, premiumPpm, feeSats, amountSats })` (BigInt, rounded to msat):

```text
l2Msat = round(amountSats × 1000 × (1e6 + premiumPpm) / 1e6) ± feeSats × 1000
```

Example: an ask at +2000 ppm with a 100 sat fee, taken for 100000 sats, has the
taker pay `(100200 + 100) × 1000` msat for 100000 on-chain sats.

There is **no central matcher**. Every node keeps its own `LiquidityBook` from
orders it hears; `fill(side, amountSats, { limitPpm, excludeMakers })` walks
price-time priority to plan takes against individual makers.

## Bodies
All bodies are JSON carried in `CONTRACT_MESSAGE`, `version: 1`, each BIP340
signed by one key over `stableStringify(jsonSafe(body without signature))`.
`bodyId(body)` is the SHA-256 of that signing string (`orderId`, `takeId`).
`fromBody` returns `null` for anything that does not normalize;
`verifyBody` returns `{ ok, reason, body, id }`.

| Type | Signed by | Fields |
|------|-----------|--------|
| `LiquidityOrder` | `makerPubkey` | `instrument`, `side`, `premiumPpm`, `feeSats`, `minSats` (≥ `HTLC_MINIMUM_SATS`), `maxSats`, `prepaySats`, `refundLockBlocks` (15–2016), `createdAt`, `expiresAt`, `makerPubkey`, `lightningNodeId`, `network`, `nonce` |
| `LiquidityOrderCancel` | `makerPubkey` | `orderId`, `makerPubkey`, `createdAt` |
| `LiquidityTake` | `takerPubkey` | `orderId`, `side`, `premiumPpm`, `amountSats`, `takerPubkey`, `takerHtlcPubkey`, `takerNodeId`, `createdAt`, `nonce`; on a **bid** also the L1 giver's terms |
| `LiquidityTakeAccept` | `makerPubkey` | `orderId`, `takeId`, `makerPubkey`, `makerHtlcPubkey`, `createdAt`; on an **ask** also the L1 giver's terms and, when `prepaySats > 0`, `prepayInvoice` |
| `LiquiditySwapFunded` | `l1GiverPubkey` | `takeId`, `l1GiverPubkey`, `txid`, `vout`, `paymentAddress`, `amountSats`, `createdAt` |

**L1 giver's terms:** `paymentHashHex`, `invoice` (BOLT11 for `l2Msat`, locked to
that hash), `refundLockHeight` (absolute height). A take must repeat the order's
`side` and `premiumPpm` and fit `[minSats, maxSats]` (`validateTake`); the
accept must name the take (`validateTakeAccept`).

Identity keys (`makerPubkey`, `takerPubkey`) sign bodies; separate HTLC keys
(`*HtlcPubkey`) sit in the escrow script; `lightningNodeId` / `takerNodeId` must
be the payee of the counterparty's invoice.

## Settlement
The **L1 giver owns the preimage** `P` (`H = SHA256(P)`). Roles by side
(`swapRoles`):

| Order side | L1 giver (preimage owner, funds HTLC, invoices L2) | L2 giver (pays invoice, claims HTLC) |
|------------|------|------|
| ask | maker | taker |
| bid | taker | maker |

Escrow is the inventory P2TR HTLC (`buildInventoryHtlcP2tr`): claim leaf =
hashlock `H` + L2 giver's HTLC key; refund leaf = CLTV `refundLockHeight` +
L1 giver's HTLC key.

```text
taker                                   maker
  | LiquidityTake  (bid: + terms) ------> |  validateTake
  | <------ LiquidityTakeAccept (ask: + terms [+ prepayInvoice])
  | pay prepayInvoice (ask, prepaySats>0)  |  non-refundable
  L1 giver: fund HTLC → LiquiditySwapFunded
  L2 giver: wait ≥ minConfirmations; check address, amount, invoice
  L2 giver: pay invoice  → learns P
  L2 giver: claim HTLC with P (claim tx reveals P on-chain)
  L1 giver: invoice paid → done (observeClaim records the claim)
  — or, if never paid —
  L1 giver: after refundLockHeight → refund
```

`LiquiditySwap` states:
`new → proposed → accepted → prepaid? → l1Funded → l2Paid → l1Claimed | refunded | aborted`.
`abort` is allowed only before L1 moves. Illegal transitions throw. `fund`
records the escrow before it sends and runs at most once; once the send
returns the swap is `l1Funded` (refundable after the lock) even if no funding
notice could be built. A Bitcoin adapter's `fundAddress` must reject only when
nothing was sent.
`toJSON({ includeSecrets })` / `fromJSON` persist a swap (the preimage is
written only with `includeSecrets`).

### Checks before the L2 giver pays
`validateSwapEscrow` rebuilds the HTLC from both keys, `H`, and the lock and
compares the address; the funding output must pay exactly `amountSats` and have
`minConfirmations`. `validateSwapInvoice` requires the invoice to commit to `H`,
ask exactly `l2Msat`, name the counterparty node as payee, be unexpired, and
leave time to claim:

```text
refundLockHeight − tip ≥ minClaimBlocks           (default 6)
invoiceExpiresAt + marginSeconds ≤ now + (refundLockHeight − tip) × secondsPerBlock
                                                  (defaults 3600 s, 600 s/block)
```

## Risks
- **Free option for the L1 giver.** The preimage owner can sit on a taken order
  and only fund if the price still suits them. On asks the maker can require
  `prepaySats` (paid before funding, kept either way) to price that. A bid has
  no symmetric guard for the maker; treat takers who stall as reputation hits.
- **Invoice vs. CLTV timing.** If the invoice can still be paid after the
  refund lock opens, the L1 giver could take both the L2 payment and the
  refund. The expiry check above and `minClaimBlocks` exist to prevent it; slow
  blocks still erode the margin, so the L2 giver should claim right away.
- **The L2 giver must claim before the lock.** Once `refundLockHeight` passes,
  the refund path is open alongside the claim path. Paying close to the lock is
  refused (`payInvoice` re-checks the invoice against the tip).
- **Reputation is local only.** Nothing tracks makers or takers who abandon
  swaps across nodes; `LiquidityBook#forgetMaker` is a local tool.
- **Order spam.** Books are bounded (`maxOrders`, `maxCancelled`, oldest
  evicted), and orders expire, but nothing prices posting an order.
- **Cancels.** A cancel is remembered with its signer and blocks an order only
  from that maker, so a third party cannot cancel an order in flight. Cancels
  for orders the book has not seen are capped per key
  (`maxPendingCancelsPerMaker`) and evicted before cancels of held orders, which
  are kept until the order expires. A flood can still evict a real maker's
  cancel that arrived before its order.

## Adapters
`LiquiditySwap` never talks to nodes directly. Pass `adapters: { bitcoin, lightning }`:

| Bitcoin adapter | Returns |
|-----------------|---------|
| `getTipHeight()` | height |
| `fundAddress(address, sats)` | `{ txid, txHex }` (or `{ txid, vout }`); rejects only when nothing was sent, so `txHex` may be null when the lookup after the send fails |
| `getTransaction(txid)` | `{ txHex, confirmations }` or `null` |
| `broadcast(txHex)` | txid |
| `getNewAddress()` | address |

| Lightning adapter | Returns |
|-------------------|---------|
| `createInvoice({ amountMsat, label, description, preimageHex, expirySeconds })` | `{ bolt11, paymentHash }` |
| `decodeInvoice(bolt11)` | `{ payment_hash, amount_msat, payee, created_at, expiry }` |
| `pay(bolt11)` | `{ paymentPreimage }` |
| `isInvoicePaid(paymentHashHex)` | boolean |

`LiquiditySwap.bitcoinAdapter(bitcoinService, { wallet })` and
`LiquiditySwap.lightningAdapter(lightningService)` wrap `services/bitcoin`
(bitcoind with `txindex`, which managed regtest enables) and
`services/lightning` (Core Lightning; `decode`, falling back to `decodepay`).

## Tests
- `tests/functions.liquiditySwap.js`, `tests/types.liquidityBook.js`,
  `tests/types.liquiditySwap.js` — run in `npm test` (mock chain + Lightning).
- `tests/lightning/liquiditySwap.regtest.js` — managed bitcoind + two Core
  Lightning nodes; settles an ask end to end and refunds an unpaid swap.
  Gated: `FABRIC_E2E_REGTEST=1 npx mocha tests/lightning/liquiditySwap.regtest.js`
  (needs `bitcoind` and `lightningd` on `PATH`).

## Non-goals
- Mainnet or any network other than regtest.
- Hub UI, HTTP routes, or Peer wiring for the bodies.
- A cross-node matching engine or shared book.
- Splitting one take across several HTLCs or invoices (one take = one swap).
