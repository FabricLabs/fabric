# Document publish envelope & L1 payment binding

**Buy / HTLC commitment (single path):** [`functions/documentPaymentHash.js`](../functions/documentPaymentHash.js) → `resolveDocumentContentHashHex`. Wire field: **`contentHashHex`**.

Envelope helpers in [`publishedDocumentEnvelope.js`](../functions/publishedDocumentEnvelope.js) remain the source for the **legacy unsealed** binding:

1. Canonical Fabric **`DocumentPublish`** `Message` (full `toBuffer()` bytes).
2. **32-byte preimage** = `SHA256` of those bytes.
3. **`purchaseContentHashHex`** = `SHA256(preimage)` — used when the document is not sealed.

## Per-blob commitments
Every document is advertised as a **`DocumentBlobIndex`** (Tree merkle over blob leaves):

- Small files → one content blob listed in `blobs[]`
- Large files → many wire-sized blobs (default chunk ≤ AMP `MAX_MESSAGE_SIZE` budget)
- `blobHashHex` = `SHA256(blob bytes)` (ciphertext bytes when sealed)
- `merkleRootHex` = Fabric [`Tree`](../types/tree.js) root over those leaf hashes
- **Priced / sealed:** inventory `contentHash` = `SHA256(K)` via [`documentContentKey`](../functions/documentContentKey.js) / [`documentSealedExchange`](../functions/documentSealedExchange.js); seller reveals `K` only after payment-hash match (Fabric) **or** by claiming the HTLC on-chain (buyer `/claimwatch` extracts `K` from the claim witness)
- **Unsealed per-blob:** `blobPaymentHashHex` tagged hash — see [`documentBlobManifest.js`](../functions/documentBlobManifest.js)
- **Refund:** after `refundLocktimeHeight`, buyer `/refund` spends the CLTV leaf if the sale never completed

When the full leaf list will not fit one AMP body, the index is compacted (`leavesInline: false`) and carries only the Tree root; leaves are recovered from verified blob frames.

Hop budgets for private relay nest with monotone `maxSats` ([`documentRequestRelay.js`](../functions/documentRequestRelay.js)).

## API (`@fabric/core/functions/*`)
| Export | Purpose |
|--------|---------|
| `documentPaymentHash` | **`resolveDocumentContentHashHex`**, alias normalize, re-exports |
| `publishedDocumentEnvelope` | Canonical envelope + legacy `purchaseContentHashHex` |
| `inventoryHtlc` | P2TR build / fund hints / claim+refund PSBTs / `extractPreimageFromClaimTx` / `refundLocktimeMature` |
| `documentContentKey` | AES-GCM seal; `paymentHashHexFromKey` |
| `documentOfferEscrow` | Role-renamed HTLC wrapper |
| `documentPurchaseSession` | Buy session records |
| `walletTransactionWatch` | Block/mempool classification against multi-seed wallet watch set |
| `Wallet.loadSeed` / `watchHtlc` / `ingestBitcoinBlock` | Key collection + on-chain watch |

## Consumption
- **hub.fabric.pub** — `functions/documentPaymentHash.js` → `@fabric/core` (invoice, inventory HTLC, HTTP 402).
- **@fabric/http** — `X-Fabric-Payment-Request` `documentOffer.contentHashHex` must be the resolved commitment (never file `sha256`).

## See also
- [L1 document exchange](L1_DOCUMENT_EXCHANGE.md)
- [BIP draft: content-addressed file exchange](bip-fabric-file-exchange.md)
- [hub `INVENTORY_HTLC_ONCHAIN.md`](https://github.com/FabricLabs/hub.fabric.pub/blob/main/INVENTORY_HTLC_ONCHAIN.md)
