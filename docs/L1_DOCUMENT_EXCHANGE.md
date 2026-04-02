# L1 document exchange
This document tracks **priorities**, **expectations**, and **tests** for Layer-1 document publish, inventory, and settlement alignment with [`functions/publishedDocumentEnvelope.js`](../functions/publishedDocumentEnvelope.js) and hub flows.

## Canonical L1 binding (implemented)
Hub and on-chain flows use:

1. **Canonical `DocumentPublish` AMP bytes** — `documentPublishEnvelopeBuffer(docId, parsed)` (whitelisted JSON + `Message.fromVector(['DocumentPublish', …])`).
2. **Preimage** — `SHA256(wire bytes)`.
3. **`purchaseContentHashHex`** — `SHA256(preimage)` as hex (invoice / HTLC `contentHash`).

See also: [`docs/PAYMENTS_DOCUMENT_BINDING.md`](PAYMENTS_DOCUMENT_BINDING.md).

**Tests:** `tests/l1.document.exchange.expectations.js` (envelope + hash invariants).

## Peer behavior (implemented vs gaps)
| Area | Status | Notes |
|------|--------|--------|
| `INVENTORY_REQUEST` / `INVENTORY_RESPONSE` | Emit `inventory` / `inventoryResponse` | Hub or app layer fills responses. Opt-in **`relayInventoryRequest`** / **`relayInventoryResponse`** (with **`serveLocalDocumentInventory`**) forward unserved BTC inventory traffic per `POLICY.md`. |
| `P2P_DOCUMENT_PUBLISH` (generic body) | Emit `documentPublish` | Pricing gossip: `source: 'pricing'`, `documentId`, `rateSats`, `contentHash`. |
| `_publishDocument(id, content, rateSats)` | Canonical + optional pricing | **1)** `DocumentPublish` AMP (L1 hash). **2)** If `rateSats > 0`, generic `P2P_DOCUMENT_PUBLISH` with `contentHash`. |
| Wire `DOCUMENT_PUBLISH` | Implemented | `Peer#_handleFabricMessage` emits `documentPublish` / `DocumentPublish` (`source: 'canonical'`). |
| Wire `DOCUMENT_REQUEST` | Implemented | Emits `documentRequest` / `DocumentRequest`. If `state.documents[id]` exists, replies with `P2P_FILE_SEND` to the requester; else **relays** the request to other peers. |
| CLI `DocumentPublish` / `DocumentRequest` | Matched | `Peer` emits PascalCase and camelCase; `request` CLI command signs and broadcasts `DocumentRequest`. |
| `serveLocalDocumentInventory` | Opt-in | When `true`, answers `INVENTORY_REQUEST` with `object.offerBtc` using `state.documents`, `documentRates`, and L1 `contentHash` per item. |
| `announceDocumentsOnPeerConnect` | Opt-in | When `true`, after `P2P_SESSION_OPEN` to an inbound peer, replays canonical + pricing publishes for all `state.documents` (late-joiner gossip). |
| `relayInventoryRequest` | Opt-in | With `serveLocalDocumentInventory`, relays `offerBtc` requests that produced no local `INVENTORY_RESPONSE`. |
| `relayInventoryResponse` | Opt-in | Relays `INVENTORY_RESPONSE` generic wire to peers other than the sender (star routers). |

## Prioritized backlog
### P0 — Correctness and hub interoperability

1. ~~**Unify publish bytes**~~ — Canonical `DocumentPublish` is primary; pricing uses generic gossip with explicit `contentHash`.
2. ~~**Wire dispatch**~~ — `DOCUMENT_PUBLISH` / `DOCUMENT_REQUEST` handled in `Peer#_handleFabricMessage`.
3. ~~**CLI event names**~~ — `DocumentPublish` / `DocumentRequest` emitted alongside camelCase events.

### P1 — Data plane in core
4. ~~**Default inventory helper**~~ — `serveLocalDocumentInventory` + `_respondInventoryFromLocalDocuments`; `_publishDocument` records `documentRates`.
5. ~~**File API**~~ — `Peer#sendDocumentFileToPeer(documentId, peerAddress)` wraps `P2P_FILE_SEND` (shared with `DOCUMENT_REQUEST` fulfillment).
6. ~~**Request round-trip**~~ — `DOCUMENT_REQUEST` → local `P2P_FILE_SEND` when held; tests in `tests/fabric.peer.js` and `tests/fabric.l1.document.network.js`.

### P2 — Settlement and policy
7. **Funds** — `Wallet.purchaseContentHashHex(documentId, parsed)` aligns with hub `CreatePurchaseInvoice` / HTLC `contentHash`; HTLC spend path remains service/hub-specific.
8. ~~**Relay policy (inventory)**~~ — `relayInventoryRequest` / `relayInventoryResponse` (defaults off; request relay requires `serveLocalDocumentInventory` + unserved `offerBtc` request). `DOCUMENT_REQUEST` already relays when the document is not held.

### P3 — UX and resilience
9. ~~**CLI handlers**~~ — `_handlePeerDocumentPublish` / `_handlePeerDocumentRequest` show document id, truncated hash, and local-library hints (not raw JSON dumps).
10. ~~**Late joiners**~~ — `announceDocumentsOnPeerConnect` replays publishes after `P2P_SESSION_OPEN`; inventory relay covers buyers behind a star router.

## Regression tests
| File | Purpose |
|------|---------|
| `tests/l1.document.exchange.expectations.js` | Envelope/hash invariants, canonical vs pricing broadcast, CLI/Peer event wiring. |
| `tests/l1.document.exchange.flow.js` | End-to-end TCP: canonical hash + pricing alignment. |
| `tests/fabric.l1.document.network.js` | Network `documentPublish`, `DOCUMENT_REQUEST` → `file`, `purchaseContentHashHex`, star inventory relay. |
| `tests/fabric.hub.mesh.integration.js` | Hub-style mesh: inventory + file send; optional `announceDocumentsOnPeerConnect` late-joiner replay. |
| `tests/fabric.peer.js` | `DOCUMENT_REQUEST` dispatch, relay, inventory relay flags, `P2P_FILE_SEND` reply when held. |

## Expectations (machine-checked)
The expectations test file asserts:

- **`purchaseContentHashHex`** is deterministic and 64 hex chars for valid parsed documents.
- **Preimage** matches `SHA256(documentPublishEnvelopeBuffer(…))`.
- **`Peer`** emits **`documentPublish`** for `P2P_DOCUMENT_PUBLISH` (pricing) and canonical **`DocumentPublish`** for `DOCUMENT_PUBLISH`.
- **Inventory** events fire for `INVENTORY_REQUEST` / `INVENTORY_RESPONSE` generic messages.
- **Canonical alignment:** `_publishDocument` with `rate 0` matches hub envelope bytes; with `rate > 0` the first broadcast matches the canonical envelope and the second is pricing gossip.
