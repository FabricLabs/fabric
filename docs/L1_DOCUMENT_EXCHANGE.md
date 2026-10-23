# L1 document exchange
This document tracks **priorities**, **expectations**, and **tests** for Layer-1 document publish, inventory, settlement, ranked offers, multi-blob delivery, and private paid relay — aligned with [`functions/publishedDocumentEnvelope.js`](../functions/publishedDocumentEnvelope.js), [`functions/inventoryHtlc.js`](../functions/inventoryHtlc.js), and hub flows.

## Canonical L1 binding (implemented)

**Single reference path:** [`functions/documentPaymentHash.js`](../functions/documentPaymentHash.js) → `resolveDocumentContentHashHex(...)`.

Wire / session / HTTP field is always **`contentHashHex`** (aliases on ingest: `contentHash`, `paymentHashHex`, `purchaseContentHashHex`).

| Binding | When | Commitment |
|---------|------|------------|
| **sealed** | priced AES-GCM docs | `SHA256(content key K)` |
| **envelope** | legacy / unsealed | `purchaseContentHashHex` = SHA256(SHA256(DocumentPublish AMP bytes)) |
| **blob** | unsealed multi-blob settles | `blobPaymentHashHex({ documentId, blobIndex, blobHashHex })` |

See also: [`docs/PAYMENTS_DOCUMENT_BINDING.md`](PAYMENTS_DOCUMENT_BINDING.md), [`docs/bip-fabric-file-exchange.md`](bip-fabric-file-exchange.md).

## Canonical Core surface (CLI-first)

Operator document exchange is standardized on the Fabric CLI packs
`documents` + `documents-market`. Headless logic lives in Core:

| Module | Role |
|--------|------|
| [`functions/cliDocumentExchange.js`](../functions/cliDocumentExchange.js) | `CliDocumentExchange` — import/publish/inventory/offers/buy/confirm/claimwatch/refund + pack catalog |
| [`functions/cliContracts.js`](../functions/cliContracts.js) | Shell pack command maps |
| `types/cli.js` | Blessed TUI adapters only (delegates to `CliDocumentExchange`) |

## Naming (do not conflate)

| Name | Where | Meaning |
|------|-------|---------|
| **`FABRIC_DOCUMENT_OFFER`** | Wire envelope (`publishedDocumentEnvelope`) | Inventory-request JSON `type` alias for catalog/terms |
| **`DocumentOfferBook`** | `@fabric/core` (`documentMarket`) | Ranked local book of seller listings after `/inventory … btc` |
| **Hub sidechain `DocumentOffer`** | Hub Beacon / reward flows | Application-state reward offer — **not** this inventory envelope |
| **HTTP 402 `documentOffer`** | `@fabric/http` | Payment-request summary for web/extension auto-pay |

BOLT12 Lightning **offer** strings (`lno1…`) are a different vocabulary — see
[`FABRIC_LIGHTNING_OFFERS.md`](FABRIC_LIGHTNING_OFFERS.md).

## Inventory offer wire

| Role | AMP opcode | Typical inner JSON |
|------|------------|--------------------|
| Catalog / terms request | `P2P_INVENTORY_REQUEST` (`0x57`) | `{ "type": "…", "object": { … } }` |
| Items / hashes / hints | `P2P_INVENTORY_RESPONSE` (`0x58`) | `{ "kind": "documents", … }` |

Canonical JSON `type` aliases (normalized by Peer to legacy `INVENTORY_*`):

| Semantic | Canonical `type` | Synonyms | Handler `type` |
|----------|------------------|----------|----------------|
| Buyer asks | `FABRIC_DOCUMENT_OFFER` | `FABRIC_DOCUMENT_OFFER_REQUEST` | `INVENTORY_REQUEST` |
| Seller replies | `FABRIC_DOCUMENT_OFFER_RESPONSE` | `FABRIC_DOCUMENT_OFFER_REPLY` | `INVENTORY_RESPONSE` |

