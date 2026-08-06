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
8. Ranking mixes peer score so slightly cheaper sybils do not always win; **sealed** multi-blob plans stay on one seller.
9. After refund locktime, buyer recovers funds with `/refund`; completed opens refuse refund.
10. `forceReveal` on approve is ignored unless `allowForceDocumentKeyReveal` is explicitly enabled.

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

## Next steps
1. Bind NOISE session static keys to Fabric derived identity (enables `pubkey@host` dial pins).
2. Atomic multi-hop HTLC chains on a single Bitcoin tx.
3. Post BIP draft to bitcoin-dev with frozen test vectors.
