# Lightning BOLT compatibility checklist (`@fabric/core`)

This checklist maps **[Lightning BOLTs](https://github.com/lightning/bolts)** (specification documents) to what **`@fabric/core`** exposes versus what a bundled **Core Lightning** (`lightningd`) node implements on the wire.

**Summary:** Almost all protocol behavior is **delegated to `lightningd`**. The **`Lightning`** service (`services/lightning.js`) exposes a **typed JSON-RPC surface** for operations apps need (channels, BOLT11 invoices, BOLT12 offers, payments). See **[LIGHTNING_COMPAT.md](LIGHTNING_COMPAT.md)** for the RPC ↔ method table.

| BOLT | Spec topic | In `@fabric/core` |
|------|------------|-------------------|
| **1** | Base protocol | **Delegated** — peer messaging handled by `lightningd`. |
| **2** | Peer protocol (channel / commitment) | **Delegated** — use `connectTo`, `createChannel`, `listFunds` / sync for visibility. |
| **3** | Bitcoin transaction construction | **Delegated** — funding & HTLC txs inside `lightningd`. |
| **4** | Onion routing | **Delegated** — `pay` / routing via `lightningd`. |
| **5** | On-chain tx handling / recommendations | **Delegated** — node policy. |
| **6** | *(no BOLT #6 in [lightning/bolts](https://github.com/lightning/bolts) today)* | **N/A** — numbering skips 6 in the public spec set. |
| **7** | Channel / node gossip | **Delegated** — not reimplemented in JS. |
| **8** | Encrypted transport (Noise) | **Delegated** — `lightningd` peer connection. *(Fabric P2P uses its own NOISE stack for Fabric messages; separate from LN transport.)* |
| **9** | Feature bits | **Delegated** — negotiated by `lightningd`; enable plugins (e.g. `experimental-offers`) via `Lightning` settings when spawning. |
| **10** | DNS / DNS seed queries | **Delegated** — not exposed in Fabric RPC. |
| **11** | Invoice protocol | **Exposed** — `createInvoice`, `decodePay`, `decodeLightning`, `pay` (bolt11). |
| **12** | Offers | **Exposed** — `createOffer`, `fetchInvoice`, `listOffers`, `disableOffer`, `createInvoiceRequest`, `listInvoiceRequests`, `disableInvoiceRequest`, `sendInvoice`, plus `decodeLightning` / `pay` as needed. Requires modern CLN + `experimental-offers` where applicable. |

## Legend

| Status | Meaning |
|--------|---------|
| **Delegated** | Correctness and wire format are **`lightningd`**; Fabric does not reimplement the BOLT. |
| **Exposed** | **`Lightning`** methods call the matching **Core Lightning JSON-RPC** commands (see [LIGHTNING_COMPAT.md](LIGHTNING_COMPAT.md)). |
| **N/A** | No standalone BOLT document for this number in the current public spec tree. |

## Programmatic pointer

From Node, the package-relative paths are available on the **`Lightning`** class:

```js
const Lightning = require('@fabric/core/services/lightning');
Lightning.DOCS.boltCompatibility;     // 'docs/BOLT_COMPATIBILITY.md'
Lightning.DOCS.fabricLightningMarkets; // same path — Fabric markets vs BOLT12 offers
Lightning.DOCS.fabricLightningOffers; // 'docs/FABRIC_LIGHTNING_OFFERS.md'
Lightning.DOCS.lightningCompat;       // 'docs/LIGHTNING_COMPAT.md'
Lightning.Bolt12.classifyLightningEncodedString('lno1…');
Lightning.FabricPayment.classifyPaymentEncodingString('fa1…');
Lightning.Bolt12Semantics.classifyDecodedBolt12({ type: 'bolt12 invoice' });
```

## BOLT #12 prefix strings (classification only)

**[BOLT #12](https://github.com/lightning/bolts/blob/master/12-offer-encoding.md)** defines offers with HR **`lno`** and invoice requests with **`lnr`**, the **`1`** separator, then the payload. Some spec snapshots (e.g. [rustyrussell/bolts 12-offer-encoding@cb79233](https://github.com/rustyrussell/bolts/blob/cb7923335a7e203d1dccbc4a28b434850febc6b3/12-offer-encoding.md)) describe ASCII **without** a trailing checksum; **Core Lightning** typically still returns **`lno1…` / `lnr1…`** with **bech32m**. **`Lightning.Bolt12`** only needs the shared prefix for routing UI; full validity is **`decodeLightning`** → `lightningd` **`decode`**.

Readers **must** strip **`+`** continuations (and following whitespace) when pasting split QR/tweet strings — **`normalizeBolt12ScanString`** applies that before **`classifyLightningEncodedString`**. TLV verification and signatures stay in the node.

## Draft: HTLC accountability ([bolts#1280](https://github.com/lightning/bolts/pull/1280))

The open PR **Outgoing reputation and HTLC Accountability** proposes outgoing-channel reputation, resource buckets against slow jamming, an **`accountable`** bit on **`update_add_htlc`**, **`upgrade_accountability`** in the onion (BOLT 4), optional **`invoice_accountable`** on BOLT12 offers, and related BOLT11 / blinded-route fields. That is **Lightning wire and node policy**, not JavaScript in this repo.

**`@fabric/core` compliance:** protocol correctness is **delegated to Core Lightning** (`lightningd`) or whichever LN implementation you run. This package does **not** build onions or commit HTLCs. **`Lightning#decodeLightning`** / **`decodePay`** surface whatever your node returns after decode; **`Lightning.Bolt12`** and **`Lightning.FabricPayment`** only **prefix-classify** strings (`lno1…`, `lnbc…`, `fa1…`) for UX routing—they do **not** parse TLVs or accountability bits. To align with bolts#1280 when it lands, **upgrade `lightningd`** (and any plugins) to a build that implements the PR; no separate Fabric wire implementation is required here.

## Maintenance

When adding JSON-RPC wrappers, update **[LIGHTNING_COMPAT.md](LIGHTNING_COMPAT.md)** and **`Lightning.CLN_RPC_METHODS`** in `services/lightning.js`, and extend this table if a BOLT gains a first-class Fabric API.