HTTP **402** + `X-Fabric-Payment-Request` mapping: `@fabric/http`
`docs/HTTP_402_FABRIC_PAYMENT.md`.

## Peer / CLI surface (implemented)

| Area | Status | Notes |
|------|--------|--------|
| Inventory + offer book | Implemented | `/inventory [peer] [btc]` ingests into `DocumentOfferBook`; `/offers` ranks by price/latency/score/completeness |
| Multi-blob | Implemented | Indexed wire-sized `P2P_FILE_SEND`; Tree verify; priced docs **sealed-until-claim** (AES-GCM; HTLC = SHA256(K); key reveal only on matching payment hash) |
| Consent file path | Implemented | `/request` → `/pending` → `/approve` / `/deny`; `autoFulfillDocumentRequests` off in CLI |
| L1 buy/confirm | Implemented | `/buy` session + `/confirm <id> <txid>` (local L1 verify and/or Hub `ConfirmInventoryHtlcPayment`) via `CliDocumentExchange` |
| Claim-watch open | Implemented | `/claimwatch` **or** wallet block/mempool watch extracts `K` from seller claim witness and opens sealed delivery |
| Refund after locktime | Implemented | `/refund` + `/refunds` list (mature/failed/pending) + tip maturity notice |
| Wallet tx watch | Implemented | Multi-seed key collection; ZMQ `BitcoinBlock*` / `BitcoinTransaction*` → `Wallet.ingest*`; monitors all known Bitcoin message types against watched addresses |
| CLI contracts | Implemented | `/contracts` lists sessions + shell packs; interfaces model in `CONTRACTS.md`; `debug` off by default |
| Private paid relay | Implemented | Budgeted `DocumentRequest` rewritten with reduced `maxSats`; `/relayfees`; reverse-route map |
| Payment hash path | Implemented | `documentPaymentHash.resolveDocumentContentHashHex` shared by Peer, CLI, Hub, HTTP 402 |
| HTLC builders | In `@fabric/core` | Hub re-exports `inventoryHtlc` / `documentSealedExchange` (`buildDocumentOfferEscrow` on `inventoryHtlc`) |

## CLI flows

### Unpaid consent
```text
/import ./note.txt
/publish <id> 0
# buyer: /connect … ; /inventory <peer> ; /request <id> <peer>
# seller: /pending ; /approve <key>
```

### Ranked paid (L1)
```text
/inventory <seller> btc
/offers <documentId>
/buy <documentId> auto [amountSats]
# pay BIP21 / address from session
/confirm <settlementId> <txid>
# ciphertext may arrive sealed; open via Fabric key reveal, or:
/claimwatch <settlementId> <claimTxid>
# if seller never claims / never reveals after locktime:
/refunds                   # list mature / failed / pending
/refund <settlementId> [destinationAddress] [feeSats]
```

### Private relay policy
```text
/relayfees              # show
/relayfees 10           # fixed sats skim per hop
/relayfees 100bps       # percent of maxSats
```

