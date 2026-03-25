# Document publish envelope & L1 payment binding
This module is the **single source of truth** for hashing a stored document record into:

1. A canonical Fabric **`DocumentPublish`** `Message` (full `toBuffer()` bytes).
2. A **32-byte preimage** = `SHA256` of those bytes.
3. A **payment / content hash** (hex) = `SHA256` preimage — used by **hub.fabric.pub** for `CreatePurchaseInvoice` / `ClaimPurchase` and inventory **P2TR HTLC** `paymentHash`.

## API (`@fabric/core/functions/publishedDocumentEnvelope`)
| Export | Purpose |
|--------|---------|
| `documentPublishEnvelopeBuffer(docIdNorm, parsed)` | Raw AMP message bytes |
| `inventoryHtlcPreimage32(docIdNorm, parsed)` | 32-byte Buffer |
| `purchaseContentHashHex(docIdNorm, parsed)` | Hex string for invoice binding |
| `whitelistedDocumentFields`, `fabricCanonicalJson` | Building blocks / tests |

## Consumption
- **hub.fabric.pub** — `require('@fabric/core/functions/publishedDocumentEnvelope')` or `require('../functions/publishedDocumentEnvelope')` (shim).
- **@fabric/http** — No runtime dependency required; HTTP servers relay payloads built upstream.

## Tests
- `tests/l1.document.exchange.expectations.js` — envelope preimage, `purchaseContentHashHex`, Peer inventory / `documentPublish`, P0 gossip-vs-envelope gap.
- `tests/fabric.l1.document.network.js` — network publish + hash visibility.

## See also
- [L1 document exchange (priorities & expectations)](L1_DOCUMENT_EXCHANGE.md) — backlog and regression matrix.
- [hub.fabric.pub `INVENTORY_HTLC_ONCHAIN.md`](https://github.com/FabricLabs/hub.fabric.pub/blob/main/INVENTORY_HTLC_ONCHAIN.md) (on-chain reference)
- [hub `PAYMENTS_PROTOCOL.md`](https://github.com/FabricLabs/hub.fabric.pub/blob/main/PAYMENTS_PROTOCOL.md)
