# Document publish envelope & L1 payment binding

**Buy / HTLC commitment (single path):** [`functions/documentPaymentHash.js`](../functions/documentPaymentHash.js) → `resolveDocumentContentHashHex`. Wire field: **`contentHashHex`**.

## Legacy unsealed envelope (unsigned only)

Helpers in [`publishedDocumentEnvelope.js`](../functions/publishedDocumentEnvelope.js):

1. Canonical Fabric **`DocumentPublish`** AMP bytes from **`documentPublishEnvelopeBuffer`** — **signature field all zeros**.
2. **32-byte preimage** = `SHA256(those unsigned bytes)`.
3. **`purchaseContentHashHex`** = `SHA256(preimage)`.

**Footgun eliminated:** do **not** hash a Schnorr-**signed** gossip `DocumentPublish` `toBuffer()`. Signing changes bytes 144–207 and diverges from the payment commitment. `assertUnsignedDocumentPublishEnvelope` / `inventoryHtlcPreimage32FromEnvelopeBuffer` **throw** if the signature region is non-zero.

Whitelist for the envelope JSON omits timestamps (`created` / `edited`) and lineage so Hub store vs Peer rebuild stay aligned.

## AMP header `preimage` (Lightning-style)

On Fabric **Messages**, wire `preimage` is a **payment secret**, not a body hash (body integrity is header `hash` = double-SHA256(body)):

| Frame | `preimage` |
|-------|------------|
| Public / default | all zeros |
| Inventory HTLC / Circuit hop | explicit 32-byte secret (`payment_hash = SHA256(preimage)`) |

Same separation as Lightning HTLC chains: multi-hop Fabric Circuits need independent secrets per hop; stuffing `SHA256(body)` into `preimage` would collide with that model. See [`MESSAGE_BODY.md`](MESSAGE_BODY.md).

## Per-blob commitments
Every document is advertised as a **`DocumentBlobIndex`** (Tree merkle over blob leaves):

- Small files → one content blob listed in `blobs[]`
- Large files → many wire-sized blobs (default chunk ≤ AMP `MAX_MESSAGE_SIZE` budget)
- `blobHashHex` = `SHA256(blob bytes)` (ciphertext bytes when sealed)
- `merkleRootHex` = Fabric [`Tree`](../types/tree.js) root over those leaf hashes
- **Priced / sealed:** inventory `contentHash` = `SHA256(K)` via [`documentSealedExchange`](../functions/documentSealedExchange.js); seller reveals `K` only after payment-hash match (Fabric) **or** by claiming the HTLC on-chain (buyer `/claimwatch` extracts `K` from the claim witness)
- **Unsealed per-blob:** `blobPaymentHashHex` tagged hash — see [`documentBlobManifest.js`](../functions/documentBlobManifest.js)
- **Refund:** after `refundLocktimeHeight`, buyer `/refund` spends the CLTV leaf if the sale never completed

When the full leaf list will not fit one AMP body, the index is compacted (`leavesInline: false`) and carries only the Tree root; leaves are recovered from verified blob frames.

Hop budgets for private relay nest with monotone `maxSats` ([`documentMarket.js`](../functions/documentMarket.js)).

## API (`@fabric/core/functions/*`)
| Export | Purpose |
|--------|---------|
| `documentPaymentHash` | **`resolveDocumentContentHashHex`**, alias normalize, re-exports |
| `publishedDocumentEnvelope` | Unsigned envelope + legacy `purchaseContentHashHex` |
| `inventoryHtlc` | P2TR build / fund hints / claim+refund PSBTs / `extractPreimageFromClaimTx` / `refundLocktimeMature` |
| `documentSealedExchange` | AES-GCM seal; `paymentHashHexFromKey`; sealed sale helpers |
| `inventoryHtlc.buildDocumentOfferEscrow` | Role-renamed HTLC wrapper (deliverer/initiator) |
| `documentMarket` | Offer book, purchase sessions, private request relay |
| `walletTransactionWatch` | Block/mempool classification against multi-seed wallet watch set |
| `Wallet.loadSeed` / `watchHtlc` / `ingestBitcoinBlock` | Key collection + on-chain watch |

## Consumption
- **hub.fabric.pub** — `functions/documentPaymentHash.js` → `@fabric/core` (invoice, inventory HTLC, HTTP 402).
- **@fabric/http** — `X-Fabric-Payment-Request` `documentOffer.contentHashHex` must be the resolved commitment (never file `sha256`).

## See also
- [L1 document exchange](L1_DOCUMENT_EXCHANGE.md)
- [BIP draft: content-addressed file exchange](bip-fabric-file-exchange.md)
- [hub `INVENTORY_HTLC_ONCHAIN.md`](https://github.com/FabricLabs/hub.fabric.pub/blob/main/INVENTORY_HTLC_ONCHAIN.md)