Terminal notes (contracts as interfaces, Hub registry, shell packs, verbosity): [`docs/CLI.md`](CLI.md), [`docs/CONTRACTS.md`](CONTRACTS.md).
## Security rules
1. Never accept blob bytes without `SHA256(bytes) === blobHashHex` (Peer `DocumentBlobTransferBook`).
2. Deduplicate settlements per `(documentId, blobIndex, contentHash)` (`settlementDedupeKey`).
3. Priced documents: HTLC / buy `contentHash` is **`SHA256(content key K)`**; ciphertext may ship anytime; **K is revealed only** after **verified settlement** (`Peer.authorizeDocumentKeyReveal` requires `settlementId` or `txid`) **or** when the seller claim witness exposes `K` on-chain (`/claimwatch`). Echoing the public inventory `paymentHashHex` alone must never unlock `K`.
4. Unsealed / free docs may still use `blobPaymentHashHex` for per-blob settles.
5. Priced `DOCUMENT_REQUEST` must not bit-identical-relay buyer frames when `relayPrivateDocumentRequests` is on; rewritten requests are **directed** (onion `relayPath`, `nextPeer`, or fan-out excluding origin) — never mesh-broadcast.
6. `maxSats` monotone decreasing across hops; fee skim cannot inflate budget.
7. Preimage / content key must not ride inside unpaid file chunks.
7a. Paid `/buy` always builds a **buyer-bound** local P2TR HTLC; seller-supplied `htlc.paymentAddress` is accepted only when it matches that script.
7b. Paid `/confirm` **fails closed** without Hub `ConfirmInventoryHtlcPayment` success or local L1 amount verify — never skip a failed RPC.
8. Ranking mixes peer score so slightly cheaper sybils do not always win; **legacy document-level sealed** plans (one `K` for the whole ciphertext — every blob carries the same payment hash) stay on one seller. **Per-blob sealed** trees (`types/document.js`, distinct `SHA256(K_i)` per index) are planned per blob across sellers.
9. After refund locktime, buyer recovers funds with `/refund`; completed opens refuse refund.
10. `forceReveal` on approve is ignored unless `allowForceDocumentKeyReveal` is explicitly enabled.

## Per-blob sealing (`types/document.js`) — chunk-level is the only sealing
A `Document` is a Tree over wire-sized blobs. When sealed, **every blob has its own key**:

| Quantity | Value |
|----------|-------|
| `blobHashHex_i` | `SHA256(ciphertext_i)` (AES-256-GCM, `K_i`, `iv_i`, tag appended) |
| `paymentHashHex_i` | `SHA256(K_i)` — the HTLC hash for blob `i` |
| `merkleRootHex` | Fabric `Tree` root over `blobHashHex_0..n-1` (same as `splitBlobs`) |
| plaintext chunk | `chunkBytes - 16` so the ciphertext blob still fits one `P2P_FILE_SEND` |

A one-blob document is indistinguishable from any other blob. The wire carries **hashes, public keys, and signatures only**:

- `Document#record()` / `Document#inventoryItem()` have no `name`, `mime`, `url`, or `title`; each inventory blob's `contentHashHex` is `paymentHashHex_i`, so the existing `DocumentOfferBook` builds one HTLC per blob and a **multi-seller** plan.
- `DocumentPublish` envelope is unchanged (`whitelistedDocumentFields` still has `name` / `mime` / `size`); publishers fill `name` with the blob hash and `mime` with `application/octet-stream` (already the defaults). Applications must not copy titles back into the envelope.
- Human-readable metadata lives in a **manifest blob**: `Document.encodeManifest({ title, url, mime, merkleRootHex, … })` → canonical JSON → sealed as its own one-blob `Document` and bought like any other chunk (`Document.decodeManifest` on the buyer). The content tree's root inside the manifest is what links the two.

Wire path (no new opcodes):

1. Seller `peer.publishSealedDocument(doc, { rateSats })` — registry `documentSealedBlobs[documentId]`; inventory (`P2P_INVENTORY_RESPONSE`) lists `perBlob: true` items, honoring `maxSats` / `blobHashHex` / `merkleRootHex` selectors.
2. Buyer `DocumentRequest { document, blobIndex: i, contentHashHex: paymentHashHex_i }` after settling that blob (`authorizeDocumentKeyReveal` keyed `documentId|paymentHashHex_i` on the seller — same gate as whole-document reveals; hash echo alone never unlocks).
3. Seller `P2P_FILE_SEND` frame for blob `i` (`sealed: true, perBlob: true, paymentHashHex, iv`) then **one existing `DocumentContentKeyReveal` per blob** (`object.blobIndex`, `object.blobHashHex` added to the same body).
4. Buyer `Peer` keeps `pendingSealedBlobs[documentId|merkleRootHex]`, opens each blob on its reveal (`documentBlobOpened`) — or with a key learned on a payment channel (`openSealedBlobWithKey`, `sealedBlobKeyForPaymentHash`) — and emits `documentReceived` / `documentOpened` once all blobs open and the Tree root matches. `Document.fromRecord(record)` + `acceptBytes` / `openBlob` do the same outside a Peer (Hub, GoonCitizen, Passport).

