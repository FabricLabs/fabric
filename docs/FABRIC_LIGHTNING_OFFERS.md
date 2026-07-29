# Fabric markets and Lightning BOLT12 (formal “offer” strings)

In **`@fabric/core`**, **Fabric commerce and resource discovery are modeled as markets**—published listings peers discover and act on. That is distinct from the Lightning specification’s use of the word **offer** for BOLT12 reusable payment strings (`lno1…`). This document ties **Application Resource Contracts (ARCs)**, **P2P inventory**, **Fabric Identity** (`id…`, bech32m), **Fabric Channels**, and **Lightning BOLT12** together so implementations stay consistent.

## Two layers of vocabulary

| Concept | Where | Meaning |
|---------|--------|---------|
| **Fabric market** | `Resource`, `Peer`, document flows | A **published** listing: committed terms to deliver data (often priced in sats). Inventory advertises BTC-backed items with **`offerBtc`** on `INVENTORY_REQUEST` / `INVENTORY_RESPONSE` (wire field name; semantically part of the **market** surface). See [L1_DOCUMENT_EXCHANGE.md](L1_DOCUMENT_EXCHANGE.md). |
| **Lightning BOLT12 offer** | `lightningd`, [BOLT #12](https://github.com/lightning/bolts/blob/master/12-offer-encoding.md) | Spec term: a reusable **payment** string (`lno1…`) from Core Lightning’s **`offer`** RPC → **`fetchinvoice`** → bolt11 **`pay`**. |
| **Fabric-routed payment (bech32m)** | `functions/fabricPaymentBech32.js` | Human-readable **`fa1…`** handles for Hub / mesh settlement (not Lightning wire). See [FABRIC_PAYMENT_BECH32.md](FABRIC_PAYMENT_BECH32.md). |

Wire types **`P2P_SESSION_OFFER`** and **`P2P_PEERING_OFFER`** are **Fabric message** kinds (handshake / peering), not BOLT12 strings.

## After publication: channels and identity

Once a **market** listing is published (canonical `DocumentPublish`, pricing gossip, inventory, or app state), **peers may establish Fabric Channels** with the **seller’s Fabric Identity**—the target party identified by bech32m **`id…`**—using **`Message`** instances:

- **Direct** delivery to a connected peer, and/or
- **Gossip** propagation where policy allows, with **encrypted envelopes** as described in **[PROTOCOL.md](../PROTOCOL.md)**, **[MESSAGES.md](../MESSAGES.md)**, and **[POLICY.md](../POLICY.md)**.

Settlement may still use Lightning where a **BOLT12** string is exposed; classify `ln…` vs `fa…` with **`Lightning.Bolt12`** / **`Lightning.FabricPayment`** (see below).

## Formal Lightning strings (classification)

Use **`functions/lightningBolt12.js`** (also **`Lightning.Bolt12`**) for cheap routing without RPC:

| Prefix / pattern | BOLT role | Typical Fabric / CLN API |
|------------------|-----------|---------------------------|
| `lno1…` | BOLT12 **offer** | `Lightning#createOffer`, `fetchInvoice`, `listOffers`, `disableOffer` |
| `lnr1…` | BOLT12 **invoice_request** | `createInvoiceRequest`, `sendInvoice`, `listInvoiceRequests`, `disableInvoiceRequest` |
| `lnbc…` / `lntb…` / … | BOLT11 **invoice** | `createInvoice`, `decodePay`, `pay` |

Full TLV decode: **`Lightning#decodeLightning`** → CLN `decode`.

## Integration pattern

1. **Discovery** — Peers learn documents and rates via Fabric **`DocumentPublish`** / inventory (see [L1_DOCUMENT_EXCHANGE.md](L1_DOCUMENT_EXCHANGE.md)).
2. **Channel / identity** — Use **`id…`** and **`Message`** for Fabric Channel setup relative to the published market party; envelopes may arrive directly or via gossip.
3. **Lightning payment rail** — When the seller exposes a **BOLT12** string, store it alongside the document id (hub or app state) and use **`fetchInvoice` → `pay`** for settlement; or publish only the bolt12 QR/string for pure-LN UX.
4. **No collision** — Do not store Fabric session/peering payloads in the same field as **`bolt12`**; use distinct keys (e.g. `fabricPeering` vs `lnBolt12`).

## Programmatic

```js
const Lightning = require('@fabric/core/services/lightning');
const { classifyLightningEncodedString, FabricLightningMarketRole } = Lightning.Bolt12;
const { classifyPaymentEncodingString, encodeFabricRoutedPaymentV0 } = Lightning.FabricPayment;

classifyLightningEncodedString('lno1…'); // 'bolt12_offer'
classifyPaymentEncodingString('fa1…');   // 'fabric_routed_payment' — checks `fa` before `ln`
encodeFabricRoutedPaymentV0({ hash32: Buffer.alloc(32, 1) });
FabricLightningMarketRole.lightning_bolt12_offer;
// `FabricLightningOfferRole` is the same object (backward-compatible alias).

// Optional: interpret `decode` JSON — BIP-340 signatures apply to bolt12 invoice_request / invoice, not offers.
Lightning.Bolt12Semantics.bip340SignatureApplies(
  Lightning.Bolt12Semantics.classifyDecodedBolt12({ type: 'bolt12 invoice' })
); // true
```

See also **`Lightning.Bolt12Semantics`** (`functions/bolt12Semantics.js`), **[FABRIC_PAYMENT_BECH32.md](FABRIC_PAYMENT_BECH32.md)**, **[LIGHTNING_COMPAT.md](LIGHTNING_COMPAT.md)**, and **[BOLT_COMPATIBILITY.md](BOLT_COMPATIBILITY.md)**.
