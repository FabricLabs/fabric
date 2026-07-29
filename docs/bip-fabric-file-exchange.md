# BIP: Content-Addressed File Exchange over Peer Channels (Draft)

```
BIP: ????
Title: Content-Addressed File Exchange with Optional Bitcoin Settlement
Author: Fabric Labs <dev@fabric.pub>
Comments-URI: https://github.com/FabricLabs/fabric
Status: Draft
Type: Informational
Created: 2026-07-24
License: BSD-2-Clause
```

## Abstract

This document describes a peer-to-peer **file exchange** pattern for Bitcoin-adjacent networks: parties discover content by inventory, request delivery, and transfer bytes only after **explicit consent**. Optional **Layer-1 Bitcoin** settlement binds payment to a deterministic content commitment (hash of a canonical publish envelope) so buyers and sellers can atomicize “pay then reveal” without a trusted courier.

The goal is a mailing-list-ready sketch that Bitcoin developers can review independently of any particular application stack. A concrete open-source profile is implemented in Fabric (`DocumentPublish`, `INVENTORY_*`, `DOCUMENT_REQUEST`, `P2P_FILE_SEND`).

## Motivation

Bitcoin already settles value. Operators still need a **minimal, auditable** way to:

1. Advertise that a peer **holds** a blob (inventory).
2. Ask for that blob (request).
3. Receive bytes only when the holder **approves** (consent).
4. Optionally require an on-chain or HTLC payment keyed to the **same content commitment** used in discovery.

Existing approaches (HTTP downloads, LN URL, ad-hoc torrents) do not share a single content commitment usable as both a catalog id and an HTLC payment hash. This BIP specifies that binding at a protocol level without mandating a particular transport beyond authenticated peer messaging.

## Definitions

- **Document id** — Stable catalog key (often a content hash of the payload or an application id).
- **Publish envelope** — Canonical serialization of whitelisted document metadata + body commitment used for hashing.
- **Content commitment** — `SHA256(SHA256(publish_envelope_bytes))` (or an equivalent tagged hash); used as invoice / HTLC `payment_hash` material.
- **Inventory** — List of `{ id, size?, mime?, rate_sats?, content_commitment? }` a peer is willing to discuss.
- **Consent** — Holder must approve before ciphertext/plaintext bytes leave their node (no silent auto-exfil on request alone).

## Specification (normative sketch)

### Messages (logical)

| Step | Message | From → To | Purpose |
|------|---------|-----------|---------|
| 1 | `inventory_request` | Buyer → Seller | Ask for catalog (`kind=documents`) or priced offers |
| 2 | `inventory_response` | Seller → Buyer | Items + optional `rate_sats` + `content_commitment` |
| 3 | `document_request` | Buyer → Seller | Ask to receive document `id` |
| 4 | *(local)* approve/deny | Seller operator/policy | Consent gate |
| 5 | `file_send` | Seller → Buyer | Payload (may be chunked; baseline is single part) |
| 6 *(optional)* | Bitcoin tx / HTLC | Buyer ↔ Seller | Settlement before step 5 when priced |

Transports MUST authenticate peers (e.g. Noise + static keys). Relays MUST NOT rewrite message bodies when forwarding (signature preservation).

### Consent rule

When a seller holds `id` and receives `document_request`:

- **Consent mode (recommended for interactive nodes):** enqueue; send `file_send` only after approve.
- **Auto-fulfill mode (optional for bots):** may send immediately — MUST be explicit in node policy.

### Optional L1 settlement

For priced items (`rate_sats > 0`):

1. Seller advertises `content_commitment` in inventory / publish gossip.
2. Buyer pays via one of:
   - **P2TR HTLC** whose payment hash commits to `content_commitment` (seller reveals preimage after payment, then `file_send`), or
   - **Invoice** (on-chain or LN) whose description/hash field binds the same commitment.
3. Seller verifies payment, then performs step 5.

Exact scripts MAY follow existing P2TR HTLC inventory profiles; this BIP only requires a **stable commitment** algorithm shared by catalog and payment.

### Commitment algorithm (Fabric profile)

Informative — Fabric today:

1. Build whitelisted JSON fields for document `id`.
2. Encode as AMP `DocumentPublish` message bytes.
3. `preimage = SHA256(envelope_bytes)`.
4. `content_commitment = SHA256(preimage)` (hex for UI / invoices).

Other profiles MAY use BIP-340 tagged hashes; they MUST document the tag and field whitelist.

## Rationale

- Separating **discovery** (inventory/publish) from **delivery** (`file_send`) allows consent and payment gates without encrypting the whole DHT.
- Binding payment to the publish envelope (not raw file bytes alone) lets metadata and pricing evolve while keeping a single hash for invoices.
- Consent-by-default matches operator-run nodes; auto-fulfill remains available for unattended mirrors.

## Backward compatibility

Informational. Existing free file drops remain valid as auto-fulfill + `rate_sats = 0`.

## Multi-peer blobs and ranking

Buyers assemble an **offer book** from many inventory responses and rank by price, latency, peer score, and completeness (`documentMarket`). Every file is advertised as a `DocumentBlobIndex` (Fabric `Tree` merkle over blob leaves): one wire-sized blob when small, many when large. Each blob may be paid to a different peer and reassembled after hash checks (`documentBlobManifest`).

## Private paid relay

Budgeted `document_request` messages are **rewritten** at each hop (new signature, reduced `maxSats`) so the seller does not see the original buyer. Relayers keep the fee skim (`maxSats_in - maxSats_out`). See `documentMarket` and Peer `relayPrivateDocumentRequests`.

## Reference implementation

- Peer APIs + private relay — `@fabric/core` `types/peer.js`.
- Shared settle — `functions/inventoryHtlc.js`, `documentSealedExchange.js`, `documentMarket.js`, `documentBlobManifest.js`.
- Interactive CLI: `/import`, `/publish`, `/inventory`, `/offers`, `/buy`, `/confirm`, `/request`, `/pending`, `/approve`, `/relayfees` — `types/cli.js`.
- Hub RPCs remain orchestration; crypto modules re-export from `@fabric/core`.
- Simulator: `document-swarm`, `document-relay-private`.
- Status tracker: [`docs/L1_DOCUMENT_EXCHANGE.md`](L1_DOCUMENT_EXCHANGE.md).

## Next steps (for Bitcoin ML / BIP process)

1. Freeze commitment algorithm (tagged hash vs double-SHA256) with test vectors.
2. Specify chunking (DocumentBlobIndex + Tree merkle; wire-sized blobs), resume, and max size for `file_send`.
3. Normative P2TR HTLC script template + failure/refund timelines.
4. Privacy: encrypted payloads keyed after payment (seller seals content until settle).
5. Assign BIP number; post to bitcoin-dev with subject `BIP proposal: content-addressed file exchange`.

## Copyright

This document is dual-licensed under the BSD 2-clause license and the MIT license.