Reassembly rules (the first frame never dictates the shape): every per-blob frame must carry a 64-hex `merkleRootHex` and a sane `blobTotal` (≤ `PEER_MAX_SEALED_BLOB_PARTS`); frames whose root / total differ from the row already being assembled, or from what `blobTransfers.expectTransfer` registered for the purchase, are rejected; a row may collect parts from several sellers (swarm plans), so origin is recorded per part rather than locked per row; an index already held with a different `blobHashHex` is never overwritten; rows are capped by count (`PEER_MAX_PENDING_SEALED_DELIVERIES`), by total held frame bytes (`PEER_MAX_PENDING_SEALED_BYTES`), and expire after `PEER_PENDING_SEALED_TTL_MS`. Each held part keeps the raw signed `P2P_FILE_SEND` frame (exposed as `frameHex`) so a `wrong-bytes` fraud proof can cite the seller's own signature. On the buying side, `DocumentOfferBook#pickBest` / `pickBlobPlan` filter listed offers by the wanted `merkleRootHex` (or lock to the first pick's root) so a plan never mixes blobs from two trees.

Presentation: `Document#compile([env, ui])` still emits the Jade fragment `extends <env> / block body / <ui>(state="<id>") {{state}}`; `@fabric/http` `components/document.js` (`fabric-document`) renders the hash-only record plus ranked offers, and only shows manifest / content client-side after the keys are held.

## Simulator
Action packs live under `tests/simulator/scenarios/packs/` (e.g. `document-market`).
- `document-swarm` — multi-seller blob plan + reassembly + sybil resistance
- `document-relay-private` — multi-hop fee skim + unlinkability flag

```bash
npm run test:simulator
node tests/simulator/run.js --scenario document-swarm
```

## Shared modules (`@fabric/core/functions`)
- `inventoryHtlc.js` — P2TR HTLC + `buildDocumentOfferEscrow` + claim-preimage extract + refund maturity
- `documentSealedExchange.js` — AES-GCM content key + sealed sale + `openWithClaimPreimage`
- `documentBlobManifest.js` — split/reassemble + buyer `DocumentBlobTransferBook`
- `documentMarket.js` — ranked offer book, purchase sessions, private request relay
- `documentPaymentHash.js` — single `contentHashHex` resolver (sealed / envelope / blob)
- `walletTransactionWatch.js` — classify/match wallet-associated Bitcoin txs (multi-seed watch set)

## Availability market (`types/bond.js`, `types/challenge.js`, `types/witness.js`)
Publisher bounties and provider deposits are **Taproot scripts only** (no custodian, no new opcode):

