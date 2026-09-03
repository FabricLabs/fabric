# Privacy — `@fabric/core`
Operator-facing privacy model for the Fabric reference client. This is **not** a
claim of anonymity; Fabric is identity- and Bitcoin-grounded.

## What peers and observers can learn

| Signal | Visibility | Notes |
|--------|------------|-------|
| Compressed public key / Fabric id | Public to connected peers | Identity is the actor id |
| TCP address / port | Visible to direct peers; may be gossiped via `P2P_PEERING_OFFER` | Publish advertise hosts deliberately |
| Signed message author | On every AMP frame | BIP-340 over header+body |
| Chat / file / inventory bodies | Visible to recipients and any relay hops that forward the frame | Prefer sealed document delivery for priced content |
| Bitcoin addresses / HTLC outs | Public on L1 once broadcast | Standard Bitcoin transparency |
| Peer alias (`P2P_PEER_ALIAS`) | Gossiped when you publish one | Optional operator nickname |

## Directed onion (`P2P_FORWARD`) — IP privacy for delivery

Apps can source-route a payload through intermediate Fabric peers so the
**destination’s TCP peer is the last hop**, not the originator:

- Helpers: [`functions/fabricOnion.js`](functions/fabricOnion.js) /
  [`docs/P2P_FORWARD.md`](docs/P2P_FORWARD.md)
- API: `Peer#sendOnion(path, payload)` (Hub JSON-RPC: `SendOnion`)
- Mesh **`P2P_RELAY` flood is not IP-hiding** — every edge sees the frame

**Limits:** this is nested source routing, **not** Sphinx/BOLT4 encryption.
Each hop can read `nextPeer` for its layer and the cleartext `inner` unless the
application seals the payload. It does **not** provide anonymity or unlinkability
against a global observer.

## What is not hidden by default

- **`sensitive` ≠ encrypted** — Message `sensitive: true` zeros the wire
  `preimage` and refuses to invent a body-hash payment secret; it does **not**
  encrypt the AMP body. Relays and connected peers that receive the frame still
  see plaintext fields. Confidentiality requires an application seal
  (`documentSealedExchange`, `groupChatSeal` / `onionChatSeal`, or similar) or
  transport that the hop cannot read. See
  [docs/MESSAGE_BODY.md](docs/MESSAGE_BODY.md#sensitive-is-not-encryption) and
  [MESSAGES.md](MESSAGES.md#mesh-chat-model-gossip-first).
- **Direct dial metadata** — NOISE encrypts stream payloads; a direct TCP peer
  still sees your IP. Prefer `P2P_FORWARD` via a relay when the destination must
  not learn your address; use VPN/Tor at the operator layer for stronger cover.
- **Graph position** — Connecting to public hubs (`hub.fabric.pub`, etc.) reveals
  participation in that mesh to the hub operator and often to other peers.
- **Document catalog entries** — Inventory responses expose ids, hashes, and prices
  you choose to advertise.
- **Logs** — With `settings.debug`, Peer may emit public-key diagnostics. Private
  key material must never be logged (see `types/peer.js` NOISE path).

## Sealed documents

Priced documents may use AES-GCM sealed delivery (`documentSealedExchange`):
ciphertext can travel before the content key `K` is revealed. The HTLC payment
hash binds to `SHA256(K)` (or the documented envelope binding). Until claim /
key reveal, plaintext stays with the seller — this is **confidentiality until
payment**, not permanent unlinkability.

## Operator controls

- Bind listen interfaces and `FABRIC_PORT` deliberately ([docs/PRODUCTION.md](docs/PRODUCTION.md)).
- Leave `announceDocumentsOnPeerConnect`, `relayInventoryRequest`, and
  `relayInventoryResponse` off unless you intend to amplify inventory traffic.
- Store seeds / xprv only on machines you control; never commit `settings/local.js`
  or `stores/` production data.
- Prefer offline backup of BIP39 mnemonics; do not sync seed material to cloud folders.

## Related

- [SECURITY.md](SECURITY.md) — gossip/offer amplification bounds, disclosure process
- [AUDIT.md](AUDIT.md) — known gaps and recommendations
- [docs/L1_DOCUMENT_EXCHANGE.md](docs/L1_DOCUMENT_EXCHANGE.md) — document market flows
