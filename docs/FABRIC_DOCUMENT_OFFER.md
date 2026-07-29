# Fabric document offer / response

Fabric defines an **offer ↔ response** pair for exchanging **document-catalog metadata** and, when applicable, **signed Bitcoin Layer-1** settlement terms (`purchaseContentHashHex`, HTLC `contentHash`). The naming is inspired by Lightning **BOLT12 offers** (*buyer-visible offer* → *fulfillment / invoice path*), but **wire types and payloads are Fabric-specific** — not interchangeable with BOLT12 `offer` TLVs.

## Relationship to Lightning BOLT12 (conceptual)

| BOLT12 (Lightning Offers) | Fabric (this protocol) |
|---------------------------|----------------------|
| Off-chain Bolt12 `offer` / `invoice_request` UX | Fabric JSON envelopes on generic P2P payloads |
| BOLT11/BOLT12 payment flow | Hub / wallet HTLC paths using L1 **`contentHash`** (see [`L1_DOCUMENT_EXCHANGE.md`](L1_DOCUMENT_EXCHANGE.md)) |
| Schnorr-less / invoice strings | Schnorr-signed Fabric `Message` bodies + optional **`fa1`** bech32m refs ([`FABRIC_PAYMENT_BECH32.md`](FABRIC_PAYMENT_BECH32.md)) |

## Wire (unchanged)

| Role | AMP opcode constant | Typical inner JSON shape |
|------|---------------------|---------------------------|
| **Offer** (catalog / terms request) | `P2P_INVENTORY_REQUEST` (`0x57`) | `{ "type": "…", "object": { … } }` |
| **Response** (items, hashes, hints) | `P2P_INVENTORY_RESPONSE` (`0x58`) | `{ "kind": "documents", … }` etc. |

The JSON field **`type`** inside the decoded body may use **legacy** names or **canonical Fabric** names (see [`functions/publishedDocumentEnvelope.js`](../functions/publishedDocumentEnvelope.js)); `Peer` normalizes Fabric aliases to `INVENTORY_REQUEST` / `INVENTORY_RESPONSE` for internal handlers. Inventory predicates (`isDocumentInventoryRequestType`, etc.) live on that module; `functions/fabricDocumentOfferEnvelope.js` is a compatibility re-export of the same API.

## Canonical JSON `type` strings (envelope aliases)

| Semantic | Canonical `type` | Accepted synonyms | Normalized handler `type` |
|----------|------------------|-------------------|---------------------------|
| Buyer / originator asks | `FABRIC_DOCUMENT_OFFER` | `FABRIC_DOCUMENT_OFFER_REQUEST` | `INVENTORY_REQUEST` |
| Seller / router replies | `FABRIC_DOCUMENT_OFFER_RESPONSE` | `FABRIC_DOCUMENT_OFFER_REPLY` | `INVENTORY_RESPONSE` |

**Legacy** `INVENTORY_REQUEST` / `INVENTORY_RESPONSE` remain valid for all implementations.

## Settlement (L1)

Per-item **BTC-backed** listings use **`object.offerBtc`** on the request and item rows with **`contentHash`** / rates on the response, as described in [`L1_DOCUMENT_EXCHANGE.md`](L1_DOCUMENT_EXCHANGE.md) and [`FABRIC_LIGHTNING_OFFERS.md`](FABRIC_LIGHTNING_OFFERS.md). That is the Fabric layer where **signed transactions** and HTLC preimages align with document bytes — not a duplicate of BOLT12’s blinded invoice path.

## HTTP 402 (paid web / extension auto-pay)

**`@fabric/http`** maps this protocol to HTTP **402** + **`X-Fabric-Payment-Request`** (base64url UTF-8 JSON, including `documentExchange` + optional `documentOffer` / invoice summary) and optional Lightning **L402** `WWW-Authenticate`. See `fabric-http` **`docs/HTTP_402_FABRIC_PAYMENT.md`**.

## Naming (do not conflate)
| Name | Where | Meaning |
|------|-------|---------|
| **`FABRIC_DOCUMENT_OFFER`** | Wire envelope (`publishedDocumentEnvelope`) | Inventory-request JSON `type` alias for catalog/terms |
| **`DocumentOfferBook`** | `@fabric/core` CLI / Peer | Ranked local book of seller listings after `/inventory … btc` |
| **Hub sidechain `DocumentOffer`** | Hub Beacon / reward flows | Application-state reward offer — **not** this inventory envelope |
| **HTTP 402 `documentOffer`** | `@fabric/http` | Payment-request summary for web/extension auto-pay |

Canonical operator flows for L1 buy/confirm/claim/refund:
[`functions/documentExchange.js`](../functions/documentExchange.js) (CLI packs
`documents` + `documents-market`).

## See also

- [`L1_DOCUMENT_EXCHANGE.md`](L1_DOCUMENT_EXCHANGE.md) — peer settings, relay policy, tests
- [`FABRIC_LIGHTNING_OFFERS.md`](FABRIC_LIGHTNING_OFFERS.md) — `offerBtc` vs BOLT12 payment strings