- `Bond.buildBounty` — one P2TR output per epoch; a hashlock leaf per provider (`SHA256(preimage_{epoch,provider})` + provider sig) and a publisher CLTV `refund` leaf. The challenger reveals an epoch preimage only after a passing `AvailabilityResponse` (`Bond.prepareBountyClaim` / `prepareBountyRefund`).
- `Bond.buildDeposit` — provider deposit with a 2-of-2 `penalty` leaf (provider + publisher, MVP adjudicator), a 2-of-2 `checkin` leaf (CSV 1 — re-deposit to the same address), and a provider CLTV `withdraw` leaf. `Bond.preparePenaltySpend` **refuses** without a verifying `FraudProof` naming that provider, and refuses `timelock` verdicts (those spend the pre-signed penalty instead).
- **Timelocked non-response** — silence is proved from chain time, not from a verifier's claim of absence. Before round *n* is live the provider signs round *n + 1*'s penalty: `Bond.prepareDepositPenalty(deposit, { fundedTxHex, deadlineHeight, destinationAddress })` is a PSBT spending the deposit through the `penalty` leaf with `nLockTime = deadlineHeight`; `Bond.signPenaltyAsProvider` yields a `DepositPenaltyPreSig` artifact (`Witness.verifyPenaltyPreSig`). `Challenge.issue({ deadlineHeight, deposit: { txid, vout } })` binds the round to that deadline and outpoint. The provider defeats the pre-signed penalty by answering **or** by broadcasting the `checkin` spend (`Bond.prepareDepositCheckIn`) before the deadline — either way the outpoint the pre-signature spends is gone. If the outpoint is still unspent at `deadlineHeight`, the publisher finalizes with `Bond.finalizePreSignedPenalty` and anyone can verify the `non-response` proof (`evidence: 'timelock'`, `enforceableAfterHeight`) with a chain view `ctx: { tipHeight, outpointUnspent }`. `Bond#recordRound(round, { penaltyPreSig, checkInPsbtBase64, deposit })` keeps these exits in a `Contract.Resolutions` tree; `resolvable` is false until the penalty pre-signature is held.
- `Challenge.issue` / `respond` / `validate` — leaf index `SHA256(root‖epoch‖nonce) mod n`; the response carries the blob's Tree inclusion proof plus `possessionHex = SHA256(nonce‖bytes)`. `validate` with a missing response only hints `fraud` when `ctx.tipHeight ≥ challenge.deadlineHeight`; `proofFor` an absence requires `extra.penaltyPreSig`.
- `Witness.FraudProof` kinds and the evidence each **must** carry (a proof without it does not verify):
  - `wrong-leaf` — signed challenge + signed response whose leaf / hash / inclusion disagree with the committed tree.
  - `non-response` — signed challenge with `deadlineHeight` + deposit outpoint, the provider's `DepositPenaltyPreSig`, and a chain view showing the outpoint unspent at or after the deadline (`evidence: 'timelock'`).
  - `wrong-bytes` — the seller's signed `DocumentOffer` (with `paymentHashHex`), the buyer's claim, and the **raw signed `P2P_FILE_SEND` frame** (`delivery.frameHex`) authored by the offer signer (`functions/fabricFrameAuthor.js`), whose signed body names the same `paymentHashHex` and whose body bytes hash to something other than the offered `blobHashHex` (`evidence: 'signed-frame'`). Peers keep `frameHex` per held sealed blob for exactly this.
  - `wrongful-penalty` — the honest challenge/response pair plus the **signed penalty transaction** that spent the challenge's deposit outpoint through the deposit's 2-of-2 `penalty` leaf (`penaltyTxHex`; an honest `checkin` or the provider's `withdraw` also spends the outpoint and never verifies), and broadcast evidence exactly as for `stale-commitment` (`evidence: 'inclusion' | 'chain-view'`). The penalized party can always publish it.
  - `stale-commitment` — the offender's signed `ChannelRevoke` plus the broadcast commitment **and** broadcast evidence: a `BitcoinTxInclusion` SPV artifact (`functions/bitcoinTxInclusion.js`: 80-byte header meeting its own `bits` proof-of-work target + Merkle branch, depth pinned by `txCount`, CVE-2012-2459 duplicate nodes rejected) **whose header the verifier knows** (`ctx.headerKnown(blockHash)`), or `ctx.txConfirmed(txid)` (`evidence: 'inclusion' | 'chain-view'`). An inclusion artifact alone never verifies; 64-byte transactions are refused.
  `DepositPenaltyPreSig` destinations are the publisher's: `Challenge.issue({ deposit: { penaltyAddress, minPenaltySats } })` signs them, and `Witness.verifyPenaltyPreSig` (and `Bond#recordRound` / `finalizePreSignedPenalty`) refuse a pre-signature that does not pay at least `minPenaltySats` to `penaltyAddress`.
  `DocumentOfferBook#ingestFraudProof` penalizes the offender **locally**; reputation is never gossiped.
- Bodies `AvailabilityCommitment` / `AvailabilityChallenge` / `AvailabilityResponse` / `FraudProof` ride `CONTRACT_MESSAGE` under `SHA256('fabric-document-market')` as `Witness.signArtifact` artifacts (x-only BIP340 pubkey + signature; canonical form is the JSON round trip, so bodies verify after the wire).

## Fabric payment channels (`types/channel.js`) — Phase 4
Per-chunk settlement moves off-chain while L1 stays the funding/exit rail. The design follows Lightning (BOLT 2/3/5) penalty channels, scaled for a per-chunk market; the review that drove it covered Impulse (BitPay 2015 payer→operator→recipient channels), Lightning, Flood & Loot, RBF pinning / replacement cycling, HTLC jamming, time dilation and the wormhole attack.

- **Funding** — `Channel.buildFunding`: P2TR with a `cooperative` 2-of-2 leaf and a funder CLTV `refund` leaf after `expireAfter`. The record carries `toSelfDelay` (bound into `channelId`). Mainnet is refused.
- **Asymmetric commitments** — `Channel.buildCommitment(funding, state, { holder, holderPoint })` builds *one party's* commitment: the holder's `toLocal` is a P2TR with a `delayed` leaf (holder key after `toSelfDelay` CSV) and a `revocation` leaf (immediate, revocation key); the counterparty's `toRemote` is a plain output; each pending HTLC is a P2TR with `claim` (hashlock + receiver key), `timeout` (sender key after CLTV) and `revocation` leaves — whichever leaf pays the *holder* also carries the CSV delay, so a holder who broadcasts can always be punished first; two 330-sat **anchor** outputs (one per party) give either side a CPFP handle without pre-signed fees. HTLCs are never **trimmed**: each one is at least `HTLC_MINIMUM_SATS` (716 = 546 dust + 170 vB claim at 1 sat/vB), so every HTLC is claimable on mainnet. Peers sign **each other's** commitment and exchange only tapscript signatures (PSBT base64).
- **Revocation** — per-commitment secrets `Channel.commitmentSecret(seed, n)` (SHA-256 chain over a per-channel seed derived from the channel key; shachain compaction is out of scope), points `secret·G`, and the BOLT 3 revocation key `Channel.revocationPubkey(basepoint = counterparty key, point)` / `Channel.revocationPrivkey`. The update round is **proposal → reply (+ inline `revoke` of the replier's state n−1) → `ChannelRevoke` n−1**; `receive()` refuses state n+1 until state n−1 is revoked by the counterparty, so revocation cannot be withheld, and refuses any proposal whose balances do not follow from the previous state (HTLCs added only by the proposer from its own balance, removed only through a settlement it can prove, fee deltas paid by the funder within negotiated bounds). Open is three messages (`ChannelOpen` → `ChannelCommitment` #0 → ack) because the funder cannot sign the counterparty's commitment before learning its first point.
- **Justice** — `Session.observe(txHex, { inclusion })` classifies a funding spend as our latest, their latest, or a **stale** (revoked) commitment; stale yields `Channel.prepareJusticeSpend` (one transaction sweeping their `toLocal` and every HTLC output through the `revocation` leaves, signed with the derived revocation key; output indexes come from the built PSBT, and each swept script is checked against the broadcast transaction) plus a `FraudProof` of kind **`stale-commitment`** (the offender's own signed `ChannelRevoke` naming the commitment txid, the broadcast transaction, and a `BitcoinTxInclusion` SPV artifact when the host supplied the block). HTLC spends are scanned for preimages (`Channel.harvestPreimages`). `Channel.Book.onBlock({ height, txHexes, blockHeaderHex, txids })` is the host hook (Hub `services/market.js#onBitcoinBlock` fetches `getblock(tip, 2)` + the raw header from the ZMQ block handler; GoonCitizen `MarketManager#onBitcoinBlock` accepts the same fields from its host).
- **Chain time** — sessions are `pending` until the funding tx has `minFundingConfirmations` (1 regtest/signet, else 3; Book `confirmations` cache fed by the host); every HTLC must satisfy `tip + minCltvDelta ≤ expireAfter ≤ funding.expireAfter − toSelfDelay − closeMarginBlocks`; `Session.tick(tip)` auto-fails expired received HTLCs and flags expired offered ones for on-chain timeout; when the host's tip is unknown or older than `staleTipMs` (60 min) no new HTLC is accepted (time-dilation guard). `Channel.Book` **always** wires `tipHeight` into its sessions, and a sender-side `ChannelHtlcFail` (or our own `failHtlc`) is refused while the tip is unknown — "no chain view" is never read as "already expired".
- **Seller-fulfils** — the party that *sells* a blob holds `K_i`, so it settles the HTLC: `Channel.Book({ preimageFor })` (hosts pass `Peer#sealedBlobPreimageForPaymentHash`) fulfils a received HTLC the moment it is committed and the round is quiet; the buyer learns `K_i` from the `ChannelHtlcFulfill` (`Book` events `htlcCommitted` / `htlcFulfilled` / `htlcSettled`, payload includes `preimageHex`) and opens the held ciphertext with `Peer#openSealedBlobWithKey`. No `DocumentContentKeyReveal` is needed on the channel rail and the key is never handed over before the HTLC is settled.
- **Limits** — policy negotiated at `ChannelOpen`, stricter value wins (`Channel.negotiatePolicy`): `maxAcceptedHtlcs` (30), `maxHtlcValueInFlightSats`, `htlcMinimumSats` (716 floor, `HTLC_MINIMUM_SATS`), `channelReserveSats` (1 % of capacity, min dust), commitment fee bounds (`updateFee` within `[minCommitFeeSats, maxCommitFeeSats]`, funder pays). Duplicate payment hashes in flight are rejected (wormhole / replay).
- **Forwarding** — `Channel.planRoute` + `Channel.checkForward` (fee, CLTV delta, same payment hash) and `Channel.Book.forward(upstream, htlcId, downstream, policy)`: offers the downstream HTLC with `forwardOf` and links the legs so a downstream fulfil/fail propagates upstream automatically.
- **Sessions / registry** — `Channel.Session` (`open`, `offerHtlc`, `updateFee`, `receive`, `fulfillHtlc` / `failHtlc` / `receiveSettlement`, `ingest`, `tick`, `observe`, `close`, `finalize`, export/import) and `Channel.Book` (`sessionFor`, `ingest`, `open`, `forward`, `setTip` / `tick` / `onBlock`, `setConfirmations`, export/import). `services/market.js` (budget agent) pays a chunk over an open channel first: a session is confirmed only once the HTLC is actually offered (`offered`); a busy round or unknown tip **defers** it (`channel_pending`, retried on `tick`) rather than requesting delivery unpaid; a dead channel falls back without penalizing the seller and the document goes back to `wanted`; spend is accounted when the HTLC settles, not when it is offered. Bodies `ChannelOpen` / `ChannelCommitment` / `ChannelRevoke` / `ChannelHtlcFulfill` / `ChannelHtlcFail` / `ChannelClose` ride `CONTRACT_MESSAGE` under the document-market namespace as `Witness.signArtifact` artifacts — **no channel opcode**, no change to `constants.js`, the AMP header or `MAX_MESSAGE_SIZE`.
- **Out of scope (explicit):** eltoo / `SIGHASH_ANYPREVOUT`, shachain compaction, second-stage HTLC-success/timeout transactions, package relay / v3 policy, watchtowers, onion routing. Channels stay regtest/signet/testnet and short-lived.

## Next steps
1. Bind NOISE session static keys to Fabric derived identity (enables `pubkey@host` dial pins).
2. Channel hardening follow-ups: watchtower delegation of `observe()`, second-stage HTLC transactions, package relay once v3 policy is available.
3. Post BIP draft to bitcoin-dev with frozen test vectors.
